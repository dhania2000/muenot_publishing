/**
 * @file lib/alt-text/batch-xlsx.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Phase 2 Task 16 — five-sheet XLSX workbook for one batch (summary, image details, alt text, warnings, status).
 * @usedBy lib/alt-text/batch-export.ts
 *
 * Every value comes from persisted rows. Untrusted text is written as typed string cells (never formulas,
 * hyperlinks or rich objects), so "=SUM(A1)" or "x² + y² = r²" stay literal readable text.
 * Uses ExcelJS because the installed SheetJS Community Edition cannot write cell styles.
 */
import ExcelJS from "exceljs"
import { resolveEffectiveSettings } from "./batch-settings"
import {
  CLASSIFICATION_LABELS,
  CONTENT_TYPES,
  DESCRIPTION_MODES,
  GENERATION_PURPOSES,
  GRADE_LEVELS,
  LANGUAGES,
  SUBJECTS,
  type GenerationSettings,
} from "./core"
import { isExportable } from "./export"
import type { BatchRow, BatchWorkbookAssetRow } from "./store"

export type WorkbookBatch = Pick<BatchRow, "id" | "name" | "description" | "projectName" | "createdBy" | "createdAt" | "status" | "settings" | "stats">

const NAVY = "FF1F3864"
const STRIPE = "FFF2F5FA"
const BORDER = "FFD0D7E2"
const DATE_FMT = "dd-mmm-yyyy hh:mm"
const EXCEL_CELL_MAX = 32767
// XML 1.0 forbids these code points; leaving them in would produce a workbook Excel refuses to open.
const XML_ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g

/** Literal text for a cell: XML-safe, within Excel's cell limit, always a string (never a formula). */
export function literal(v: string | null | undefined): string {
  if (v == null) return ""
  const clean = v.replace(XML_ILLEGAL, "")
  return clean.length > EXCEL_CELL_MAX ? `${clean.slice(0, EXCEL_CELL_MAX - 14)} …[truncated]` : clean
}

const label = (map: Record<string, unknown>, key: string | null | undefined): string => {
  if (!key) return ""
  const v = map[key]
  if (typeof v === "string") return v
  if (v && typeof v === "object" && "label" in v) return String((v as { label: unknown }).label)
  return key
}

const toDate = (iso: string | null | undefined) => {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

const STATUS_LABELS: Record<string, string> = {
  uploaded: "Pending",
  processing: "Processing",
  in_review: "Completed (In Review)",
  approved: "Completed (Approved)",
  rejected: "Completed (Rejected)",
  failed: "Failed",
}
export function statusLabel(a: Pick<BatchWorkbookAssetRow, "status" | "errorMessage">): string {
  if (a.status === "uploaded" && a.errorMessage) return "Blocked"
  return STATUS_LABELS[a.status] ?? a.status
}

/** Only failure / block reasons the dashboard already shows; never stack traces or provider payloads. */
const safeReason = (a: BatchWorkbookAssetRow) => (a.status === "failed" || a.status === "uploaded" ? literal(a.errorMessage) : "")

type Column = { header: string; key: string; width: number; wrap?: boolean; date?: boolean; numFmt?: string }

function dataSheet(wb: ExcelJS.Workbook, name: string, columns: Column[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] })
  ws.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width,
    style: {
      alignment: { vertical: "top", wrapText: !!c.wrap },
      ...(c.date ? { numFmt: DATE_FMT } : c.numFmt ? { numFmt: c.numFmt } : {}),
    },
  }))
  styleHeader(ws.getRow(1))
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } }
  return ws
}

function styleHeader(row: ExcelJS.Row) {
  row.height = 22
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Calibri", size: 11 }
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } }
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true }
    cell.border = { bottom: { style: "thin", color: { argb: NAVY } } }
  })
}

function addRow(ws: ExcelJS.Worksheet, values: Record<string, unknown>) {
  const row = ws.addRow(values)
  if (row.number % 2 === 1) {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STRIPE } }
    })
  }
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.border = { bottom: { style: "hair", color: { argb: BORDER } } }
  })
  return row
}

