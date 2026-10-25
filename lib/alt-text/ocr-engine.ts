/**
 * @file lib/alt-text/ocr-engine.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Phase 3 Task 5 — self-hosted Tesseract.js (WASM) provider; Phase 3 Task 6 — English,
 *   Hindi and English + Hindi recognition modes. Runs entirely inside this process: no network, no
 *   external API, no image bytes leave the server.
 *
 * - Language packs ship as npm packages (`@tesseract.js-data/eng`, `@tesseract.js-data/hin`, MIT,
 *   from the official naptha/tessdata project). Each file is SHA-256 checked once, and the verified
 *   bytes themselves are handed to the worker (`{ code, data }`), so what was checked is exactly what
 *   is loaded and nothing is ever fetched at runtime.
 * - One recognition at a time across all modes (shared queue, `engine_busy` beyond MAX_QUEUED), a hard
 *   timeout that terminates the worker, and at most MAX_WORKERS initialised workers kept warm
 *   (least-recently-used evicted). English-only requests keep using an English-only worker.
 * - Workers are terminated after an idle period.
 */
import "server-only"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { createWorker, OEM, PSM, type Worker } from "tesseract.js"
import { OCR_LANGUAGE_MODES, OCR_LIMITS, type OcrErrorCategory, type OcrLanguageMode, type OcrModelReference, type OcrPageSegmentation, type OcrPixelBox } from "./ocr-contract"

/** Kept in sync with node_modules/tesseract.js/package.json (asserted by the engine test). */
export const OCR_ENGINE_VERSION = "tesseract.js@7.0.0"

type PackDef = { pkg: string; version: string; variant: string; sha256: string }

/**
 * Pinned, integrity-checked LSTM ("best_int") packs. Hashes are of the files inside the exact
 * package versions in package.json; updating a package without updating its hash disables that pack.
 */
export const OCR_LANGUAGE_PACKS = {
  eng: { pkg: "@tesseract.js-data/eng", version: "1.0.0", variant: "4.0.0_best_int", sha256: "45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91" },
  hin: { pkg: "@tesseract.js-data/hin", version: "1.0.0", variant: "4.0.0_best_int", sha256: "f3b6a0d320df38d886178cdd727b90dbf9df3db053adb32bd9cf73f0463cda07" },
} as const satisfies Record<string, PackDef>
export type OcrPackCode = keyof typeof OCR_LANGUAGE_PACKS

/** Task 5 constant, kept for existing callers: the English model reference. */
export const OCR_LANGUAGE_MODEL = "eng@4.0.0_best_int"

export const packReference = (code: OcrPackCode): OcrModelReference => {
  const p = OCR_LANGUAGE_PACKS[code]
  return { code, reference: `${p.pkg}@${p.version}/${p.variant}`, sha256: p.sha256 }
}
export const modelsForMode = (mode: OcrLanguageMode): OcrModelReference[] => OCR_LANGUAGE_MODES[mode].tesseract.map((c) => packReference(c))

const MAX_QUEUED = 4
const MAX_WORKERS = 2
const IDLE_MS = 5 * 60_000
const FAILED_PROBE_TTL_MS = 60_000

export const ocrPackPath = (code: OcrPackCode) => {
  const p = OCR_LANGUAGE_PACKS[code]
  return path.join(process.cwd(), "node_modules", ...p.pkg.split("/"), p.variant, `${code}.traineddata.gz`)
}
/** Task 5 helper (English pack directory). */
export const ocrLanguageDir = () => path.dirname(ocrPackPath("eng"))

export class OcrEngineError extends Error {
  constructor(
    readonly category: OcrErrorCategory,
    message?: string,
  ) {
    super(message ?? category)
    this.name = "OcrEngineError"
  }
}

export type OcrModeHealth = { status: "available" | "asset_missing" | "integrity_failed" | "init_failed" | "disabled"; reason: string | null }

