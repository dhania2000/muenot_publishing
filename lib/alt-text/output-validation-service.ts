/**
 * @file lib/alt-text/output-validation-service.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Phase 3 Task 18 — orchestration for accessible-output quality validation.
 *   Loads the owner-scoped document and completed export, resolves the approved versions recorded at
 *   export time (batched, no N+1), runs the read-only validator and persists one immutable report per
 *   run. Re-validation is skipped (replayed) unless the output, policy, rule version or current
 *   approvals changed, or the caller forces it. Neither the original nor the output is modified.
 *   Runs synchronously: inputs are bounded by the same upload/export size limits as the export itself.
 */
import "server-only"
import { createHash, randomUUID } from "node:crypto"
import { readVerifiedOriginal, logName } from "./document-extraction-run"
import { ownerScopeFor } from "./document-service"
import { getDocument, type StoredDocument } from "./document-store"
import { readDocxExportFile } from "./docx-export-service"
import { getExportByRef, getExportChecksums, type StoredDocxExport } from "./docx-export-store"
import type { HistoryActor } from "./history"
import { validateExportOutput, type ExpectedOccurrence } from "./output-validation"
import {
  compareChecks,
  filterChecks,
  OUTPUT_VALIDATION_RULE_VERSION,
  summarizeChecks,
  type AcknowledgeRequest,
  type FindingsQuery,
  type ValidationReport,
  type ValidationResponse,
} from "./output-validation-contract"
import {
  acknowledgeCheck,
  claimValidation,
  completeValidation,
  failValidation,
  getLatestRuns,
  loadOccurrenceApprovals,
  loadVersionTexts,
  type StoredValidationRun,
} from "./output-validation-store"
import { getSettings } from "./store"
import { ALT_TEXT_UPLOAD_MAX_MB } from "./upload"

const MAX_SOURCE_BYTES = ALT_TEXT_UPLOAD_MAX_MB * 1024 * 1024

export type ValidationFailure = { ok: false; status: 404 | 409 | 422 | 500 | 503; code: string; error: string }
const fail = (status: ValidationFailure["status"], code: string, error: string): ValidationFailure => ({ ok: false, status, code, error })
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex")

type Context = { doc: StoredDocument; record: StoredDocxExport }

async function loadContext(documentId: number, outputRef: string, actor: HistoryActor): Promise<{ ok: true; ctx: Context } | ValidationFailure> {
  const doc = await getDocument(documentId, ownerScopeFor(actor))
  if (!doc) return fail(404, "NOT_FOUND", "The document could not be found.")
  const record = await getExportByRef(doc.id, outputRef)
  if (!record || record.status !== "completed") return fail(404, "NOT_FOUND", "The export could not be found.")
  return { ok: true, ctx: { doc, record } }
}

/** Report with acknowledgements merged in and the summary recomputed from them. */
function hydrate(run: StoredValidationRun): ValidationReport | null {
  if (!run.report) return null
  const acknowledgements = run.acknowledgements
  return { ...run.report, acknowledgements, summary: summarizeChecks(run.report.checks, acknowledgements) }
}

function view(runs: { latest: StoredValidationRun | null; completed: StoredValidationRun | null }, q: FindingsQuery, extra: { replayed?: boolean; canAcknowledge?: boolean } = {}): ValidationResponse {
  const latestRun = runs.latest ? { runId: runs.latest.runId, status: runs.latest.status, errorCode: runs.latest.errorCode, createdAt: runs.latest.createdAt } : null
  const report = runs.completed ? hydrate(runs.completed) : null
  const base = { success: true as const, latestRun, ...extra }
  if (!report) return { ...base, report: null, findings: { items: [], total: 0, page: q.page, pageSize: q.pageSize } }
  const { checks, ...meta } = report
  const filtered = filterChecks(checks, q)
  const start = (q.page - 1) * q.pageSize
  return { ...base, report: meta, findings: { items: filtered.slice(start, start + q.pageSize), total: filtered.length, page: q.page, pageSize: q.pageSize } }
}

