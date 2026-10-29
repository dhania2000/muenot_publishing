/**
 * @file lib/alt-text/document-approval-store.ts
 * @module Publishing · Alt Text
 * @kind Server-side data access
 * @summary Phase 3 Task 14 — tenant-scoped review queue, decisions and insertion readiness for
 *   document image occurrences. Review state lives on alt_text_document_images; every decision is
 *   also appended to the existing alt_text_versions log (no new version or audit table).
 *   Callers must already have resolved the document inside the actor's owner scope.
 */
import "server-only"
import {withinScope,type HistoryActor} from "./history"
import {auditAccessibilityDenial} from "./security-audit"
import type { ResultSetHeader, RowDataPacket } from "mysql2"
import { query, withTransaction } from "@/lib/db"
import { currentTenantId } from "@/lib/tenant-scope"
import {
  ACTION_TO_STATUS,
  COMMENT_CATEGORIES,
  DESCRIPTION_REVIEW_STATUSES,
  EFFECTIVE_REVIEW_SQL,
  INSERTION_BLOCKER_MESSAGES,
  effectiveReviewStatus,
  generationStatusOf,
  hasBlocking,
  insertionBlocker,
  runQualityChecks,
  type CommentCategory,
  type DecisionRequest,
  type DescriptionReviewStatus,
  type InsertionReadinessRow,
  type QualityCheck,
  type ReviewQueueRow,
  type ReviewState,
  type ReviewStats,
  type ReviewVersionSnapshot,
} from "./document-approval-contract"
import { ensureAltTextSchema } from "./store"

const tid = () => currentTenantId()

const iso = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : null)
const asStatus = (v: unknown): DescriptionReviewStatus =>
  (DESCRIPTION_REVIEW_STATUSES as readonly string[]).includes(String(v)) ? (v as DescriptionReviewStatus) : "not_reviewed"
const asCategory = (v: unknown): CommentCategory | null => (typeof v === "string" && v in COMMENT_CATEGORIES ? (v as CommentCategory) : null)
const num = (v: unknown) => (v == null ? null : Number(v))

/** Only extracted occurrences with a saved description (version ≥ 1) enter the review queue. */
const QUEUE_BASE = `FROM alt_text_document_images i
  JOIN alt_text_documents d ON d.id = i.document_id AND d.tenant_id = i.tenant_id
  JOIN alt_text_assets a ON a.id = i.alt_text_asset_id AND a.tenant_id = i.tenant_id
  WHERE i.tenant_id = ? AND i.document_id = ? AND i.extraction_status = 'extracted' AND a.current_version > 0`

/** SQL twin of insertionBlocker's structural rules; quality is re-checked per row by the readiness API. */
const READY_SQL = `(i.source_locator <> '' AND a.status <> 'processing' AND i.approved_version_id IS NOT NULL
  AND i.approved_version = a.current_version AND i.alt_review_status = 'approved' AND i.alt_review_version = i.approved_version)`

/* ---------- Queue & stats ---------- */

