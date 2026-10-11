/**
 * @file lib/ai/credits/credits-store.ts
 * @module AI Features
 * @kind Server-side library
 * @summary AI Features domain logic (PlatformTenantPolicy, TenantCreditPolicy, DEFAULT_PLATFORM_POLICY, defaultTenantPolicy, …).
 * @exports PlatformTenantPolicy, TenantCreditPolicy, DEFAULT_PLATFORM_POLICY, defaultTenantPolicy, normalizePlatformPolicy, normalizeTenantPolicy, ensureCreditSchema, creditAudit, … (35 total)
 * @data Reads and writes MySQL via lib/db.
 * @usedBy app/api/ai/credits/admin/route.ts, app/api/ai/credits/route.ts, app/api/platform/ai-credits/route.ts, lib/ai/credits/credits-admin.ts, lib/ai/credits/credits-service.ts
 * @see docs/CODEBASE-GUIDE.md for module ownership, conventions and where to add new code.
 */
import "server-only"
/**
 * AI Credits — tenant wallet engine. Every balance mutation runs inside a
 * transaction that first locks the tenant's wallet row (SELECT … FOR UPDATE),
 * so concurrent requests serialise per tenant and can never double-spend.
 * The ledger is append-only and every write carries an idempotency key.
 */
import { randomUUID } from "node:crypto"
import type mysql from "mysql2/promise"
import { query, withTransaction } from "@/lib/db"
import { getTenantById } from "@/lib/tenant-service"
import { getSubscriptionForTenant } from "@/lib/platform-console"
import {
  CREDIT_SOURCES,
  CreditError,
  allocateDebit,
  crossedThresholds,
  periodWindow,
  userRemaining,
  type Bucket,
  type CreditSource,
  type LedgerType,
  type OverageMode,
  type UserLimit,
  type UserLimitMode,
} from "./credits-core"
import { getPlanAllowance, getPlatformConfig, type PlanAllowance } from "./credits-platform"
import { getTenantEntitlements } from "@/lib/platform/entitlement-guard"
import { resolveAiMonthlyCredits } from "@/lib/billing/entitlement-policy"

type Conn = mysql.PoolConnection

/** Set by platform super admins only. */
export type PlatformTenantPolicy = {
  aiSuspended: boolean
  unlimited: boolean
  /** Overrides the plan allowance when set. */
  customAllowance: number | null
  /** Absolute ceiling on credits consumed per period, including purchased. */
  hardLimit: number | null
  overageMode: OverageMode | null
  allowTopup: boolean
  allowAutoTopup: boolean
  allowUserAllocation: boolean
  allowPremiumModels: boolean
  blockedModels: string[]
  maxRequestCredits: number | null
  dailyCap: number | null
  requestsPerMinute: number | null
}

/** Editable by tenant owners/admins within the platform policy. */
export type TenantCreditPolicy = {
  alertThresholds: number[]
  deductionPriority: CreditSource[]
  defaultUserMode: UserLimitMode
  defaultUserLimit: number | null
  autoTopup: { enabled: boolean; thresholdCredits: number; packId: number | null; maxPerMonth: number }
}

export const DEFAULT_PLATFORM_POLICY: PlatformTenantPolicy = {
  aiSuspended: false,
  unlimited: false,
  customAllowance: null,
  hardLimit: null,
  overageMode: null,
  allowTopup: true,
  allowAutoTopup: true,
  allowUserAllocation: true,
  allowPremiumModels: true,
  blockedModels: [],
  maxRequestCredits: null,
  dailyCap: null,
  requestsPerMinute: 20,
}

export function defaultTenantPolicy(priority: CreditSource[]): TenantCreditPolicy {
  return {
    alertThresholds: [50, 75, 90, 100],
    deductionPriority: priority,
    defaultUserMode: "pool",
    defaultUserLimit: null,
    autoTopup: { enabled: false, thresholdCredits: 0, packId: null, maxPerMonth: 1 },
  }
}

const parse = (v: unknown) => {
  if (v == null) return null
  if (typeof v === "object") return v as any
  try { return JSON.parse(String(v)) } catch { return null }
}
const nOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null)
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const sqlDate = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ")
const USER_MODES: UserLimitMode[] = ["none", "pool", "fixed", "percent", "unlimited"]
/** Reservations older than this are treated as abandoned and stop holding credits. */
const RESERVATION_TTL_MIN = 15

export function normalizePlatformPolicy(raw: any, base = DEFAULT_PLATFORM_POLICY): PlatformTenantPolicy {
  const r = raw && typeof raw === "object" ? raw : {}
  const bool = (k: keyof PlatformTenantPolicy) => (typeof r[k] === "boolean" ? r[k] : base[k]) as boolean
  const nul = (k: keyof PlatformTenantPolicy) => (k in r ? nOrNull(r[k]) : (base[k] as number | null))
  return {
    aiSuspended: bool("aiSuspended"),
    unlimited: bool("unlimited"),
    customAllowance: nul("customAllowance"),
    hardLimit: nul("hardLimit"),
    overageMode: r.overageMode === "overage" || r.overageMode === "hard_limit" ? r.overageMode : r.overageMode === null ? null : base.overageMode,
    allowTopup: bool("allowTopup"),
    allowAutoTopup: bool("allowAutoTopup"),
    allowUserAllocation: bool("allowUserAllocation"),
    allowPremiumModels: bool("allowPremiumModels"),
    blockedModels: Array.isArray(r.blockedModels) ? r.blockedModels.map(String).slice(0, 200) : base.blockedModels,
    maxRequestCredits: nul("maxRequestCredits"),
    dailyCap: nul("dailyCap"),
    requestsPerMinute: nul("requestsPerMinute"),
  }
}

export function normalizeTenantPolicy(raw: any, base: TenantCreditPolicy): TenantCreditPolicy {
  const r = raw && typeof raw === "object" ? raw : {}
  const at = r.autoTopup && typeof r.autoTopup === "object" ? r.autoTopup : {}
  const thresholds = Array.isArray(r.alertThresholds)
    ? [...new Set<number>(r.alertThresholds.map(Number).filter((n: number) => n > 0 && n <= 100))].sort((a, b) => a - b)
    : base.alertThresholds
  const priority = Array.isArray(r.deductionPriority)
    ? r.deductionPriority.filter((s: string) => (CREDIT_SOURCES as readonly string[]).includes(s))
    : base.deductionPriority
  return {
    alertThresholds: thresholds,
    deductionPriority: priority.length ? priority : base.deductionPriority,
    defaultUserMode: USER_MODES.includes(r.defaultUserMode) ? r.defaultUserMode : base.defaultUserMode,
    defaultUserLimit: "defaultUserLimit" in r ? nOrNull(r.defaultUserLimit) : base.defaultUserLimit,
    autoTopup: {
      enabled: typeof at.enabled === "boolean" ? at.enabled : base.autoTopup.enabled,
      thresholdCredits: nOrNull(at.thresholdCredits) ?? base.autoTopup.thresholdCredits,
      packId: "packId" in at ? (Number(at.packId) || null) : base.autoTopup.packId,
      maxPerMonth: Math.min(10, Math.max(0, Math.floor(nOrNull(at.maxPerMonth) ?? base.autoTopup.maxPerMonth))),
    },
  }
}

