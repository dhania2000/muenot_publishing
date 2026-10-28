import "server-only"
import { query, withTransaction } from "@/lib/db"
import type { ResultSetHeader } from "mysql2"
import { AiError } from "@/lib/ai/governance-core"
import { deriveTier, estimateCredits, rateUsage, type CreditTier, type ModelRate, type UsageMeasure } from "@/lib/ai/credits/credits-core"

type ModelLike = { id: string; tier: "economy" | "standard" | "advanced"; supportsReasoning: boolean; maxOutputTokens?: number | null }
type Rate = Omit<ModelRate, "id" | "effectiveFrom">

export type MeteredRequest = { ctx: { tenantId: number }; rate: Rate; requestId: string; reserved: number }
export type MeteringOptions = { sourceModule?: string; metadata?: Record<string, unknown>; meterTokens?: boolean }

/** Credits per 1K tokens by tier. Standalone deployments use a flat rate card. */
const RATE_CARD: Record<CreditTier, { input: number; output: number }> = {
  economy: { input: 0.1, output: 0.4 },
  standard: { input: 0.5, output: 2 },
  premium: { input: 1.5, output: 6 },
  premium_plus: { input: 3, output: 12 },
}

function rateForModel(model: ModelLike): Rate {
  const tier = deriveTier({ costTier: model.tier, supportsReasoning: model.supportsReasoning })
  const card = RATE_CARD[tier]
  return {
    modelId: model.id,
    tier,
    inputPer1K: card.input,
    cachedInputPer1K: card.input / 2,
    outputPer1K: card.output,
    reasoningPer1K: card.output,
    toolCall: 0,
    multiplier: 1,
    minimumCharge: 0.01,
    maxOutputTokens: model.maxOutputTokens ?? null,
    enabled: true,
    premium: tier === "premium" || tier === "premium_plus",
    version: 1,
  }
}

/** Optional monthly cap (AI_MONTHLY_CREDIT_LIMIT); unset means unlimited. */
async function assertWithinLimit(tenantId: number, credits: number) {
  const limit = Number(process.env.AI_MONTHLY_CREDIT_LIMIT)
  if (!Number.isFinite(limit) || limit <= 0) return
  const rows = await query<any[]>(
    `SELECT COALESCE(SUM(CASE WHEN status='settled' THEN settled_credits WHEN status='reserved' THEN credits ELSE 0 END),0) AS used
       FROM ai_credit_reservations WHERE tenant_id = ? AND created_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')`,
    [tenantId],
  )
  if (Number(rows[0]?.used ?? 0) + credits > limit) {
    throw new AiError("tenant_budget_exceeded", "Your organisation has used its AI credits for this month.", { creditCode: "insufficient_credits" })
  }
}

/** Reserves worst-case credits before the provider call. Duplicate request ids raise ER_DUP_ENTRY. */
export async function beginMeteredRequest(
  tenantId: number,
  userId: number,
  model: ModelLike,
  promptChars: number,
  maxOutputTokens: number,
  requestId: string,
): Promise<MeteredRequest> {
  const rate = rateForModel(model)
  const credits = estimateCredits(promptChars, Math.min(maxOutputTokens, rate.maxOutputTokens ?? maxOutputTokens), rate)
  await assertWithinLimit(tenantId, credits)
  await query(
    "INSERT INTO ai_credit_reservations (tenant_id, user_id, request_id, model_id, credits, status) VALUES (?, ?, ?, ?, ?, 'reserved')",
    [tenantId, userId, requestId, model.id, credits],
  )
  return { ctx: { tenantId }, rate, requestId, reserved: credits }
}

export async function abortMeteredRequest(m: MeteredRequest, _opts: Pick<MeteringOptions, "sourceModule"> = {}) {
  await query("UPDATE ai_credit_reservations SET status='released' WHERE tenant_id = ? AND request_id = ? AND status='reserved'", [m.ctx.tenantId, m.requestId])
    .catch((e) => console.error("[ai-credits] release failed", e))
}

export async function finishMeteredRequest(m: MeteredRequest, userId: number, modelId: string, usage: UsageMeasure, interactionId: number, opts: MeteringOptions = {}) {
  const rated = rateUsage(usage, m.rate)
  // A ledger failure must also undo the status change. Otherwise the retry observes a settled
  // reservation, skips its audit row and incorrectly reports successful settlement.
  return withTransaction(async (conn) => {
    const [updated] = await conn.query<ResultSetHeader>(
      "UPDATE ai_credit_reservations SET status='settled', settled_credits = ? WHERE tenant_id = ? AND request_id = ? AND status='reserved'",
      [rated.credits, m.ctx.tenantId, m.requestId],
    )
    if (Number(updated?.affectedRows ?? 0) > 0) {
      const metadata = { ...usage, tier: rated.tier, multiplier: rated.multiplier, provider: modelId.split("/")[0], interactionId, sourceModule: opts.sourceModule ?? null, ...(opts.metadata ?? {}) }
      await conn.query(
        "INSERT IGNORE INTO ai_credit_ledger (tenant_id, user_id, idempotency_key, amount, provider, model_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [m.ctx.tenantId, userId, `usage:${m.requestId}`, -rated.credits, modelId.split("/")[0] || null, modelId, JSON.stringify(metadata)],
      )
    }
    return { credits: rated.credits }
  })
}
