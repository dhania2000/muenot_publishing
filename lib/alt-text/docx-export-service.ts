/**
 * @file lib/alt-text/docx-export-service.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Phase 3 Task 15 — "Download Accessible Document" orchestration for DOCX.
 *   preflight: readiness totals, approval snapshot and a dry-run plan (nothing is written).
 *   export:    idempotent, one-at-a-time per document. Reads the verified private original,
 *              inserts approved alt text into a copy, re-checks the approval snapshot, stores the
 *              derived file privately and records an export row with the full per-image report.
 *   The original document, its file record and every approval/version row are never modified.
 */
import "server-only"
import { createHash, randomUUID } from "node:crypto"
import { deleteFile, downloadFile, uploadFile } from "@/lib/storage"
import { keyBelongsToTenant } from "@/lib/storage/keys"
import { checkStorageQuota } from "@/lib/storage/storage-quota"
import { currentTenantId } from "@/lib/tenant-scope"
import { listInsertionReadiness } from "./document-approval-store"
import { readVerifiedOriginal, readBody, logName } from "./document-extraction-run"
import { ownerScopeFor } from "./document-service"
import { getDocument, type StoredDocument } from "./document-store"
import { insertDocxAltText, type DocxInsertInstruction } from "./docx-alt-text-inserter"
import {
  ACCESSIBLE_EXPORT_MIME,
  isAccessibleExportFormat,
  type AccessibleExportFormat,
  type DocxExportPreflight,
  type DocxExportRecord,
  type DocxExportRequest,
  type DocxExportResponse,
} from "./docx-export-contract"
import { insertPptxAltText } from "./pptx-alt-text-inserter"
import { remediatePdfAltText } from "./pdf-alt-text-remediator"
import {
  approvalSnapshot,
  DOCX_EXPORT_MAX_OCCURRENCES,
  exportFilename,
  exportPolicyFailure,
  mergeExportReport,
  planDocxExport,
  strictPreconditionFailure,
} from "./docx-export-plan"
import { claimExport, completeExport, failExport, getExportByKey, getExportByRef, listExports, type StoredDocxExport } from "./docx-export-store"
import type { HistoryActor } from "./history"
import { getSettings } from "./store"
import { ALT_TEXT_UPLOAD_MAX_MB } from "./upload"

const isExportable = (t: string): t is AccessibleExportFormat => isAccessibleExportFormat(t)

async function insertAltText(format: AccessibleExportFormat, source: Buffer, instructions: DocxInsertInstruction[], opts: { maxOutputBytes: number; dryRun?: boolean }) {
  if (format === "pdf") return remediatePdfAltText(source, instructions, opts)
  return format === "pptx" ? insertPptxAltText(source, instructions, opts) : insertDocxAltText(source, instructions, opts)
}

const FAILURE_STATUS: Record<string, ExportFailure["status"]> = {
  SIGNED_DOCUMENT: 409,
  ENCRYPTED_DOCUMENT: 409,
  OUTPUT_TOO_LARGE: 413,
  TOO_MANY_IMAGES: 413,
}
const MAX_SOURCE_BYTES = ALT_TEXT_UPLOAD_MAX_MB * 1024 * 1024
/** Alt text adds a few attributes; headroom covers re-deflated XML parts. */
const MAX_OUTPUT_BYTES = MAX_SOURCE_BYTES + 4 * 1024 * 1024

export type ExportFailure = { ok: false; status: 404 | 409 | 413 | 415 | 422 | 500 | 503 | 507; code: string; error: string; details?: Record<string, unknown> }
const fail = (status: ExportFailure["status"], code: string, error: string, details?: Record<string, unknown>): ExportFailure => ({ ok: false, status, code, error, ...(details ? { details } : {}) })

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex")

function unavailableReason(doc: StoredDocument): string | null {
  if (!isExportable(doc.documentType)) return "Accessible document download is available for Word (DOCX), PowerPoint (PPTX) and tagged PDF documents."
  if (doc.securityStatus !== "clean") return "The document has not passed the security scan."
  return null
}