export async function getOutputValidation(documentId: number, outputRef: string, actor: HistoryActor, q: FindingsQuery, canAcknowledge = false): Promise<{ ok: true; response: ValidationResponse } | ValidationFailure> {
  const loaded = await loadContext(documentId, outputRef, actor)
  if (!loaded.ok) return loaded
  const runs = await getLatestRuns(loaded.ctx.doc.id, outputRef)
  return { ok: true, response: view(runs, q, { canAcknowledge }) }
}

export async function getOutputValidationReport(documentId: number, outputRef: string, actor: HistoryActor): Promise<{ ok: true; report: ValidationReport } | ValidationFailure> {
  const loaded = await loadContext(documentId, outputRef, actor)
  if (!loaded.ok) return loaded
  const { completed } = await getLatestRuns(loaded.ctx.doc.id, outputRef)
  const report = completed ? hydrate(completed) : null
  return report ? { ok: true, report } : fail(404, "NOT_FOUND", "This output has not been validated yet.")
}

async function expectedOccurrences(ctx: Context): Promise<ExpectedOccurrence[]> {
  const items = ctx.record.report?.items ?? []
  const versionIds = items.map((i) => (i as { approvedVersionId?: number | null }).approvedVersionId).filter((v): v is number => typeof v === "number")
  const [approvals, versions] = await Promise.all([loadOccurrenceApprovals(ctx.doc.id, items.map((i) => i.occurrenceId)), loadVersionTexts(versionIds)])
  return items.map((i) => {
    const approvedVersionId = (i as { approvedVersionId?: number | null }).approvedVersionId ?? null
    const version = approvedVersionId != null ? versions.get(approvedVersionId) : undefined
    const current = approvals.get(i.occurrenceId)
    return {
      occurrenceId: i.occurrenceId,
      sourceLocator: current?.sourceLocator ?? "",
      exportStatus: i.status,
      exportCode: i.code,
      exportMessage: i.message,
      decorative: Boolean(i.decorative),
      approvedVersionId,
      approvedVersion: version?.version ?? null,
      approvedText: version?.shortAlt ?? null,
      versionFound: version != null,
      currentApprovedVersionId: current?.approvedVersionId ?? null,
      location: { region: i.region ?? null, pageNumber: i.pageNumber ?? null, slideNumber: i.slideNumber ?? null },
    }
  })
}

