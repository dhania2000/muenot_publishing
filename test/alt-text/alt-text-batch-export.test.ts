import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const s = vi.hoisted(() => ({
  batch: null as any,
  rows: [] as any[],
  exports: [] as any[],
  pages: [] as any[],
  throwOnList: null as any,
}))
vi.mock("@/lib/alt-text/store", () => ({
  BATCH_COMPLETED_ASSET_STATUSES: ["in_review", "approved", "rejected"],
  getBatch: vi.fn(async (id: string) => (s.batch && s.batch.id === id ? s.batch : null)),
  countBatchExportRows: vi.fn(async (_id: string, owner?: any) => s.rows.filter((r) => !owner || r.createdBy === owner.userId).length),
  listBatchExportRows: vi.fn(async (_id: string, page: any) => {
    if (s.throwOnList) throw s.throwOnList
    s.pages.push(page)
    return s.rows
      .filter((r) => r.id > page.afterId && (!page.owner || r.createdBy === page.owner.userId))
      .sort((a, b) => a.id - b.id)
      .slice(0, page.limit)
  }),
  recordExport: vi.fn(async (...args: any[]) => void s.exports.push(args)),
  getBatchProgressRecord: vi.fn(),
  listBatchAssetStatuses: vi.fn(),
}))
vi.mock("@/lib/alt-text/batch-job", () => ({
  ALT_TEXT_BATCH_JOB_TYPE: "alt_text.batch_processing",
  altTextBatchIdempotencyKey: (id: string) => `alt-text-batch:${id}`,
}))
const gate = vi.hoisted(() => ({ result: null as any, opts: null as any }))
vi.mock("@/lib/alt-text/route-gate", async () => {
  const { NextResponse } = await import("next/server")
  const H = { "Cache-Control": "private, no-store" }
  return {
    gateAltTextHistory: vi.fn(async (opts: any) => ((gate.opts = opts), gate.result)),
    jsonError: (f: any) => NextResponse.json({ success: false, error: f.error, code: f.code }, { status: f.status, headers: H }),
    unexpected: () => NextResponse.json({ success: false, code: "INTERNAL_ERROR" }, { status: 500, headers: H }),
  }
})
vi.mock("@/lib/tenant-scope", () => ({ currentTenantIdOrNull: () => 9 }))

import { NextRequest, NextResponse } from "next/server"
import { GET } from "@/app/api/alt-text/batches/[id]/export/route"
import { BATCH_EXPORT_CHUNK, buildBatchCsv, buildBatchTxt } from "@/lib/alt-text/batch-export"
import { DEFAULT_GENERATION_SETTINGS } from "@/lib/alt-text/core"

const BID = "11111111-2222-4333-8444-555555555555"
const T = "2026-10-01T10:00:00.000Z"

const row = (over: Record<string, unknown> = {}) => ({
  id: 1,
  fileName: "रसायन-diagram.png",
  status: "in_review",
  language: "hi",
  classification: "chemical_structure",
  shortAlt: "H₂SO₄ अणु",
  longDescription: "E = mc²\n\nपैराग्राफ दो: ∫x dx",
  extractedText: "H₂O",
  warnings: ["Verify charge"],
  modelId: "openai/gpt-4o",
  currentVersion: 3,
  settingsOverride: null,
  updatedAt: T,
  createdBy: 5,
  ...over,
})

const get = (qs: string, id = BID) => GET(new NextRequest(`http://x/api/alt-text/batches/${id}/export?${qs}`), { params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  gate.result = { ok: true, actor: { userId: 5, viewScope: "all" } }
  s.batch = {
    id: BID,
    name: "Chapter 3",
    projectId: 12,
    createdBy: 5,
    submittedBy: 5,
    settings: { ...DEFAULT_GENERATION_SETTINGS, subject: "chemistry", chapterTopic: "Acids", imagePurpose: "informative" },
  }
  s.rows = [
    row(),
    row({ id: 2, classification: "decorative", shortAlt: "", longDescription: null, extractedText: null, warnings: [] }),
    row({ id: 3, shortAlt: '=HYPERLINK("x")', settingsOverride: { subject: "physics" } }),
  ]
  s.exports = []
  s.pages = []
  s.throwOnList = null
})