async function loadReadiness(documentId: number) {
  const { shortMaxChars } = await getSettings()
  const readiness = await listInsertionReadiness(documentId, { limit: DOCX_EXPORT_MAX_OCCURRENCES + 1, offset: 0 }, { shortMaxChars })
  return readiness
}

async function loadOwnedDocument(documentId: number, actor: HistoryActor): Promise<StoredDocument | null> {
  return getDocument(documentId, ownerScopeFor(actor))
}

export async function getDocxExportPreflight(documentId: number, actor: HistoryActor): Promise<{ ok: true; preflight: DocxExportPreflight } | ExportFailure> {
  const doc = await loadOwnedDocument(documentId, actor)
  if (!doc) return fail(404, "NOT_FOUND", "The document could not be found.")
  const [readiness, exports] = await Promise.all([loadReadiness(doc.id), listExports(doc.id)])
  const plan = planDocxExport(readiness.rows.slice(0, DOCX_EXPORT_MAX_OCCURRENCES))
  let reason = unavailableReason(doc)
  if (!reason && readiness.total > DOCX_EXPORT_MAX_OCCURRENCES) reason = `This document has more than ${DOCX_EXPORT_MAX_OCCURRENCES} images, which is above the export limit.`
  if (!reason && readiness.total === 0) reason = "No image occurrences have been mapped for this document yet."

  let dryRun: DocxExportPreflight["plan"] = null
  let pdfAssessment: DocxExportPreflight["pdfAssessment"] = null
  const isPdf = doc.documentType === "pdf"
  // PDFs are always assessed so the tagging status is shown even before anything is approved.
  if (!reason && (plan.instructions.length > 0 || isPdf)) {
    const original = await readVerifiedOriginal(doc, MAX_SOURCE_BYTES)
    if (!original.ok) reason = original.error
    else {
      const result = await insertAltText(doc.documentType as AccessibleExportFormat, original.bytes, plan.instructions, { maxOutputBytes: MAX_OUTPUT_BYTES, dryRun: true })
      if (!result.ok) {
        reason = result.message
        if ("details" in result) pdfAssessment = result.details ?? null
      } else {
        const merged = mergeExportReport(result.report, plan)
        dryRun = { ...merged.summary, items: merged.items }
        pdfAssessment = merged.summary.pdf ?? null
      }
    }
  }

  return {
    ok: true,
    preflight: {
      success: true,
      documentId: doc.id,
      filename: doc.filename,
      documentType: doc.documentType,
      supported: reason == null,
      unavailableReason: reason,
      snapshot: approvalSnapshot(readiness.rows),
      totals: plan.totals,
      plan: dryRun,
      ...(isPdf ? { pdfAssessment } : {}),
      exports,
    },
  }
}

const strip = ({ objectKey: _k, report: _r, ...rec }: StoredDocxExport): DocxExportRecord => rec

function replay(existing: StoredDocxExport): { ok: true; response: DocxExportResponse } | ExportFailure {
  if (existing.status === "processing") return fail(409, "EXPORT_IN_PROGRESS", "This export is still being prepared. Try again shortly.")
  const report = existing.report ?? mergeExportReport(null, { instructions: [], skipped: [], totals: { occurrences: 0, eligible: 0, pendingReview: 0, unmapped: 0, blocked: 0 }, approvedVersions: new Map() })
  return { ok: true, response: { success: true, replayed: true, export: strip(existing), summary: report.summary, items: report.items } }
}

