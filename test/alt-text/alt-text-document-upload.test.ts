import { beforeEach, describe, expect, it, vi } from "vitest"
import type { FileObject } from "@/lib/storage/file-metadata"
import { ooxml, pdf } from "./fixtures/documents"

const storage = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  deleteFile: vi.fn(async () => {}),
  checkStorageQuota: vi.fn(async () => ({ allowed: true }) as { allowed: boolean; reason?: string }),
  listFileMetadata: vi.fn(async () => [] as FileObject[]),
  getScanForFile: vi.fn(async () => null as null | { scanStatus: string; approved: boolean }),
  getUploadLimits: vi.fn(async () => ({ maxBytes: 25 * 1024 * 1024, maxMb: 25, extensions: [] as string[], mimeTypes: new Set<string>() })),
  validateUploadContent: vi.fn(async () => null as string | null),
}))

vi.mock("@/lib/storage", () => ({ uploadFile: storage.uploadFile, deleteFile: storage.deleteFile }))
vi.mock("@/lib/storage/storage-quota", () => ({ checkStorageQuota: storage.checkStorageQuota }))
vi.mock("@/lib/storage/file-metadata", () => ({ listFileMetadata: storage.listFileMetadata }))
vi.mock("@/lib/storage/file-scanning", () => ({ getScanForFile: storage.getScanForFile }))
vi.mock("@/lib/settings/uploads", () => ({ getUploadLimits: storage.getUploadLimits, validateUploadContent: storage.validateUploadContent }))
vi.mock("@/lib/alt-text/store", () => ({}))
vi.mock("@/lib/alt-text/document-service", () => ({
  persistUploadedDocument: vi.fn(async (file: FileObject) => ({ ok: true, document: { id: 1, uploadId: String(file.entityId) }, created: true })),
  syncDocumentForUpload: vi.fn(async () => null),
}))

const { processDocumentUpload, getDocumentUpload, DOCUMENT_ENTITY_TYPE } = await import("@/lib/alt-text/document-upload")
const { deriveDocumentSecurity } = await import("@/lib/alt-text/document-upload-contract")
const { keyBelongsToTenant, tenantKey } = await import("@/lib/storage/keys")

const MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

const fileOf = (bytes: Buffer, name: string, type = "") => new File([new Uint8Array(bytes)], name, { type })

let nextId = 1
function fileRow(over: Partial<FileObject> = {}): FileObject {
  const id = nextId++
  return {
    id, fileRef: `FILE-${String(id).padStart(6, "0")}`, module: "publishing", entityType: DOCUMENT_ENTITY_TYPE,
    entityId: "11111111-1111-4111-8111-111111111111", objectKey: `t/1/alt-text/documents/7/x.pdf`, provider: "s3",
    filename: "report.pdf", mimeType: MIME.pdf, size: 10, checksum: null, encryptionState: "provider" as FileObject["encryptionState"],
    uploadStatus: "completed", version: 1, isCurrent: true, classification: "confidential", retentionPolicy: "default",
    retentionExpiresAt: null, legalHold: false, ownerId: 7, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: null, ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  storage.uploadFile.mockImplementation(async (path: string, file: File, opts: { metadata: Record<string, unknown> }) => ({
    ok: true,
    result: {
      key: `t/1/${path}`,
      file: fileRow({ entityId: String(opts.metadata.entityId), filename: file.name, mimeType: file.type, size: file.size, objectKey: `t/1/${path}` }),
    },
  }))
})

