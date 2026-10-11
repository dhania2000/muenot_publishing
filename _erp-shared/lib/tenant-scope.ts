/**
 * @file lib/tenant-scope.ts
 * @module Multi-Tenancy
 * @kind Server-side library
 * @summary Multi-Tenancy domain logic (CrossTenantAccessError, currentTenantId, currentTenantIdOrNull, scopedWhere, …).
 * @exports CrossTenantAccessError, currentTenantId, currentTenantIdOrNull, scopedWhere, tenantSelect, tenantFindById, requireOwnedRow, assertSameTenant, … (14 total)
 * @data Reads and writes MySQL via lib/db.
 * @usedBy app/api/admin/storage/files/route.ts, app/api/admin/storage/health/route.ts, app/api/admin/storage/migrations/[id]/route.ts, app/api/admin/storage/migrations/route.ts, app/api/admin/storage/retention/file/route.ts (+110 more); 22 test files
 * @see docs/CODEBASE-GUIDE.md for module ownership, conventions and where to add new code.
 */
import "server-only"
/**
 * Tenant-scoped data access helpers.
 * ---------------------------------------------------------------------------
 * The safe, ergonomic way for routes/services to read and write tenant-owned
 * data. Every helper derives the tenant from the verified session context
 * (lib/tenant-context.ts) — NEVER from client input — and always emits a
 * `tenant_id` predicate, so it satisfies the fail-closed guard (lib/tenant-guard.ts)
 * and prevents cross-tenant leakage uniformly across:
 *
 *   - API access   : list/read/write helpers below.
 *   - IDOR         : assertSameTenant / requireOwnedRow reject foreign ids.
 *   - Search       : scopedWhere adds tenant_id to any filter.
 *   - Exports/reports: same helpers → export/report code is scoped for free.
 *   - Files        : assertTenantOwnsFile guards file/document rows.
 *   - Background jobs: runForTenant / forEachActiveTenant scope cron work.
 */
import { query } from "@/lib/db"
import { getCurrentTenant, requireCurrentTenantId, runWithTenant } from "@/lib/tenant-context"
import { TENANT_COLUMN, isTenantScopedTable } from "@/lib/tenant-tables"
import { listTenants } from "@/lib/tenant-service"

export class CrossTenantAccessError extends Error {
  constructor(message = "Resource not found") {
    // Message is intentionally vague (404-style) so we never confirm the
    // existence of another tenant's record to an attacker.
    super(message)
    this.name = "CrossTenantAccessError"
  }
}

/** The acting tenant id from context; throws if there is none. */
export function currentTenantId(): number {
  return requireCurrentTenantId()
}

/** The acting tenant id, or null when unauthenticated / system context. */
export function currentTenantIdOrNull(): number | null {
  return getCurrentTenant()?.tenantId ?? null
}

function assertScopable(table: string) {
  if (!isTenantScopedTable(table)) {
    throw new Error(
      `Table "${table}" is not registered as tenant-scoped. Add it to lib/tenant-tables.ts before using tenant-scope helpers.`,
    )
  }
}

/**
 * Build a `tenant_id = ?` clause plus params for the current tenant, merged
 * with an optional caller-supplied filter. Use for lists, search, exports and
 * reports so results can never span tenants.
 *
 *   const { where, params } = scopedWhere("sales_leads", "status = ?", ["New"])
 *   query(`SELECT * FROM sales_leads ${where}`, params)
 */
export function scopedWhere(
  table: string,
  extraWhere = "",
  extraParams: any[] = [],
  opts: { alias?: string } = {},
): { where: string; params: any[] } {
  assertScopable(table)
  const col = opts.alias ? `${opts.alias}.${TENANT_COLUMN}` : `\`${TENANT_COLUMN}\``
  const trimmed = extraWhere.trim().replace(/^where\s+/i, "")
  const where = trimmed ? `WHERE ${col} = ? AND (${trimmed})` : `WHERE ${col} = ?`
  return { where, params: [currentTenantId(), ...extraParams] }
}

/** SELECT scoped to the current tenant. `tail` holds anything after the WHERE. */
export async function tenantSelect<T = any[]>(
  table: string,
  opts: {
    columns?: string
    where?: string
    params?: any[]
    tail?: string // e.g. "ORDER BY created_at DESC LIMIT 50"
  } = {},
): Promise<T> {
  const { where, params } = scopedWhere(table, opts.where ?? "", opts.params ?? [])
  const cols = opts.columns ?? "*"
  const tail = opts.tail ? ` ${opts.tail}` : ""
  return query<T>(`SELECT ${cols} FROM \`${table}\` ${where}${tail}`, params)
}

/**
 * Fetch a single row by primary key, scoped to the current tenant. Returns null
 * when the id belongs to another tenant or does not exist — the core IDOR
 * defense for `GET /resource/[id]` style routes.
 */
export async function tenantFindById<T = any>(
  table: string,
  id: number | string,
  idColumn = "id",
): Promise<T | null> {
  const { where, params } = scopedWhere(table, `\`${idColumn}\` = ?`, [id])
  const rows = await query<any[]>(`SELECT * FROM \`${table}\` ${where} LIMIT 1`, params)
  return (rows[0] as T) ?? null
}