export async function runDocxExport(documentId: number, actor: HistoryActor, request: DocxExportRequest): Promise<{ ok: true; response: DocxExportResponse } | ExportFailure> {
  const doc = await loadOwnedDocument(documentId, actor)
  if (!doc) return fail(404, "NOT_FOUND", "The document could not be found.")
  if (!isExportable(doc.documentType)) return fail(415, "UNSUPPORTED_DOCUMENT_TYPE", "Accessible document download is available for DOCX, PPTX and PDF documents only.")
  const format = doc.documentType
  if (request.format !== format) return fail(422, "FORMAT_MISMATCH", `This document is a ${format.toUpperCase()} file; request ${format.toUpperCase()} output.`)
  if (doc.securityStatus !== "clean") return fail(409, "DOCUMENT_NOT_CLEAN", "The document has not passed the security scan.")

  const existing = await getExportByKey(doc.id, request.idempotencyKey)
  if (existing) return replay(existing)

  const readiness = await loadReadiness(doc.id)
  if (readiness.total > DOCX_EXPORT_MAX_OCCURRENCES) return fail(413, "TOO_MANY_OCCURRENCES", `This document has more than ${DOCX_EXPORT_MAX_OCCURRENCES} images, which is above the export limit.`)
  if (readiness.total === 0) return fail(422, "NO_MAPPED_OCCURRENCES", "No image occurrences have been mapped for this document yet.")
  const snapshot = approvalSnapshot(readiness.rows)
  if (request.snapshot && request.snapshot !== snapshot) {
    return fail(409, "SNAPSHOT_CHANGED", "Approvals changed since you reviewed the export summary. Review the updated summary and try again.", { snapshot })
  }

  const plan = planDocxExport(readiness.rows)
  if (request.policy === "strict") {
    const unmet = strictPreconditionFailure(plan.totals)
    if (unmet) return fail(422, "STRICT_POLICY_UNMET", `${unmet} No document was produced.`, { totals: plan.totals })
  }
  if (plan.instructions.length === 0) return fail(422, "NO_APPROVED_DESCRIPTIONS", "No image in this document has an approved description yet.", { totals: plan.totals })

  const outputRef = randomUUID()
  const filename = exportFilename(doc.filename, format)
  const claim = await claimExport({ documentId: doc.id, outputRef, idempotencyKey: request.idempotencyKey, format, policy: request.policy, snapshot, filename, createdBy: actor.userId })
  if (claim === "duplicate_key") {
    const again = await getExportByKey(doc.id, request.idempotencyKey)
    return again ? replay(again) : fail(409, "EXPORT_IN_PROGRESS", "Another export of this document is in progress.")
  }
  if (claim === "in_progress") return fail(409, "EXPORT_IN_PROGRESS", "Another export of this document is in progress. Try again when it finishes.")

  // From here on the run owns the slot and must complete or fail the export row.
  let storedKey: string | null = null
  try {
    const original = await readVerifiedOriginal(doc, MAX_SOURCE_BYTES)
    if (!original.ok) {
      await failExport(doc.id, outputRef, original.code)
      return fail(original.status === 404 ? 404 : original.status === 503 ? 503 : 422, original.code, original.error)
    }
    const source = original.bytes
    const sourceChecksum = sha256(source)

    const result = await insertAltText(format, source, plan.instructions, { maxOutputBytes: MAX_OUTPUT_BYTES })
    if (!result.ok) {
      await failExport(doc.id, outputRef, result.code)
      const details = "details" in result && result.details ? { pdf: result.details } : undefined
      return fail(FAILURE_STATUS[result.code] ?? 422, result.code, result.message, details)
    }
    const report = mergeExportReport(result.report, plan)
    const verdict = exportPolicyFailure(request.policy, report.summary)
    if (verdict) {
      await failExport(doc.id, outputRef, verdict.code, report)
      return fail(422, verdict.code, verdict.message, { summary: report.summary, items: report.items })
    }

    // Approvals may have moved while the file was being rewritten; never ship a stale snapshot.
    const after = await loadReadiness(doc.id)
    if (approvalSnapshot(after.rows) !== snapshot) {
      await failExport(doc.id, outputRef, "APPROVALS_CHANGED", report)
      return fail(409, "SNAPSHOT_CHANGED", "Approvals changed while the document was being prepared. Review the updated summary and try again.")
    }
    if (sha256(source) !== sourceChecksum) {
      await failExport(doc.id, outputRef, "SOURCE_MUTATED", report)
      return fail(500, "SOURCE_MUTATED", "The document could not be prepared safely.")
    }

    // No edits needed (every approved description is already present): ship an identical copy.
    const output = result.output ?? Buffer.from(source)
    const quota = await checkStorageQuota(output.length)
    if (!quota.allowed) {
      await failExport(doc.id, outputRef, "STORAGE_QUOTA_EXCEEDED", report)
      return fail(507, "STORAGE_QUOTA_EXCEEDED", quota.reason || "Your organisation has reached its storage quota.")
    }
    const upload = await uploadFile(`alt-text/exports/${doc.id}/${outputRef}.${format}`, new File([new Uint8Array(output)], filename, { type: ACCESSIBLE_EXPORT_MIME[format] }), {
      metadata: { module: "publishing", entityType: "alt_text_document_export", entityId: doc.id, ownerId: actor.userId, classification: "confidential" },
    })
    if (!upload.ok) {
      await failExport(doc.id, outputRef, "STORAGE_UNAVAILABLE", report)
      return fail(503, "STORAGE_UNAVAILABLE", "Document storage is temporarily unavailable. Please try again.")
    }
    storedKey = upload.result.key

    // Store the approved version id for every inserted occurrence alongside the report.
    const items = report.items.map((i) => ({ ...i, approvedVersionId: plan.approvedVersions.get(i.occurrenceId) ?? null }))
    await completeExport(doc.id, outputRef, {
      sourceChecksum,
      objectKey: storedKey,
      fileId: upload.result.file?.id ?? null,
      outputChecksum: sha256(output),
      sizeBytes: output.length,
      summary: report.summary,
      items,
    })
    const record = await getExportByRef(doc.id, outputRef)
    if (!record || record.status !== "completed") throw new Error("Export row did not complete")
    return { ok: true, response: { success: true, replayed: false, export: strip(record), summary: report.summary, items: report.items } }
  } catch (err) {
    console.error("[alt-text/docx-export] run failed", logName(err))
    if (storedKey) await deleteFile(storedKey).catch(() => {})
    await failExport(doc.id, outputRef, "UNEXPECTED").catch(() => {})
    return fail(500, "EXPORT_FAILED", "The accessible document could not be prepared. Please try again.")
  }
}

