/**
 * @file lib/alt-text/ocr-engine.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Phase 3 Task 5 — self-hosted Tesseract.js (WASM) provider. Runs entirely inside this
 *   process: no network, no external API, no image bytes leave the server.
 *
 * - The English LSTM model ships in `@tesseract.js-data/eng` and is integrity-checked (SHA-256)
 *   before the first worker starts; a missing or altered file reports `misconfigured`.
 * - One worker, one job at a time, a bounded queue (`engine_busy` beyond it) and a hard timeout that
 *   terminates the worker so a stuck job cannot hold memory.
 * - The worker is terminated after an idle period.
 */
import "server-only"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { createWorker, OEM, PSM, type Worker } from "tesseract.js"
import { OCR_LIMITS, type OcrErrorCategory, type OcrPixelBox } from "./ocr-contract"

/** Kept in sync with node_modules/tesseract.js/package.json (asserted by the engine test). */
export const OCR_ENGINE_VERSION = "tesseract.js@7.0.0"
export const OCR_LANGUAGE_MODEL = "eng@4.0.0_best_int"
/** SHA-256 of @tesseract.js-data/eng@1.0.0 4.0.0_best_int/eng.traineddata.gz. */
export const OCR_LANGUAGE_MODEL_SHA256 = "45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91"

const MAX_QUEUED = 4
const IDLE_MS = 5 * 60_000
const FAILED_PROBE_TTL_MS = 60_000

export const ocrLanguageDir = () => path.join(process.cwd(), "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int")

export class OcrEngineError extends Error {
  constructor(
    readonly category: OcrErrorCategory,
    message?: string,
  ) {
    super(message ?? category)
    this.name = "OcrEngineError"
  }
}

export type OcrEngineHealth = {
  status: "available" | "unavailable" | "misconfigured"
  reason: string | null
  engineVersion: string
  languageModel: string
  languages: string[]
}

let workerPromise: Promise<Worker> | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let queue: Promise<unknown> = Promise.resolve()
let queued = 0
let modelVerified = false
let probeCache: { at: number; health: OcrEngineHealth } | null = null

async function verifyModel(): Promise<void> {
  if (modelVerified) return
  let bytes: Buffer
  try {
    bytes = await readFile(path.join(ocrLanguageDir(), "eng.traineddata.gz"))
  } catch {
    throw new OcrEngineError("engine_unavailable", "The English OCR language pack is not installed.")
  }
  if (createHash("sha256").update(bytes).digest("hex") !== OCR_LANGUAGE_MODEL_SHA256) {
    throw new OcrEngineError("engine_unavailable", "The English OCR language pack failed its integrity check.")
  }
  modelVerified = true
}

function getWorker(): Promise<Worker> {
  workerPromise ??= (async () => {
    await verifyModel()
    // cacheMethod "none": never write traineddata to the working directory.
    const worker = await createWorker("eng", OEM.LSTM_ONLY, { langPath: ocrLanguageDir(), gzip: true, cacheMethod: "none" })
    await worker.setParameters({ preserve_interword_spaces: "1" })
    return worker
  })().catch((e) => {
    workerPromise = null
    throw e
  })
  return workerPromise
}

async function terminateWorker() {
  const p = workerPromise
  workerPromise = null
  if (!p) return
  try {
    await (await p).terminate()
  } catch {
    /* already gone */
  }
}

function scheduleIdleShutdown() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (queued === 0) void terminateWorker()
  }, IDLE_MS)
  idleTimer.unref?.()
}

/** Health check used by the capability registry. Successful results are cached for the process. */
export async function probeOcrEngine(): Promise<OcrEngineHealth> {
  if (process.env.ALT_TEXT_OCR_DISABLED === "1") {
    return { status: "unavailable", reason: "OCR is disabled for this deployment.", engineVersion: OCR_ENGINE_VERSION, languageModel: OCR_LANGUAGE_MODEL, languages: [] }
  }
  if (probeCache && (probeCache.health.status === "available" || Date.now() - probeCache.at < FAILED_PROBE_TTL_MS)) return probeCache.health
  let health: OcrEngineHealth
  try {
    await getWorker()
    scheduleIdleShutdown()
    health = { status: "available", reason: null, engineVersion: OCR_ENGINE_VERSION, languageModel: OCR_LANGUAGE_MODEL, languages: ["en"] }
  } catch (e) {
    const misconfigured = e instanceof OcrEngineError
    console.error("[alt-text/ocr-engine] probe failed", e instanceof Error ? e.message : "unknown")
    health = {
      status: misconfigured ? "misconfigured" : "unavailable",
      reason: misconfigured ? e.message : "The OCR engine could not be started.",
      engineVersion: OCR_ENGINE_VERSION,
      languageModel: OCR_LANGUAGE_MODEL,
      languages: [],
    }
  }
  probeCache = { at: Date.now(), health }
  return health
}

export type OcrRecognition = { text: string; blocks: unknown; durationMs: number; psm: string }

function classifyEngineError(e: unknown): OcrEngineError {
  if (e instanceof OcrEngineError) return e
  const msg = e instanceof Error ? e.message : String(e)
  if (/read image|pixReadMem|image/i.test(msg)) return new OcrEngineError("decode_failed")
  return new OcrEngineError("engine_error")
}

/**
 * Recognises printed English text. `rectangle` limits recognition to a stored-pixel crop; returned
 * boxes are in full-image stored-pixel coordinates either way.
 */
export function recognizeImage(input: { bytes: Uint8Array; rectangle?: OcrPixelBox | null; timeoutMs?: number }): Promise<OcrRecognition> {
  if (queued >= MAX_QUEUED) return Promise.reject(new OcrEngineError("engine_busy"))
  queued++
  const run = async (): Promise<OcrRecognition> => {
    const psm = input.rectangle ? PSM.SINGLE_BLOCK : PSM.AUTO
    const started = Date.now()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const worker = await getWorker()
      await worker.setParameters({ tessedit_pageseg_mode: psm })
      const job = worker.recognize(Buffer.from(input.bytes), input.rectangle ? { rectangle: input.rectangle } : {}, { text: true, blocks: true })
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new OcrEngineError("timeout")), input.timeoutMs ?? OCR_LIMITS.timeoutMs)
      })
      const result = await Promise.race([job, timeout])
      return { text: result.data.text ?? "", blocks: result.data.blocks ?? [], durationMs: Date.now() - started, psm: String(psm) }
    } catch (e) {
      const err = classifyEngineError(e)
      // A timed-out or crashed worker cannot be trusted with the next job.
      if (err.category === "timeout" || err.category === "engine_error") await terminateWorker()
      throw err
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  const p = queue.then(run, run)
  queue = p.catch(() => undefined)
  return p.finally(() => {
    queued--
    scheduleIdleShutdown()
  })
}

/** Test/shutdown hook. */
export async function shutdownOcrEngine() {
  if (idleTimer) clearTimeout(idleTimer)
  probeCache = null
  await terminateWorker()
}
