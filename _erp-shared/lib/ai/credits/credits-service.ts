/**
 * @file lib/ai/credits/credits-service.ts
 * @module AI Features
 * @kind Server-side library
 * @summary AI Features domain logic (rateForModel, modelCreditHints, toAiError, MeteredRequest, …).
 * @exports rateForModel, modelCreditHints, toAiError, MeteredRequest, beginMeteredRequest, abortMeteredRequest, finishMeteredRequest, Allocation, … (14 total)
 * @data Reads and writes MySQL via lib/db.
 * @usedBy app/api/ai/credits/admin/route.ts, app/api/platform/ai-credits/route.ts, lib/ai/assistant-service.ts, lib/billing/billing-engine.ts
 * @see docs/CODEBASE-GUIDE.md for module ownership, conventions and where to add new code.
 */
import "server-only"
import { query } from "@/lib/db"
import { AiError } from "@/lib/ai/governance-core"
import { meterUsage } from "@/lib/billing/usage-guard"
import {
  CreditError,
  deriveTier,
  effectiveRate,
  estimateCredits,
  rateUsage,
  relativeMultiplier,
  type CreditTier,
  type ModelRate,
  type UsageMeasure,
} from "./credits-core"
import { currentRates, getPack, getPlatformConfig, listPacks, type CreditPack } from "./credits-platform"
import {
  addAllocationBonus,
  debitCredits,
  ensureCreditSchema,
  grantCredits,
  creditAudit,
  loadWalletContext,
  releaseCredits,
  reserveCredits,
  settleCredits,
  type WalletContext,
} from "./credits-store"

type ModelLike = { id: string; tier: string; supportsReasoning: boolean; maxOutputTokens: number }
type Rate = Omit<ModelRate, "id" | "effectiveFrom">

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

function tierOf(m: ModelLike): CreditTier {
  const costTier = m.tier === "economy" || m.tier === "standard" ? m.tier : "advanced"
  return deriveTier({ costTier, supportsReasoning: m.supportsReasoning })
}

export async function rateForModel(m: ModelLike): Promise<Rate> {
  const [rates, cfg] = await Promise.all([currentRates(), getPlatformConfig()])
  return effectiveRate(m.id, tierOf(m), rates.get(m.id) ?? null, cfg)
}

/** Credit pricing hints for the model picker. */
export async function modelCreditHints(models: ModelLike[]) {
  const [rates, cfg] = await Promise.all([currentRates(), getPlatformConfig()])
  return Object.fromEntries(
    models.map((m) => {
      const r = effectiveRate(m.id, tierOf(m), rates.get(m.id) ?? null, cfg)
      return [m.id, { tier: r.tier, multiplier: relativeMultiplier(r.multiplier, cfg), premium: r.premium, enabled: r.enabled, typical: estimateCredits(2000, 600, r) }]
    }),
  ) as Record<string, { tier: CreditTier; multiplier: number; premium: boolean; enabled: boolean; typical: number }>
}

/** Credit-engine errors surface through the assistant's existing AiError contract. */
export function toAiError(e: CreditError): AiError {
  const map: Record<string, ConstructorParameters<typeof AiError>[0]> = {
    ai_suspended: "ai_disabled",
    model_not_allowed: "model_not_allowed",
    premium_not_allowed: "model_not_allowed",
    request_too_large: "token_limit_exceeded",
    rate_limited: "rate_limited",
    duplicate_request: "invalid_request",
    daily_cap_reached: "tenant_budget_exceeded",
    insufficient_credits: "tenant_budget_exceeded",
    user_limit_reached: "user_budget_exceeded",
    department_limit_reached: "user_budget_exceeded",
  }
  return new AiError(map[e.code] ?? "tenant_budget_exceeded", e.message, { creditCode: e.code, ...(e.meta ?? {}) })
}

export type MeteredRequest = { ctx: WalletContext; rate: Rate; requestId: string; reserved: number }

/** Reserves worst-case credits before the provider call. */
export async function beginMeteredRequest(
  tenantId: number,
  userId: number,
  model: ModelLike,
  promptChars: number,
  maxOutputTokens: number,
  requestId: string,
): Promise<MeteredRequest> {
  const [ctx, rate] = await Promise.all([loadWalletContext(tenantId), rateForModel(model)])
  if (!rate.enabled) throw new AiError("model_not_allowed", "This model is not currently available for AI credits.")
  const credits = estimateCredits(promptChars, Math.min(maxOutputTokens, rate.maxOutputTokens ?? maxOutputTokens), rate)
  try {
    await reserveCredits(ctx, { requestId, userId, modelId: model.id, credits, premium: rate.premium })
  } catch (e) {
    if (e instanceof CreditError) throw toAiError(e)
    throw e
  }
  return { ctx, rate, requestId, reserved: credits }
}