function summarySheet(wb: ExcelJS.Workbook, batch: WorkbookBatch, exportedAt: Date, exportedImages: number) {
  const ws = wb.addWorksheet("Batch Summary")
  ws.columns = [
    { key: "field", width: 28 },
    { key: "value", width: 60, style: { alignment: { vertical: "top", wrapText: true } } },
  ]
  const title = ws.addRow(["Alt Text Batch Export"])
  title.font = { bold: true, size: 14, color: { argb: NAVY } }
  title.height = 24
  ws.addRow([])
  const header = ws.addRow(["Field", "Value"])
  styleHeader(header)

  const s = batch.stats
  const pct = s.total > 0 ? s.completed / s.total : 0
  const d: GenerationSettings = batch.settings
  const rows: [string, string | number | Date | null, string?][] = [
    ["Batch ID", batch.id],
    ["Batch Name", literal(batch.name)],
    ...(batch.projectName ? [["Project Name", literal(batch.projectName)] as [string, string]] : []),
    ["Batch Description", literal(batch.description)],
    ["Created By (User ID)", batch.createdBy],
    ["Created Date", toDate(batch.createdAt), DATE_FMT],
    ["Export Date", exportedAt, DATE_FMT],
    ["Batch Status", label(STATUS_BATCH, batch.status)],
    ["Total Images", s.total],
    ["Completed Images", s.completed],
    ["Failed Images", s.failed],
    ["Pending Images", s.pending],
    ["Processing Images", s.processing],
    ["Success Percentage", pct, "0.0%"],
    ["Default Language", label(LANGUAGES, d.outputLanguage)],
    ["Default Subject", label(SUBJECTS, d.subject)],
    ["Description Mode", label(DESCRIPTION_MODES, d.descriptionMode)],
    ["Images in This Export", exportedImages],
  ]
  for (const [field, value, fmt] of rows) {
    const row = addRow(ws, { field, value: value ?? "" })
    row.getCell(1).font = { bold: true }
    row.getCell(2).alignment = { horizontal: "left", vertical: "top", wrapText: true }
    if (fmt) row.getCell(2).numFmt = fmt
  }
  ws.addRow([])
  const note = ws.addRow(["Notes", "Per-image start and completion times are not recorded by the system and are left blank."])
  note.font = { italic: true, color: { argb: "FF5A6478" } }
}

const STATUS_BATCH: Record<string, string> = {
  draft: "Draft",
  queued: "Queued",
  processing: "Processing",
  pause_requested: "Pause Requested",
  paused: "Paused",
  cancel_requested: "Cancel Requested",
  completed: "Completed",
  partially_completed: "Partially Completed",
  failed: "Failed",
  cancelled: "Cancelled",
}

