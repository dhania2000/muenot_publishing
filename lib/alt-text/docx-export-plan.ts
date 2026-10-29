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
import type { PdfInsertReport } from "./pdf-alt-text-remediator"
import type { DocxExportItem, DocxExportPolicy, DocxExportSummary } from "./docx-export-contract"

/** Upper bound of occurrences handled by one synchronous export run. */
export const DOCX_EXPORT_MAX_OCCURRENCES = 5000

const PENDING_REVIEW = new Set<InsertionBlocker>(["NO_AI_RESULT", "NOT_APPROVED", "APPROVAL_SUPERSEDED", "GENERATION_IN_PROGRESS"])

export type DocxExportTotals = { occurrences: number; eligible: number; pendingReview: number; unmapped: number; blocked: number }

export type DocxExportPlan = {
  /** Approved detailed descriptions stay linked in ERP, outside native picture fields. */
  detailedDescriptions?: number
  occurrenceSnapshots?:Map<number,InsertionReadinessRow>
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
  let detailedDescriptions = 0
  for (const r of rows) {
    approvedVersions.set(r.imageOccurrenceId, r.approvedVersionId)
    if (r.eligible) {
      totals.eligible++
      if (!r.decorativeApproved && r.approvedLongDescription?.trim()) detailedDescriptions++
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
  return { instructions, skipped, totals, approvedVersions,detailedDescriptions,occurrenceSnapshots:new Map(rows.map(r=>[r.imageOccurrenceId,r])) }
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
      r.accessibility?.fingerprint??null,
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

export function mergeExportReport(report: DocxInsertReport | PptxInsertReport | PdfInsertReport | null, plan: DocxExportPlan): { summary: DocxExportSummary; items: DocxExportItem[] } {
  type AnyItem = DocxInsertReport["items"][number] | PptxInsertReport["items"][number] | PdfInsertReport["items"][number]
  const inserted: DocxExportItem[] = (report?.items ?? []).map((i: AnyItem) => ({
    occurrenceId: i.occurrenceId,
    status: i.status,
    code: i.code,
    message: i.message,
    region: "region" in i ? i.region : null,
    placement: "placement" in i ? i.placement : null,
    decorative: i.decorative,
    ...("slideNumber" in i ? { slideNumber: i.slideNumber, grouped: i.grouped } : {}),
    ...("pageNumber" in i ? { pageNumber: i.pageNumber } : {}),
  }))
  const slides = report && "slideCount" in report ? { slideCount: report.slideCount, groupedPictureCount: report.groupedPictureCount } : {}
  const pdf = report && "pdf" in report ? { pdf: report.pdf } : {}
  const items = [...inserted, ...plan.skipped].map(item=>{const row=plan.occurrenceSnapshots?.get(item.occurrenceId);return row?{...item,documentId:row.documentId,assetId:row.accessibility?.assetId??null,sourceLocator:row.sourceLocator,approvedVersionId:row.approvedVersionId,approvedVersion:row.approvedVersion,...row.accessibility?{accessibility:row.accessibility}:{}}:item}).sort((a, b) => a.occurrenceId - b.occurrenceId)
  const warnings = [...(report?.warnings ?? [])]
  const detailed=plan.detailedDescriptions??0
  if(report&&"slideCount" in report&&detailed>0)warnings.push({code:"DETAILED_DESCRIPTION_ERP_ONLY",message:`${detailed} approved detailed description${detailed===1?" is":"s are"} kept in the ERP only; only the short alt text is written to the presentation.`})
  if (plan.totals.unmapped > 0) {
    warnings.push({
      code: "UNMAPPED_OCCURRENCES",
      message: `${plan.totals.unmapped} image${plan.totals.unmapped === 1 ? " has" : "s have"} no source location and cannot receive alt text.`,
    })
  }
  const captured=items.flatMap(i=>i.accessibility?[i.accessibility]:[])
  const accessibility=captured.length?{schemaVersion:1 as const,capturedOccurrences:captured.length,withGenerationEvidence:captured.filter(s=>!!s.generation).length,withQa:captured.filter(s=>!!s.qa).length,recordedQaBlockers:captured.reduce((n,s)=>n+(s.qa?.blockingFailures??0),0),qaMissingOrDifferentVersion:captured.filter(s=>!s.qa?.matchesApprovedVersion).length,omittedReferences:captured.reduce((n,s)=>n+(s.generation?.omittedReferences??0),0),structuredEvidenceEmbedded:false as const,conformance:"not_verified" as const}:null
  if(accessibility){warnings.push({code:"STRUCTURED_EVIDENCE_SEPARATE",message:"Native picture/Figure metadata uses only the exact approved Short Alt Text. Detailed descriptions, OCR, LaTeX/MathML, datasets and reviewer corrections remain linked in ERP."});if(accessibility.recordedQaBlockers)warnings.push({code:"RECORDED_ADVANCED_QA_BLOCKERS",message:`Saved advanced QA snapshots record ${accessibility.recordedQaBlockers} blocking findings. They are provenance rather than a fresh validation; inspect the image findings before release.`});if(accessibility.qaMissingOrDifferentVersion)warnings.push({code:"ADVANCED_QA_NOT_CURRENT",message:`${accessibility.qaMissingOrDifferentVersion} approved occurrences have no saved QA matching the approved version. This export does not certify their advanced content.`});if(accessibility.omittedReferences)warnings.push({code:"ADVANCED_REFERENCE_LIMIT",message:`${accessibility.omittedReferences} evidence references exceeded bounded export metadata limits; source evidence remains in ERP.`})}
  return {
    items,
    summary: {
      ...accessibility?{accessibility}:{},
      updated: report?.updated ?? 0,
      unchanged: report?.unchanged ?? 0,
      skipped: plan.skipped.length,
      unsupported: report?.unsupported ?? 0,
      failed: report?.failed ?? 0,
      existingAltTextPreserved: report?.existingAltTextPreserved ?? 0,
      pictureCount: report?.pictureCount ?? 0,
      uniqueMediaCount: report?.uniqueMediaCount ?? 0,
      ...slides,
      ...pdf,
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
  // PDF: every meaningful image must end up on a reliably mapped Figure with a description.
  const manual = summary.pdf?.manualRemediationRequired ?? 0
  if (policy === "strict" && manual > 0) {
    return { code: "STRICT_POLICY_UNMET", message: `${manual} image${manual === 1 ? " still needs" : "s still need"} manual PDF remediation, so no document was produced.` }
  }
  if (summary.updated + summary.unchanged === 0) return { code: "NOTHING_TO_INSERT", message: "No approved description could be inserted into this document." }
  return null
}

const SAFE = /[^A-Za-z0-9._ -]+/g

export function exportFilename(original: string, ext: "docx" | "pptx" | "pdf" = "docx"): string {
  const base = original.replace(/\.(?:docx|pptx|pdf)$/i, "").replace(SAFE, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "document"
  return ext === "pdf" || ext === "pptx" ? `${base}-alt-text-updated.${ext}` : `${base}-alt-text.${ext}`
}
