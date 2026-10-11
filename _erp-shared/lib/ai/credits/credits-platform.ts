/**
 * @file lib/ai/credits/credits-platform.ts
 * @module AI Features
 * @kind Server-side library
 * @summary AI Features domain logic (ensurePlatformCreditSchema, platformAudit, normalizeConfig, getPlatformConfig, …).
 * @exports ensurePlatformCreditSchema, platformAudit, normalizeConfig, getPlatformConfig, savePlatformConfig, currentRates, rateHistory, saveModelRate, … (17 total)
 * @data Reads and writes MySQL via lib/db.
 * @usedBy app/api/platform/ai-credits/route.ts, lib/ai/credits/credits-admin.ts, lib/ai/credits/credits-service.ts, lib/ai/credits/credits-store.ts
 * @see docs/CODEBASE-GUIDE.md for module ownership, conventions and where to add new code.
 */
import "server-only"
/**
 * AI Credits — platform-owned configuration: global pricing config, versioned
 * model rate cards, credit packs and per-plan allowances. These tables are
 * global (not tenant-scoped) and only writable by platform super admins.
 */
import { query } from "@/lib/db"
import {
  CREDIT_SOURCES,
  CREDIT_TIERS,
  DEFAULT_PLATFORM_CONFIG,
  type CreditTier,
  type ModelRate,
  type OverageMode,
  type PlatformCreditConfig,
  type ResetFrequency,
} from "./credits-core"

let ensured: Promise<void> | null = null