export async function readDocxExportFile(
  documentId: number,
  outputRef: string,
  actor: HistoryActor,
): Promise<{ ok: true; body: Buffer; filename: string; mimeType: string } | ExportFailure> {
  const doc = await loadOwnedDocument(documentId, actor)
  if (!doc) return fail(404, "NOT_FOUND", "The document could not be found.")
  const record = await getExportByRef(doc.id, outputRef)
  if (!record || record.status !== "completed" || !record.objectKey) return fail(404, "NOT_FOUND", "The export could not be found.")
  if (!keyBelongsToTenant(record.objectKey, currentTenantId())) return fail(404, "NOT_FOUND", "The export could not be found.")
  let object: Awaited<ReturnType<typeof downloadFile>>
  try {
    object = await downloadFile(record.objectKey)
  } catch (err) {
    console.error("[alt-text/docx-export] storage read failed", logName(err))
    return fail(503, "STORAGE_UNAVAILABLE", "Document storage is temporarily unavailable. Please try again.")
  }
  const body = await readBody(object.body, MAX_OUTPUT_BYTES).catch(() => null)
  if (!body || (record.sizeBytes != null && body.length !== record.sizeBytes)) return fail(422, "INVALID_EXPORT", "The exported document could not be read.")
  return { ok: true, body, filename: record.filename, mimeType: ACCESSIBLE_EXPORT_MIME[record.format] }
}
