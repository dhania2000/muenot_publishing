import { readFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => {
  const query = vi.fn()
  const connQuery = vi.fn()
  return { query, connQuery, withTransaction: vi.fn(async (fn: (c: any) => Promise<unknown>) => fn({ query: connQuery })) }
})
vi.mock("@/lib/db", () => ({ query: db.query, withTransaction: db.withTransaction }))

import { setCurrentTenant } from "@/lib/tenant-context"
import { DEFAULT_GENERATION_SETTINGS } from "@/lib/alt-text/core"
import {
  addAssetsToBatch,
  createBatch,
  getBatch,
  getBatchStats,
  listBatchAssets,
  listBatches,
  normalizeOverride,
  updateBatch,
} from "@/lib/alt-text/store"

const TENANT = 42
const BATCH_ID = "11111111-2222-4333-8444-555555555555"
const calls = (fn: any) => fn.mock.calls.map(([sql, params]: [string, any[]]) => ({ sql: String(sql), params: params ?? [] }))
const dml = (fn: any) => calls(fn).filter((c: any) => !/CREATE TABLE|ALTER TABLE/.test(c.sql))
const batchRow = (over: Record<string, unknown> = {}) => ({
  id: BATCH_ID, tenant_id: TENANT, project_id: null, name: "Chapter 3", description: null,
  settings: JSON.stringify({ ...DEFAULT_GENERATION_SETTINGS, subject: "biology" }), status: "draft", revision: 0,
  created_by: 1, created_at: new Date(), updated_at: new Date(), total: 4, pending: 1, processing: 1, completed: 1, failed: 1, ...over,
})

let assetRows: any[] = []
beforeEach(() => {
  db.query.mockReset()
  db.connQuery.mockReset()
  assetRows = [{ id: 1, batch_id: null, status: "uploaded" }, { id: 2, batch_id: null, status: "in_review" }]
  db.query.mockImplementation(async (sql: string) => {
    if (/FROM alt_text_batches b\s+LEFT JOIN/.test(sql)) return [batchRow()]
    if (/COUNT\(\*\) AS n/.test(sql)) return [{ n: 30 }]
    if (/^\s*SELECT/i.test(sql)) return []
    return { affectedRows: 1, insertId: 1 }
  })
  db.connQuery.mockImplementation(async (sql: string, params: any[]) => {
    if (sql.includes("FROM alt_text_projects")) return [params[1] === 5 ? [{ id: 5 }] : []]
    if (sql.includes("FROM alt_text_batches")) return [[{ settings: batchRow().settings, status: "draft" }]]
    if (sql.includes("FROM alt_text_assets")) return [assetRows.filter((r) => params.slice(1).includes(r.id))]
    return [{ affectedRows: 1 }]
  })
  setCurrentTenant({ tenantId: TENANT })
})
afterEach(() => setCurrentTenant(null))

