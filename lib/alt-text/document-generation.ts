/**
 * @file lib/alt-text/document-generation.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Phase 3 Task 12 — connects Task 10 selections / Task 11 readiness to the Phase 2 batch
 *   pipeline, and resolves the occurrence-specific Task 9 context the batch worker passes to the
 *   Phase 1 vision call. No new queue, billing, provider or version store.
 *
 * - Submission: selected AND currently eligible occurrences → one Phase 2 batch (createBatchFromRequest)
 *   → submitBatchForProcessing (durable job). Never runs AI in the HTTP request.
 * - Worker: resolveDocumentPromptContext(assetId) re-reads the occurrence + document at processing
 *   time, so security, extraction and context changes after submission are honoured.
 * - Each occurrence owns its own alt text asset, so identical binaries are described per location.
 */
import "server-only"
import type { HistoryActor } from "./history"
import { getDocumentForExtraction, ownerScopeFor } from "./document-service"
import { getDocumentImage } from "./document-store"
import { documentContextSource, contextSourceMatches, contextOcrMatches } from "./document-context-source"
import { buildDocumentContextPacket } from "./document-context-packet"
import { getSettingsRecord } from "./store"
import { normalizeAccessibilityPreferences } from "./accessibility-settings"
import type { RowDataPacket } from "mysql2"
import { query } from "@/lib/db"
import { currentTenantId } from "@/lib/tenant-scope"
import { normalizeGenerationSettings, validateGenerationSettings } from "./core"
import { createBatchFromRequest, submitBatchForProcessing, type BatchActor, type BatchFailure } from "./batch-submission"
import { DOCUMENT_CONTEXT_VERSION, parseStoredContext } from "./document-context"
import { getSelectionSnapshot } from "./document-image-review-store"
import type { DocumentPromptContext } from "./document-prompt"
import { ensureAltTextSchema, BATCH_MAX_ASSETS_PER_CALL } from "./store"

const DOC_TYPES = new Set(["pdf", "pptx", "docx"])

type OccurrenceRow = RowDataPacket & {
  id: number
  document_id: number
  alt_text_asset_id: number
  page_number: number | null
  slide_number: number | null
  occurrence_index: number
  is_decorative: number | boolean
  extraction_status: string
  context_json: unknown
  context_version: number | null
  document_type: string
  security_scan_status: string
}

export type DocumentContextResolution =
  | { kind: "standalone" }
  | { kind: "document"; document: DocumentPromptContext }
  | { kind: "ineligible"; code: string; error: string }

function locationLabel(r: OccurrenceRow): string {
  if (r.slide_number != null) return `Slide ${Number(r.slide_number)}`
  if (r.page_number != null) return `Page ${Number(r.page_number)}`
  return `Position ${Number(r.occurrence_index) + 1}`
}

function parseJson(v: unknown): unknown {
  if (v == null || typeof v === "object") return v
  try {
    return JSON.parse(String(v))
  } catch {
    return null
  }
}

/**
 * Occurrence-specific prompt context for one alt text asset, read at processing time (tenant-scoped).
 * Standalone (non-document) assets resolve to `standalone` and keep the Phase 1/2 behaviour unchanged.
 */
export async function resolveDocumentPromptContext(assetId: number, actor: HistoryActor, occurrenceId: number | null = null): Promise<DocumentContextResolution> {
  await ensureAltTextSchema()
  const rows = await query<OccurrenceRow[]>(
    `SELECT i.id, i.document_id, i.alt_text_asset_id, i.page_number, i.slide_number, i.occurrence_index, i.is_decorative,
            i.extraction_status, i.context_json, i.context_version, i.context_status, d.document_type, d.security_scan_status
       FROM alt_text_document_images i
       JOIN alt_text_documents d ON d.tenant_id = i.tenant_id AND d.id = i.document_id
      WHERE i.tenant_id = ? AND i.alt_text_asset_id = ? AND (? IS NULL OR i.id = ?)
      ORDER BY i.id LIMIT 2`,
    [currentTenantId(), assetId, occurrenceId, occurrenceId],
  )
  const r = rows[0]
  if (!r) return occurrenceId == null ? { kind: "standalone" } : { kind: "ineligible", code: "NOT_FOUND", error: "Image occurrence not found." }
  if (rows.length > 1) return { kind: "ineligible", code: "AMBIGUOUS_OCCURRENCE", error: "This asset is linked to multiple document occurrences. Select an unambiguous occurrence before generating." }
  const doc = await getDocumentForExtraction(Number(r.document_id),ownerScopeFor(actor))
  if (!doc) return {kind:"ineligible",code:"NOT_FOUND",error:"Source document not found."}
  if (doc.securityStatus !== "clean") return { kind: "ineligible", code: "DOCUMENT_NOT_CLEAN", error: "The source document has not passed the security scan." }
  if (r.extraction_status !== "extracted") return { kind: "ineligible", code: "OCCURRENCE_NOT_ELIGIBLE", error: "The image occurrence is no longer eligible for generation." }
  if (!DOC_TYPES.has(r.document_type)) return { kind: "ineligible", code: "UNSUPPORTED_TYPE", error: "The source document type is not supported." }

  const versionMatches = r.context_version != null && Number(r.context_version) === DOCUMENT_CONTEXT_VERSION
  const parsed = versionMatches ? parseStoredContext(parseJson(r.context_json)) : null
  // Context must belong to this exact occurrence; anything else is treated as unavailable.
  const [occurrence,source,settings] = await Promise.all([getDocumentImage(Number(r.document_id),Number(r.id)),documentContextSource(doc),getSettingsRecord()])
  if (!occurrence || occurrence.altTextAssetId !== assetId || !source) return {kind:"ineligible",code:"DOCUMENT_SOURCE_CHANGED",error:"The document image source is no longer current."}
  const eligible = parsed && (r as any).context_status === "analyzed" && parsed.imageOccurrenceId === Number(r.id) && parsed.documentId === Number(r.document_id) && parsed.documentType === r.document_type && contextSourceMatches(parsed,source,occurrence) && await contextOcrMatches(parsed)
  const context = eligible ? parsed : null
  const preferences = normalizeAccessibilityPreferences(settings.accessibility).preferences.descriptions
  const policy = {enabled:preferences.useDocumentContext,speakerNotes:preferences.includeSpeakerNotes,sourceAlt:preferences.preserveExistingAlt}
  const packet = context ? buildDocumentContextPacket(context,policy) : null
  return {
    kind: "document",
    document: {
      imageAssetId: Number(r.alt_text_asset_id),
      imageOccurrenceId: Number(r.id),
      documentId: Number(r.document_id),
      documentType: r.document_type as DocumentPromptContext["documentType"],
      context: policy.enabled ? context : null,
      packet,
      contextVersion: r.context_version == null ? null : Number(r.context_version),
      stale: r.context_version != null && (!versionMatches || !eligible),
      sourceDecorative: Number(r.is_decorative) === 1,
      locationLabel: locationLabel(r),
    },
  }
}