export async function getReviewStats(documentId: number): Promise<ReviewStats> {
  await ensureAltTextSchema()
  const rows = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total,
       SUM(${EFFECTIVE_REVIEW_SQL} = 'not_reviewed') AS pending,
       SUM(${EFFECTIVE_REVIEW_SQL} = 'in_review') AS in_review,
       SUM(${EFFECTIVE_REVIEW_SQL} = 'changes_requested') AS changes_requested,
       SUM(${EFFECTIVE_REVIEW_SQL} = 'approved') AS approved,
       SUM(${EFFECTIVE_REVIEW_SQL} = 'rejected') AS rejected,
       SUM(${READY_SQL}) AS ready
     ${QUEUE_BASE}`,
    [tid(), documentId],
  )
  const r = rows[0] ?? {}
  return {
    totalGenerated: Number(r.total ?? 0),
    pending: Number(r.pending ?? 0),
    inReview: Number(r.in_review ?? 0),
    changesRequested: Number(r.changes_requested ?? 0),
    approved: Number(r.approved ?? 0),
    rejected: Number(r.rejected ?? 0),
    insertionReady: Number(r.ready ?? 0),
  }
}

export async function listReviewQueue(
  documentId: number,
  status: DescriptionReviewStatus | null,
  page: { limit: number; offset: number },
): Promise<{ rows: ReviewQueueRow[]; total: number }> {
  await ensureAltTextSchema()
  const filter = status ? ` AND ${EFFECTIVE_REVIEW_SQL} = ?` : ""
  const params: unknown[] = [tid(), documentId, ...(status ? [status] : [])]
  const [countRows, rows] = await Promise.all([
    query<RowDataPacket[]>(`SELECT COUNT(*) AS n ${QUEUE_BASE}${filter}`, params),
    query<RowDataPacket[]>(
      `SELECT i.id, i.document_id, i.page_number, i.slide_number, i.occurrence_index, i.is_decorative, i.approved_version,
         JSON_UNQUOTE(JSON_EXTRACT(i.image_position_json, '$.label')) AS location_label,
         d.original_filename, d.document_type,
         a.id AS asset_id, a.status AS asset_status, a.current_version, a.classification, LEFT(a.short_alt, 160) AS short_preview,
         GREATEST(a.updated_at, i.updated_at) AS updated_at,
         ${EFFECTIVE_REVIEW_SQL} AS effective_status
       ${QUEUE_BASE}${filter}
       ORDER BY i.occurrence_index ASC, i.id ASC LIMIT ? OFFSET ?`,
      [...params, page.limit, page.offset],
    ),
  ])
  return {
    total: Number(countRows[0]?.n ?? 0),
    rows: rows.map((r) => {
      const currentVersion = Number(r.current_version)
      const approvedVersion = num(r.approved_version)
      return {
        imageId: Number(r.id),
        assetId: Number(r.asset_id),
        documentId: Number(r.document_id),
        documentFilename: String(r.original_filename),
        documentType: String(r.document_type),
        pageNumber: num(r.page_number),
        slideNumber: num(r.slide_number),
        locationLabel: r.location_label && r.location_label !== "null" ? String(r.location_label) : null,
        occurrenceIndex: Number(r.occurrence_index),
        classification: r.classification ?? null,
        shortAltPreview: r.short_preview ?? null,
        generationStatus: generationStatusOf(r.asset_status, currentVersion),
        reviewStatus: asStatus(r.effective_status),
        currentVersion,
        approvedVersion,
        approvalSuperseded: approvedVersion != null && approvedVersion !== currentVersion,
        sourceDecorative: Number(r.is_decorative) === 1,
        updatedAt: iso(r.updated_at) ?? new Date(0).toISOString(),
      }
    }),
  }
}

/* ---------- Single occurrence ---------- */

export type OccurrenceReviewRow = {
  imageId: number
  documentId: number
  documentFilename: string
  documentType: string
  sourceLocator: string
  pageNumber: number | null
  slideNumber: number | null
  locationLabel: string | null
  extractionStatus: string
  sourceDecorative: boolean
  sourceMetadata: unknown
  contextJson: unknown
  contextStatus: string | null
  contextConfidence: string | null
  assetId: number | null
  review: ReviewState
}

const REVIEW_COLUMNS = `i.alt_review_status, i.alt_review_version, i.alt_review_comment, i.alt_review_category, i.alt_reviewed_by, i.alt_reviewed_at,
  i.approved_version_id, i.approved_version, i.approved_by, i.approved_at, i.approved_decorative, i.decorative_justification,
  ub.name AS reviewed_by_name, ua.name AS approved_by_name`

function toReviewState(r: RowDataPacket, currentVersion: number): ReviewState {
  const stored = asStatus(r.alt_review_status)
  const decidedVersion = num(r.alt_review_version)
  const approvedVersion = num(r.approved_version)
  return {
    status: effectiveReviewStatus(stored, decidedVersion, currentVersion),
    storedStatus: stored,
    decidedVersion,
    comment: r.alt_review_comment ?? null,
    category: asCategory(r.alt_review_category),
    reviewedBy: r.alt_reviewed_by ? { id: Number(r.alt_reviewed_by), name: r.reviewed_by_name ?? "Unknown" } : null,
    reviewedAt: iso(r.alt_reviewed_at),
    approval:
      r.approved_version_id != null && approvedVersion != null
        ? {
            versionId: Number(r.approved_version_id),
            version: approvedVersion,
            approvedBy: r.approved_by ? { id: Number(r.approved_by), name: r.approved_by_name ?? "Unknown" } : null,
            approvedAt: iso(r.approved_at),
            decorative: Number(r.approved_decorative) === 1,
            justification: r.decorative_justification ?? null,
            superseded: approvedVersion !== currentVersion,
          }
        : null,
  }
}

const parseJson = (v: unknown) => {
  if (typeof v !== "string") return v ?? null
  try {
    return JSON.parse(v)
  } catch {
    return null
  }
}

export async function getOccurrenceForReview(documentId: number, imageId: number): Promise<(OccurrenceReviewRow & { currentVersion: number }) | null> {
  await ensureAltTextSchema()
  const rows = await query<RowDataPacket[]>(
    `SELECT i.id, i.document_id, i.source_locator, i.page_number, i.slide_number, i.extraction_status, i.is_decorative,
       JSON_UNQUOTE(JSON_EXTRACT(i.image_position_json, '$.label')) AS location_label,
       i.source_metadata_json, i.context_json, i.context_status, i.context_confidence, i.alt_text_asset_id,
       d.original_filename, d.document_type, a.current_version,
       ${REVIEW_COLUMNS}
     FROM alt_text_document_images i
     JOIN alt_text_documents d ON d.id = i.document_id AND d.tenant_id = i.tenant_id
     LEFT JOIN alt_text_assets a ON a.id = i.alt_text_asset_id AND a.tenant_id = i.tenant_id
     LEFT JOIN users ub ON ub.id = i.alt_reviewed_by
     LEFT JOIN users ua ON ua.id = i.approved_by
     WHERE i.tenant_id = ? AND i.document_id = ? AND i.id = ? LIMIT 1`,
    [tid(), documentId, imageId],
  )
  const r = rows[0]
  if (!r) return null
  const currentVersion = Number(r.current_version ?? 0)
  return {
    imageId: Number(r.id),
    documentId: Number(r.document_id),
    documentFilename: String(r.original_filename),
    documentType: String(r.document_type),
    sourceLocator: String(r.source_locator ?? ""),
    pageNumber: num(r.page_number),
    slideNumber: num(r.slide_number),
    locationLabel: r.location_label && r.location_label !== "null" ? String(r.location_label) : null,
    extractionStatus: String(r.extraction_status),
    sourceDecorative: Number(r.is_decorative) === 1,
    sourceMetadata: parseJson(r.source_metadata_json),
    contextJson: parseJson(r.context_json),
    contextStatus: r.context_status ?? null,
    contextConfidence: r.context_confidence ?? null,
    assetId: num(r.alt_text_asset_id),
    currentVersion,
    review: toReviewState(r, currentVersion),
  }
}

function toSnapshot(r: RowDataPacket): ReviewVersionSnapshot {
  return {
    versionId: Number(r.id),
    version: Number(r.version),
    source: r.action === "generated" ? "ai" : "manual",
    classification: r.classification ?? null,
    shortAlt: r.short_alt ?? null,
    longDescription: r.long_description ?? null,
    modelId: r.model_id ?? null,
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
  }
}

/** First AI output and the approved snapshot, read from the immutable alt_text_versions rows. */
export async function getReviewSnapshots(assetId: number, approvedVersionId: number | null) {
  const rows = await query<RowDataPacket[]>(
    `(SELECT id, version, action, classification, short_alt, long_description, model_id, created_at, 'first_ai' AS kind
        FROM alt_text_versions WHERE tenant_id = ? AND asset_id = ? AND action = 'generated' ORDER BY id ASC LIMIT 1)
     UNION ALL
     (SELECT id, version, action, classification, short_alt, long_description, model_id, created_at, 'approved' AS kind
        FROM alt_text_versions WHERE tenant_id = ? AND asset_id = ? AND id = ? LIMIT 1)`,
    [tid(), assetId, tid(), assetId, approvedVersionId ?? 0],
  )
  const first = rows.find((r) => r.kind === "first_ai")
  const approved = rows.find((r) => r.kind === "approved")
  return { originalAi: first ? toSnapshot(first) : null, approved: approved ? toSnapshot(approved) : null }
}

/** Version-row id of a saved content version (generated or edited) — the immutable approval target. */
export async function findContentVersionId(assetId: number, version: number): Promise<number | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id FROM alt_text_versions WHERE tenant_id = ? AND asset_id = ? AND version = ? AND action IN ('generated','edited') ORDER BY id DESC LIMIT 1`,
    [tid(), assetId, version],
  )
  return rows[0] ? Number(rows[0].id) : null
}