/**
 * Optional, backwards-compatible metering options for non-assistant features.
 * `meterTokens: false` skips the token meter when usage is an estimate rather
 * than provider-reported counts.
 */
export type MeteringOptions = { sourceModule?: string; metadata?: Record<string, unknown>; meterTokens?: boolean }

export async function abortMeteredRequest(m: MeteredRequest, opts: Pick<MeteringOptions, "sourceModule"> = {}) {
  await releaseCredits(m.ctx.tenantId, m.requestId).catch((e) => console.error("[ai-credits] release failed", e))
  // Diagnostic-only: failed attempts never roll up into billable totals.
  meterUsage({
    meterKey: "ai_requests",
    quantity: 1,
    tenantId: m.ctx.tenantId,
    source: "ai",
    idempotencyKey: `ai:req:${m.requestId}`,
    attribution: { sourceModule: opts.sourceModule ?? "ai_assistant", correlationId: m.requestId, status: "failed", billable: false },
  })
}

export async function finishMeteredRequest(m: MeteredRequest, userId: number, modelId: string, usage: UsageMeasure, interactionId: number, opts: MeteringOptions = {}) {
  const rated = rateUsage(usage, m.rate)
  const res = await settleCredits(m.ctx, {
    requestId: m.requestId,
    userId,
    modelId,
    credits: rated.credits,
    rateVersion: rated.rateVersion,
    interactionId,
    metadata: { ...usage, tier: rated.tier, multiplier: rated.multiplier, provider: modelId.split("/")[0], ...(opts.metadata ?? {}) },
  })
  // Universal usage ledger: tokens + one successful request, idempotent on the
  // credit request id so a retried settle cannot double-count. Fire-and-forget.
  const provider = modelId.split("/")[0] || null
  const attribution = {
    userId,
    actorType: "user" as const,
    sourceModule: opts.sourceModule ?? "ai_assistant",
    provider,
    modelOrService: modelId,
    correlationId: m.requestId,
    costStatus: "unavailable" as const,
  }
  const tokens = Math.max(0, Math.round((usage.inputTokens || 0) + (usage.outputTokens || 0) + (usage.reasoningTokens || 0)))
  if (tokens > 0 && opts.meterTokens !== false) {
    meterUsage({ meterKey: "ai_usage", quantity: tokens, tenantId: m.ctx.tenantId, source: "ai", refId: String(interactionId), idempotencyKey: `ai:tok:${m.requestId}`, attribution })
  }
  meterUsage({ meterKey: "ai_requests", quantity: 1, tenantId: m.ctx.tenantId, source: "ai", refId: String(interactionId), idempotencyKey: `ai:req:${m.requestId}`, attribution })
  if (res?.autoTopup) {
    await runAutoTopup(m.ctx).catch((e) => console.error("[ai-credits] auto top-up failed", e))
  }
  return { credits: rated.credits, balanceAfter: res?.balanceAfter ?? null, alerts: res?.alerts ?? [] }
}

// ---------- Purchases ----------

export type Allocation = { mode: "pool" } | { mode: "department"; department: string } | { mode: "users"; userIds: number[] }

function packAvailable(pack: CreditPack | null, plan: string): pack is CreditPack {
  return !!pack && pack.active && (!pack.applicablePlans || pack.applicablePlans.includes(plan))
}

export async function availablePacks(tenantId: number) {
  const ctx = await loadWalletContext(tenantId)
  if (!ctx.platform.allowTopup) return []
  return (await listPacks({ activeOnly: true })).filter((p) => packAvailable(p, ctx.plan))
}

function normalizeAllocation(raw: any): Allocation {
  if (raw?.mode === "department" && typeof raw.department === "string" && raw.department.trim()) return { mode: "department", department: raw.department.trim().slice(0, 120) }
  if (raw?.mode === "users" && Array.isArray(raw.userIds)) {
    const ids = [...new Set<number>(raw.userIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))].slice(0, 200)
    if (ids.length) return { mode: "users", userIds: ids }
  }
  return { mode: "pool" }
}

/**
 * Records a pending top-up order. Price and credits are always recomputed from
 * the server-side pack; the client only supplies pack id, quantity, allocation.
 */
