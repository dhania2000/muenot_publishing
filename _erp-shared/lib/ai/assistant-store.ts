/**
 * @file lib/ai/assistant-store.ts
 * @module AI Features
 * @kind Server-side library
 * @summary AI Features domain logic (ensureAiSchema, getTenantAiSettings, saveTenantAiSettings, getUsageSnapshot, …).
 * @exports ensureAiSchema, getTenantAiSettings, saveTenantAiSettings, getUsageSnapshot, InteractionInput, logInteraction, applyRetention, InteractionRow, … (13 total)
 * @data Writes to MySQL via lib/db.
 * @usedBy app/api/ai/assistant/route.ts, app/api/ai/governance/interactions/route.ts, app/api/ai/governance/route.ts, app/api/ai/models/route.ts, lib/ai/assistant-service.ts
 * @see docs/CODEBASE-GUIDE.md for module ownership, conventions and where to add new code.
 */
import "server-only"
/**
 * SPEC 18 — tenant-scoped persistence for the AI assistant and its governance
 * policy. Every statement goes through the tenant-scope helpers so it carries
 * a tenant_id predicate and satisfies the fail-closed guard.
 */
import { query } from "@/lib/db"
import { tenantInsert, tenantSelect, tenantUpdate } from "@/lib/tenant-scope"
import {
  defaultTenantSettings,
  monthStart,
  normalizeTenantSettings,
  retentionCutoff,
  type TenantAiSettings,
  type UsageSnapshot,
} from "./governance-core"

let ensured: Promise<void> | null = null