/** Other extracted occurrences in the same document whose current Short Alt Text is identical. */
export async function countDuplicateDescriptions(documentId: number, imageId: number, shortAlt: string): Promise<number> {
  if (!shortAlt.trim()) return 0
  const rows = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM alt_text_document_images i
     JOIN alt_text_assets a ON a.id = i.alt_text_asset_id AND a.tenant_id = i.tenant_id
     WHERE i.tenant_id = ? AND i.document_id = ? AND i.id <> ? AND a.current_version > 0 AND a.short_alt = ?`,
    [tid(), documentId, imageId, shortAlt],
  )
  return Number(rows[0]?.n ?? 0)
}

/** Appends an audit-only row to the existing version log (e.g. approval superseded by a new draft). */
export async function appendReviewAudit(assetId: number, version: number, action: string, note: string, actorId: number): Promise<number> {
  const res = await query<ResultSetHeader>(
    `INSERT INTO alt_text_versions (tenant_id, asset_id, version, action, classification, short_alt, long_description, extracted_text, note, model_id, actor_id)
     SELECT tenant_id, id, ?, ?, classification, short_alt, long_description, extracted_text, ?, NULL, ?
       FROM alt_text_assets WHERE tenant_id = ? AND id = ?`,
    [version, action, note.slice(0, 500), actorId, tid(), assetId],
  )
  return Number(res.insertId ?? 0)
}

/* ---------- Decisions ---------- */

export type DecisionFailureCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "NO_AI_RESULT"
  | "ASSET_BUSY"
  | "VERSION_CONFLICT"
  | "VERSION_MISSING"
  | "QUALITY_CHECKS_FAILED"
  | "INVALID_DECORATIVE_APPROVAL"
  | "NO_SOURCE_MAPPING"

export type DecisionOutcome =
  | { ok: true; changed: boolean; auditId: number | null; currentVersion: number }
  | { ok: false; code: DecisionFailureCode; message: string; currentVersion?: number; checks?: QualityCheck[] }

const AUDIT_ACTION: Record<DecisionRequest["action"], string> = {
  start_review: "review_started",
  approve: "approved",
  request_changes: "changes_requested",
  reject: "rejected",
}

export function auditNote(imageId: number, req: Pick<DecisionRequest, "category" | "comment" | "justification" | "decorative">): string {
  const parts = [`Occurrence #${imageId}`]
  if (req.decorative) parts.push("Decorative confirmed")
  if (req.category) parts.push(COMMENT_CATEGORIES[req.category])
  const text = req.decorative ? req.justification : req.comment
  return `${parts.join(" · ")}${text ? `: ${text}` : ""}`.slice(0, 500)
}