export async function createCreditOrder(tenantId: number, actor: { id: number; name: string }, input: any, opts: { auto?: boolean } = {}) {
  await ensureCreditSchema()
  const ctx = await loadWalletContext(tenantId)
  if (!ctx.platform.allowTopup) throw new Error("Credit top-ups are not available for your organisation")
  const pack = await getPack(Number(input?.packId))
  if (!packAvailable(pack, ctx.plan)) throw new Error("This credit pack is not available for your plan")
  const qty = Number(input?.quantity ?? 1)
  if (!Number.isInteger(qty) || qty < pack.minQty || qty > pack.maxQty) throw new Error(`Quantity must be between ${pack.minQty} and ${pack.maxQty}`)
  const allocation = normalizeAllocation(input?.allocation)
  const subtotal = round2(pack.price * qty)
  const amount = round2(subtotal * (1 + pack.taxPercent / 100))
  const res: any = await query(
    "INSERT INTO ai_credit_orders (tenant_id, pack_id, pack_name, quantity, credits, amount, currency, auto_topup, allocation_json, validity_months, purchased_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [tenantId, pack.id, pack.name, qty, pack.credits * qty, amount, pack.currency, opts.auto ? 1 : 0, JSON.stringify(allocation), pack.validityMonths, actor.id],
  )
  const orderId = Number(res.insertId)
  const invoice = await invoiceCreditOrder(tenantId, actor, orderId, pack, qty)
  await creditAudit(tenantId, { actorId: actor.id, actorName: actor.name, action: opts.auto ? "topup.auto_order" : "topup.order", next: { orderId, packId: pack.id, qty, amount, allocation, invoiceId: invoice?.id ?? null } })
  return {
    orderId,
    credits: pack.credits * qty,
    subtotal,
    tax: round2(amount - subtotal),
    amount,
    currency: pack.currency,
    invoiceId: invoice?.id ?? null,
    invoiceNo: invoice?.no ?? null,
  }
}

/**
 * Raises a finalized billing invoice for the order so payment runs through the
 * existing billing checkout and gateway webhooks. Credits are granted only
 * when that invoice is confirmed paid (see syncCreditOrdersForInvoice).
 */
async function invoiceCreditOrder(tenantId: number, actor: { id: number; name: string }, orderId: number, pack: CreditPack, qty: number) {
  try {
    const [{ createInvoice }, { runForTenant }] = await Promise.all([import("@/lib/billing/billing-engine"), import("@/lib/tenant-scope")])
    const session = { userId: actor.id, email: "", name: actor.name, role: "admin", tenantId } as any
    const inv: any = await runForTenant({ tenantId }, () =>
      createInvoice(
        {
          invoice_type: "one_time" as any,
          customer_name: actor.name,
          currency: pack.currency,
          lines: [{ description: `AI Credit Pack — ${pack.name} (${pack.credits.toLocaleString("en-IN")} AI Credits)`, quantity: qty, unit_amount: pack.price, line_type: "one_time" }],
          tax_rate: pack.taxPercent,
          memo: `ai_credit_order:${orderId}`,
          finalize: true,
        },
        session,
      ),
    )
    const id = Number(inv?.id ?? inv?.invoice?.id)
    if (!id) return null
    await query("UPDATE ai_credit_orders SET invoice_id = ? WHERE tenant_id = ? AND id = ?", [id, tenantId, orderId])
    return { id, no: String(inv?.invoice_no ?? inv?.invoice?.invoice_no ?? "") || null }
  } catch (e) {
    console.error("[ai-credits] invoice creation failed", e)
    return null
  }
}

/**
 * Called whenever a billing invoice is recomputed (gateway webhook, manual
 * payment, refund). Paid → grant the order's credits; fully refunded →
 * reverse the unused purchased credits. Both paths are idempotent.
 */
export async function syncCreditOrdersForInvoice(invoiceId: number, invoiceStatus: string, invoiceNo: string | null) {
  await ensureCreditSchema()
  const orders = await query<any[]>("SELECT id, tenant_id, status FROM ai_credit_orders WHERE invoice_id = ?", [invoiceId])
  for (const o of orders) {
    const tenantId = Number(o.tenant_id)
    const ref = invoiceNo ? `invoice ${invoiceNo}` : `invoice #${invoiceId}`
    if (invoiceStatus === "paid" && o.status === "pending") {
      await fulfillCreditOrder(tenantId, Number(o.id), ref, null)
    } else if (invoiceStatus === "refunded" && o.status === "fulfilled") {
      await reverseCreditOrder(tenantId, Number(o.id), 0, `Payment refunded (${ref})`)
    } else if (invoiceStatus === "void" && o.status === "pending") {
      await query("UPDATE ai_credit_orders SET status = 'cancelled' WHERE id = ? AND status = 'pending'", [o.id])
    }
  }
}

