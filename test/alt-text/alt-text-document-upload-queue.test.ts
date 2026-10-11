import { describe, expect, it, vi } from "vitest"
import type { ApiResult } from "@/lib/alt-text/client"
import type { DocumentUploadReference } from "@/lib/alt-text/document-upload-contract"
import { classifyUploadError, createDocumentUploadQueue, selectionLimitError, type DocumentUploadState, type UploadFn } from "@/lib/alt-text/document-upload-queue"

const flush = () => new Promise((r) => setTimeout(r, 0))
const ref = (uploadId: string) => ({ uploadId }) as DocumentUploadReference
const ok = (id: string): ApiResult<DocumentUploadReference> => ({ ok: true, data: ref(id) })
const err = (status: number, code: string): ApiResult<DocumentUploadReference> => ({ ok: false, error: { status, code, message: `${code} message` } })
const item = (id: string) => ({ id, file: new File(["x"], `${id}.pdf`) })

function setup(upload: UploadFn, concurrency = 2) {
  let states: ReadonlyMap<string, DocumentUploadState> = new Map()
  const queue = createDocumentUploadQueue({ upload, concurrency, onChange: (s) => (states = s) })
  return { queue, phase: (id: string) => states.get(id)?.phase, state: (id: string) => states.get(id) }
}

describe("document upload queue", () => {
  it("bounds concurrency and uploads every document once", async () => {
    let inFlight = 0, peak = 0
    const resolvers: Array<() => void> = []
    const upload: UploadFn = vi.fn((file) => {
      inFlight++; peak = Math.max(peak, inFlight)
      return new Promise((r) => resolvers.push(() => { inFlight--; r(ok(file.name)) }))
    })
    const t = setup(upload, 2)
    t.queue.enqueue(["a", "b", "c", "d"].map(item))
    expect(upload).toHaveBeenCalledTimes(2)
    expect(t.phase("c")).toBe("queued")
    while (resolvers.length) { resolvers.shift()!(); await flush() }
    expect(peak).toBe(2)
    expect(upload).toHaveBeenCalledTimes(4)
    expect(["a", "b", "c", "d"].every((id) => t.phase(id) === "uploaded")).toBe(true)
  })

  it("ignores duplicate starts (double click) and never reuploads successes", async () => {
    const upload: UploadFn = vi.fn(async (f) => ok(f.name))
    const t = setup(upload)
    t.queue.enqueue([item("a")])
    expect(t.queue.enqueue([item("a")])).toEqual([])
    await flush()
    expect(t.queue.enqueue([item("a")])).toEqual([])
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it("retries only the failed document after a partial failure", async () => {
    let attempts = 0
    const upload: UploadFn = vi.fn(async (f) => (f.name === "b.pdf" && attempts++ === 0 ? err(503, "STORAGE_UNAVAILABLE") : ok(f.name)))
    const t = setup(upload)
    t.queue.enqueue([item("a"), item("b")])
    await flush()
    expect(t.phase("a")).toBe("uploaded")
    expect(t.state("b")).toMatchObject({ phase: "failed", code: "STORAGE_UNAVAILABLE", error: "STORAGE_UNAVAILABLE message" })
    expect(t.queue.enqueue([item("a"), item("b")])).toEqual(["b"])
    await flush()
    expect(t.phase("b")).toBe("uploaded")
    expect((upload as ReturnType<typeof vi.fn>).mock.calls.filter(([f]) => f.name === "a.pdf")).toHaveLength(1)
  })

  it("does not retry permanently rejected documents", async () => {
    const upload: UploadFn = vi.fn(async () => err(422, "MACROS_NOT_ALLOWED"))
    const t = setup(upload)
    t.queue.enqueue([item("m")])
    await flush()
    expect(t.phase("m")).toBe("rejected")
    expect(t.queue.enqueue([item("m")])).toEqual([])
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it("treats a throwing transport as a retryable network failure without leaking slots", async () => {
    let calls = 0
    const upload: UploadFn = vi.fn(async (f) => {
      if (calls++ === 0) throw new TypeError("Failed to fetch")
      return ok(f.name)
    })
    const t = setup(upload, 1)
    t.queue.enqueue([item("a"), item("b")])
    await flush(); await flush()
    expect(t.state("a")).toMatchObject({ phase: "failed", code: "NETWORK_ERROR" })
    expect(t.phase("b")).toBe("uploaded")
    expect(t.queue.activeCount).toBe(0)
  })

  it("aborts in-flight requests when a document is removed", async () => {
    let signal: AbortSignal | undefined
    const upload: UploadFn = vi.fn((_f, _p, s) => { signal = s; return new Promise(() => {}) })
    const t = setup(upload)
    t.queue.enqueue([item("a")])
    t.queue.forget("a")
    expect(signal?.aborted).toBe(true)
    expect(t.phase("a")).toBeUndefined()
  })

  it("only reports measured progress", async () => {
    let report: ((p: number) => void) | undefined
    const upload: UploadFn = vi.fn((_f, onProgress) => { report = onProgress; return new Promise(() => {}) })
    const t = setup(upload)
    t.queue.enqueue([item("a")])
    expect(t.state("a")).toEqual({ phase: "uploading", progress: null })
    report!(40)
    expect(t.state("a")).toEqual({ phase: "uploading", progress: 40 })
  })

  it("classifies retryable vs permanent errors", () => {
    for (const code of ["NETWORK_ERROR", "STORAGE_UNAVAILABLE", "STORAGE_QUOTA_EXCEEDED", "RATE_LIMITED", "FORBIDDEN", "SCAN_UNAVAILABLE"])
      expect(classifyUploadError({ status: 0, code, message: "" })).toBe("failed")
    for (const code of ["UNSUPPORTED_TYPE", "CONTENT_MISMATCH", "FILE_TOO_LARGE", "UNSAFE_ARCHIVE", "EMPTY_FILE"])
      expect(classifyUploadError({ status: 0, code, message: "" })).toBe("rejected")
  })

  it("enforces selection count and aggregate size limits", () => {
    expect(selectionLimitError(Array.from({ length: 10 }, () => ({ size: 1 })))).toBeNull()
    expect(selectionLimitError(Array.from({ length: 11 }, () => ({ size: 1 })))).toMatch(/up to 10/)
    expect(selectionLimitError([{ size: 60 * 1024 * 1024 }, { size: 50 * 1024 * 1024 }])).toMatch(/100 MB/)
  })
})
