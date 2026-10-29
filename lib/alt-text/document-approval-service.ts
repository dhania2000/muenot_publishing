/**
 * @file lib/alt-text/document-approval-service.ts
 * @module Publishing · Alt Text
 * @kind Server-side service
 * @summary Phase 3 Task 14 — orchestration for the review routes: detail assembly (image, source
 *   context, versions, quality checks), draft save through the existing versioned edit path with
 *   approval-supersede auditing, single decisions and bounded bulk decisions.
 *   Callers must already have resolved the document inside the actor's owner scope.
 */
import "server-only"
import type { DocumentImageContext } from "./document-context"
import { contextState, existingAltText } from "./document-image-review"
import type { DocumentImageRecord } from "./document-records"
import {
  appendReviewAudit,
  countDuplicateDescriptions,
  decideOccurrence,
  findContentVersionId,
  getOccurrenceForReview,
  getReviewSnapshots,
  getReviewStats,
  type DecisionFailureCode,
} from "./document-approval-store"
import {
  generationStatusOf,
  runQualityChecks,
  type BulkOutcome,
  type BulkReviewRequest,
  type BulkReviewResponse,
  type DecisionRequest,
  type DecisionResponse,
  type DraftSaveResponse,
  type ReviewDetailResponse,
} from "./document-approval-contract"
import { updateAsset,withinScope, type HistoryActor, type HistoryFailure } from "./history"
import { getAsset, getSettings } from "./store"

type Fail = HistoryFailure
const fail = (status: number, code: string, error: string, details?: Record<string, unknown>): Fail => ({ ok: false, status, code, error, ...(details ? { details } : {}) })

export const DECISION_STATUS: Record<DecisionFailureCode, number> = {
  FORBIDDEN:403,
  NOT_FOUND: 404,
  NO_AI_RESULT: 409,
  ASSET_BUSY: 409,
  VERSION_CONFLICT: 409,
  VERSION_MISSING: 409,
  NO_SOURCE_MAPPING: 409,
  QUALITY_CHECKS_FAILED: 422,
  INVALID_DECORATIVE_APPROVAL: 422,
}

/** Task 9 context bucket → the vocabulary runQualityChecks expects ("ready" is "analyzed"). */
const qualityContextState = (status: string | null, confidence: string | null) => {
  const s = contextState(status, confidence)
  return s === "ready" ? "analyzed" : s
}

function summariseContext(raw: unknown): ReviewDetailResponse["occurrence"]["context"] {
  if (!raw || typeof raw !== "object") return null
  const c = raw as Partial<DocumentImageContext>
  const heading = c.sectionHeading?.text ?? (Array.isArray(c.headings) && c.headings.length ? c.headings[c.headings.length - 1]?.text : null) ?? null
  return {
    caption: c.caption?.text ?? null,
    heading,
    pageTitle: c.pageTitle?.text ?? null,
    nearbyText: Array.isArray(c.nearbyText) ? c.nearbyText.map((t) => t?.text).filter((t): t is string => typeof t === "string" && !!t.trim()).slice(0, 4) : [],
    confidence: typeof c.confidence === "string" ? c.confidence : null,
    warnings: Array.isArray(c.warnings) ? c.warnings.map((w) => w?.message).filter((m): m is string => typeof m === "string").slice(0, 6) : [],
  }
}

export async function buildReviewDetail(
  documentId: number,
  imageId: number,
  permissions: ReviewDetailResponse["permissions"],
  actor:HistoryActor,
): Promise<{ ok: true; body: ReviewDetailResponse } | Fail> {
  const occ = await getOccurrenceForReview(documentId, imageId)
  if (!occ) return fail(404, "NOT_FOUND", "Image occurrence not found.")
  if (occ.assetId == null) return fail(409, "NO_AI_RESULT", "No description has been generated for this image yet.")
  const [asset, settings] = await Promise.all([getAsset(occ.assetId), getSettings()])
  if (!asset || asset.currentVersion <= 0) return fail(409, "NO_AI_RESULT", "No saved description exists for this image.")
  if(!withinScope(actor.viewScope,actor.userId,asset))return fail(404,"NOT_FOUND","Image occurrence not found.")
  permissions={canEdit:permissions.canEdit&&withinScope(actor.updateScope,actor.userId,asset),canReview:permissions.canReview&&withinScope(actor.updateScope,actor.userId,asset)&&withinScope(actor.approveScope,actor.userId,asset)}

  const approval = occ.review.approval
  const [snapshots, duplicateCount] = await Promise.all([
    getReviewSnapshots(asset.id, approval?.versionId ?? null),
    countDuplicateDescriptions(documentId, imageId, asset.shortAlt ?? ""),
  ])
  const ctxState = qualityContextState(occ.contextStatus, occ.contextConfidence)
  const checks = runQualityChecks({
    classification: asset.classification,
    shortAlt: asset.shortAlt,
    longDescription: asset.longDescription,
    language: asset.language,
    shortMaxChars: settings.shortMaxChars,
    duplicateCount,
    contextState: ctxState,
    sourceDecorative: occ.sourceDecorative,
    decorativeConfirmation: !!approval && !approval.superseded && approval.decorative,
  })

  return {
    ok: true,
    body: {
      success: true,
      occurrence: {
        imageId: occ.imageId,
        documentId: occ.documentId,
        documentFilename: occ.documentFilename,
        documentType: occ.documentType,
        sourceLocator: occ.sourceLocator,
        pageNumber: occ.pageNumber,
        slideNumber: occ.slideNumber,
        locationLabel: occ.locationLabel,
        sourceDecorative: occ.sourceDecorative,
        contextState: ctxState,
        context: summariseContext(occ.contextJson),
        sourceAltText: existingAltText({ sourceMetadata: occ.sourceMetadata as DocumentImageRecord["sourceMetadata"] }),
      },
      asset: {
        id: asset.id,
        imageUrl: asset.imageUrl,
        status: asset.status,
        generationStatus: generationStatusOf(asset.status, asset.currentVersion),
        classification: asset.classification,
        shortAlt: asset.shortAlt,
        longDescription: asset.longDescription,
        extractedText: asset.extractedText,
        warnings: asset.warnings,
        language: asset.language,
        modelId: asset.modelId,
        currentVersion: asset.currentVersion,
        updatedAt: asset.updatedAt,
      },
      originalAi: snapshots.originalAi,
      approvedSnapshot: snapshots.approved,
      review: occ.review,
      checks,
      shortMaxChars: settings.shortMaxChars,
      permissions,
    },
  }
}