/** Grants an order's credits once payment is confirmed. Idempotent per order. */
export async function fulfillCreditOrder(tenantId: number, orderId: number, reference: string, actorId: number | null) {
  const [order] = await query<any[]>("SELECT * FROM ai_credit_orders WHERE tenant_id = ? AND id = ?", [tenantId, orderId])
  if (!order) throw new Error("Order not found")
  if (order.status === "fulfilled") return false
  if (order.status !== "pending") throw new Error(`Order is ${order.status}`)
  const months = order.validity_months == null ? null : Number(order.validity_months)
  const expiresAt = months ? new Date(Date.now() + months * 30 * 86_400_000) : null
  const granted = await grantCredits(tenantId, {
    key: `topup:${orderId}`,
    type: "topup_purchase",
    source: "purchased",
    amount: Number(order.credits),
    expiresAt,
    reference: `order:${orderId}`,
    note: `${order.pack_name} × ${order.quantity} (${reference})`,
    actorId,
  })
  await query("UPDATE ai_credit_orders SET status = 'fulfilled', fulfilled_at = UTC_TIMESTAMP() WHERE tenant_id = ? AND id = ? AND status = 'pending'", [tenantId, orderId])
  const alloc = normalizeAllocation(typeof order.allocation_json === "string" ? JSON.parse(order.allocation_json) : order.allocation_json)
  if (alloc.mode === "department") await addAllocationBonus(tenantId, { department: alloc.department }, Number(order.credits))
  if (alloc.mode === "users") {
    const share = round2(Number(order.credits) / alloc.userIds.length)
    for (const userId of alloc.userIds) await addAllocationBonus(tenantId, { userId }, share)
  }
  return granted
}

/** Payment reversal / refund: removes unused purchased credits from that order. */
export async function reverseCreditOrder(tenantId: number, orderId: number, actorId: number, note: string) {
  const [order] = await query<any[]>("SELECT * FROM ai_credit_orders WHERE tenant_id = ? AND id = ?", [tenantId, orderId])
  if (!order) throw new Error("Order not found")
  if (order.status === "pending") {
    await query("UPDATE ai_credit_orders SET status = 'cancelled' WHERE id = ?", [orderId])
    return 0
  }
  if (order.status !== "fulfilled") throw new Error(`Order is ${order.status}`)
  const taken = await debitCredits(tenantId, {
    key: `reversal:${orderId}`,
    type: "payment_reversal",
    amount: Number(order.credits),
    preferSource: "purchased",
    bucketReference: `order:${orderId}`,
    reference: `order:${orderId}`,
    note,
    actorId,
  })
  await query("UPDATE ai_credit_orders SET status = 'reversed' WHERE id = ?", [orderId])
  return taken
}

export async function listCreditOrders(tenantId: number | null, limit = 100) {
  await ensureCreditSchema()
  const r = await query<any[]>(
    `SELECT * FROM ai_credit_orders ${tenantId ? "WHERE tenant_id = ?" : ""} ORDER BY id DESC LIMIT ${Math.min(500, limit)}`,
    tenantId ? [tenantId] : [],
  )
  return r.map((x) => ({
    id: Number(x.id),
    tenantId: Number(x.tenant_id),
    packName: String(x.pack_name),
    quantity: Number(x.quantity),
    credits: Number(x.credits),
    amount: Number(x.amount),
    currency: String(x.currency),
    status: String(x.status),
    autoTopup: Boolean(Number(x.auto_topup)),
    createdAt: new Date(x.created_at).toISOString(),
    fulfilledAt: x.fulfilled_at ? new Date(x.fulfilled_at).toISOString() : null,
  }))
}

/** Places a pending auto top-up order, capped per month; payment completes it. */
async function runAutoTopup(ctx: WalletContext) {
  const at = ctx.tenant.autoTopup
  if (!at.packId) return
  const [r] = await query<any[]>(
    "SELECT COUNT(*) c, SUM(status = 'pending') p FROM ai_credit_orders WHERE tenant_id = ? AND auto_topup = 1 AND created_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')",
    [ctx.tenantId],
  )
  if (Number(r.c) >= at.maxPerMonth || Number(r.p) > 0) return
  await createCreditOrder(ctx.tenantId, { id: 0, name: "Auto top-up" }, { packId: at.packId, quantity: 1 }, { auto: true })
}