describe("GET /api/alt-text/batches/:id/export", () => {
  it("requires the export permission through the shared gate", async () => {
    gate.result = { ok: false, response: NextResponse.json({ success: false }, { status: 403 }) }
    expect((await get("format=csv")).status).toBe(403)
    expect(gate.opts).toEqual({ export: true })
    expect(s.exports).toHaveLength(0)
  })

  it("validates batch id, format and scope", async () => {
    expect((await get("format=csv", "not-a-batch")).status).toBe(400)
    expect((await get("format=pdf")).status).toBe(400)
    expect((await get("format=csv&scope=all")).status).toBe(400)
  })

  it("hides unknown, foreign-tenant and out-of-scope batches as 404", async () => {
    expect((await get("format=csv", "99999999-2222-4333-8444-555555555555")).status).toBe(404)
    gate.result = { ok: true, actor: { userId: 77, viewScope: "added" } }
    expect((await get("format=csv")).status).toBe(404)
    expect(s.exports).toHaveLength(0)
  })

  it("CSV: BOM, Unicode, decorative empty alt, formula guard, effective overrides, history", async () => {
    const res = await get("format=csv")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8")
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="batch-${BID}-alt-text.csv"`)
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    // Response.text() strips the BOM, so check the raw bytes.
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const text = new TextDecoder().decode(bytes)
    expect(text).toContain("batchId,batchName,assetId,fileName,classification,imagePurpose,subject,chapterTopic,language,shortAlt")
    expect(text).toContain("रसायन-diagram.png")
    expect(text).toContain('"E = mc²\n\nपैराग्राफ दो: ∫x dx"')
    expect(text).toContain(`'=HYPERLINK(""x"")`)
    expect(text).toMatch(/,3,.*,physics,/)
    expect(text).not.toMatch(/storage|secret|credit|tenants\//i)
    expect(s.exports).toEqual([["csv", "batch", 12, 3, 5, null, BID]])
  })

  it("TXT: grouped per image with batch header and labelled fields", async () => {
    const text = await (await get("format=txt")).text()
    expect(text).toContain("Batch: Chapter 3")
    expect(text).toContain("Total Exported Images: 3")
    expect(text).toContain("Image 1\n\nFilename: रसायन-diagram.png")
    expect(text).toContain("Subject: Chemistry")
    expect(text).toContain("Chapter / Topic: Acids")
    expect(text).toContain("Language: Hindi")
    expect(text).toContain('(empty — decorative image, use alt="")')
    expect(text).toContain("Accessibility Warnings:\n- Verify charge")
  })

  it("JSON: batch metadata and images with decorative alt preserved as empty string", async () => {
    const body = await (await get("format=json")).json()
    expect(body.batch).toMatchObject({ id: BID, name: "Chapter 3", totalExported: 3 })
    expect(body.images.map((i: any) => i.assetId)).toEqual([1, 2, 3])
    expect(body.images[1].shortAlt).toBe("")
    expect(body.images[0]).not.toHaveProperty("storageKey")
  })

  it("excludes rows with no saved alt text and returns 409 when nothing is exportable", async () => {
    s.rows = [row({ id: 1, classification: null, shortAlt: null, longDescription: null })]
    const res = await get("format=csv")
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("NO_EXPORTABLE_RECORDS")
    expect(s.exports).toHaveLength(0)
  })

  it("scoped users export only their own assets", async () => {
    gate.result = { ok: true, actor: { userId: 5, viewScope: "added" } }
    s.rows.push(row({ id: 4, createdBy: 6 }))
    const body = await (await get("format=json")).json()
    expect(body.images.map((i: any) => i.assetId)).toEqual([1, 2, 3])
  })

  it("pages deterministically by id without duplicates across chunks", async () => {
    s.rows = Array.from({ length: BATCH_EXPORT_CHUNK + 5 }, (_, i) => row({ id: BATCH_EXPORT_CHUNK + 5 - i }))
    const body = await (await get("format=json")).json()
    const ids = body.images.map((i: any) => i.assetId)
    expect(ids).toHaveLength(BATCH_EXPORT_CHUNK + 5)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual([...ids].sort((a: number, b: number) => a - b))
    expect(s.pages.map((p) => p.afterId)).toEqual([0, BATCH_EXPORT_CHUNK])
  })

  it("does not return a partial file or record history when the store fails mid-export", async () => {
    s.throwOnList = new Error("db down")
    expect((await get("format=csv")).status).toBe(500)
    expect(s.exports).toHaveLength(0)
  })
})

describe("batch export serializers", () => {
  const meta = { id: BID, name: "=cmd", exportedAt: T, totalExported: 1 }
  const rec = {
    batchId: BID, batchName: "=cmd", assetId: 1, fileName: "a.png", classification: "photo", imagePurpose: "informative", subject: "general",
    chapterTopic: null, language: "en", shortAlt: "A cat", longDescription: null, extractedText: null, warnings: [], modelId: null, savedVersion: 1, updatedAt: T,
  }
  it("guards batch name against formula injection in CSV", () => {
    expect(buildBatchCsv(meta, [rec])).toContain(`,'=cmd,`)
  })
  it("omits empty optional sections in TXT", () => {
    const text = buildBatchTxt(meta, [rec])
    expect(text).not.toContain("Detailed Description")
    expect(text).not.toContain("Chapter / Topic")
  })
})