export async function runOutputValidation(
  documentId: number,
  outputRef: string,
  actor: HistoryActor,
  opts: { force: boolean; query: FindingsQuery; canAcknowledge?: boolean },
): Promise<{ ok: true; response: ValidationResponse } | ValidationFailure> {
  const loaded = await loadContext(documentId, outputRef, actor)
  if (!loaded.ok) return loaded
  const { ctx } = loaded
  if (ctx.doc.securityStatus !== "clean") return fail(409, "DOCUMENT_NOT_CLEAN", "The document has not passed the security scan.")

  const [occurrences, checksums, { shortMaxChars }] = await Promise.all([expectedOccurrences(ctx), getExportChecksums(ctx.doc.id, outputRef), getSettings()])
  const fingerprint = sha256(
    JSON.stringify([
      OUTPUT_VALIDATION_RULE_VERSION,
      ctx.record.policy,
      checksums?.sourceChecksum ?? null,
      checksums?.outputChecksum ?? null,
      shortMaxChars,
      occurrences.map((o) => [o.occurrenceId, o.approvedVersionId, o.currentApprovedVersionId]),
    ]),
  )

  const before = await getLatestRuns(ctx.doc.id, outputRef)
  if (!opts.force && before.completed?.fingerprint === fingerprint) {
    return { ok: true, response: view(before, opts.query, { replayed: true, canAcknowledge: opts.canAcknowledge }) }
  }

  const runRef = randomUUID()
  const claim = await claimValidation({ documentId: ctx.doc.id, outputRef, runRef, fingerprint, ruleVersion: OUTPUT_VALIDATION_RULE_VERSION, createdBy: actor.userId })
  if (claim === "in_progress") return fail(409, "VALIDATION_IN_PROGRESS", "This output is already being validated. Try again shortly.")

  try {
    const original = await readVerifiedOriginal(ctx.doc, MAX_SOURCE_BYTES)
    if (!original.ok) {
      await failValidation(runRef, original.code)
      return fail(original.status === 404 ? 404 : original.status === 503 ? 503 : 422, original.code, original.error)
    }
    const file = await readDocxExportFile(ctx.doc.id, outputRef, actor)
    // Storage outages are transient — fail the run instead of recording a false integrity failure.
    if (!file.ok && file.status === 503) {
      await failValidation(runRef, file.code)
      return fail(503, file.code, file.error)
    }

    const checks = await validateExportOutput({
      format: ctx.record.format,
      original: original.bytes,
      output: file.ok ? file.body : null,
      outputReadError: file.ok ? null : file.error,
      record: { sourceChecksum: checksums?.sourceChecksum ?? null, outputChecksum: checksums?.outputChecksum ?? null, sizeBytes: ctx.record.sizeBytes, policy: ctx.record.policy },
      occurrences,
      shortMaxChars,
    })
    checks.sort(compareChecks)
    const report: ValidationReport = {
      runId: runRef,
      documentId: ctx.doc.id,
      outputId: outputRef,
      format: ctx.record.format,
      ruleVersion: OUTPUT_VALIDATION_RULE_VERSION,
      validatedAt: new Date().toISOString(),
      originalFilename: ctx.doc.filename,
      outputFilename: ctx.record.filename,
      policy: { exportPolicy: ctx.record.policy, shortMaxChars, guideline: null, pdfUaValidator: null, renderer: null },
      summary: summarizeChecks(checks),
      checks,
      acknowledgements: {},
    }
    await completeValidation(runRef, report)
    const after = await getLatestRuns(ctx.doc.id, outputRef)
    return { ok: true, response: view(after, opts.query, { replayed: false, canAcknowledge: opts.canAcknowledge }) }
  } catch (err) {
    console.error("[alt-text/output-validation] run failed", logName(err))
    await failValidation(runRef, "UNEXPECTED").catch(() => {})
    return fail(500, "VALIDATION_FAILED", "The output could not be validated. Please try again.")
  }
}

/** Acknowledgement never turns a manual-review item into "passed"; it only closes it for readiness. */
export async function acknowledgeManualCheck(
  documentId: number,
  outputRef: string,
  actor: HistoryActor,
  request: AcknowledgeRequest,
  query: FindingsQuery,
): Promise<{ ok: true; response: ValidationResponse } | ValidationFailure> {
  const loaded = await loadContext(documentId, outputRef, actor)
  if (!loaded.ok) return loaded
  const runs = await getLatestRuns(loaded.ctx.doc.id, outputRef)
  const run = runs.completed
  if (!run?.report || run.runId !== request.runId) return fail(409, "STALE_RUN", "This report has been superseded. Refresh to see the latest validation.")
  const check = run.report.checks.find((c) => c.id === request.checkId)
  if (!check) return fail(404, "NOT_FOUND", "The check could not be found.")
  if (check.status !== "manual_review") return fail(422, "NOT_MANUAL_REVIEW", "Only manual-review items can be acknowledged.")
  const ok = await acknowledgeCheck(loaded.ctx.doc.id, outputRef, run.runId, check.id, { by: actor.userId, at: new Date().toISOString(), note: request.note })
  if (!ok) return fail(409, "STALE_RUN", "This report has been superseded. Refresh to see the latest validation.")
  const after = await getLatestRuns(loaded.ctx.doc.id, outputRef)
  return { ok: true, response: view(after, query, { canAcknowledge: true }) }
}