// ---------- Schema ----------

let ensured: Promise<void> | null = null
const TABLE = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"

async function runEnsure() {
  await query(`CREATE TABLE IF NOT EXISTS ai_credit_wallets (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    platform_policy_json JSON NULL,
    tenant_policy_json JSON NULL,
    period_key VARCHAR(16) NULL,
    period_start DATETIME NULL,
    period_end DATETIME NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_ai_credit_wallets (tenant_id)
  ) ${TABLE}`)
  await query(`CREATE TABLE IF NOT EXISTS ai_credit_buckets (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    source VARCHAR(20) NOT NULL,
    granted DECIMAL(14,2) NOT NULL,
    remaining DECIMAL(14,2) NOT NULL,
    period_key VARCHAR(16) NULL,
    reference VARCHAR(120) NULL,
    expires_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_ai_credit_buckets_tenant (tenant_id, source, expires_at)
  ) ${TABLE}`)
  await query(`CREATE TABLE IF NOT EXISTS ai_credit_ledger (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    txn_id CHAR(36) NOT NULL,
    idempotency_key VARCHAR(160) NOT NULL,
    type VARCHAR(30) NOT NULL,
    amount DECIMAL(14,2) NOT NULL,
    balance_before DECIMAL(14,2) NOT NULL,
    balance_after DECIMAL(14,2) NOT NULL,
    source VARCHAR(20) NULL,
    user_id INT NULL,
    department VARCHAR(120) NULL,
    request_id VARCHAR(80) NULL,
    model_id VARCHAR(120) NULL,
    provider VARCHAR(60) NULL,
    rate_version INT NULL,
    reference VARCHAR(160) NULL,
    note VARCHAR(500) NULL,
    metadata_json JSON NULL,
    actor_id INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_ai_credit_ledger_txn (txn_id),
    UNIQUE KEY uq_ai_credit_ledger_idem (tenant_id, idempotency_key),
    KEY idx_ai_credit_ledger_time (tenant_id, created_at),
    KEY idx_ai_credit_ledger_user (tenant_id, user_id, created_at)
  ) ${TABLE}`)
  await query(`CREATE TABLE IF NOT EXISTS ai_credit_reservations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    request_id VARCHAR(80) NOT NULL,
    user_id INT NOT NULL,
    department VARCHAR(120) NULL,
    model_id VARCHAR(120) NOT NULL,
    credits DECIMAL(14,2) NOT NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'reserved',
    interaction_id BIGINT NULL,
    settled_credits DECIMAL(14,2) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_ai_credit_reservations (tenant_id, request_id),
    KEY idx_ai_credit_reservations_status (tenant_id, status, created_at)
  ) ${TABLE}`)
  await query(`CREATE TABLE IF NOT EXISTS ai_credit_user_limits (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    user_id INT NOT NULL,
    mode VARCHAR(12) NOT NULL DEFAULT 'pool',
    monthly_limit DECIMAL(14,2) NULL,
    percent DECIMAL(5,2) NULL,
    department VARCHAR(120) NULL,
    bonus DECIMAL(14,2) NOT NULL DEFAULT 0,
    bonus_period VARCHAR(16) NULL,
    updated_by INT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_ai_credit_user_limits (tenant_id, user_id)
  ) ${TABLE}`)
  await query(`CREATE TABLE IF NOT EXISTS ai_credit_departments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    name VARCHAR(120) NOT NULL,
    monthly_limit DECIMAL(14,2) NULL,
    bonus DECIMAL(14,2) NOT NULL DEFAULT 0,
    bonus_period VARCHAR(16) NULL,
    UNIQUE KEY uq_ai_credit_departments (tenant_id, name)
  ) ${TABLE}`)
  await query(`CREATE TABLE IF NOT EXISTS ai_credit_requests (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    user_id INT NOT NULL,
    user_name VARCHAR(255) NULL,
    amount DECIMAL(14,2) NOT NULL,
    reason VARCHAR(500) NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'pending',
    approved_amount DECIMAL(14,2) NULL,
    decided_by INT NULL,
    decided_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_ai_credit_requests (tenant_id, status, created_at)
  ) ${TABLE}`)
  await query(`CREATE TABLE IF NOT EXISTS ai_credit_orders (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    pack_id INT NOT NULL,
    pack_name VARCHAR(120) NOT NULL,
    quantity INT NOT NULL,
    credits INT NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    invoice_id BIGINT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    auto_topup TINYINT(1) NOT NULL DEFAULT 0,
    allocation_json JSON NULL,
    validity_months INT NULL,
    purchased_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fulfilled_at DATETIME NULL,
    KEY idx_ai_credit_orders_invoice (tenant_id, invoice_id),
    KEY idx_ai_credit_orders_time (tenant_id, created_at)
  ) ${TABLE}`)
  await query(`CREATE TABLE IF NOT EXISTS ai_credit_alerts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    period_key VARCHAR(16) NOT NULL,
    threshold INT NOT NULL,
    used DECIMAL(14,2) NOT NULL,
    allowance DECIMAL(14,2) NOT NULL,
    acknowledged TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_ai_credit_alerts (tenant_id, period_key, threshold)
  ) ${TABLE}`)
  await query(`CREATE TABLE IF NOT EXISTS ai_credit_audit (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    actor_id INT NULL,
    actor_name VARCHAR(255) NULL,
    action VARCHAR(60) NOT NULL,
    target_user_id INT NULL,
    old_json JSON NULL,
    new_json JSON NULL,
    ip VARCHAR(64) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_ai_credit_audit_time (tenant_id, created_at)
  ) ${TABLE}`)
}

export function ensureCreditSchema(): Promise<void> {
  if (!ensured) ensured = runEnsure().catch((e) => { ensured = null; throw e })
  return ensured
}