const fail = (status: number, code: string, error: string, details?: Record<string, unknown>): BatchFailure => ({ ok: false, status, code, error, ...(details ? { details } : {}) })

export type DocumentGenerationRequest = { settings: unknown; idempotencyKey: string | null }

export type DocumentGenerationResult = {
  success: true
  documentId: number
  batchId: string
  jobId: number | null
  replayed: boolean
  submissionStatus: "queued"
  acceptedImageCount: number
  skippedImageCount: number
  message: string
}

/**
 * Submits the document's selected, currently eligible occurrences as one Phase 2 batch.
 * Caller has authorized the document (tenant + owner scope + clean security verdict).
 */
export async function submitDocumentGeneration(
  doc: { id: number; filename: string; projectId: number | null },
  req: DocumentGenerationRequest,
  actor: BatchActor,
): Promise<{ ok: true; body: DocumentGenerationResult } | BatchFailure> {
  const settings = normalizeGenerationSettings(req.settings ?? undefined)
  const settingsErrors = validateGenerationSettings(settings)
  if (Object.keys(settingsErrors).length) return fail(422, "INVALID_SETTINGS", "Generation settings are invalid.", { fields: settingsErrors })

  const snapshot = await getSelectionSnapshot(doc.id)
  const eligible = snapshot.items.filter((i) => i.eligibility.eligible)
  if (!eligible.length) return fail(422, "NO_ELIGIBLE_IMAGES", "Select at least one eligible image before generating alt text.")
  if (eligible.length > BATCH_MAX_ASSETS_PER_CALL) {
    return fail(413, "TOO_MANY_ASSETS", `A generation run can contain at most ${BATCH_MAX_ASSETS_PER_CALL} images. Narrow the selection and try again.`)
  }
  // One asset per occurrence; dedupe defensively so an occurrence is never processed twice per attempt.
  const assetIds = [...new Set(eligible.map((i) => i.altTextAssetId))]

  const created = await createBatchFromRequest(
    {
      name: `Document: ${doc.filename}`.slice(0, 120),
      description: `Alt text for ${assetIds.length} selected image${assetIds.length === 1 ? "" : "s"} from document #${doc.id}.`,
      projectId: doc.projectId,
      assetIds,
      settings,
      overrides: {},
      idempotencyKey: req.idempotencyKey,
    },
    actor,
  )
  if (!created.ok) {
    if (created.code === "ASSET_IN_OTHER_BATCH") return fail(409, "ALREADY_QUEUED", "Some selected images are already part of another generation batch.", created.details)
    return created
  }
  const batch = created.body.batch

  // Replay of an already-submitted batch (double click / retry): return the existing references.
  if (created.body.replayed && batch.status !== "draft") {
    return {
      ok: true,
      body: {
        success: true,
        documentId: doc.id,
        batchId: batch.id,
        jobId: null,
        replayed: true,
        submissionStatus: "queued",
        acceptedImageCount: batch.totalImages,
        skippedImageCount: Math.max(0, snapshot.total - batch.totalImages),
        message: "This generation request was already submitted.",
      },
    }
  }

  const submitted = await submitBatchForProcessing(batch.id, actor)
  if (!submitted.ok) return submitted
  return {
    ok: true,
    body: {
      success: true,
      documentId: doc.id,
      batchId: submitted.body.batchId,
      jobId: submitted.body.jobId,
      replayed: created.body.replayed,
      submissionStatus: "queued",
      acceptedImageCount: submitted.body.acceptedImageCount,
      skippedImageCount: Math.max(0, snapshot.total - submitted.body.acceptedImageCount),
      message: submitted.body.message,
    },
  }
}