describe("processDocumentUpload · accepted documents", () => {
  it.each([
    ["report.pdf", pdf(), "pdf"],
    ["deck.pptx", ooxml("pptx"), "pptx"],
    ["memo.docx", ooxml("docx"), "docx"],
  ] as const)("stores %s privately and returns a safe reference", async (name, bytes, ext) => {
    const res = await processDocumentUpload(fileOf(bytes, name, MIME[ext]), { userId: 7 })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const [path, stored, opts] = storage.uploadFile.mock.calls[0]
    expect(path).toMatch(new RegExp(`^alt-text/documents/7/[0-9a-f-]{36}\\.${ext}$`))
    expect((stored as File).type).toBe(MIME[ext])
    expect(opts).toMatchObject({ skipValidation: true, metadata: { module: "publishing", entityType: DOCUMENT_ENTITY_TYPE, ownerId: 7, classification: "confidential" } })
    expect(opts.public).toBeUndefined()
    expect(res.document).toMatchObject({ filename: name, extension: ext, mimeType: MIME[ext], uploadStatus: "uploaded", securityStatus: "scanning", processingStatus: "scanning" })
    expect(res.document.uploadId).toBe(opts.metadata.entityId)
    expect(res.reused).toBe(false)
    expect(JSON.stringify(res.document)).not.toContain("t/1/")
  })

  it("generates a distinct server id per upload", async () => {
    const a = await processDocumentUpload(fileOf(pdf("% a\n"), "a.pdf"), { userId: 7 })
    const b = await processDocumentUpload(fileOf(pdf("% b\n"), "b.pdf"), { userId: 7 })
    expect(a.ok && b.ok && a.document.uploadId !== b.document.uploadId).toBe(true)
  })

  it("strips directory components from the original filename", async () => {
    const res = await processDocumentUpload(fileOf(pdf(), "../../etc/report.pdf"), { userId: 7 })
    expect(res.ok && res.document.filename).toBe("report.pdf")
    expect(storage.uploadFile.mock.calls[0][0]).not.toContain("..")
  })
})

describe("processDocumentUpload · rejections never reach storage", () => {
  const cases: Array<[string, () => File, string]> = [
    ["unsupported extension", () => fileOf(Buffer.from("MZ"), "tool.exe"), "UNSUPPORTED_TYPE"],
    ["legacy .doc", () => fileOf(Buffer.from("x"), "old.doc"), "LEGACY_FORMAT"],
    ["legacy .ppt", () => fileOf(Buffer.from("x"), "old.ppt"), "LEGACY_FORMAT"],
    ["empty file", () => fileOf(Buffer.alloc(0), "empty.pdf"), "EMPTY_FILE"],
    ["declared MIME mismatch", () => fileOf(pdf(), "x.pdf", "image/png"), "CONTENT_MISMATCH"],
    ["invalid signature", () => fileOf(Buffer.from("not a pdf at all"), "x.pdf"), "CONTENT_MISMATCH"],
    ["generic zip as docx", () => fileOf(ooxml("pptx"), "x.docx"), "CONTENT_MISMATCH"],
  ]
  it.each(cases)("%s", async (_label, make, expected) => {
    const res = await processDocumentUpload(make(), { userId: 7 })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe(expected)
    expect(storage.uploadFile).not.toHaveBeenCalled()
  })

  it("enforces the stricter of the feature and tenant size limits", async () => {
    storage.getUploadLimits.mockResolvedValueOnce({ maxBytes: 64, maxMb: 0, extensions: [], mimeTypes: new Set() })
    const res = await processDocumentUpload(fileOf(pdf(), "big.pdf"), { userId: 7 })
    expect(!res.ok && res.status === 413 && res.code === "FILE_TOO_LARGE").toBe(true)
    expect(storage.uploadFile).not.toHaveBeenCalled()
  })

  it("honours the tenant extension allow list", async () => {
    storage.getUploadLimits.mockResolvedValueOnce({ maxBytes: 25 * 1024 * 1024, maxMb: 25, extensions: ["pdf"], mimeTypes: new Set() })
    const res = await processDocumentUpload(fileOf(ooxml("docx"), "x.docx"), { userId: 7 })
    expect(!res.ok && res.code).toBe("UNSUPPORTED_TYPE")
  })

  it("enforces the tenant storage quota", async () => {
    storage.checkStorageQuota.mockResolvedValueOnce({ allowed: false, reason: "Storage quota exceeded." })
    const res = await processDocumentUpload(fileOf(pdf(), "x.pdf"), { userId: 7 })
    expect(res).toMatchObject({ ok: false, status: 413, code: "STORAGE_QUOTA_EXCEEDED" })
    expect(storage.uploadFile).not.toHaveBeenCalled()
  })
})