describe("alt text batch store", () => {
  it("creates a draft batch atomically with normalized defaults and per-image overrides", async () => {
    const id = await createBatch(
      { name: " Chapter 3 ", projectId: 5, settings: { ...DEFAULT_GENERATION_SETTINGS, subject: "biology" }, assets: [{ assetId: 1, override: { gradeLevel: "undergraduate", bogus: 1 } }, { assetId: 2 }] },
      7,
    )
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(db.withTransaction).toHaveBeenCalledTimes(1)
    const c = calls(db.connQuery)
    const insert = c.find((x: any) => x.sql.includes("INSERT INTO alt_text_batches"))!
    expect(insert.params.slice(0, 4)).toEqual([id, TENANT, 5, "Chapter 3"])
    expect(JSON.parse(insert.params[5]).subject).toBe("biology")
    const updates = c.filter((x: any) => x.sql.startsWith("UPDATE alt_text_assets"))
    expect(JSON.parse(updates[0].params[1])).toEqual({ gradeLevel: "undergraduate" })
    expect(updates[1].params[1]).toBeNull()
    for (const u of updates) expect(u.params.slice(2, 3)).toEqual([TENANT])
  })

  it("rejects another tenant's project and rolls back", async () => {
    await expect(createBatch({ name: "x", projectId: 99, settings: {} }, 1)).rejects.toThrow(/not found/)
    expect(calls(db.connQuery).some((c: any) => c.sql.includes("INSERT"))).toBe(false)
  })

  it("blocks attaching assets that the tenant does not own", async () => {
    await expect(addAssetsToBatch(BATCH_ID, [{ assetId: 1 }, { assetId: 999 }])).rejects.toThrow(/not found/)
    expect(calls(db.connQuery).some((c: any) => c.sql.startsWith("UPDATE alt_text_assets"))).toBe(false)
    const lock = calls(db.connQuery).find((c: any) => c.sql.includes("FROM alt_text_assets"))!
    expect(lock.sql).toMatch(/tenant_id = \? AND id IN/)
    expect(lock.params[0]).toBe(TENANT)
  })

  it("refuses assets already in another batch or mid-generation", async () => {
    assetRows[0].batch_id = "other"
    await expect(addAssetsToBatch(BATCH_ID, [{ assetId: 1 }])).rejects.toThrow(/another batch/)
    assetRows[0].batch_id = null
    assetRows[0].status = "processing"
    await expect(addAssetsToBatch(BATCH_ID, [{ assetId: 1 }])).rejects.toThrow(/being processed/)
  })

  it("returns null for a batch outside the tenant without revealing it", async () => {
    db.connQuery.mockImplementation(async () => [[]])
    expect(await addAssetsToBatch(BATCH_ID, [{ assetId: 1 }])).toBeNull()
    db.query.mockImplementation(async (sql: string) => (/^\s*SELECT/i.test(sql) ? [] : { affectedRows: 0 }))
    expect(await getBatch(BATCH_ID)).toBeNull()
    expect(await listBatchAssets(BATCH_ID)).toBeNull()
    expect(await updateBatch(BATCH_ID, { status: "queued" })).toBeNull()
  })

  it("derives stats from real asset statuses and scopes every query by tenant", async () => {
    const batch = await getBatch(BATCH_ID)
    expect(batch?.settings.subject).toBe("biology")
    expect(await getBatchStats(BATCH_ID)).toEqual({ total: 4, pending: 1, processing: 1, completed: 1, failed: 1 })
    const sql = dml(db.query)[0]
    expect(sql.sql).toMatch(/COUNT\(\*\) AS total[\s\S]*FROM alt_text_assets WHERE tenant_id = \? AND batch_id = \?/)
    expect(sql.params).toEqual([TENANT, BATCH_ID, TENANT, BATCH_ID])
  })

  it("paginates batch lists with clamped limits", async () => {
    const res = await listBatches({ limit: 1000, offset: 20, status: "draft" })
    expect(res.total).toBe(30)
    const [list, count] = dml(db.query)
    expect(list.sql).toContain("LIMIT 100 OFFSET 20")
    expect(list.params).toEqual([TENANT, TENANT, "draft"])
    expect(count.params).toEqual([TENANT, "draft"])
  })

  it("applies owner, search, date and sort filters with bound parameters", async () => {
    const from = new Date("2026-10-01T00:00:00Z")
    await listBatches({ ownerId: 7, search: "bio'; DROP", createdFrom: from, sort: "updated" })
    const [list, count] = dml(db.query)
    expect(list.sql).toContain("(b.created_by = ? OR b.submitted_by = ?)")
    expect(list.sql).toContain("ORDER BY b.updated_at DESC, b.id DESC")
    expect(list.sql).not.toContain("DROP")
    expect(count.params).toEqual([TENANT, 7, 7, "%bio'; DROP%", from])
  })

  it("stores status and refuses stale revisions", async () => {
    await updateBatch(BATCH_ID, { status: "queued", expectedRevision: 0 })
    const upd = dml(db.query).find((c: any) => c.sql.startsWith("UPDATE alt_text_batches"))!
    expect(upd.sql).toMatch(/tenant_id = \? AND id = \?[\s\S]*AND revision = \?/)
    expect(upd.params).toContain("queued")
    db.query.mockImplementation(async (sql: string) => (/LEFT JOIN/.test(sql) ? [batchRow({ revision: 3 })] : { affectedRows: 0 }))
    expect(await updateBatch(BATCH_ID, { name: "x", expectedRevision: 0 })).toBe("conflict")
    await expect(updateBatch(BATCH_ID, { status: "bogus" as any })).rejects.toThrow(/Invalid/)
  })

  it("resolves effective per-image settings while keeping unspecified fields inherited", async () => {
    db.query.mockImplementation(async (sql: string) => {
      if (/FROM alt_text_batches b\s+LEFT JOIN/.test(sql)) return [batchRow()]
      if (/COUNT\(\*\) AS n/.test(sql)) return [{ n: 2 }]
      return [
        { id: 1, batch_id: BATCH_ID, settings_override: JSON.stringify({ gradeLevel: "undergraduate" }), created_at: new Date() },
        { id: 2, batch_id: BATCH_ID, settings_override: null, created_at: new Date() },
      ]
    })
    const res = await listBatchAssets(BATCH_ID)
    expect(res!.items[0].effectiveSettings).toMatchObject({ subject: "biology", gradeLevel: "undergraduate" })
    expect(res!.items[1].settingsOverride).toBeNull()
    expect(res!.items[1].effectiveSettings.subject).toBe("biology")
    expect(normalizeOverride(DEFAULT_GENERATION_SETTINGS, { contentType: "x" })).toBeNull()
  })

  it("ships an additive, idempotent migration", () => {
    const sql = readFileSync("database/migrations/2026-10-12-alt-text-batches.sql", "utf8")
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE|DELETE|RENAME|MODIFY)\b/i)
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS `alt_text_batches`")
    expect(sql).toMatch(/information_schema\.columns[\s\S]*settings_override/)
    expect(sql).toMatch(/information_schema\.statistics[\s\S]*idx_alt_assets_batch/)
  })
})