async function runEnsure() {
  await query(`CREATE TABLE IF NOT EXISTS ai_credit_platform_config (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    config_json JSON NOT NULL,
    updated_by INT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
  // Rate cards are append-only: a change inserts a new version so historical
  // ledger rows keep pointing at the rate they were billed under.
  await query(`CREATE TABLE IF NOT EXISTS ai_model_rates (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    model_id VARCHAR(120) NOT NULL,
    version INT NOT NULL,
    tier VARCHAR(20) NOT NULL,
    input_per_1k DECIMAL(12,4) NOT NULL,
    cached_input_per_1k DECIMAL(12,4) NOT NULL,
    output_per_1k DECIMAL(12,4) NOT NULL,
    reasoning_per_1k DECIMAL(12,4) NOT NULL,
    tool_call DECIMAL(12,4) NOT NULL,
    multiplier DECIMAL(10,4) NOT NULL,
    minimum_charge DECIMAL(12,4) NOT NULL,
    max_output_tokens INT NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    premium TINYINT(1) NOT NULL DEFAULT 0,
    effective_from DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    changed_by INT NULL,
    UNIQUE KEY uq_ai_model_rates (model_id, version),
    KEY idx_ai_model_rates_model (model_id, effective_from)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
  await query(`CREATE TABLE IF NOT EXISTS ai_credit_packs (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    credits INT NOT NULL,
    price DECIMAL(12,2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    tax_percent DECIMAL(5,2) NOT NULL DEFAULT 18,
    validity_months INT NULL,
    applicable_plans JSON NULL,
    min_qty INT NOT NULL DEFAULT 1,
    max_qty INT NOT NULL DEFAULT 10,
    active TINYINT(1) NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
  await query(`CREATE TABLE IF NOT EXISTS ai_plan_allowances (
    plan_code VARCHAR(60) NOT NULL PRIMARY KEY,
    ai_enabled TINYINT(1) NOT NULL DEFAULT 1,
    monthly_credits INT NULL,
    reset_frequency VARCHAR(12) NOT NULL DEFAULT 'monthly',
    carry_forward TINYINT(1) NOT NULL DEFAULT 0,
    carry_forward_max INT NULL,
    overage_mode VARCHAR(12) NOT NULL DEFAULT 'hard_limit',
    updated_by INT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
  await query(`CREATE TABLE IF NOT EXISTS ai_credit_platform_audit (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    actor_id INT NULL,
    action VARCHAR(60) NOT NULL,
    target VARCHAR(160) NULL,
    old_json JSON NULL,
    new_json JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_ai_credit_platform_audit_time (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
}

export function ensurePlatformCreditSchema(): Promise<void> {
  if (!ensured) ensured = runEnsure().catch((e) => { ensured = null; throw e })
  return ensured
}

const json = (v: unknown) => {
  if (v == null) return null
  if (typeof v === "object") return v
  try { return JSON.parse(String(v)) } catch { return null }
}
const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d)
const numOrNull = (v: unknown) => (v === null || v === "" || v === undefined ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null)

export async function platformAudit(actorId: number | null, action: string, target: string | null, oldV: unknown, newV: unknown) {
  await query(
    "INSERT INTO ai_credit_platform_audit (actor_id, action, target, old_json, new_json) VALUES (?, ?, ?, ?, ?)",
    [actorId, action, target, oldV == null ? null : JSON.stringify(oldV), newV == null ? null : JSON.stringify(newV)],
  )
}

// ---------- Global config ----------

export function normalizeConfig(raw: any, base: PlatformCreditConfig = DEFAULT_PLATFORM_CONFIG): PlatformCreditConfig {
  const r = raw && typeof raw === "object" ? raw : {}
  const tm = r.tierMultipliers && typeof r.tierMultipliers === "object" ? r.tierMultipliers : {}
  const thresholds = Array.isArray(r.alertThresholds)
    ? [...new Set(r.alertThresholds.map(Number).filter((n: number) => n > 0 && n <= 100))].sort((a: any, b: any) => a - b)
    : base.alertThresholds
  const priority = Array.isArray(r.defaultDeductionPriority)
    ? r.defaultDeductionPriority.filter((s: string) => (CREDIT_SOURCES as readonly string[]).includes(s))
    : base.defaultDeductionPriority
  return {
    baseInputPer1K: num(r.baseInputPer1K, base.baseInputPer1K),
    baseCachedInputPer1K: num(r.baseCachedInputPer1K, base.baseCachedInputPer1K),
    baseOutputPer1K: num(r.baseOutputPer1K, base.baseOutputPer1K),
    baseReasoningPer1K: num(r.baseReasoningPer1K, base.baseReasoningPer1K),
    baseToolCall: num(r.baseToolCall, base.baseToolCall),
    minimumCharge: num(r.minimumCharge, base.minimumCharge),
    tierMultipliers: Object.fromEntries(CREDIT_TIERS.map((t) => [t, num(tm[t], base.tierMultipliers[t]) || base.tierMultipliers[t]])) as Record<CreditTier, number>,
    alertThresholds: thresholds as number[],
    defaultDeductionPriority: priority.length ? priority : base.defaultDeductionPriority,
    purchasedExpiryMonths: "purchasedExpiryMonths" in r ? numOrNull(r.purchasedExpiryMonths) : base.purchasedExpiryMonths,
  }
}

export async function getPlatformConfig(): Promise<PlatformCreditConfig> {
  await ensurePlatformCreditSchema()
  const rows = await query<any[]>("SELECT config_json FROM ai_credit_platform_config WHERE id = 1")
  return rows[0] ? normalizeConfig(json(rows[0].config_json)) : DEFAULT_PLATFORM_CONFIG
}

export async function savePlatformConfig(input: unknown, actorId: number): Promise<PlatformCreditConfig> {
  const current = await getPlatformConfig()
  const next = normalizeConfig(input, current)
  await query(
    "INSERT INTO ai_credit_platform_config (id, config_json, updated_by) VALUES (1, ?, ?) ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), updated_by = VALUES(updated_by)",
    [JSON.stringify(next), actorId],
  )
  await platformAudit(actorId, "config.update", null, current, next)
  return next
}

// ---------- Model rate cards ----------

function toRate(r: any): ModelRate {
  return {
    id: Number(r.id),
    modelId: String(r.model_id),
    tier: (CREDIT_TIERS as readonly string[]).includes(r.tier) ? r.tier : "standard",
    inputPer1K: Number(r.input_per_1k),
    cachedInputPer1K: Number(r.cached_input_per_1k),
    outputPer1K: Number(r.output_per_1k),
    reasoningPer1K: Number(r.reasoning_per_1k),
    toolCall: Number(r.tool_call),
    multiplier: Number(r.multiplier),
    minimumCharge: Number(r.minimum_charge),
    maxOutputTokens: r.max_output_tokens == null ? null : Number(r.max_output_tokens),
    enabled: Boolean(Number(r.enabled)),
    premium: Boolean(Number(r.premium)),
    effectiveFrom: new Date(r.effective_from).toISOString(),
    version: Number(r.version),
  }
}

/** The latest rate version per model that is already in effect. */
export async function currentRates(): Promise<Map<string, ModelRate>> {
  await ensurePlatformCreditSchema()
  const rows = await query<any[]>(
    `SELECT r.* FROM ai_model_rates r
     JOIN (SELECT model_id, MAX(version) v FROM ai_model_rates WHERE effective_from <= NOW() GROUP BY model_id) x
       ON x.model_id = r.model_id AND x.v = r.version`,
  )
  return new Map(rows.map((r) => [String(r.model_id), toRate(r)]))
}

export async function rateHistory(modelId: string): Promise<ModelRate[]> {
  await ensurePlatformCreditSchema()
  const rows = await query<any[]>("SELECT * FROM ai_model_rates WHERE model_id = ? ORDER BY version DESC LIMIT 20", [modelId])
  return rows.map(toRate)
}

export async function saveModelRate(input: any, actorId: number): Promise<ModelRate> {
  await ensurePlatformCreditSchema()
  const modelId = String(input?.modelId ?? "").trim()
  if (!/^[a-z0-9._-]+\/[a-z0-9._:-]+$/i.test(modelId)) throw new Error("A valid provider/model id is required")
  const tier = (CREDIT_TIERS as readonly string[]).includes(input?.tier) ? input.tier : "standard"
  const cfg = await getPlatformConfig()
  const effectiveFrom = input?.effectiveFrom ? new Date(input.effectiveFrom) : new Date()
  if (Number.isNaN(effectiveFrom.getTime())) throw new Error("Invalid effective date")
  const [{ v }] = await query<any[]>("SELECT COALESCE(MAX(version), 0) v FROM ai_model_rates WHERE model_id = ?", [modelId])
  const version = Number(v) + 1
  const multiplier = num(input?.multiplier, cfg.tierMultipliers[tier as CreditTier])
  if (multiplier <= 0) throw new Error("Multiplier must be greater than zero")
  await query(
    `INSERT INTO ai_model_rates (model_id, version, tier, input_per_1k, cached_input_per_1k, output_per_1k, reasoning_per_1k, tool_call, multiplier, minimum_charge, max_output_tokens, enabled, premium, effective_from, changed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      modelId, version, tier,
      num(input?.inputPer1K, cfg.baseInputPer1K),
      num(input?.cachedInputPer1K, cfg.baseCachedInputPer1K),
      num(input?.outputPer1K, cfg.baseOutputPer1K),
      num(input?.reasoningPer1K, cfg.baseReasoningPer1K),
      num(input?.toolCall, cfg.baseToolCall),
      multiplier,
      num(input?.minimumCharge, cfg.minimumCharge),
      numOrNull(input?.maxOutputTokens),
      input?.enabled === false ? 0 : 1,
      input?.premium ? 1 : tier === "premium" || tier === "premium_plus" ? 1 : 0,
      effectiveFrom,
      actorId,
    ],
  )
  const [row] = await query<any[]>("SELECT * FROM ai_model_rates WHERE model_id = ? AND version = ?", [modelId, version])
  const rate = toRate(row)
  await platformAudit(actorId, "rate.version", modelId, null, rate)
  return rate
}

// ---------- Credit packs ----------

export type CreditPack = {
  id: number
  name: string
  credits: number
  price: number
  currency: string
  taxPercent: number
  validityMonths: number | null
  applicablePlans: string[] | null
  minQty: number
  maxQty: number
  active: boolean
}

function toPack(r: any): CreditPack {
  const plans = json(r.applicable_plans)
  return {
    id: Number(r.id),
    name: String(r.name),
    credits: Number(r.credits),
    price: Number(r.price),
    currency: String(r.currency),
    taxPercent: Number(r.tax_percent),
    validityMonths: r.validity_months == null ? null : Number(r.validity_months),
    applicablePlans: Array.isArray(plans) && plans.length ? plans.map(String) : null,
    minQty: Number(r.min_qty),
    maxQty: Number(r.max_qty),
    active: Boolean(Number(r.active)),
  }
}

export async function listPacks(opts: { activeOnly?: boolean } = {}): Promise<CreditPack[]> {
  await ensurePlatformCreditSchema()
  const rows = await query<any[]>(
    `SELECT * FROM ai_credit_packs ${opts.activeOnly ? "WHERE active = 1" : ""} ORDER BY sort_order, credits`,
  )
  return rows.map(toPack)
}

export async function getPack(id: number): Promise<CreditPack | null> {
  await ensurePlatformCreditSchema()
  const rows = await query<any[]>("SELECT * FROM ai_credit_packs WHERE id = ?", [id])
  return rows[0] ? toPack(rows[0]) : null
}

export async function savePack(input: any, actorId: number): Promise<CreditPack> {
  await ensurePlatformCreditSchema()
  const name = String(input?.name ?? "").trim().slice(0, 120)
  const credits = Math.floor(Number(input?.credits))
  const price = Number(input?.price)
  const currency = String(input?.currency ?? "INR").toUpperCase().slice(0, 10)
  if (!name) throw new Error("Pack name is required")
  if (!Number.isInteger(credits) || credits <= 0) throw new Error("Credits must be a positive whole number")
  if (!Number.isFinite(price) || price <= 0) throw new Error("Price must be greater than zero")
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must be a 3-letter ISO code")
  const minQty = Math.max(1, Math.floor(num(input?.minQty, 1)))
  const maxQty = Math.max(minQty, Math.floor(num(input?.maxQty, 10)))
  const plans = Array.isArray(input?.applicablePlans) && input.applicablePlans.length ? JSON.stringify(input.applicablePlans.map(String)) : null
  const values = [name, credits, price, currency, num(input?.taxPercent, 18), numOrNull(input?.validityMonths), plans, minQty, maxQty, input?.active === false ? 0 : 1]
  const id = Number(input?.id) || 0
  let before: CreditPack | null = null
  if (id) {
    before = await getPack(id)
    if (!before) throw new Error("Pack not found")
    await query(
      "UPDATE ai_credit_packs SET name=?, credits=?, price=?, currency=?, tax_percent=?, validity_months=?, applicable_plans=?, min_qty=?, max_qty=?, active=? WHERE id=?",
      [...values, id],
    )
  }
  const res: any = id
    ? null
    : await query(
        "INSERT INTO ai_credit_packs (name, credits, price, currency, tax_percent, validity_months, applicable_plans, min_qty, max_qty, active) VALUES (?,?,?,?,?,?,?,?,?,?)",
        values,
      )
  const pack = (await getPack(id || Number(res.insertId)))!
  await platformAudit(actorId, id ? "pack.update" : "pack.create", String(pack.id), before, pack)
  return pack
}

// ---------- Plan allowances ----------

export type PlanAllowance = {
  planCode: string
  aiEnabled: boolean
  /** null = unlimited AI usage on this plan. */
  monthlyCredits: number | null
  resetFrequency: ResetFrequency
  carryForward: boolean
  carryForwardMax: number | null
  overageMode: OverageMode
  /** False when no ai_plan_allowances row exists and the legacy default was returned. */
  configured?: boolean
}

export const DEFAULT_ALLOWANCE: Omit<PlanAllowance, "planCode"> = {
  aiEnabled: true,
  monthlyCredits: 1000,
  resetFrequency: "monthly",
  carryForward: false,
  carryForwardMax: null,
  overageMode: "hard_limit",
}

function toAllowance(r: any): PlanAllowance {
  return {
    planCode: String(r.plan_code),
    aiEnabled: Boolean(Number(r.ai_enabled)),
    monthlyCredits: r.monthly_credits == null ? null : Number(r.monthly_credits),
    resetFrequency: ["monthly", "quarterly", "yearly"].includes(r.reset_frequency) ? r.reset_frequency : "monthly",
    carryForward: Boolean(Number(r.carry_forward)),
    carryForwardMax: r.carry_forward_max == null ? null : Number(r.carry_forward_max),
    overageMode: r.overage_mode === "overage" ? "overage" : "hard_limit",
  }
}

export async function listPlanAllowances(): Promise<PlanAllowance[]> {
  await ensurePlatformCreditSchema()
  return (await query<any[]>("SELECT * FROM ai_plan_allowances ORDER BY plan_code")).map(toAllowance)
}

export async function getPlanAllowance(planCode: string): Promise<PlanAllowance> {
  await ensurePlatformCreditSchema()
  const rows = await query<any[]>("SELECT * FROM ai_plan_allowances WHERE plan_code = ?", [planCode])
  return rows[0] ? { ...toAllowance(rows[0]), configured: true } : { planCode, ...DEFAULT_ALLOWANCE, configured: false }
}

export async function savePlanAllowance(input: any, actorId: number): Promise<PlanAllowance> {
  const planCode = String(input?.planCode ?? "").trim().toLowerCase()
  if (!/^[a-z0-9_-]{1,60}$/.test(planCode)) throw new Error("A valid plan code is required")
  const before = await getPlanAllowance(planCode)
  const next: PlanAllowance = {
    planCode,
    aiEnabled: input?.aiEnabled !== false,
    monthlyCredits: input?.unlimited ? null : Math.floor(num(input?.monthlyCredits, before.monthlyCredits ?? 0)),
    resetFrequency: ["monthly", "quarterly", "yearly"].includes(input?.resetFrequency) ? input.resetFrequency : before.resetFrequency,
    carryForward: Boolean(input?.carryForward),
    carryForwardMax: numOrNull(input?.carryForwardMax),
    overageMode: input?.overageMode === "overage" ? "overage" : "hard_limit",
  }
  await query(
    `INSERT INTO ai_plan_allowances (plan_code, ai_enabled, monthly_credits, reset_frequency, carry_forward, carry_forward_max, overage_mode, updated_by)
     VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE ai_enabled=VALUES(ai_enabled), monthly_credits=VALUES(monthly_credits),
       reset_frequency=VALUES(reset_frequency), carry_forward=VALUES(carry_forward), carry_forward_max=VALUES(carry_forward_max),
       overage_mode=VALUES(overage_mode), updated_by=VALUES(updated_by)`,
    [planCode, next.aiEnabled ? 1 : 0, next.monthlyCredits, next.resetFrequency, next.carryForward ? 1 : 0, next.carryForwardMax, next.overageMode, actorId],
  )
  await platformAudit(actorId, "plan_allowance.update", planCode, before, next)
  return next
}