export type OcrEngineHealth = {
  status: "available" | "unavailable" | "misconfigured"
  reason: string | null
  engineVersion: string
  languageModel: string
  /** ISO 639-1 codes whose pack verified and initialised in at least one mode. */
  languages: string[]
  /** Per recognition mode: only `available` modes were actually initialised in this process. */
  modes: Record<OcrLanguageMode, OcrModeHealth>
}

/* ───────────── Pack verification (once per process) ───────────── */

const verifiedPacks = new Map<OcrPackCode, Promise<Uint8Array>>()

function loadPack(code: OcrPackCode): Promise<Uint8Array> {
  let p = verifiedPacks.get(code)
  if (!p) {
    p = (async () => {
      let bytes: Buffer
      try {
        bytes = await readFile(ocrPackPath(code))
      } catch {
        throw new OcrEngineError("language_asset_missing", `The ${code} OCR language pack is not installed.`)
      }
      if (createHash("sha256").update(bytes).digest("hex") !== OCR_LANGUAGE_PACKS[code].sha256) {
        throw new OcrEngineError("language_asset_invalid", `The ${code} OCR language pack failed its integrity check.`)
      }
      return new Uint8Array(bytes)
    })()
    // Failures are not cached so an operator fix is picked up on the next probe.
    p.catch(() => verifiedPacks.delete(code))
    verifiedPacks.set(code, p)
  }
  return p
}

/* ───────────── Worker pool (bounded, LRU) ───────────── */

const workers = new Map<OcrLanguageMode, Promise<Worker>>()
let idleTimer: ReturnType<typeof setTimeout> | null = null
let queue: Promise<unknown> = Promise.resolve()
let queued = 0
let probeCache: { at: number; health: OcrEngineHealth } | null = null
/** Worker start-up failures seen by recognition or probing, reported by the readiness check for a short TTL. */
const initFailures = new Map<OcrLanguageMode, { at: number; health: OcrModeHealth }>()

async function terminate(mode: OcrLanguageMode) {
  const p = workers.get(mode)
  workers.delete(mode)
  if (!p) return
  try {
    await (await p).terminate()
  } catch {
    /* already gone */
  }
}

/** Only called from inside the serial queue, so no other job is using an evicted worker. */
async function getWorker(mode: OcrLanguageMode): Promise<Worker> {
  const existing = workers.get(mode)
  if (existing) {
    workers.delete(mode)
    workers.set(mode, existing) // mark most-recently used
    return existing
  }
  while (workers.size >= MAX_WORKERS) await terminate(workers.keys().next().value as OcrLanguageMode)
  const p = (async () => {
    const langs = await Promise.all(OCR_LANGUAGE_MODES[mode].tesseract.map(async (code) => ({ code, data: await loadPack(code) })))
    // cacheMethod "none": never write traineddata to disk. errorHandler: without it tesseract.js
    // rethrows job rejections from the worker message listener as uncaught exceptions.
    const worker = await createWorker(langs, OEM.LSTM_ONLY, { cacheMethod: "none", errorHandler: () => undefined }).catch((e) => {
      throw e instanceof OcrEngineError ? e : new OcrEngineError("language_init_failed", `The ${OCR_LANGUAGE_MODES[mode].label} OCR worker could not be initialised.`)
    })
    await worker.setParameters({ preserve_interword_spaces: "1" })
    return worker
  })()
  workers.set(mode, p)
  p.then(
    () => initFailures.delete(mode),
    (e) => {
      if (workers.get(mode) === p) workers.delete(mode)
      initFailures.set(mode, { at: Date.now(), health: healthFromError(e) })
    },
  )
  return p
}

function scheduleIdleShutdown() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (queued === 0) for (const m of [...workers.keys()]) void terminate(m)
  }, IDLE_MS)
  idleTimer.unref?.()
}

/** Serial queue shared by recognition and probing. */
function enqueue<T>(fn: () => Promise<T>, bounded: boolean): Promise<T> {
  if (bounded && queued >= MAX_QUEUED) return Promise.reject(new OcrEngineError("engine_busy"))
  queued++
  const p = queue.then(fn, fn)
  queue = p.catch(() => undefined)
  return p.finally(() => {
    queued--
    scheduleIdleShutdown()
  })
}