/**
 * Atomically records one decision for one occurrence against the saved version the reviewer saw.
 * Row locks on the occurrence and the asset serialise concurrent reviewers and editors: a stale
 * expectedVersion is rejected, an asset being regenerated is rejected, and approval stores the id
 * of the immutable alt_text_versions row so later edits can never inherit it.
 */
export async function decideOccurrence(
  documentId: number,
  imageId: number,
  req: DecisionRequest,
  actorId: number,
  policy: { shortMaxChars: number;actor:HistoryActor },
): Promise<DecisionOutcome> {
  await ensureAltTextSchema()
  const tenantId = tid()
  return withTransaction(async (conn) => {
    const [occRows] = await conn.query<RowDataPacket[]>(
      `SELECT id, alt_text_asset_id, extraction_status, source_locator, is_decorative, alt_review_status, alt_review_version, approved_version_id, approved_version
       FROM alt_text_document_images WHERE tenant_id = ? AND document_id = ? AND id = ? FOR UPDATE`,
      [tenantId, documentId, imageId],
    )
    const occ = occRows[0]
    if (!occ) return { ok: false, code: "NOT_FOUND", message: "Image occurrence not found." } as const
    if (occ.extraction_status !== "extracted" || !String(occ.source_locator ?? "").trim()) {
      return { ok: false, code: "NO_SOURCE_MAPPING", message: "This image was not extracted from a valid source location." } as const
    }
    if (occ.alt_text_asset_id == null) return { ok: false, code: "NO_AI_RESULT", message: "No description has been generated for this image yet." } as const

    const [assetRows] = await conn.query<RowDataPacket[]>(
      "SELECT id, status, current_version, language,created_by,reviewer_id FROM alt_text_assets WHERE tenant_id = ? AND id = ? FOR UPDATE",
      [tenantId, occ.alt_text_asset_id],
    )
    const asset = assetRows[0]
    const currentVersion = Number(asset?.current_version ?? 0)
    if (!asset || currentVersion <= 0) return { ok: false, code: "NO_AI_RESULT", message: "No saved description exists for this image." } as const
    const permissionTarget={createdBy:Number(asset.created_by),reviewerId:asset.reviewer_id==null?null:Number(asset.reviewer_id)}
    if(policy.actor.userId!==actorId||![policy.actor.viewScope,policy.actor.updateScope,policy.actor.approveScope].every(scope=>withinScope(scope,actorId,permissionTarget))){auditAccessibilityDenial(actorId,"review",Number(asset.id));return {ok:false,code:"FORBIDDEN",message:"You cannot review or approve this image."} as const}
    if (asset.status === "processing") return { ok: false, code: "ASSET_BUSY", message: "A generation is running for this image. Try again when it finishes.", currentVersion } as const
    if (currentVersion !== req.expectedVersion) {
      return { ok: false, code: "VERSION_CONFLICT", message: `A newer version (v${currentVersion}) was saved. Reload and review it before deciding.`, currentVersion } as const
    }

    const [verRows] = await conn.query<RowDataPacket[]>(
      `SELECT id, classification, short_alt, long_description FROM alt_text_versions
       WHERE tenant_id = ? AND asset_id = ? AND version = ? AND action IN ('generated','edited') ORDER BY id DESC LIMIT 1`,
      [tenantId, asset.id, currentVersion],
    )
    const ver = verRows[0]
    if (!ver) return { ok: false, code: "VERSION_MISSING", message: "The saved version record could not be found.", currentVersion } as const

    const target = ACTION_TO_STATUS[req.action]
    const sameVersion = Number(occ.alt_review_version) === currentVersion
    const alreadyApproved = target === "approved" && sameVersion && occ.alt_review_status === "approved" && Number(occ.approved_version_id) === Number(ver.id)
    if (alreadyApproved || (target !== "approved" && sameVersion && occ.alt_review_status === target && target === "in_review")) {
      return { ok: true, changed: false, auditId: null, currentVersion } as const
    }

    if (req.action === "approve") {
      const checks = runQualityChecks({
        classification: ver.classification,
        shortAlt: ver.short_alt,
        longDescription: ver.long_description,
        language: String(asset.language ?? "en"),
        shortMaxChars: policy.shortMaxChars,
        duplicateCount: 0,
        contextState: "analyzed",
        sourceDecorative: false,
        decorativeConfirmation: req.decorative,
      })
      if (hasBlocking(checks)) {
        const decorativeIssue = checks.some((c) => c.code === "DECORATIVE_UNCONFIRMED" || c.code === "DECORATIVE_HAS_TEXT")
        return {
          ok: false,
          code: decorativeIssue ? "INVALID_DECORATIVE_APPROVAL" : "QUALITY_CHECKS_FAILED",
          message: checks.find((c) => c.severity === "blocking")!.message,
          currentVersion,
          checks: checks.filter((c) => c.severity === "blocking"),
        } as const
      }
    }

    const approve = req.action === "approve"
    await conn.query<ResultSetHeader>(
      `UPDATE alt_text_document_images SET
         alt_review_status = ?, alt_review_version = ?, alt_review_comment = ?, alt_review_category = ?, alt_reviewed_by = ?, alt_reviewed_at = CURRENT_TIMESTAMP,
         approved_version_id = ?, approved_version = ?, approved_by = ?, approved_at = ${approve ? "CURRENT_TIMESTAMP" : "NULL"},
         approved_decorative = ?, decorative_justification = ?
       WHERE tenant_id = ? AND document_id = ? AND id = ?`,
      [
        target,
        currentVersion,
        req.decorative ? req.justification : req.comment,
        req.category,
        actorId,
        approve ? Number(ver.id) : null,
        approve ? currentVersion : null,
        approve ? actorId : null,
        approve && req.decorative ? 1 : 0,
        approve && req.decorative ? req.justification : null,
        tenantId,
        documentId,
        imageId,
      ],
    )

    const assetStatus = approve ? "approved" : req.action === "reject" ? "rejected" : "in_review"
    const [upd] = await conn.query<ResultSetHeader>(
      `UPDATE alt_text_assets SET status = ?, reviewed_by = ?, approved_at = ${approve ? "CURRENT_TIMESTAMP" : "NULL"}
       WHERE tenant_id = ? AND id = ? AND current_version = ? AND status <> 'processing'`,
      [assetStatus, actorId, tenantId, asset.id, currentVersion],
    )
    if (!upd.affectedRows) throw new Error("asset changed under lock")

    const [audit] = await conn.query<ResultSetHeader>(
      `INSERT INTO alt_text_versions (tenant_id, asset_id, version, action, classification, short_alt, long_description, extracted_text, note, model_id, actor_id)
       SELECT tenant_id, asset_id, version, ?, classification, short_alt, long_description, extracted_text, ?, NULL, ?
         FROM alt_text_versions WHERE tenant_id = ? AND id = ?`,
      [req.decorative ? "decorative_approved" : AUDIT_ACTION[req.action], auditNote(imageId, req), actorId, tenantId, ver.id],
    )
    return { ok: true, changed: true, auditId: Number(audit.insertId ?? 0) || null, currentVersion } as const
  })
}

