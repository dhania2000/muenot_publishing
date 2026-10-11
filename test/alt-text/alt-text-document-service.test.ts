import { beforeEach, describe, expect, it, vi } from "vitest"

const deps = vi.hoisted(() => ({
  createDocument: vi.fn(),
  getDocument: vi.fn(),
  getDocumentByUploadId: vi.fn(),
  listDocuments: vi.fn(),
  updateDocumentSecurityStatus: vi.fn(async () => true),
  getScanForFile: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/storage/file-scanning", () => ({ getScanForFile: deps.getScanForFile }))
vi.mock("@/lib/alt-text/document-store", () => ({
  createDocument: deps.createDocument,
  getDocument: deps.getDocument,
  getDocumentByUploadId: deps.getDocumentByUploadId,
  listDocuments: deps.listDocuments,
  updateDocumentSecurityStatus: deps.updateDocumentSecurityStatus,
}))

const svc = await import("@/lib/alt-text/document-service")

const stored = (over: Record<string, unknown> = {}) =>
  ({
    id: 5,
    uploadId: "u1",
    fileObjectId: 42,
    storageReferenceId: "ref_abc",
    projectId: null,
    filename: "a.pdf",
    documentType: "pdf",
    mimeType: "application/pdf",
    size: 10,
    uploadStatus: "uploaded",
    securityStatus: "scanning",
    processingStatus: "pending",
    extractionReady: false,
    extractedImageCount: 0,
    uploadedBy: 7,
    createdAt: "2026-10-12T00:00:00.000Z",
    updatedAt: "2026-10-12T00:00:00.000Z",
    ...over,
  }) as never

const file = (over: Record<string, unknown> = {}) =>
  ({ id: 42, entityId: "u1", fileRef: "ref_abc", filename: "a.pdf", mimeType: "application/pdf", size: 10, ownerId: 7, checksum: null, ...over }) as never

beforeEach(() => {
  vi.clearAllMocks()
  deps.updateDocumentSecurityStatus.mockResolvedValue(true)
})

describe("ownerScopeFor", () => {
  it("restricts non-`all` viewers to their own uploads", () => {
    expect(svc.ownerScopeFor({ userId: 7, viewScope: "own" })).toEqual({ uploadedBy: 7 })
    expect(svc.ownerScopeFor({ userId: 7, viewScope: "all" })).toBeNull()
  })
})

describe("toPublicDocument", () => {
  it("strips the internal file object id", () => {
    expect(svc.toPublicDocument(stored())).not.toHaveProperty("fileObjectId")
  })
})

describe("persistUploadedDocument", () => {
  it("creates a record from server-verified storage metadata", async () => {
    deps.createDocument.mockResolvedValueOnce({ ok: true, document: stored(), created: true })
    const res = await svc.persistUploadedDocument(file(), { userId: 7 }, "a".repeat(64), null)
    expect(res.ok).toBe(true)
    expect(deps.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ uploadId: "u1", fileObjectId: 42, documentType: "pdf", securityStatus: "scanning", uploadedBy: 7 }),
    )
  })

  it("refuses files owned by someone else or with an unsupported type", async () => {
    expect((await svc.persistUploadedDocument(file({ ownerId: 8 }), { userId: 7 }, null, null)).ok).toBe(false)
    expect((await svc.persistUploadedDocument(file({ filename: "a.exe" }), { userId: 7 }, null, null)).ok).toBe(false)
    expect(deps.createDocument).not.toHaveBeenCalled()
  })

  it("maps a store conflict to 409 and a database failure to 503 without leaking details", async () => {
    deps.createDocument.mockResolvedValueOnce({ ok: false, code: "CONFLICT", message: "Upload already registered." })
    expect(await svc.persistUploadedDocument(file(), { userId: 7 }, null, null)).toMatchObject({ ok: false, status: 409 })
    deps.createDocument.mockRejectedValueOnce(new Error("ER_CON secret-host"))
    const res = await svc.persistUploadedDocument(file(), { userId: 7 }, null, null)
    expect(res).toMatchObject({ ok: false, status: 503 })
    expect(JSON.stringify(res)).not.toMatch(/secret-host/)
  })
})

describe("mirrorSecurityStatus", () => {
  it("does not overwrite the stored value when the guarded transition is refused", async () => {
    deps.updateDocumentSecurityStatus.mockResolvedValueOnce(false)
    const doc = stored({ securityStatus: "quarantined" })
    expect(await svc.mirrorSecurityStatus(doc, "clean")).toBe(doc)
  })

  it("marks a clean, pending document extraction-ready", async () => {
    const next = await svc.mirrorSecurityStatus(stored(), "clean")
    expect(next).toMatchObject({ securityStatus: "clean", extractionReady: true })
  })
})

describe("listDocumentRecords", () => {
  it("passes owner scope to the store and only re-checks unsettled scans", async () => {
    deps.listDocuments.mockResolvedValueOnce({ documents: [stored({ securityStatus: "clean" }), stored({ id: 6 })], total: 2 })
    deps.getScanForFile.mockResolvedValueOnce(null)
    const res = await svc.listDocumentRecords({ page: 1, pageSize: 25 }, { uploadedBy: 7 })
    expect(deps.listDocuments).toHaveBeenCalledWith({ page: 1, pageSize: 25 }, { uploadedBy: 7 })
    expect(deps.getScanForFile).toHaveBeenCalledTimes(1)
    expect(res.total).toBe(2)
    expect(res.documents.every((d) => !("fileObjectId" in d))).toBe(true)
  })
})