type EditRequest = Parameters<typeof updateAsset>[1]

/**
 * Saves a reviewer draft as a new immutable version via the Phase 1 edit path (optimistic
 * expectedVersion, scope checks, field validation). When the occurrence held an approval for the
 * version being replaced, an `approval_superseded` audit row records that it no longer applies.
 */
export async function saveReviewDraft(
  documentId: number,
  imageId: number,
  req: EditRequest,
  actor: HistoryActor,
): Promise<{ ok: true; body: DraftSaveResponse } | Fail> {
  const occ = await getOccurrenceForReview(documentId, imageId)
  if (!occ) return fail(404, "NOT_FOUND", "Image occurrence not found.")
  if (occ.assetId == null || occ.currentVersion <= 0) return fail(409, "NO_AI_RESULT", "No description has been generated for this image yet.")

  const saved = await updateAsset(occ.assetId, req, actor)
  if (!saved.ok) return saved
  const newVersion = saved.body.asset.currentVersion

  const approval = occ.review.approval
  if (approval && !approval.superseded && approval.version !== newVersion) {
    await appendReviewAudit(occ.assetId, newVersion, "approval_superseded", `Occurrence #${imageId}: approved v${approval.version} superseded by edited v${newVersion}`, actor.userId)
  }
  const [savedVersionId, after] = await Promise.all([findContentVersionId(occ.assetId, newVersion), getOccurrenceForReview(documentId, imageId)])
  return { ok: true, body: { success: true, savedVersionId, currentVersion: newVersion, review: after?.review ?? occ.review } }
}

export async function decideAndReload(
  documentId: number,
  imageId: number,
  req: DecisionRequest,
  actor: HistoryActor,
): Promise<{ ok: true; body: DecisionResponse } | Fail> {
  const { shortMaxChars } = await getSettings()
  const out = await decideOccurrence(documentId, imageId, req, actor.userId, { shortMaxChars,actor })
  if (!out.ok) {
    return fail(DECISION_STATUS[out.code], out.code, out.message, {
      ...(out.currentVersion != null ? { currentVersion: out.currentVersion } : {}),
      ...(out.checks ? { checks: out.checks } : {}),
    })
  }
  const occ = await getOccurrenceForReview(documentId, imageId)
  if (!occ) return fail(404, "NOT_FOUND", "Image occurrence not found.")
  return { ok: true, body: { success: true, changed: out.changed, auditId: out.auditId, review: occ.review, currentVersion: out.currentVersion } }
}

/**
 * Applies one bulk action item by item. Each item runs in its own transaction against the version
 * the reviewer saw, so one stale or invalid item never blocks — or silently rides along with — the rest.
 */
export async function bulkDecide(documentId: number, req: BulkReviewRequest, actor:HistoryActor): Promise<BulkReviewResponse> {
  const { shortMaxChars } = await getSettings()
  const outcomes: BulkOutcome[] = []
  for (const item of req.items) {
    try {
      const out = await decideOccurrence(
        documentId,
        item.imageId,
        { action: req.action, expectedVersion: item.expectedVersion, comment: req.comment, category: req.category, decorative: false, justification: null },
        actor.userId,
        { shortMaxChars,actor },
      )
      if (out.ok) outcomes.push({ imageId: item.imageId, result: out.changed ? "accepted" : "skipped", ...(out.changed ? {} : { code: "UNCHANGED", message: "Already in this state." }) })
      else outcomes.push({ imageId: item.imageId, result: "rejected", code: out.code, message: out.message })
    } catch (err) {
      console.error("[alt-text/review-bulk] item failed", err instanceof Error ? err.name : "unknown")
      outcomes.push({ imageId: item.imageId, result: "rejected", code: "INTERNAL_ERROR", message: "This image could not be updated. Try again." })
    }
  }
  const count = (r: BulkOutcome["result"]) => outcomes.filter((o) => o.result === r).length
  return {
    success: true,
    action: req.action,
    accepted: count("accepted"),
    skipped: count("skipped"),
    rejected: count("rejected"),
    outcomes,
    stats: await getReviewStats(documentId),
  }
}
