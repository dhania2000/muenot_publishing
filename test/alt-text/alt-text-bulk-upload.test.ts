import { describe, expect, it, vi } from "vitest"
import type { BulkImageItem } from "@/lib/alt-text/bulk-queue"
import { buildUploadedAssets, createBulkUploadEngine, isTransientUploadError, summarizeUploads, type Uploader, type UploadEntry } from "@/lib/alt-text/bulk-upload"
import { DEFAULT_GENERATION_SETTINGS } from "@/lib/alt-text/core"
import type { UploadedAsset } from "@/lib/alt-text/upload"

const item = (id: string, over: Partial<BulkImageItem> = {}): BulkImageItem => ({
  id, file: new File(["x"], `${id}.png`, { type: "image/png" }), name: `${id}.png`, type: "image/png", size: 1,
  lastModified: 0, previewUrl: "blob:x", status: "valid", hash: `h-${id}`, ...over,
})
const asset = (id: number): UploadedAsset => ({ id, filename: "f", mimeType: "image/png", size: 1, width: 1, height: 1, status: "uploaded", scanStatus: "pending" })
const fail = (status: number, code = "X") => ({ ok: false as const, error: { status, code, message: "nope" } })
const flush = () => new Promise((r) => setTimeout(r, 0))

function setup(upload: Uploader, opts: { concurrency?: number } = {}) {
  let entries: UploadEntry[] = []
  const timers: Array<() => void> = []
  const engine = createBulkUploadEngine({ upload, onChange: (e) => (entries = e), schedule: (fn) => timers.push(fn), ...opts })
  return { engine, get entries() { return entries }, runTimers: () => timers.splice(0).forEach((t) => t()) }
}

describe("bulk upload engine", () => {
  it("only queues Task 3 valid items and respects the concurrency limit", async () => {
    let inFlight = 0, peak = 0, next = 1
    const resolvers: Array<() => void> = []
    const upload: Uploader = vi.fn(() => {
      inFlight++; peak = Math.max(peak, inFlight)
      return new Promise((r) => resolvers.push(() => { inFlight--; r({ ok: true, data: asset(next++) }) }))
    })
    const t = setup(upload, { concurrency: 2 })
    t.engine.sync([item("a"), item("b"), item("c"), item("bad", { status: "invalid" }), item("dup", { status: "duplicate" })])
    expect(t.entries).toHaveLength(3)
    t.engine.start()
    expect(upload).toHaveBeenCalledTimes(2)
    while (resolvers.length) { resolvers.shift()!(); await flush() }
    expect(peak).toBe(2)
    expect(upload).toHaveBeenCalledTimes(3)
    expect(t.entries.every((e) => e.uploadStatus === "scan_pending" && e.assetId)).toBe(true)
  })

  it("retries transient errors with backoff, but not permanent ones", async () => {
    const calls: Record<string, number> = {}
    const upload: Uploader = vi.fn(async (file) => {
      calls[file.name] = (calls[file.name] ?? 0) + 1
      if (file.name === "t.png") return calls[file.name] < 2 ? fail(503) : { ok: true, data: asset(9) }
      return fail(415, "UNSUPPORTED_TYPE")
    })
    const t = setup(upload)
    t.engine.sync([item("t"), item("p")])
    t.engine.start()
    await flush()
    expect(t.entries.find((e) => e.localId === "p")!.uploadStatus).toBe("failed")
    expect(t.entries.find((e) => e.localId === "t")!.uploadStatus).toBe("ready")
    t.runTimers(); await flush()
    expect(t.entries.find((e) => e.localId === "t")).toMatchObject({ uploadStatus: "scan_pending", assetId: 9, attempts: 2 })
    expect(calls["p.png"]).toBe(1)
  })

  it("gives up after max attempts and retry() requeues failed items", async () => {
    let ok = false
    const upload: Uploader = vi.fn(async () => (ok ? { ok: true as const, data: asset(5) } : fail(0, "NETWORK_ERROR")))
    const t = setup(upload)
    t.engine.sync([item("a")])
    t.engine.start()
    for (let i = 0; i < 3; i++) { await flush(); t.runTimers() }
    await flush()
    expect(t.entries[0]).toMatchObject({ uploadStatus: "failed", attempts: 3 })
    ok = true
    t.engine.retry(["a"]); await flush()
    expect(t.entries[0]).toMatchObject({ uploadStatus: "scan_pending", assetId: 5 })
  })

  it("cancel aborts in-flight requests, keeps confirmed assets, and marks pending as cancelled", async () => {
    const upload: Uploader = vi.fn((file, signal) => {
      if (file.name === "a.png") return Promise.resolve({ ok: true as const, data: asset(1) })
      return new Promise((r) => signal.addEventListener("abort", () => r(fail(0, "ABORTED"))))
    })
    const t = setup(upload, { concurrency: 2 })
    t.engine.sync([item("a"), item("b"), item("c")])
    t.engine.start(); await flush()
    t.engine.cancel(); await flush()
    const by = Object.fromEntries(t.entries.map((e) => [e.localId, e.uploadStatus]))
    expect(by).toEqual({ a: "scan_pending", b: "cancelled", c: "cancelled" })
  })

  it("removing a local item never deletes server data and re-adding identical bytes reuses the asset", async () => {
    const upload: Uploader = vi.fn(async () => ({ ok: true as const, data: asset(7) }))
    const t = setup(upload)
    t.engine.sync([item("a")]); t.engine.start(); await flush()
    t.engine.sync([])
    expect(t.entries).toHaveLength(0)
    t.engine.sync([item("a2", { hash: "h-a" })])
    expect(t.entries[0]).toMatchObject({ uploadStatus: "scan_pending", assetId: 7 })
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it("classifies transient errors", () => {
    expect(isTransientUploadError(0, "NETWORK_ERROR")).toBe(true)
    expect(isTransientUploadError(429, "RATE_LIMITED")).toBe(true)
    expect(isTransientUploadError(0, "ABORTED")).toBe(false)
    expect(isTransientUploadError(403, "FORBIDDEN")).toBe(false)
    expect(isTransientUploadError(413, "FILE_TOO_LARGE")).toBe(false)
  })

  it("builds Task 7 input from server-confirmed assets only, with effective settings", () => {
    const base = { file: new File([], "x"), filename: "x", size: 1, validationStatus: "valid" as const, attempts: 1, hash: null }
    const entries: UploadEntry[] = [
      { ...base, localId: "a", uploadStatus: "uploaded", assetId: 1 },
      { ...base, localId: "b", uploadStatus: "scan_pending", assetId: 2 },
      { ...base, localId: "c", uploadStatus: "failed", assetId: null },
    ]
    const out = buildUploadedAssets(entries, DEFAULT_GENERATION_SETTINGS, { a: { imageType: "chart" } as any })
    expect(out.uploaded.map((a) => a.assetId)).toEqual([1, 2])
    expect(out.readyToSubmit.map((a) => a.assetId)).toEqual([1])
    expect(out.awaitingScan.map((a) => a.assetId)).toEqual([2])
    expect(out.uploaded[0].effectiveSettings.imageType).toBe("chart")
    expect(summarizeUploads(entries)).toMatchObject({ total: 3, uploaded: 1, scanPending: 1, failed: 1 })
  })
})
