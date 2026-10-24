/**
 * @file lib/alt-text/docx-export-plan.ts
 * @module Publishing · Alt Text
 * @kind Pure domain logic (no I/O)
 * @summary Phase 3 Task 15 — turns persisted insertion-readiness rows into inserter instructions,
 *   classifies everything that cannot be inserted, fingerprints the approval state (snapshot) and
 *   merges the inserter report into the user-facing export summary. Policy decisions live here so
 *   they are unit-testable without a database or storage.
 */
import { createHash } from "node:crypto"
import type { InsertionBlocker, InsertionReadinessRow } from "./document-approval-contract"
import type { DocxInsertInstruction, DocxInsertReport } from "./docx-alt-text-inserter"
import type { PptxInsertReport } from "./pptx-alt-text-inserter"
import type { DocxExportItem, DocxExportPolicy, DocxExportSummary } from "./docx-export-contract"

/** Upper bound of occurrences handled by one synchronous export run. */
export const DOCX_EXPORT_MAX_OCCURRENCES = 5000

const PENDING_REVIEW = new Set<InsertionBlocker>(["NO_AI_RESULT", "NOT_APPROVED", "APPROVAL_SUPERSEDED", "GENERATION_IN_PROGRESS"])

export type DocxExportTotals = { occurrences: number; eligible: number; pendingReview: number; unmapped: number; blocked: number }

export type DocxExportPlan = {
  instructions: DocxInsertInstruction[]
  /** Occurrences that are never sent to the inserter, with the reason. */
  skipped: DocxExportItem[]
  totals: DocxExportTotals
  /** Approved version id per occurrence, kept with the export report for traceability. */
  approvedVersions: Map<number, number | null>
}

export function planDocxExport(rows: InsertionReadinessRow[]): DocxExportPlan {
  const instructions: DocxInsertInstruction[] = []
  const skipped: DocxExportItem[] = []
  const approvedVersions = new Map<number, number | null>()
  const totals: DocxExportTotals = { occurrences: rows.length, eligible: 0, pendingReview: 0, unmapped: 0, blocked: 0 }
  for (const r of rows) {
    approvedVersions.set(r.imageOccurrenceId, r.approvedVersionId)
    if (r.eligible) {
      totals.eligible++
      instructions.push({
        occurrenceId: r.imageOccurrenceId,
        sourceLocator: r.sourceLocator,
        text: r.decorativeApproved ? "" : (r.approvedShortAlt ?? ""),
        decorative: r.decorativeApproved,
      })
      continue
    }
    const reason = r.blockingReason ?? "VALIDATION_FAILED"
    if (reason === "NO_SOURCE_MAPPING") totals.unmapped++
    else if (PENDING_REVIEW.has(reason)) totals.pendingReview++
    else totals.blocked++
    skipped.push({
      occurrenceId: r.imageOccurrenceId,
      status: "skipped",
      code: reason,
      message: r.blockingMessage ?? "This image is not ready for insertion.",
      region: null,
      placement: null,
      decorative: r.decorativeApproved,
    })
  }
  return { instructions, skipped, totals, approvedVersions }
}

/**
 * Fingerprint of everything that decides what gets inserted. A changed snapshot between preflight
 * and export (or during the run) means approvals moved and the export must be re-confirmed.
 */
export function approvalSnapshot(rows: InsertionReadinessRow[]): string {
  const facts = [...rows]
    .sort((a, b) => a.imageOccurrenceId - b.imageOccurrenceId)
    .map((r) => [
      r.imageOccurrenceId,
      r.eligible ? 1 : 0,
      r.blockingReason ?? "",
      r.approvedVersionId ?? 0,
      r.decorativeApproved ? 1 : 0,
      r.sourceLocator,
      createHash("sha256").update(r.approvedShortAlt ?? "").digest("hex"),
    ])
  return createHash("sha256").update(JSON.stringify(facts)).digest("hex")
}

/** Strict policy can only start when nothing mapped is waiting for review or blocked. */
export function strictPreconditionFailure(totals: DocxExportTotals): string | null {
  if (totals.pendingReview > 0 || totals.blocked > 0) {
    const n = totals.pendingReview + totals.blocked
    return `${n} mapped image${n === 1 ? " is" : "s are"} not approved and insertable.`
  }
  return null
}

export function mergeExportReport(report: DocxInsertReport | PptxInsertReport | null, plan: DocxExportPlan): { summary: DocxExportSummary; items: DocxExportItem[] } {
  const inserted: DocxExportItem[] = (report?.items ?? []).map((i: DocxInsertReport["items"][number] | PptxInsertReport["items"][number]) => ({
    occurrenceId: i.occurrenceId,
    status: i.status,
    code: i.code,
    message: i.message,
    region: "region" in i ? i.region : null,
    placement: "placement" in i ? i.placement : null,
    decorative: i.decorative,
    ...("slideNumber" in i ? { slideNumber: i.slideNumber, grouped: i.grouped } : {}),
  }))
  const slides = report && "slideCount" in report ? { slideCount: report.slideCount, groupedPictureCount: report.groupedPictureCount } : {}
  const items = [...inserted, ...plan.skipped].sort((a, b) => a.occurrenceId - b.occurrenceId)
  const warnings = [...(report?.warnings ?? [])]
  if (plan.totals.unmapped > 0) {
    warnings.push({
      code: "UNMAPPED_OCCURRENCES",
      message: `${plan.totals.unmapped} image${plan.totals.unmapped === 1 ? " has" : "s have"} no source location and cannot receive alt text.`,
    })
  }
  return {
    items,
    summary: {
      updated: report?.updated ?? 0,
      unchanged: report?.unchanged ?? 0,
      skipped: plan.skipped.length,
      unsupported: report?.unsupported ?? 0,
      failed: report?.failed ?? 0,
      existingAltTextPreserved: report?.existingAltTextPreserved ?? 0,
      pictureCount: report?.pictureCount ?? 0,
      uniqueMediaCount: report?.uniqueMediaCount ?? 0,
      ...slides,
      warnings,
    },
  }
}

/** Policy verdict after the inserter ran. Returns an error code when no output may be produced. */
export function exportPolicyFailure(policy: DocxExportPolicy, summary: DocxExportSummary): { code: string; message: string } | null {
  // Unmapped occurrences are reported but do not fail strict mode: they cannot be targeted at all.
  const blocking = summary.unsupported + summary.failed
  if (policy === "strict" && blocking > 0) {
    return { code: "STRICT_POLICY_UNMET", message: `${blocking} approved image${blocking === 1 ? "" : "s"} could not be inserted, so no document was produced.` }
  }
  if (summary.updated + summary.unchanged === 0) return { code: "NOTHING_TO_INSERT", message: "No approved description could be inserted into this document." }
  return null
}

const SAFE = /[^A-Za-z0-9._ -]+/g

export function exportFilename(original: string, ext: "docx" | "pptx" = "docx"): string {
  const base = original.replace(/\.(?:docx|pptx)$/i, "").replace(SAFE, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "document"
  return `${base}-alt-text.${ext}`
}