describe("processDocumentUpload · storage failures and retries", () => {
  it("maps storage unavailability to a retryable 503", async () => {
    storage.uploadFile.mockResolvedValueOnce({ ok: false, error: "Upload failed. Check the connected storage configuration." })
    expect(await processDocumentUpload(fileOf(pdf(), "x.pdf"), { userId: 7 })).toMatchObject({ ok: false, status: 503, code: "STORAGE_UNAVAILABLE" })
  })

  it("deletes the object when no scan record could be created", async () => {
    storage.uploadFile.mockResolvedValueOnce({ ok: true, result: { key: "t/1/alt-text/documents/7/x.pdf", file: null } })
    const res = await processDocumentUpload(fileOf(pdf(), "x.pdf"), { userId: 7 })
    expect(res).toMatchObject({ ok: false, status: 503, code: "SCAN_UNAVAILABLE" })
    expect(storage.deleteFile).toHaveBeenCalledWith("t/1/alt-text/documents/7/x.pdf")
  })

  it("reuses the caller's identical document instead of storing it twice", async () => {
    const first = await processDocumentUpload(fileOf(pdf(), "x.pdf"), { userId: 7 })
    expect(first.ok).toBe(true)
    const storedRow = await storage.uploadFile.mock.results[0].value
    const { createHash } = await import("node:crypto")
    storage.listFileMetadata.mockResolvedValueOnce([{ ...storedRow.result.file, checksum: createHash("sha256").update(pdf()).digest("hex") }])
    const retry = await processDocumentUpload(fileOf(pdf(), "x.pdf"), { userId: 7 })
    expect(retry.ok && retry.reused).toBe(true)
    expect(retry.ok && first.ok && retry.document.uploadId === first.document.uploadId).toBe(true)
    expect(storage.uploadFile).toHaveBeenCalledTimes(1)
  })

  it("does not reuse another user's identical document", async () => {
    const { createHash } = await import("node:crypto")
    storage.listFileMetadata.mockResolvedValueOnce([fileRow({ ownerId: 99, checksum: createHash("sha256").update(pdf()).digest("hex") })])
    const res = await processDocumentUpload(fileOf(pdf(), "x.pdf"), { userId: 7 })
    expect(res.ok && res.reused).toBe(false)
    expect(storage.uploadFile).toHaveBeenCalledTimes(1)
  })
})

describe("getDocumentUpload · access + security status", () => {
  const id = "22222222-2222-4222-8222-222222222222"

  it("rejects malformed ids without querying", async () => {
    expect(await getDocumentUpload("../../x", { userId: 7, canViewAll: true })).toBeNull()
    expect(storage.listFileMetadata).not.toHaveBeenCalled()
  })

  it("hides other users' documents unless view scope is all", async () => {
    storage.listFileMetadata.mockResolvedValue([fileRow({ entityId: id, ownerId: 99 })])
    expect(await getDocumentUpload(id, { userId: 7, canViewAll: false })).toBeNull()
    expect(await getDocumentUpload(id, { userId: 7, canViewAll: true })).not.toBeNull()
  })

  it("reports the real scan verdict", async () => {
    storage.listFileMetadata.mockResolvedValue([fileRow({ entityId: id })])
    storage.getScanForFile.mockResolvedValueOnce({ scanStatus: "clean", approved: false })
    expect((await getDocumentUpload(id, { userId: 7, canViewAll: false }))?.processingStatus).toBe("ready_for_processing")
    storage.getScanForFile.mockResolvedValueOnce({ scanStatus: "infected", approved: false })
    expect((await getDocumentUpload(id, { userId: 7, canViewAll: false }))?.processingStatus).toBe("quarantined")
  })
})

describe("security status mapping", () => {
  it("never marks a document ready before the scan passes", () => {
    expect(deriveDocumentSecurity(null).processingStatus).toBe("scanning")
    expect(deriveDocumentSecurity({ scanStatus: "pending", approved: false }).processingStatus).toBe("scanning")
    expect(deriveDocumentSecurity({ scanStatus: "scanning", approved: false }).processingStatus).toBe("scanning")
    expect(deriveDocumentSecurity({ scanStatus: "error", approved: false }).processingStatus).toBe("held_for_review")
    expect(deriveDocumentSecurity({ scanStatus: "infected", approved: false }).processingStatus).toBe("quarantined")
    expect(deriveDocumentSecurity({ scanStatus: "clean", approved: false }).processingStatus).toBe("ready_for_processing")
    expect(deriveDocumentSecurity({ scanStatus: "error", approved: true }).processingStatus).toBe("ready_for_processing")
  })
})

describe("tenant-scoped storage keys", () => {
  it("namespaces document paths per tenant and blocks cross-tenant keys", () => {
    const key = tenantKey(1, "alt-text/documents/7/abc.pdf")
    expect(key).toBe("t/1/alt-text/documents/7/abc.pdf")
    expect(keyBelongsToTenant(key, 1)).toBe(true)
    expect(keyBelongsToTenant(key, 2)).toBe(false)
    expect(tenantKey(1, "../../t/2/alt-text/documents/x.pdf").startsWith("t/1/")).toBe(true)
  })
})