async function runEnsure(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS ai_tenant_settings (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      tenant_id INT NOT NULL,
      settings_json JSON NOT NULL,
      updated_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_ai_tenant_settings (tenant_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS ai_interactions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      tenant_id INT NOT NULL,
      user_id INT NOT NULL,
      user_name VARCHAR(255) NULL,
      feature VARCHAR(40) NOT NULL,
      model_id VARCHAR(120) NULL,
      fallback_from VARCHAR(120) NULL,
      status VARCHAR(20) NOT NULL,
      error_code VARCHAR(60) NULL,
      prompt_text TEXT NULL,
      response_text MEDIUMTEXT NULL,
      citations_json JSON NULL,
      injection_flags JSON NULL,
      redacted_count INT NOT NULL DEFAULT 0,
      input_tokens INT NOT NULL DEFAULT 0,
      output_tokens INT NOT NULL DEFAULT 0,
      total_tokens INT NOT NULL DEFAULT 0,
      cost_usd DECIMAL(12,6) NOT NULL DEFAULT 0,
      latency_ms INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_ai_interactions_tenant_time (tenant_id, created_at),
      KEY idx_ai_interactions_user (tenant_id, user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
}

export function ensureAiSchema(): Promise<void> {
  if (!ensured) ensured = runEnsure().catch((e) => { ensured = null; throw e })
  return ensured
}

const parseJson = (v: unknown) => {
  if (v == null) return null
  if (typeof v === "object") return v
  try { return JSON.parse(String(v)) } catch { return null }
}

export async function getTenantAiSettings(): Promise<TenantAiSettings> {
  await ensureAiSchema()
  const rows = await tenantSelect<any[]>("ai_tenant_settings", { columns: "settings_json", tail: "LIMIT 1" })
  if (!rows[0]) return defaultTenantSettings()
  return normalizeTenantSettings(parseJson(rows[0].settings_json), defaultTenantSettings())
}

export async function saveTenantAiSettings(input: unknown, userId: number): Promise<TenantAiSettings> {
  await ensureAiSchema()
  const current = await getTenantAiSettings()
  const next = normalizeTenantSettings(input, current)
  const json = JSON.stringify(next)
  const updated = await tenantUpdate("ai_tenant_settings", { settings_json: json, updated_by: userId }, "1=1")
  if (updated === 0) await tenantInsert("ai_tenant_settings", { settings_json: json, updated_by: userId })
  return next
}

export async function getUsageSnapshot(userId: number): Promise<UsageSnapshot> {
  await ensureAiSchema()
  const since = monthStart()
  const cols = "COALESCE(SUM(cost_usd),0) AS cost, COALESCE(SUM(total_tokens),0) AS tokens"
  const [tenant] = await tenantSelect<any[]>("ai_interactions", { columns: cols, where: "created_at >= ?", params: [since] })
  const [user] = await tenantSelect<any[]>("ai_interactions", {
    columns: cols,
    where: "created_at >= ? AND user_id = ?",
    params: [since, userId],
  })
  return {
    tenantSpendUsd: Number(tenant?.cost ?? 0),
    tenantTokens: Number(tenant?.tokens ?? 0),
    userSpendUsd: Number(user?.cost ?? 0),
    userTokens: Number(user?.tokens ?? 0),
  }
}

export type InteractionInput = {
  userId: number
  userName: string | null
  feature: string
  modelId: string | null
  fallbackFrom: string | null
  status: "ok" | "blocked" | "error"
  errorCode: string | null
  prompt: string | null
  response: string | null
  citations: { id: number; code: string | null; title: string }[]
  injectionFlags: string[]
  redactedCount: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  latencyMs: number | null
}

/**
 * Append one interaction. Prompt/response content is persisted only when the
 * tenant keeps history; usage numbers are always kept so budgets stay exact.
 */
export async function logInteraction(entry: InteractionInput, settings: TenantAiSettings): Promise<number> {
  await ensureAiSchema()
  const keepContent = settings.historyEnabled && settings.retentionDays > 0
  const { insertId } = await tenantInsert("ai_interactions", {
    user_id: entry.userId,
    user_name: entry.userName,
    feature: entry.feature,
    model_id: entry.modelId,
    fallback_from: entry.fallbackFrom,
    status: entry.status,
    error_code: entry.errorCode,
    prompt_text: keepContent ? entry.prompt : null,
    response_text: keepContent ? entry.response : null,
    citations_json: JSON.stringify(entry.citations),
    injection_flags: JSON.stringify(entry.injectionFlags),
    redacted_count: entry.redactedCount,
    input_tokens: entry.inputTokens,
    output_tokens: entry.outputTokens,
    total_tokens: entry.inputTokens + entry.outputTokens,
    cost_usd: entry.costUsd,
    latency_ms: entry.latencyMs,
  })
  await applyRetention(settings)
  return insertId
}

/** Strip content older than the retention window; usage rows stay for billing. */
export async function applyRetention(settings: TenantAiSettings): Promise<void> {
  const cutoff = retentionCutoff(settings.retentionDays)
  if (!cutoff) return
  await tenantUpdate(
    "ai_interactions",
    { prompt_text: null, response_text: null },
    "created_at < ? AND (prompt_text IS NOT NULL OR response_text IS NOT NULL)",
    [cutoff],
  )
}

export type InteractionRow = {
  id: number
  userId: number
  userName: string | null
  feature: string
  modelId: string | null
  fallbackFrom: string | null
  status: string
  errorCode: string | null
  prompt: string | null
  response: string | null
  citations: { id: number; code: string | null; title: string }[]
  injectionFlags: string[]
  redactedCount: number
  totalTokens: number
  costUsd: number
  latencyMs: number | null
  createdAt: string
}

function mapRow(r: any): InteractionRow {
  return {
    id: Number(r.id),
    userId: Number(r.user_id),
    userName: r.user_name ?? null,
    feature: r.feature,
    modelId: r.model_id ?? null,
    fallbackFrom: r.fallback_from ?? null,
    status: r.status,
    errorCode: r.error_code ?? null,
    prompt: r.prompt_text ?? null,
    response: r.response_text ?? null,
    citations: (parseJson(r.citations_json) as InteractionRow["citations"]) ?? [],
    injectionFlags: (parseJson(r.injection_flags) as string[]) ?? [],
    redactedCount: Number(r.redacted_count ?? 0),
    totalTokens: Number(r.total_tokens ?? 0),
    costUsd: Number(r.cost_usd ?? 0),
    latencyMs: r.latency_ms == null ? null : Number(r.latency_ms),
    createdAt: new Date(r.created_at).toISOString(),
  }
}

export async function listInteractions(opts: { userId?: number; status?: string; limit?: number } = {}): Promise<InteractionRow[]> {
  await ensureAiSchema()
  const where: string[] = []
  const params: unknown[] = []
  if (opts.userId != null) { where.push("user_id = ?"); params.push(opts.userId) }
  if (opts.status) { where.push("status = ?"); params.push(opts.status) }
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50))
  const rows = await tenantSelect<any[]>("ai_interactions", {
    where: where.join(" AND "),
    params,
    tail: `ORDER BY id DESC LIMIT ${limit}`,
  })
  return rows.map(mapRow)
}

export type UsageSummary = {
  monthSpendUsd: number
  monthTokens: number
  monthRequests: number
  blockedRequests: number
  flaggedRequests: number
  byModel: { modelId: string; requests: number; costUsd: number }[]
}

export function emptyUsageSummary(): UsageSummary {
  return { monthSpendUsd: 0, monthTokens: 0, monthRequests: 0, blockedRequests: 0, flaggedRequests: 0, byModel: [] }
}

export async function getUsageSummary(): Promise<UsageSummary> {
  await ensureAiSchema()
  const since = monthStart()
  // CASE guards JSON_LENGTH so a single malformed flags value can't fail the whole aggregate.
  const [tot] = await tenantSelect<any[]>("ai_interactions", {
    columns: `COALESCE(SUM(cost_usd),0) AS cost, COALESCE(SUM(total_tokens),0) AS tokens, COUNT(*) AS n,
              COALESCE(SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END),0) AS blocked,
              COALESCE(SUM(CASE WHEN injection_flags IS NOT NULL AND JSON_VALID(injection_flags) AND JSON_LENGTH(injection_flags) > 0 THEN 1 ELSE 0 END),0) AS flagged`,
    where: "created_at >= ?",
    params: [since],
  })
  const models = await tenantSelect<any[]>("ai_interactions", {
    columns: "model_id, COUNT(*) AS n, COALESCE(SUM(cost_usd),0) AS cost",
    where: "created_at >= ? AND model_id IS NOT NULL",
    params: [since],
    tail: "GROUP BY model_id ORDER BY cost DESC",
  })
  return {
    monthSpendUsd: Number(tot?.cost ?? 0),
    monthTokens: Number(tot?.tokens ?? 0),
    monthRequests: Number(tot?.n ?? 0),
    blockedRequests: Number(tot?.blocked ?? 0),
    flaggedRequests: Number(tot?.flagged ?? 0),
    byModel: models.map((m) => ({ modelId: m.model_id, requests: Number(m.n), costUsd: Number(m.cost) })),
  }
}

/** Erase all stored prompt/response content for the tenant (usage rows kept). */
export async function purgeInteractionContent(): Promise<number> {
  await ensureAiSchema()
  return tenantUpdate("ai_interactions", { prompt_text: null, response_text: null }, "prompt_text IS NOT NULL OR response_text IS NOT NULL")
}