export async function creditAudit(
  tenantId: number,
  e: { actorId: number | null; actorName?: string | null; action: string; targetUserId?: number | null; old?: unknown; next?: unknown; ip?: string | null },
) {
  await ensureCreditSchema()
  await query(
    "INSERT INTO ai_credit_audit (tenant_id, actor_id, actor_name, action, target_user_id, old_json, new_json, ip) VALUES (?,?,?,?,?,?,?,?)",
    [tenantId, e.actorId, e.actorName ?? null, e.action, e.targetUserId ?? null, e.old == null ? null : JSON.stringify(e.old), e.next == null ? null : JSON.stringify(e.next), e.ip ?? null],
  )
}

// ---------- Wallet context ----------

export type WalletContext = {
  tenantId: number
  plan: string
  allowance: PlanAllowance
  platform: PlatformTenantPolicy
  tenant: TenantCreditPolicy
  /** Credits granted per period; null = unlimited. */
  periodAllowance: number | null
  unlimited: boolean
  overageMode: OverageMode
  aiEnabled: boolean
}

async function ensureWalletRow(tenantId: number) {
  await ensureCreditSchema()
  await query("INSERT IGNORE INTO ai_credit_wallets (tenant_id) VALUES (?)", [tenantId])
}

export async function loadWalletContext(tenantId: number): Promise<WalletContext> {
  await ensureWalletRow(tenantId)
  const [row] = await query<any[]>("SELECT platform_policy_json, tenant_policy_json FROM ai_credit_wallets WHERE tenant_id = ?", [tenantId])
  const [tenantRow, subscription] = await Promise.all([
    getTenantById(tenantId).catch(() => null),
    getSubscriptionForTenant(tenantId).catch(() => null),
  ])
  // Feature #13: the subscription's plan_code is canonical; tenants.plan is a legacy mirror.
  const plan = String(subscription?.plan_code ?? tenantRow?.plan ?? "free").toLowerCase()
  const [rawAllowance, cfg, entitlementCredits] = await Promise.all([
    getPlanAllowance(plan),
    getPlatformConfig(),
    getTenantEntitlements(tenantId).then((e) => e.ai_credits_per_month).catch(() => undefined),
  ])
  // Feature #13: an unconfigured plan inherits the subscription's effective
  // ai_credits_per_month (incl. add-ons/overrides) instead of a fixed default.
  const allowance: PlanAllowance = {
    ...rawAllowance,
    monthlyCredits: resolveAiMonthlyCredits({ configured: rawAllowance.configured !== false, allowanceCredits: rawAllowance.monthlyCredits, entitlementCredits }),
  }
  const platform = normalizePlatformPolicy(parse(row?.platform_policy_json))
  const tenant = normalizeTenantPolicy(parse(row?.tenant_policy_json), defaultTenantPolicy(cfg.defaultDeductionPriority))
  const unlimited = platform.unlimited || (platform.customAllowance == null && allowance.monthlyCredits == null)
  return {
    tenantId,
    plan,
    allowance,
    platform,
    tenant,
    periodAllowance: unlimited ? null : platform.customAllowance ?? allowance.monthlyCredits,
    unlimited,
    overageMode: platform.overageMode ?? allowance.overageMode,
    aiEnabled: allowance.aiEnabled && !platform.aiSuspended,
  }
}

export async function savePlatformTenantPolicy(tenantId: number, input: unknown, actorId: number): Promise<PlatformTenantPolicy> {
  const ctx = await loadWalletContext(tenantId)
  const next = normalizePlatformPolicy(input, ctx.platform)
  await query("UPDATE ai_credit_wallets SET platform_policy_json = ? WHERE tenant_id = ?", [JSON.stringify(next), tenantId])
  await creditAudit(tenantId, { actorId, action: "platform_policy.update", old: ctx.platform, next })
  return next
}

export async function saveTenantCreditPolicy(tenantId: number, input: unknown, actor: { id: number; name: string; ip?: string | null }) {
  const ctx = await loadWalletContext(tenantId)
  const next = normalizeTenantPolicy(input, ctx.tenant)
  if (next.autoTopup.enabled && !ctx.platform.allowAutoTopup) throw new Error("Automatic top-up is not available for your organisation")
  await query("UPDATE ai_credit_wallets SET tenant_policy_json = ? WHERE tenant_id = ?", [JSON.stringify(next), tenantId])
  await creditAudit(tenantId, { actorId: actor.id, actorName: actor.name, action: "tenant_policy.update", old: ctx.tenant, next, ip: actor.ip })
  return next
}

// ---------- Locked primitives (inside a transaction) ----------

async function rows<T = any[]>(conn: Conn, sql: string, params: unknown[] = []): Promise<T> {
  const [r] = await conn.query(sql, params)
  return r as T
}

async function lockWallet(conn: Conn, tenantId: number) {
  const [w] = await rows<any[]>(conn, "SELECT id, period_key FROM ai_credit_wallets WHERE tenant_id = ? FOR UPDATE", [tenantId])
  if (!w) throw new Error("AI credit wallet missing")
  return w as { id: number; period_key: string | null }
}

async function lockedBuckets(conn: Conn, tenantId: number): Promise<Bucket[]> {
  const r = await rows<any[]>(
    conn,
    "SELECT id, source, remaining, expires_at FROM ai_credit_buckets WHERE tenant_id = ? AND remaining > 0 AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP()) FOR UPDATE",
    [tenantId],
  )
  return r.map((b) => ({ id: Number(b.id), source: b.source, remaining: Number(b.remaining), expiresAt: b.expires_at ? new Date(b.expires_at).toISOString() : null }))
}

const sumBuckets = (b: Bucket[]) => round2(b.reduce((s, x) => s + x.remaining, 0))

type LedgerEntry = {
  key: string
  type: LedgerType
  amount: number
  before: number
  after: number
  source?: CreditSource | null
  userId?: number | null
  department?: string | null
  requestId?: string | null
  modelId?: string | null
  rateVersion?: number | null
  reference?: string | null
  note?: string | null
  metadata?: unknown
  actorId?: number | null
}

