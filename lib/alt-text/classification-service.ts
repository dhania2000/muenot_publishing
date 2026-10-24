/**
 * @file lib/alt-text/classification-service.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Phase 3 Task 3 — reads and corrects an asset's image classification. Resolves the view
 *   through `resolveClassificationView` using tenant-effective accessibility settings, and stores
 *   manual corrections at asset level or for one document occurrence without touching the automated
 *   result or the alt text versions.
 * @security Callers pass the gated HistoryActor; visibility and edit scope are re-checked per asset.
 */
import "server-only"
import { detectAccessibilityBackend } from "./accessibility-backend"
import { resolveEffectiveAccessibilitySettings } from "./accessibility-settings"
import {
  resolveClassificationView,
  validateManualClassification,
  type ClassificationPolicy,
  type ClassificationView,
  type ManualClassification,
} from "./classification"
import { withinScope, type HistoryActor, type HistoryFailure } from "./history"
import { getAsset, getOccurrenceClassification, getSettingsRecord, setManualClassification, setOccurrenceClassification } from "./store"

export type ClassificationResponse = { success: true; assetId: number; occurrenceId: number | null; classification: ClassificationView }
export type ClassificationContext = { tenantId: number; role: "admin" | "employee"; canEdit: boolean }
type Result = { ok: true; body: ClassificationResponse } | HistoryFailure

const fail = (status: number, code: string, error: string, details?: Record<string, unknown>): HistoryFailure => ({ ok: false, status, code, error, ...(details ? { details } : {}) })
const NOT_FOUND = () => fail(404, "NOT_FOUND", "Image not found.")

/** Parses an optional occurrence id from a query string or body value. Returns undefined when invalid. */
export function parseOccurrenceId(raw: unknown): number | null | undefined {
  if (raw == null || raw === "") return null
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : NaN
  return Number.isSafeInteger(n) && n > 0 ? n : undefined
}

async function loadPolicy(ctx: ClassificationContext) {
  const [record, backend] = await Promise.all([getSettingsRecord(), detectAccessibilityBackend(ctx.tenantId, ctx.role)])
  const resolved = resolveEffectiveAccessibilitySettings({ storedAccessibility: record.accessibility, revision: record.revision, tenant: record.settings, backend })
  const g = resolved.effective.general as unknown as Record<string, unknown>
  const policy: ClassificationPolicy = {
    useAutoClassification: g.useAutoClassification === true,
    reviewUncertainClassification: g.reviewUncertainClassification === true,
    allowCategoryCorrection: g.allowCategoryCorrection === true,
    analysisTypes: Array.isArray(g.analysisTypes) ? (g.analysisTypes as string[]) : [],
  }
  return { policy, capabilities: resolved.capabilities }
}

async function buildView(assetId: number, occurrenceId: number | null, actor: HistoryActor, ctx: ClassificationContext): Promise<Result> {
  const asset = await getAsset(assetId)
  if (!asset || !withinScope(actor.viewScope, actor.userId, asset)) return NOT_FOUND()
  let occurrenceManual: ManualClassification | null = null
  if (occurrenceId != null) {
    const occ = await getOccurrenceClassification(assetId, occurrenceId)
    if (!occ.found) return NOT_FOUND()
    occurrenceManual = occ.manual
  }
  const { policy, capabilities } = await loadPolicy(ctx)
  const canEdit = ctx.canEdit && withinScope(actor.updateScope, actor.userId, asset)
  const classification = resolveClassificationView({
    stored: asset.classificationRecord ?? null,
    occurrenceManual,
    legacyClassification: asset.classification,
    modelId: asset.modelId,
    assetStatus: asset.status,
    queued: asset.status === "queued",
    capabilities,
    policy,
    canEdit,
  })
  return { ok: true, body: { success: true, assetId, occurrenceId, classification } }
}

export function readClassification(assetId: number, occurrenceId: number | null, actor: HistoryActor, ctx: ClassificationContext) {
  return buildView(assetId, occurrenceId, actor, ctx)
}

/** Shared permission + policy checks for correcting or clearing a classification. */
async function guardCorrection(assetId: number, actor: HistoryActor, ctx: ClassificationContext): Promise<HistoryFailure | null> {
  const asset = await getAsset(assetId)
  if (!asset || !withinScope(actor.viewScope, actor.userId, asset)) return NOT_FOUND()
  if (!withinScope(actor.updateScope, actor.userId, asset)) return fail(403, "FORBIDDEN", "You do not have permission to correct this classification.")
  const { policy } = await loadPolicy(ctx)
  if (!policy.allowCategoryCorrection) return fail(403, "CORRECTION_DISABLED", "Category correction is turned off in Accessibility Settings.")
  if (asset.status === "processing") return fail(409, "ASSET_BUSY", "Alt text is being generated for this image. Try again when it finishes.")
  return null
}

export async function correctClassification(assetId: number, body: unknown, actor: HistoryActor, ctx: ClassificationContext, now: Date = new Date()): Promise<Result> {
  const parsed = validateManualClassification(body)
  if (!parsed.ok) return fail(400, "INVALID_REQUEST", parsed.error, { field: parsed.field })
  const occurrenceId = parseOccurrenceId((body as Record<string, unknown>).occurrenceId)
  if (occurrenceId === undefined) return fail(400, "INVALID_REQUEST", "occurrenceId must be a positive integer.", { field: "occurrenceId" })
  const denied = await guardCorrection(assetId, actor, ctx)
  if (denied) return denied
  const manual: ManualClassification = { ...parsed.value, editedBy: actor.userId, editedAt: now.toISOString() }
  const saved = occurrenceId != null ? await setOccurrenceClassification(assetId, occurrenceId, manual) : await setManualClassification(assetId, manual)
  if (!saved) return occurrenceId != null ? NOT_FOUND() : fail(409, "ASSET_BUSY", "Alt text is being generated for this image. Try again when it finishes.")
  return buildView(assetId, occurrenceId, actor, ctx)
}

export async function clearClassificationCorrection(assetId: number, occurrenceId: number | null, actor: HistoryActor, ctx: ClassificationContext): Promise<Result> {
  const denied = await guardCorrection(assetId, actor, ctx)
  if (denied) return denied
  const saved = occurrenceId != null ? await setOccurrenceClassification(assetId, occurrenceId, null) : await setManualClassification(assetId, null)
  if (!saved) return occurrenceId != null ? NOT_FOUND() : fail(409, "ASSET_BUSY", "Alt text is being generated for this image. Try again when it finishes.")
  return buildView(assetId, occurrenceId, actor, ctx)
}