export async function buildBatchWorkbook(batch: WorkbookBatch, assets: BatchWorkbookAssetRow[], exportedAt = new Date()): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  wb.creator = "Muenot ERP"
  wb.created = exportedAt
  wb.title = literal(`Alt Text — ${batch.name}`)

  summarySheet(wb, batch, exportedAt, assets.length)

  const details = dataSheet(wb, "Image Details", [
    { header: "S.No.", key: "sno", width: 7 },
    { header: "Asset ID", key: "assetId", width: 10 },
    { header: "Original Filename", key: "fileName", width: 34, wrap: true },
    { header: "File Type", key: "fileType", width: 13 },
    { header: "File Size (KB)", key: "size", width: 13, numFmt: "#,##0.0" },
    { header: "Image Classification", key: "classification", width: 22 },
    { header: "Image Purpose", key: "purpose", width: 18 },
    { header: "Content Type", key: "contentType", width: 18 },
    { header: "Subject", key: "subject", width: 18 },
    { header: "Grade / Level", key: "grade", width: 16 },
    { header: "Chapter / Topic", key: "chapter", width: 26, wrap: true },
    { header: "Output Language", key: "language", width: 14 },
    { header: "Settings Override", key: "override", width: 14 },
    { header: "Processing Status", key: "status", width: 22 },
  ])
  const alt = dataSheet(wb, "Alt Text", [
    { header: "S.No.", key: "sno", width: 7 },
    { header: "Filename", key: "fileName", width: 30, wrap: true },
    { header: "Image Classification", key: "classification", width: 20 },
    { header: "Subject", key: "subject", width: 16 },
    { header: "Chapter", key: "chapter", width: 22, wrap: true },
    { header: "Short Alt Text", key: "shortAlt", width: 48, wrap: true },
    { header: "Detailed Description", key: "longDescription", width: 70, wrap: true },
    { header: "Extracted Visible Text", key: "extractedText", width: 40, wrap: true },
    { header: "Output Language", key: "language", width: 14 },
    { header: "AI Model", key: "model", width: 22 },
    { header: "Version Number", key: "version", width: 10 },
    { header: "Last Updated", key: "updatedAt", width: 18, date: true },
  ])
  const warnings = dataSheet(wb, "Review Warnings", [
    { header: "S.No.", key: "sno", width: 7 },
    { header: "Filename", key: "fileName", width: 30, wrap: true },
    { header: "Image Classification", key: "classification", width: 20 },
    { header: "Warning / Review Issue", key: "warning", width: 70, wrap: true },
    { header: "Processing Status", key: "status", width: 22 },
    { header: "Latest Updated", key: "updatedAt", width: 18, date: true },
  ])
  const status = dataSheet(wb, "Processing Status", [
    { header: "S.No.", key: "sno", width: 7 },
    { header: "Filename", key: "fileName", width: 30, wrap: true },
    { header: "Status", key: "status", width: 22 },
    { header: "Generation Attempts", key: "attempts", width: 12 },
    { header: "Safe Failure Reason", key: "reason", width: 48, wrap: true },
    { header: "Started At", key: "startedAt", width: 18, date: true },
    { header: "Completed At", key: "completedAt", width: 18, date: true },
    { header: "Last Updated", key: "updatedAt", width: 18, date: true },
    { header: "AI Model", key: "model", width: 22 },
  ])

  let altNo = 0
  let warnNo = 0
  assets.forEach((a, i) => {
    const s = resolveEffectiveSettings(batch.settings, a.settingsOverride ?? undefined)
    const fileName = literal(a.fileName)
    const classification = label(CLASSIFICATION_LABELS, a.classification)
    const st = statusLabel(a)
    const updatedAt = toDate(a.updatedAt)

    addRow(details, {
      sno: i + 1,
      assetId: a.id,
      fileName,
      fileType: literal(a.mimeType),
      size: Math.round((a.sizeBytes / 1024) * 10) / 10,
      classification,
      purpose: label(GENERATION_PURPOSES, s.imagePurpose),
      contentType: label(CONTENT_TYPES, s.contentType),
      subject: label(SUBJECTS, s.subject),
      grade: label(GRADE_LEVELS, s.gradeLevel),
      chapter: literal(s.chapterTopic),
      language: label(LANGUAGES, s.outputLanguage),
      override: a.settingsOverride ? "Yes" : "No",
      status: st,
    })

    if (isExportable(a)) {
      addRow(alt, {
        sno: ++altNo,
        fileName,
        classification,
        subject: label(SUBJECTS, s.subject),
        chapter: literal(s.chapterTopic),
        // Decorative images intentionally keep alt="" — written as an empty string, never a placeholder.
        shortAlt: literal(a.shortAlt),
        longDescription: literal(a.longDescription),
        extractedText: literal(a.extractedText),
        language: label(LANGUAGES, a.language),
        model: literal(a.modelId),
        version: a.currentVersion,
        updatedAt,
      })
    }

    for (const w of a.warnings) {
      if (!w?.trim()) continue
      addRow(warnings, { sno: ++warnNo, fileName, classification, warning: literal(w), status: st, updatedAt })
    }

    addRow(status, {
      sno: i + 1,
      fileName,
      status: st,
      attempts: a.attempts,
      reason: safeReason(a),
      startedAt: null,
      completedAt: null,
      updatedAt,
      model: literal(a.modelId),
    })
  })

  if (altNo === 0) alt.addRow({ fileName: "No completed images with saved alt text." }).font = { italic: true }
  if (warnNo === 0) warnings.addRow({ fileName: "No review warnings recorded" }).font = { italic: true }

  const buf = await wb.xlsx.writeBuffer()
  return new Uint8Array(buf as ArrayBuffer)
}