/** Returns false when the idempotency key already exists (duplicate). */
async function writeLedger(conn: Conn, tenantId: number, e: LedgerEntry): Promise<boolean> {
  const [res]: any = await conn.query(
    `INSERT IGNORE INTO ai_credit_ledger (tenant_id, txn_id, idempotency_key, type, amount, balance_before, balance_after, source, user_id, department, request_id, model_id, provider, rate_version, reference, note, metadata_json, actor_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      tenantId, randomUUID(), e.key, e.type, round2(e.amount), round2(e.before), round2(e.after), e.source ?? null, e.userId ?? null,
      e.department ?? null, e.requestId ?? null, e.modelId ?? null, e.modelId ? e.modelId.split("/")[0] : null, e.rateVersion ?? null,
      e.reference ?? null, e.note?.slice(0, 500) ?? null, e.metadata == null ? null : JSON.stringify(e.metadata), e.actorId ?? null,
    ],
  )
  return Number(res.affectedRows) > 0
}

async function addBucket(conn: Conn, tenantId: number, source: CreditSource, amount: number, expiresAt: Date | null, periodKey: string | null, reference: string | null) {
  const [res]: any = await conn.query(
    "INSERT INTO ai_credit_buckets (tenant_id, source, granted, remaining, period_key, reference, expires_at) VALUES (?,?,?,?,?,?,?)",
    [tenantId, source, round2(amount), round2(amount), periodKey, reference, expiresAt ? sqlDate(expiresAt) : null],
  )
  return Number(res.insertId)
}

/**
 * Lazily rolls the wallet into the current period (idempotent under the lock):
 * expires stale buckets, carries forward when the plan allows, then grants
 * the period allowance exactly once per period key.
 */
async function rollPeriod(conn: Conn, ctx: WalletContext, wallet: { period_key: string | null }) {
  const tenantId = ctx.tenantId
  const win = periodWindow(ctx.allowance.resetFrequency)

  // Expire anything past its expiry date (purchased packs, promos …).
  const expired = await rows<any[]>(
    conn,
    "SELECT id, source, remaining FROM ai_credit_buckets WHERE tenant_id = ? AND remaining > 0 AND expires_at IS NOT NULL AND expires_at <= UTC_TIMESTAMP() FOR UPDATE",
    [tenantId],
  )
  if (wallet.period_key === win.key && expired.length === 0) return

  let balance = sumBuckets(await lockedBuckets(conn, tenantId)) + expired.reduce((s, b) => s + Number(b.remaining), 0)
  let carry = 0
  for (const b of expired) {
    const amt = Number(b.remaining)
    if (b.source === "subscription" && ctx.allowance.carryForward && wallet.period_key !== win.key) {
      carry += amt
    }
    await conn.query("UPDATE ai_credit_buckets SET remaining = 0 WHERE id = ? AND tenant_id = ?", [b.id, tenantId])
    await writeLedger(conn, tenantId, { key: `expiry:${b.id}`, type: "expiry", amount: -amt, before: balance, after: balance - amt, source: b.source, note: "Credits expired" })
    balance = round2(balance - amt)
  }

  if (wallet.period_key !== win.key) {
    if (carry > 0) {
      const amt = ctx.allowance.carryForwardMax == null ? carry : Math.min(carry, ctx.allowance.carryForwardMax)
      if (amt > 0) {
        const id = await addBucket(conn, tenantId, "carry_forward", amt, win.end, win.key, `carry:${wallet.period_key}`)
        await writeLedger(conn, tenantId, { key: `carry:${win.key}`, type: "carry_forward", amount: amt, before: balance, after: balance + amt, source: "carry_forward", reference: String(id), note: `Carried forward from ${wallet.period_key}` })
        balance = round2(balance + amt)
      }
    }
    if (ctx.aiEnabled && ctx.periodAllowance && ctx.periodAllowance > 0) {
      const amt = ctx.periodAllowance
      const id = await addBucket(conn, tenantId, "subscription", amt, win.end, win.key, `plan:${ctx.plan}`)
      const ok = await writeLedger(conn, tenantId, { key: `sub:${win.key}`, type: "subscription_credit", amount: amt, before: balance, after: balance + amt, source: "subscription", reference: String(id), note: `${ctx.plan} plan allowance for ${win.key}` })
      if (!ok) await conn.query("DELETE FROM ai_credit_buckets WHERE id = ? AND tenant_id = ?", [id, tenantId])
    }
    await conn.query("UPDATE ai_credit_wallets SET period_key = ?, period_start = ?, period_end = ? WHERE tenant_id = ?", [win.key, sqlDate(win.start), sqlDate(win.end), tenantId])
  }
}

async function periodConsumed(conn: Conn, tenantId: number, start: Date, filter = "", params: unknown[] = []) {
  const [r] = await rows<any[]>(
    conn,
    `SELECT COALESCE(-SUM(amount),0) used FROM ai_credit_ledger WHERE tenant_id = ? AND type IN ('usage_debit','reversal') AND created_at >= ? ${filter}`,
    [tenantId, sqlDate(start), ...params],
  )
  return Math.max(0, Number(r?.used ?? 0))
}

async function activeReserved(conn: Conn, tenantId: number, filter = "", params: unknown[] = []) {
  const [r] = await rows<any[]>(
    conn,
    `SELECT COALESCE(SUM(credits),0) c FROM ai_credit_reservations WHERE tenant_id = ? AND status = 'reserved' AND created_at > (UTC_TIMESTAMP() - INTERVAL ${RESERVATION_TTL_MIN} MINUTE) ${filter}`,
    [tenantId, ...params],
  )
  return Number(r?.c ?? 0)
}

async function loadUserLimit(conn: Conn | null, tenantId: number, userId: number, ctx: WalletContext, periodKey: string): Promise<UserLimit & { department: string | null }> {
  const sql = "SELECT mode, monthly_limit, percent, department, bonus, bonus_period FROM ai_credit_user_limits WHERE tenant_id = ? AND user_id = ?"
  const r = conn ? (await rows<any[]>(conn, sql, [tenantId, userId]))[0] : (await query<any[]>(sql, [tenantId, userId]))[0]
  if (!r) {
    return { mode: ctx.tenant.defaultUserMode, monthlyLimit: ctx.tenant.defaultUserLimit, percent: null, bonus: 0, department: null }
  }
  return {
    mode: USER_MODES.includes(r.mode) ? r.mode : "pool",
    monthlyLimit: r.monthly_limit == null ? null : Number(r.monthly_limit),
    percent: r.percent == null ? null : Number(r.percent),
    bonus: r.bonus_period === periodKey ? Number(r.bonus) : 0,
    department: r.department ?? null,
  }
}

// ---------- Reserve / settle / release ----------

export type ReserveInput = { requestId: string; userId: number; modelId: string; credits: number; premium: boolean }
export type Reservation = { requestId: string; credits: number; replay: { interactionId: number } | null }

export async function reserveCredits(ctx: WalletContext, input: ReserveInput): Promise<Reservation> {
  const tenantId = ctx.tenantId
  if (!ctx.aiEnabled) throw new CreditError("ai_suspended", ctx.platform.aiSuspended ? "AI has been suspended for your organisation. Contact support." : "AI is not included in your current plan.")
  if (ctx.platform.blockedModels.includes(input.modelId)) throw new CreditError("model_not_allowed", "This model is not available for your organisation.")
  if (input.premium && !ctx.platform.allowPremiumModels) throw new CreditError("premium_not_allowed", "Premium models are not included in your plan.")
  if (ctx.platform.maxRequestCredits != null && input.credits > ctx.platform.maxRequestCredits) {
    throw new CreditError("request_too_large", `This request could use up to ${input.credits} credits, above the ${ctx.platform.maxRequestCredits}-credit per-request limit. Shorten it or choose a cheaper model.`)
  }
  await ensureWalletRow(tenantId)

  return withTransaction(async (conn) => {
    const wallet = await lockWallet(conn, tenantId)

    const [existing] = await rows<any[]>(conn, "SELECT status, credits, interaction_id FROM ai_credit_reservations WHERE tenant_id = ? AND request_id = ? FOR UPDATE", [tenantId, input.requestId])
    if (existing) {
      if (existing.status === "settled" && existing.interaction_id) return { requestId: input.requestId, credits: Number(existing.credits), replay: { interactionId: Number(existing.interaction_id) } }
      if (existing.status === "reserved") throw new CreditError("duplicate_request", "This request is already being processed.")
      // A released (failed) request may be retried under the same id.
      await conn.query("DELETE FROM ai_credit_reservations WHERE tenant_id = ? AND request_id = ? AND status = 'released'", [tenantId, input.requestId])
    }

    await rollPeriod(conn, ctx, wallet)
    const win = periodWindow(ctx.allowance.resetFrequency)

    if (ctx.platform.requestsPerMinute != null) {
      const [r] = await rows<any[]>(conn, "SELECT COUNT(*) c FROM ai_credit_reservations WHERE tenant_id = ? AND user_id = ? AND created_at > (UTC_TIMESTAMP() - INTERVAL 1 MINUTE)", [tenantId, input.userId])
      if (Number(r.c) >= ctx.platform.requestsPerMinute) throw new CreditError("rate_limited", "Too many AI requests. Please wait a moment and try again.")
    }

    const reserved = await activeReserved(conn, tenantId)
    if (ctx.platform.dailyCap != null) {
      const today = new Date()
      today.setUTCHours(0, 0, 0, 0)
      const usedToday = await periodConsumed(conn, tenantId, today)
      if (usedToday + reserved + input.credits > ctx.platform.dailyCap) throw new CreditError("daily_cap_reached", "Your organisation has reached today's AI credit cap.")
    }

    const used = await periodConsumed(conn, tenantId, win.start)
    if (ctx.platform.hardLimit != null && used + reserved + input.credits > ctx.platform.hardLimit) {
      throw new CreditError("insufficient_credits", "Your organisation has reached its AI credit limit for this period.")
    }
    if (!ctx.unlimited && ctx.overageMode === "hard_limit") {
      const available = sumBuckets(await lockedBuckets(conn, tenantId)) - reserved
      if (available < input.credits) {
        throw new CreditError("insufficient_credits", "Your organisation has insufficient AI credits. Ask an administrator to buy more credits.", { available: Math.max(0, round2(available)) })
      }
    }

    const limit = await loadUserLimit(conn, tenantId, input.userId, ctx, win.key)
    if (limit.mode === "none") throw new CreditError("user_limit_reached", "AI access has not been enabled for your account.")
    if (limit.mode !== "unlimited") {
      const userUsed = (await periodConsumed(conn, tenantId, win.start, "AND user_id = ?", [input.userId])) + (await activeReserved(conn, tenantId, "AND user_id = ?", [input.userId]))
      const left = userRemaining(limit, userUsed, ctx.periodAllowance)
      if (left != null && left < input.credits) {
        throw new CreditError("user_limit_reached", "You have reached your AI credit limit for this period. You can request more credits from your administrator.", { remaining: left })
      }
      if (limit.department) {
        const [dept] = await rows<any[]>(conn, "SELECT monthly_limit, bonus, bonus_period FROM ai_credit_departments WHERE tenant_id = ? AND name = ?", [tenantId, limit.department])
        if (dept?.monthly_limit != null) {
          const cap = Number(dept.monthly_limit) + (dept.bonus_period === win.key ? Number(dept.bonus) : 0)
          const deptUsed = (await periodConsumed(conn, tenantId, win.start, "AND department = ?", [limit.department])) + (await activeReserved(conn, tenantId, "AND department = ?", [limit.department]))
          if (deptUsed + input.credits > cap) throw new CreditError("department_limit_reached", `The ${limit.department} department has reached its AI credit limit for this period.`)
        }
      }
    }

    await conn.query(
      "INSERT INTO ai_credit_reservations (tenant_id, request_id, user_id, department, model_id, credits) VALUES (?,?,?,?,?,?)",
      [tenantId, input.requestId, input.userId, limit.department, input.modelId, round2(input.credits)],
    )
    return { requestId: input.requestId, credits: round2(input.credits), replay: null }
  })
}

export async function releaseCredits(tenantId: number, requestId: string): Promise<void> {
  await query("UPDATE ai_credit_reservations SET status = 'released' WHERE tenant_id = ? AND request_id = ? AND status = 'reserved'", [tenantId, requestId])
}

export type SettleResult = { charged: number; balanceAfter: number; uncovered: number; alerts: number[]; autoTopup: boolean }

/** Converts a reservation into a final debit. Exactly-once per request id. */
export async function settleCredits(
  ctx: WalletContext,
  input: { requestId: string; userId: number; modelId: string; credits: number; rateVersion: number | null; interactionId: number; metadata: Record<string, unknown> },
): Promise<SettleResult | null> {
  const tenantId = ctx.tenantId
  const result = await withTransaction(async (conn) => {
    await lockWallet(conn, tenantId)
    const [res]: any = await conn.query(
      "UPDATE ai_credit_reservations SET status = 'settled', settled_credits = ?, interaction_id = ? WHERE tenant_id = ? AND request_id = ? AND status = 'reserved'",
      [round2(input.credits), input.interactionId, tenantId, input.requestId],
    )
    if (Number(res.affectedRows) === 0) return null
    const [resv] = await rows<any[]>(conn, "SELECT department FROM ai_credit_reservations WHERE tenant_id = ? AND request_id = ?", [tenantId, input.requestId])

    const win = periodWindow(ctx.allowance.resetFrequency)
    const usedBefore = await periodConsumed(conn, tenantId, win.start)
    const buckets = await lockedBuckets(conn, tenantId)
    const before = sumBuckets(buckets)
    const { draws, uncovered } = ctx.unlimited ? { draws: [], uncovered: 0 } : allocateDebit(buckets, input.credits, ctx.tenant.deductionPriority)
    for (const d of draws) {
      await conn.query("UPDATE ai_credit_buckets SET remaining = remaining - ? WHERE id = ? AND tenant_id = ? AND remaining >= ?", [d.amount, d.bucketId, tenantId, d.amount])
    }
    const drawn = round2(draws.reduce((s, d) => s + d.amount, 0))
    const after = round2(before - drawn)
    await writeLedger(conn, tenantId, {
      key: `usage:${input.requestId}`,
      type: "usage_debit",
      amount: -input.credits,
      before,
      after,
      source: draws[0]?.source ?? null,
      userId: input.userId,
      department: resv?.department ?? null,
      requestId: input.requestId,
      modelId: input.modelId,
      rateVersion: input.rateVersion,
      reference: String(input.interactionId),
      metadata: { ...input.metadata, draws, overage: uncovered || undefined },
    })

    const alerts: number[] = []
    const allowance = ctx.periodAllowance
    if (allowance && allowance > 0) {
      for (const t of crossedThresholds(usedBefore, usedBefore + input.credits, allowance, ctx.tenant.alertThresholds)) {
        const [a]: any = await conn.query(
          "INSERT IGNORE INTO ai_credit_alerts (tenant_id, period_key, threshold, used, allowance) VALUES (?,?,?,?,?)",
          [tenantId, win.key, t, round2(usedBefore + input.credits), allowance],
        )
        if (Number(a.affectedRows) > 0) alerts.push(t)
      }
    }
    const at = ctx.tenant.autoTopup
    const autoTopup = !ctx.unlimited && ctx.platform.allowAutoTopup && ctx.platform.allowTopup && at.enabled && at.packId != null && after <= at.thresholdCredits
    return { charged: input.credits, balanceAfter: after, uncovered, alerts, autoTopup }
  })
  return result
}

// ---------- Grants (purchases, manual, promos, refunds) ----------

export async function grantCredits(
  tenantId: number,
  g: { key: string; type: LedgerType; source: CreditSource; amount: number; expiresAt: Date | null; reference?: string | null; note?: string | null; actorId?: number | null; userId?: number | null },
): Promise<boolean> {
  if (!(g.amount > 0)) throw new Error("Grant amount must be positive")
  await ensureWalletRow(tenantId)
  return withTransaction(async (conn) => {
    await lockWallet(conn, tenantId)
    const before = sumBuckets(await lockedBuckets(conn, tenantId))
    const ok = await writeLedger(conn, tenantId, { key: g.key, type: g.type, amount: g.amount, before, after: before + g.amount, source: g.source, reference: g.reference, note: g.note, actorId: g.actorId, userId: g.userId })
    if (ok) await addBucket(conn, tenantId, g.source, g.amount, g.expiresAt, null, g.reference ?? g.key)
    return ok
  })
}

/** Removes up to `amount` credits (manual debit, refund reversal). Never goes below zero. */
export async function debitCredits(
  tenantId: number,
  d: { key: string; type: LedgerType; amount: number; preferSource?: CreditSource; reference?: string | null; note?: string | null; actorId?: number | null; bucketReference?: string },
): Promise<number> {
  await ensureWalletRow(tenantId)
  return withTransaction(async (conn) => {
    await lockWallet(conn, tenantId)
    const [dup] = await rows<any[]>(conn, "SELECT id FROM ai_credit_ledger WHERE tenant_id = ? AND idempotency_key = ?", [tenantId, d.key])
    if (dup) return 0
    let buckets = await lockedBuckets(conn, tenantId)
    const before = sumBuckets(buckets)
    if (d.bucketReference) {
      const ref = await rows<any[]>(conn, "SELECT id FROM ai_credit_buckets WHERE tenant_id = ? AND reference = ?", [tenantId, d.bucketReference])
      const ids = new Set(ref.map((r) => Number(r.id)))
      buckets = [...buckets.filter((b) => ids.has(b.id)), ...buckets.filter((b) => !ids.has(b.id))]
    }
    const priority = d.preferSource ? [d.preferSource, ...CREDIT_SOURCES.filter((s) => s !== d.preferSource)] : [...CREDIT_SOURCES]
    const { draws } = allocateDebit(d.bucketReference ? buckets.map((b, i) => ({ ...b, source: (i < buckets.length ? b.source : b.source) })) : buckets, d.amount, priority)
    for (const x of draws) await conn.query("UPDATE ai_credit_buckets SET remaining = remaining - ? WHERE id = ? AND tenant_id = ?", [x.amount, x.bucketId, tenantId])
    const taken = round2(draws.reduce((s, x) => s + x.amount, 0))
    await writeLedger(conn, tenantId, { key: d.key, type: d.type, amount: -taken, before, after: before - taken, source: draws[0]?.source ?? null, reference: d.reference, note: d.note, actorId: d.actorId, metadata: { requested: d.amount, draws } })
    return taken
  })
}

// ---------- Read models ----------

export type WalletSummary = {
  aiEnabled: boolean
  suspended: boolean
  unlimited: boolean
  plan: string
  periodKey: string
  periodEnd: string
  periodAllowance: number | null
  balance: number
  reserved: number
  usedThisPeriod: number
  bySource: Record<CreditSource, number>
  overageMode: OverageMode
  canTopup: boolean
  user: { mode: UserLimitMode; remaining: number | null; used: number; department: string | null }
  alerts: { threshold: number; createdAt: string }[]
}

/** Read path also rolls the period so balances shown are always current. */
export async function walletSummary(ctx: WalletContext, userId: number): Promise<WalletSummary> {
  const tenantId = ctx.tenantId
  await ensureWalletRow(tenantId)
  return withTransaction(async (conn) => {
    const wallet = await lockWallet(conn, tenantId)
    await rollPeriod(conn, ctx, wallet)
    const win = periodWindow(ctx.allowance.resetFrequency)
    const buckets = await lockedBuckets(conn, tenantId)
    const bySource = Object.fromEntries(CREDIT_SOURCES.map((s) => [s, 0])) as Record<CreditSource, number>
    for (const b of buckets) bySource[b.source] = round2((bySource[b.source] ?? 0) + b.remaining)
    const reserved = await activeReserved(conn, tenantId)
    const used = await periodConsumed(conn, tenantId, win.start)
    const limit = await loadUserLimit(conn, tenantId, userId, ctx, win.key)
    const userUsed = await periodConsumed(conn, tenantId, win.start, "AND user_id = ?", [userId])
    const alerts = await rows<any[]>(conn, "SELECT threshold, created_at FROM ai_credit_alerts WHERE tenant_id = ? AND period_key = ? ORDER BY threshold DESC", [tenantId, win.key])
    return {
      aiEnabled: ctx.aiEnabled,
      suspended: ctx.platform.aiSuspended,
      unlimited: ctx.unlimited,
      plan: ctx.plan,
      periodKey: win.key,
      periodEnd: win.end.toISOString(),
      periodAllowance: ctx.periodAllowance,
      balance: sumBuckets(buckets),
      reserved: round2(reserved),
      usedThisPeriod: round2(used),
      bySource,
      overageMode: ctx.overageMode,
      canTopup: ctx.platform.allowTopup,
      user: { mode: limit.mode, remaining: userRemaining(limit, userUsed, ctx.periodAllowance), used: round2(userUsed), department: limit.department },
      alerts: alerts.map((a) => ({ threshold: Number(a.threshold), createdAt: new Date(a.created_at).toISOString() })),
    }
  })
}

export type LedgerRow = {
  id: number
  txnId: string
  type: LedgerType
  amount: number
  balanceBefore: number
  balanceAfter: number
  source: string | null
  userId: number | null
  department: string | null
  requestId: string | null
  modelId: string | null
  reference: string | null
  note: string | null
  createdAt: string
}

export async function listLedger(
  tenantId: number,
  opts: { userId?: number | null; type?: string | null; limit?: number; offset?: number } = {},
): Promise<LedgerRow[]> {
  await ensureCreditSchema()
  const where = ["tenant_id = ?"]
  const params: unknown[] = [tenantId]
  if (opts.userId) { where.push("user_id = ?"); params.push(opts.userId) }
  if (opts.type) { where.push("type = ?"); params.push(opts.type) }
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100))
  const offset = Math.max(0, opts.offset ?? 0)
  const r = await query<any[]>(`SELECT * FROM ai_credit_ledger WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`, params)
  return r.map((x) => ({
    id: Number(x.id),
    txnId: String(x.txn_id),
    type: x.type,
    amount: Number(x.amount),
    balanceBefore: Number(x.balance_before),
    balanceAfter: Number(x.balance_after),
    source: x.source ?? null,
    userId: x.user_id == null ? null : Number(x.user_id),
    department: x.department ?? null,
    requestId: x.request_id ?? null,
    modelId: x.model_id ?? null,
    reference: x.reference ?? null,
    note: x.note ?? null,
    createdAt: new Date(x.created_at).toISOString(),
  }))
}

export async function usageBreakdown(tenantId: number, since: Date) {
  await ensureCreditSchema()
  const base = "FROM ai_credit_ledger WHERE tenant_id = ? AND type = 'usage_debit' AND created_at >= ?"
  const p = [tenantId, sqlDate(since)]
  const [byUser, byModel, byDept, byDay] = await Promise.all([
    query<any[]>(`SELECT user_id k, -SUM(amount) credits, COUNT(*) requests ${base} GROUP BY user_id ORDER BY credits DESC LIMIT 50`, p),
    query<any[]>(`SELECT model_id k, -SUM(amount) credits, COUNT(*) requests ${base} GROUP BY model_id ORDER BY credits DESC LIMIT 50`, p),
    query<any[]>(`SELECT COALESCE(department,'Unassigned') k, -SUM(amount) credits, COUNT(*) requests ${base} GROUP BY department ORDER BY credits DESC LIMIT 50`, p),
    query<any[]>(`SELECT DATE(created_at) k, -SUM(amount) credits, COUNT(*) requests ${base} GROUP BY DATE(created_at) ORDER BY k`, p),
  ])
  const map = (r: any[]) => r.map((x) => ({ key: x.k == null ? null : String(x.k instanceof Date ? x.k.toISOString().slice(0, 10) : x.k), credits: round2(Number(x.credits)), requests: Number(x.requests) }))
  return { byUser: map(byUser), byModel: map(byModel), byDepartment: map(byDept), byDay: map(byDay) }
}

// ---------- User & department limits ----------

export type UserLimitRow = { userId: number; mode: UserLimitMode; monthlyLimit: number | null; percent: number | null; department: string | null; bonus: number }

export async function listUserLimits(tenantId: number): Promise<UserLimitRow[]> {
  await ensureCreditSchema()
  const win = periodWindow((await loadWalletContext(tenantId)).allowance.resetFrequency)
  const r = await query<any[]>("SELECT * FROM ai_credit_user_limits WHERE tenant_id = ?", [tenantId])
  return r.map((x) => ({
    userId: Number(x.user_id),
    mode: x.mode,
    monthlyLimit: x.monthly_limit == null ? null : Number(x.monthly_limit),
    percent: x.percent == null ? null : Number(x.percent),
    department: x.department ?? null,
    bonus: x.bonus_period === win.key ? Number(x.bonus) : 0,
  }))
}

export async function setUserLimit(tenantId: number, input: any, actor: { id: number; name: string; ip?: string | null }) {
  const ctx = await loadWalletContext(tenantId)
  if (!ctx.platform.allowUserAllocation) throw new Error("User credit allocation is disabled for your organisation")
  const userId = Number(input?.userId)
  if (!Number.isInteger(userId) || userId <= 0) throw new Error("A valid user is required")
  const mode: UserLimitMode = USER_MODES.includes(input?.mode) ? input.mode : "pool"
  const monthlyLimit = mode === "fixed" ? nOrNull(input?.monthlyLimit) : null
  const percent = mode === "percent" ? Math.min(100, nOrNull(input?.percent) ?? 0) : null
  if (mode === "fixed" && monthlyLimit == null) throw new Error("Enter a monthly credit limit")
  if (mode === "percent" && !percent) throw new Error("Enter a percentage between 1 and 100")
  const department = typeof input?.department === "string" && input.department.trim() ? input.department.trim().slice(0, 120) : null
  const [old] = await query<any[]>("SELECT mode, monthly_limit, percent, department FROM ai_credit_user_limits WHERE tenant_id = ? AND user_id = ?", [tenantId, userId])
  await query(
    `INSERT INTO ai_credit_user_limits (tenant_id, user_id, mode, monthly_limit, percent, department, updated_by) VALUES (?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE mode=VALUES(mode), monthly_limit=VALUES(monthly_limit), percent=VALUES(percent), department=VALUES(department), updated_by=VALUES(updated_by)`,
    [tenantId, userId, mode, monthlyLimit, percent, department, actor.id],
  )
  if (department) await query("INSERT IGNORE INTO ai_credit_departments (tenant_id, name) VALUES (?, ?)", [tenantId, department])
  await creditAudit(tenantId, { actorId: actor.id, actorName: actor.name, action: "user_limit.update", targetUserId: userId, old: old ?? null, next: { mode, monthlyLimit, percent, department }, ip: actor.ip })
}

export async function listDepartments(tenantId: number) {
  await ensureCreditSchema()
  const r = await query<any[]>("SELECT name, monthly_limit FROM ai_credit_departments WHERE tenant_id = ? ORDER BY name", [tenantId])
  return r.map((x) => ({ name: String(x.name), monthlyLimit: x.monthly_limit == null ? null : Number(x.monthly_limit) }))
}

export async function setDepartmentLimit(tenantId: number, input: any, actor: { id: number; name: string; ip?: string | null }) {
  await ensureCreditSchema()
  const name = String(input?.name ?? "").trim().slice(0, 120)
  if (!name) throw new Error("Department name is required")
  const limit = nOrNull(input?.monthlyLimit)
  await query(
    "INSERT INTO ai_credit_departments (tenant_id, name, monthly_limit) VALUES (?,?,?) ON DUPLICATE KEY UPDATE monthly_limit = VALUES(monthly_limit)",
    [tenantId, name, limit],
  )
  await creditAudit(tenantId, { actorId: actor.id, actorName: actor.name, action: "department_limit.update", next: { name, monthlyLimit: limit }, ip: actor.ip })
}

/** Adds a per-period bonus to a user's or department's limit (approved requests, pack allocation). */
export async function addAllocationBonus(tenantId: number, target: { userId?: number; department?: string }, amount: number) {
  const ctx = await loadWalletContext(tenantId)
  const key = periodWindow(ctx.allowance.resetFrequency).key
  if (target.userId) {
    await query(
      `INSERT INTO ai_credit_user_limits (tenant_id, user_id, mode, monthly_limit, bonus, bonus_period) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE bonus = IF(bonus_period = VALUES(bonus_period), bonus + VALUES(bonus), VALUES(bonus)), bonus_period = VALUES(bonus_period)`,
      [tenantId, target.userId, ctx.tenant.defaultUserMode, ctx.tenant.defaultUserLimit, round2(amount), key],
    )
  }
  if (target.department) {
    await query(
      `INSERT INTO ai_credit_departments (tenant_id, name, bonus, bonus_period) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE bonus = IF(bonus_period = VALUES(bonus_period), bonus + VALUES(bonus), VALUES(bonus)), bonus_period = VALUES(bonus_period)`,
      [tenantId, target.department, round2(amount), key],
    )
  }
}

// ---------- Credit requests ----------

export async function createCreditRequest(tenantId: number, user: { id: number; name: string }, input: any) {
  await ensureCreditSchema()
  const amount = Number(input?.amount)
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) throw new Error("Enter a valid number of credits")
  const reason = typeof input?.reason === "string" ? input.reason.trim().slice(0, 500) : null
  const [pending] = await query<any[]>("SELECT COUNT(*) c FROM ai_credit_requests WHERE tenant_id = ? AND user_id = ? AND status = 'pending'", [tenantId, user.id])
  if (Number(pending.c) >= 3) throw new Error("You already have pending credit requests")
  await query("INSERT INTO ai_credit_requests (tenant_id, user_id, user_name, amount, reason) VALUES (?,?,?,?,?)", [tenantId, user.id, user.name, round2(amount), reason])
}

export async function listCreditRequests(tenantId: number, opts: { userId?: number; status?: string } = {}) {
  await ensureCreditSchema()
  const where = ["tenant_id = ?"]
  const params: unknown[] = [tenantId]
  if (opts.userId) { where.push("user_id = ?"); params.push(opts.userId) }
  if (opts.status) { where.push("status = ?"); params.push(opts.status) }
  const r = await query<any[]>(`SELECT * FROM ai_credit_requests WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT 100`, params)
  return r.map((x) => ({
    id: Number(x.id),
    userId: Number(x.user_id),
    userName: x.user_name ?? null,
    amount: Number(x.amount),
    reason: x.reason ?? null,
    status: String(x.status),
    approvedAmount: x.approved_amount == null ? null : Number(x.approved_amount),
    createdAt: new Date(x.created_at).toISOString(),
  }))
}

export async function decideCreditRequest(tenantId: number, input: any, actor: { id: number; name: string; ip?: string | null }) {
  const id = Number(input?.id)
  const approve = input?.decision === "approve"
  const [req] = await query<any[]>("SELECT * FROM ai_credit_requests WHERE tenant_id = ? AND id = ?", [tenantId, id])
  if (!req) throw new Error("Request not found")
  const amount = approve ? Math.min(Number(req.amount) * 10, nOrNull(input?.amount) ?? Number(req.amount)) : null
  if (approve && !(amount! > 0)) throw new Error("Approved amount must be positive")
  const res: any = await query(
    "UPDATE ai_credit_requests SET status = ?, approved_amount = ?, decided_by = ?, decided_at = UTC_TIMESTAMP() WHERE tenant_id = ? AND id = ? AND status = 'pending'",
    [approve ? "approved" : "rejected", amount, actor.id, tenantId, id],
  )
  if (Number(res.affectedRows) === 0) throw new Error("This request has already been decided")
  if (approve) await addAllocationBonus(tenantId, { userId: Number(req.user_id) }, amount!)
  await creditAudit(tenantId, { actorId: actor.id, actorName: actor.name, action: approve ? "credit_request.approve" : "credit_request.reject", targetUserId: Number(req.user_id), next: { requestId: id, amount }, ip: actor.ip })
}

export async function listCreditAudit(tenantId: number, limit = 100) {
  await ensureCreditSchema()
  const r = await query<any[]>(`SELECT * FROM ai_credit_audit WHERE tenant_id = ? ORDER BY id DESC LIMIT ${Math.min(500, limit)}`, [tenantId])
  return r.map((x) => ({
    id: Number(x.id),
    actorName: x.actor_name ?? (x.actor_id ? `User #${x.actor_id}` : "System"),
    action: String(x.action),
    targetUserId: x.target_user_id == null ? null : Number(x.target_user_id),
    old: parse(x.old_json),
    next: parse(x.new_json),
    createdAt: new Date(x.created_at).toISOString(),
  }))
}