/* ───────────── Health ───────────── */

const MODE_IDS = Object.keys(OCR_LANGUAGE_MODES) as OcrLanguageMode[]

const healthFromError = (e: unknown): OcrModeHealth => {
  if (e instanceof OcrEngineError) {
    const status = e.category === "language_asset_missing" ? "asset_missing" : e.category === "language_asset_invalid" ? "integrity_failed" : "init_failed"
    return { status, reason: e.message }
  }
  return { status: "init_failed", reason: "The OCR worker could not be started." }
}

/**
 * Health check used by the capability registry. Every mode is verified by actually initialising its
 * worker with the verified packs; a mode is never reported available because its code is known.
 * The English mode is initialised last so it stays warm. Successful results are cached per process.
 */
export async function probeOcrEngine(): Promise<OcrEngineHealth> {
  const base = { engineVersion: OCR_ENGINE_VERSION, languageModel: OCR_LANGUAGE_MODEL }
  if (process.env.ALT_TEXT_OCR_DISABLED === "1") {
    const disabled: OcrModeHealth = { status: "disabled", reason: "OCR is disabled for this deployment." }
    return { ...base, status: "unavailable", reason: disabled.reason, languages: [], modes: { eng: disabled, hin: disabled, eng_hin: disabled } }
  }
  if (probeCache && (probeCache.health.status === "available" || Date.now() - probeCache.at < FAILED_PROBE_TTL_MS)) return probeCache.health
  const health = await enqueue(async () => {
    const modes = {} as Record<OcrLanguageMode, OcrModeHealth>
    for (const mode of [...MODE_IDS.filter((m) => m !== "eng"), "eng" as const]) {
      try {
        await getWorker(mode)
        modes[mode] = { status: "available", reason: null }
      } catch (e) {
        modes[mode] = healthFromError(e)
        console.error("[alt-text/ocr-engine] mode probe failed", mode, e instanceof Error ? e.message : "unknown")
      }
    }
    const ok = MODE_IDS.filter((m) => modes[m].status === "available")
    const languages = [...new Set(ok.flatMap((m) => [...OCR_LANGUAGE_MODES[m].languages]))]
    const anyMisconfigured = MODE_IDS.some((m) => modes[m].status === "asset_missing" || modes[m].status === "integrity_failed")
    const h: OcrEngineHealth = {
      ...base,
      status: ok.length ? "available" : anyMisconfigured ? "misconfigured" : "unavailable",
      reason: ok.length ? null : (modes.eng.reason ?? "The OCR engine could not be started."),
      languages,
      modes,
    }
    return h
  }, false)
  probeCache = { at: Date.now(), health }
  return health
}

/**
 * Lightweight availability check for request paths (settings, classification, regions, OCR).
 * It never starts a Tesseract worker: on shared hosting, initialising WASM workers for every mode
 * inside a page request can exhaust the process memory and take the whole app down (proxy 503).
 * A mode counts as available when all of its pinned packs exist and pass their SHA-256 check and its
 * worker has not recently failed to start. Results from a full probe or real recognition take precedence.
 */
export async function checkOcrReadiness(): Promise<OcrEngineHealth> {
  const base = { engineVersion: OCR_ENGINE_VERSION, languageModel: OCR_LANGUAGE_MODEL }
  if (process.env.ALT_TEXT_OCR_DISABLED === "1") return probeOcrEngine()
  if (probeCache && (probeCache.health.status === "available" || Date.now() - probeCache.at < FAILED_PROBE_TTL_MS)) return probeCache.health
  const modes = {} as Record<OcrLanguageMode, OcrModeHealth>
  for (const mode of MODE_IDS) {
    const failure = initFailures.get(mode)
    if (failure && Date.now() - failure.at < FAILED_PROBE_TTL_MS) {
      modes[mode] = failure.health
      continue
    }
    try {
      await Promise.all(OCR_LANGUAGE_MODES[mode].tesseract.map((code) => loadPack(code)))
      modes[mode] = { status: "available", reason: null }
    } catch (e) {
      modes[mode] = healthFromError(e)
    }
  }
  const ok = MODE_IDS.filter((m) => modes[m].status === "available")
  const anyMisconfigured = MODE_IDS.some((m) => modes[m].status === "asset_missing" || modes[m].status === "integrity_failed")
  return {
    ...base,
    status: ok.length ? "available" : anyMisconfigured ? "misconfigured" : "unavailable",
    reason: ok.length ? null : (modes.eng.reason ?? "The OCR engine could not be started."),
    languages: [...new Set(ok.flatMap((m) => [...OCR_LANGUAGE_MODES[m].languages]))],
    modes,
  }
}

