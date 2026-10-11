import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => {
  const query = vi.fn()
  const connQuery = vi.fn()
  return { query, connQuery, withTransaction: vi.fn(async (fn: (c: any) => Promise<unknown>) => fn({ query: connQuery })) }
})
vi.mock("@/lib/db", () => ({ query: db.query, withTransaction: db.withTransaction }))

import { setCurrentTenant } from "@/lib/tenant-context"
import { assignReviewer, claimForGeneration, createAsset, decideAsset, editAsset, getSettings, getStats, markFailed, saveGeneration } from "@/lib/alt-text/store"

const TENANT = 42
const assetRow = (over: Record<string, unknown> = {}) => ({
  id: 7, tenant_id: TENANT, project_id: null, file_name: "a.png", mime_type: "image/png", size_bytes: 1, status: "in_review",
  classification: "photo", short_alt: "old", long_description: "", extracted_text: "", warnings: null, attempts: 1,
  current_version: 3, created_by: 1, created_at: new Date(), ...over,
})
const result = { classification: "photo", shortAlt: "s", longDescription: "l", extractedText: "", warnings: [], treatment: "informative" } as any
const calls = (fn: any) => fn.mock.calls.map(([sql, params]: [string, any[]]) => ({ sql: String(sql), params }))

beforeEach(() => {
  db.query.mockReset()
  db.connQuery.mockReset()
  db.query.mockImplementation(async (sql: string) => (/^\s*SELECT/i.test(sql) ? [] : { affectedRows: 1, insertId: 1 }))
  db.connQuery.mockImplementation(async (sql: string) => (/^\s*SELECT/i.test(sql) ? [[{ current_version: 4 }]] : [{ affectedRows: 1 }]))
  setCurrentTenant({ tenantId: TENANT })
})
afterEach(() => setCurrentTenant(null))

describe("alt text store", () => {
  it("scopes every statement to the current tenant", async () => {
    await getStats()
    await getSettings()
    for (const c of calls(db.query).filter((c: any) => !/CREATE TABLE|ALTER TABLE/.test(c.sql))) {
      expect(c.sql).toMatch(/tenant_id = \?/)
      expect(c.params).toContain(TENANT)
    }
  })

  it("refuses to attach an asset to another tenant's project", async () => {
    await expect(
      createAsset({ projectId: 99, batchId: null, fileName: "a.png", mimeType: "image/png", sizeBytes: 1, storageKey: "k", storageUrl: "u", context: "", language: "en", audience: "web", createdBy: 1 }),
    ).rejects.toThrow(/not found/)
    expect(calls(db.query).some((c: any) => c.sql.includes("INSERT INTO alt_text_assets"))).toBe(false)
  })

  it("returns the attempt token from the atomic claim and null when already claimed", async () => {
    db.query.mockImplementation(async (sql: string) => (sql.includes("LAST_INSERT_ID") ? { affectedRows: 1, insertId: 3 } : { affectedRows: 0 }))
    expect(await claimForGeneration(7)).toBe(3)
    db.query.mockImplementation(async () => ({ affectedRows: 0 }))
    expect(await claimForGeneration(7)).toBeNull()
  })

  it("only lands generation results and failures on claimed assets", async () => {
    db.connQuery.mockImplementation(async () => [{ affectedRows: 0 }])
    expect(await saveGeneration(7, result, "m", 1, 1, true)).toBe(false)
    expect(calls(db.connQuery)[0].sql).toMatch(/status = 'processing'/)
    expect(calls(db.connQuery).some((c: any) => c.sql.includes("INSERT INTO alt_text_versions"))).toBe(false)
    await markFailed(7, "boom")
    expect(calls(db.query).at(-1).sql).toMatch(/status = 'processing'/)
  })

  it("writes the incremented version row with the generation", async () => {
    expect(await saveGeneration(7, result, "m", 1, 1, true, 2)).toBe(true)
    const insert = calls(db.connQuery).find((c: any) => c.sql.includes("INSERT INTO alt_text_versions"))
    expect(insert.params.slice(0, 3)).toEqual([TENANT, 7, 4])
  })

  it("rejects a stale manual edit instead of overwriting a newer version", async () => {
    db.query.mockImplementation(async (sql: string) => (/^\s*SELECT/i.test(sql) ? [assetRow()] : { affectedRows: 1 }))
    expect(await editAsset(7, { classification: "photo", shortAlt: "x", longDescription: "", extractedText: "" }, 1, 2)).toBe("conflict")
    expect(db.withTransaction).not.toHaveBeenCalled()
    db.connQuery.mockImplementation(async () => [{ affectedRows: 0 }])
    expect(await editAsset(7, { classification: "photo", shortAlt: "x", longDescription: "", extractedText: "" }, 1, 3)).toBe("conflict")
    expect(calls(db.connQuery)[0].sql).toMatch(/current_version = \?/)
  })

  it("refuses edits and decisions while a generation is in flight", async () => {
    db.query.mockImplementation(async (sql: string) => (/^\s*SELECT/i.test(sql) ? [assetRow({ status: "processing" })] : { affectedRows: 1 }))
    expect(await editAsset(7, { classification: "photo", shortAlt: "x", longDescription: "", extractedText: "" }, 1)).toBe("busy")
    expect(await decideAsset(7, "approved", 1, null)).toBeNull()
  })

  it("only assigns reviewers from the current tenant", async () => {
    db.query.mockImplementation(async () => ({ affectedRows: 0 }))
    expect(await assignReviewer(7, 500)).toBeNull()
    expect(calls(db.query)[0].sql).toMatch(/EXISTS \(SELECT 1 FROM users WHERE id = \? AND tenant_id = \?\)/)
  })

  it("returns zeroed stats on an empty dataset", async () => {
    db.query.mockImplementation(async (sql: string) => (/COUNT\(\*\)/.test(sql) ? [{ total: 0, in_review: null, approved: null, failed: null, processing: null, credits: 0 }] : []))
    expect(await getStats()).toMatchObject({ total: 0, inReview: 0, approved: 0, failed: 0, processing: 0, creditsUsed: 0, exports: [] })
  })
})