/** Like tenantFindById but throws CrossTenantAccessError instead of returning null. */
export async function requireOwnedRow<T = any>(
  table: string,
  id: number | string,
  idColumn = "id",
): Promise<T> {
  const row = await tenantFindById<T>(table, id, idColumn)
  if (!row) throw new CrossTenantAccessError()
  return row
}

/**
 * Guard an already-loaded row (or its tenant id) against the current tenant.
 * Use right after any read that did NOT go through the scoped helpers, before
 * returning, updating, or deleting the row.
 */
export function assertSameTenant(row: { tenant_id?: number | null } | number | null | undefined): void {
  const rowTenant = typeof row === "number" ? row : row?.tenant_id ?? null
  if (rowTenant == null || Number(rowTenant) !== currentTenantId()) {
    throw new CrossTenantAccessError()
  }
}

/**
 * INSERT helper that stamps the current tenant id. Pass the column/value map;
 * `tenant_id` is added automatically and cannot be overridden by the caller.
 */
export async function tenantInsert(
  table: string,
  values: Record<string, any>,
): Promise<{ insertId: number; affectedRows: number }> {
  assertScopable(table)
  const data = Object.fromEntries(Object.entries(values).filter(([column]) => column.toLowerCase() !== TENANT_COLUMN))
  data[TENANT_COLUMN] = currentTenantId()
  const cols = Object.keys(data)
  const placeholders = cols.map(() => "?").join(", ")
  const sql = `INSERT INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(", ")}) VALUES (${placeholders})`
  const res = await query<any>(sql, Object.values(data))
  return { insertId: Number(res?.insertId ?? 0), affectedRows: Number(res?.affectedRows ?? 0) }
}

/**
 * UPDATE scoped to the current tenant. Always ANDs `tenant_id = ?` into the
 * WHERE so a forged id can never touch another tenant's row.
 */
export async function tenantUpdate(
  table: string,
  set: Record<string, any>,
  where: string,
  whereParams: any[] = [],
): Promise<number> {
  assertScopable(table)
  // The WHERE protects which row is changed; it does not protect ownership
  // after the write. Never allow a caller-supplied patch to move an owned row
  // into another tenant, even when the row currently belongs to this tenant.
  if (Object.keys(set).some((column) => column.toLowerCase() === TENANT_COLUMN)) {
    throw new CrossTenantAccessError()
  }
  const setCols = Object.keys(set)
  if (setCols.length === 0) return 0
  const setClause = setCols.map((c) => `\`${c}\` = ?`).join(", ")
  const scoped = scopedWhere(table, where, whereParams)
  const res = await query<any>(
    `UPDATE \`${table}\` SET ${setClause} ${scoped.where}`,
    [...Object.values(set), ...scoped.params],
  )
  return Number(res?.affectedRows ?? 0)
}

/** DELETE scoped to the current tenant. */
export async function tenantDelete(
  table: string,
  where: string,
  whereParams: any[] = [],
): Promise<number> {
  assertScopable(table)
  const scoped = scopedWhere(table, where, whereParams)
  const res = await query<any>(`DELETE FROM \`${table}\` ${scoped.where}`, scoped.params)
  return Number(res?.affectedRows ?? 0)
}

// ---------------------------------------------------------------------------
// File / document access
// ---------------------------------------------------------------------------

/**
 * Assert the current tenant owns a file/document record before streaming or
 * returning it. `ownerTable` must be a tenant-scoped table; `ownerId` is the
 * row the file hangs off (e.g. the subscription/employee/invoice it documents).
 * Prevents cross-tenant file access via a guessed attachment id.
 */
export async function assertTenantOwnsFile(ownerTable: string, ownerId: number | string): Promise<void> {
  const row = await tenantFindById(ownerTable, ownerId)
  if (!row) throw new CrossTenantAccessError("File not found")
}

// ---------------------------------------------------------------------------
// Background jobs / cron
// ---------------------------------------------------------------------------

/**
 * Run `fn` with an explicit tenant bound in context. Cron and other system
 * entry points have no session, so the guard cannot infer a tenant; wrap
 * per-tenant work in this so all reads/writes inside are correctly scoped.
 */
export async function runForTenant<T>(
  tenant: { tenantId: number; slug?: string },
  fn: () => Promise<T>,
): Promise<T> {
  // A fresh async scope keeps concurrent webhook/job fan-out from overwriting
  // a sibling's tenant while either callback is waiting on I/O.
  return runWithTenant({ tenantId: tenant.tenantId, slug: tenant.slug }, fn)
}

/**
 * Iterate every active tenant, running `fn` scoped to each. Background jobs
 * that used to sweep a single global dataset must fan out per tenant so one
 * customer's scheduled work never reads or mutates another's data.
 */
export async function forEachActiveTenant(
  fn: (tenant: { tenantId: number; slug: string; name: string }) => Promise<void>,
): Promise<{ processed: number; failed: number }> {
  const tenants = (await listTenants()).filter((t) => t.status === "active")
  let processed = 0
  let failed = 0
  for (const t of tenants) {
    try {
      await runForTenant({ tenantId: t.id, slug: t.slug }, () =>
        fn({ tenantId: t.id, slug: t.slug, name: t.name }),
      )
      processed++
    } catch {
      failed++
      // Raw driver errors can embed SQL, hostnames or credentials. The caller
      // records its own sanitized operational code; this fan-out logs no cause.
      console.error(`[tenant-scope] tenant job failed tenantId=${t.id}`)
    }
  }
  return { processed, failed }
}