/* ───────────── Recognition ───────────── */

export type OcrRecognition = {
  text: string
  blocks: unknown
  durationMs: number
  psm: string
  languageMode: OcrLanguageMode
  /** Tesseract language string actually loaded, e.g. "eng" or "hin+eng". */
  loadedLanguages: string
  models: OcrModelReference[]
}

function classifyEngineError(e: unknown): OcrEngineError {
  if (e instanceof OcrEngineError) return e
  const msg = e instanceof Error ? e.message : String(e)
  if (/read image|pixReadMem|image/i.test(msg)) return new OcrEngineError("decode_failed")
  if (/memory|OOM|Cannot enlarge/i.test(msg)) return new OcrEngineError("memory_exceeded")
  return new OcrEngineError("engine_error")
}

const PSM_VALUES: Record<OcrPageSegmentation, PSM> = {
  auto: PSM.AUTO,
  single_block: PSM.SINGLE_BLOCK,
  single_line: PSM.SINGLE_LINE,
  sparse_text: PSM.SPARSE_TEXT,
}

/**
 * Recognises printed text in the requested language mode (default English, Task 5 behaviour).
 * `rectangle` limits recognition to a stored-pixel crop; returned boxes are in full-image
 * stored-pixel coordinates either way. Never falls back to another language: a mode whose packs or
 * worker fail raises an error instead.
 */
export function recognizeImage(input: {
  bytes: Uint8Array
  rectangle?: OcrPixelBox | null
  timeoutMs?: number
  languageMode?: OcrLanguageMode
  segmentation?: OcrPageSegmentation
}): Promise<OcrRecognition> {
  const mode: OcrLanguageMode = input.languageMode ?? "eng"
  if (!(mode in OCR_LANGUAGE_MODES)) return Promise.reject(new OcrEngineError("invalid_language"))
  const segmentation: OcrPageSegmentation = input.segmentation ?? (input.rectangle ? "single_block" : "auto")
  if (!(segmentation in PSM_VALUES)) return Promise.reject(new OcrEngineError("engine_error", "Unsupported page segmentation."))
  return enqueue(async () => {
    const psm = PSM_VALUES[segmentation]
    const started = Date.now()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const worker = await getWorker(mode)
      await worker.setParameters({ tessedit_pageseg_mode: psm })
      const job = worker.recognize(Buffer.from(input.bytes), input.rectangle ? { rectangle: input.rectangle } : {}, { text: true, blocks: true })
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new OcrEngineError("timeout")), input.timeoutMs ?? OCR_LIMITS.timeoutMs)
      })
      const result = await Promise.race([job, timeout])
      return {
        text: result.data.text ?? "",
        blocks: result.data.blocks ?? [],
        durationMs: Date.now() - started,
        psm: String(psm),
        languageMode: mode,
        loadedLanguages: OCR_LANGUAGE_MODES[mode].tesseract.join("+"),
        models: modelsForMode(mode),
      }
    } catch (e) {
      const err = classifyEngineError(e)
      // A timed-out or crashed worker cannot be trusted with the next job.
      if (err.category === "timeout" || err.category === "engine_error" || err.category === "memory_exceeded") await terminate(mode)
      throw err
    } finally {
      if (timer) clearTimeout(timer)
    }
  }, true)
}

/** Test/shutdown hook. */
export async function shutdownOcrEngine() {
  if (idleTimer) clearTimeout(idleTimer)
  probeCache = null
  initFailures.clear()
  for (const m of [...workers.keys()]) await terminate(m)
}