/* ---------- Insertion readiness (read-only) ---------- */

export async function listInsertionReadiness(
  documentId: number,
  page: { limit: number; offset: number },
  policy: { shortMaxChars: number },
): Promise<{ rows: InsertionReadinessRow[]; total: number; eligible: number }> {
  await ensureAltTextSchema()
  const base = `FROM alt_text_document_images i
    LEFT JOIN alt_text_assets a ON a.id = i.alt_text_asset_id AND a.tenant_id = i.tenant_id
    LEFT JOIN alt_text_versions v ON v.id = i.approved_version_id AND v.tenant_id = i.tenant_id AND v.asset_id = i.alt_text_asset_id
    WHERE i.tenant_id = ? AND i.document_id = ?`
  const params = [tid(), documentId]
  const [countRows, rows] = await Promise.all([
    query<RowDataPacket[]>(`SELECT COUNT(*) AS n, SUM(${READY_SQL}) AS ready ${base}`, params),
    query<RowDataPacket[]>(
      `SELECT i.id, i.document_id, i.source_locator, i.extraction_status, i.alt_text_asset_id, i.alt_review_status, i.alt_review_version,
         i.approved_version_id, i.approved_version, i.approved_by, i.approved_at, i.approved_decorative,
         a.status AS asset_status, a.current_version, a.language,
         v.id AS v_id, v.classification AS v_classification, v.short_alt AS v_short_alt, v.long_description AS v_long_description
       ${base} ORDER BY i.occurrence_index ASC, i.id ASC LIMIT ? OFFSET ?`,
      [...params, page.limit, page.offset],
    ),
  ])
  return {
    total: Number(countRows[0]?.n ?? 0),
    eligible: Number(countRows[0]?.ready ?? 0),
    rows: rows.map((r) => {
      const blocker = insertionBlocker({
        extractionStatus: String(r.extraction_status),
        sourceLocator: String(r.source_locator ?? ""),
        assetId: num(r.alt_text_asset_id),
        assetStatus: r.asset_status ?? null,
        currentVersion: Number(r.current_version ?? 0),
        reviewStatus: r.alt_review_status ?? null,
        reviewVersion: num(r.alt_review_version),
        approvedVersionId: num(r.approved_version_id),
        approvedVersion: num(r.approved_version),
        approvedVersionFound: r.v_id != null,
        approvedDecorative: Number(r.approved_decorative) === 1,
        approvedClassification: r.v_classification ?? null,
        approvedShortAlt: r.v_short_alt ?? null,
        approvedLongDescription: r.v_long_description ?? null,
        language: String(r.language ?? "en"),
        shortMaxChars: policy.shortMaxChars,
      })
      const eligible = blocker === null
      return {
        documentId: Number(r.document_id),
        imageOccurrenceId: Number(r.id),
        sourceLocator: String(r.source_locator ?? ""),
        approvedVersionId: eligible ? Number(r.approved_version_id) : null,
        approvedVersion: eligible ? Number(r.approved_version) : null,
        approvedShortAlt: eligible ? (r.v_short_alt ?? "") : null,
        approvedLongDescription: eligible ? r.v_long_description || null : null,
        decorativeApproved: eligible && Number(r.approved_decorative) === 1,
        reviewerId: eligible ? num(r.approved_by) : null,
        approvedAt: eligible ? iso(r.approved_at) : null,
        eligible,
        blockingReason: blocker,
        blockingMessage: blocker ? INSERTION_BLOCKER_MESSAGES[blocker] : null,
      }
    }),
  }
}
