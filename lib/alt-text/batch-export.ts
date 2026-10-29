/**
 * @file lib/alt-text/batch-export.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Phase 2 Task 15 — bulk CSV / TXT / JSON export of the latest saved descriptions in one batch.
 * @usedBy app/api/alt-text/batches/[id]/export/route.ts
 *
 * Reuses the Phase 1 export format list, `isExportable` saved-result rule, `toCsv` (BOM + formula-injection
 * guard) and `recordExport`. Only persisted rows are read; client drafts never reach this module.
 * A failed regeneration of a previously saved asset is already returned to `in_review` by `markFailed`,
 * so its saved result remains exportable while never-completed failures stay excluded.
 */
import "server-only"
import { resolveEffectiveSettings } from "./batch-settings"
import { BATCH_ID_PATTERN, ownsBatch } from "./batch-progress"
import { CLASSIFICATION_LABELS, GENERATION_PURPOSES, LANGUAGES, SUBJECTS, toCsv, type ImageClassification } from "./core"
import { EXPORT_FORMATS, isExportable, type ExportFile, type ExportFormat } from "./export"
import type { HistoryActor, HistoryFailure } from "./history"
import { buildBatchWorkbook } from "./batch-xlsx"
import {
  countBatchExportRows,
  countBatchWorkbookRows,
  getBatch,
  listBatchExportRows,
  listBatchWorkbookRows,
  recordExport,
  type BatchExportAssetRow,
  type BatchExportOwner,
  type BatchRow,
  type BatchWorkbookAssetRow,
} from "./store"

/** Synchronous ceiling (matches the Phase 1 project export cap); larger batches need a durable export. */
export const BATCH_EXPORT_MAX_ROWS = 5000
export const BATCH_EXPORT_CHUNK = 500

/** Batch-only formats; XLSX is not offered by the Phase 1 single-asset/project export. */
export const BATCH_EXPORT_FORMATS = [...EXPORT_FORMATS, "xlsx"] as const
export type BatchExportFormat = (typeof BATCH_EXPORT_FORMATS)[number]
export type BatchExportFile = { body: string | Uint8Array; contentType: string; filename: string }
export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

export type BatchExportQuery = { batchId: string; format: BatchExportFormat; scope: "completed" }

export type BatchExportRecord = {
  batchId: string
  batchName: string
  assetId: number
  fileName: string
  classification: string | null
  imagePurpose: string
  subject: string
  chapterTopic: string | null
  language: string
  shortAlt: string | null
  longDescription: string | null
  extractedText: string | null
  warnings: string[]
  modelId: string | null
  savedVersion: number
  updatedAt: string
}

export type BatchExportMeta = { id: string; name: string; exportedAt: string; totalExported: number }

const CONTENT_TYPES: Record<ExportFormat, string> = {
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
}

const fail = (status: number, code: string, error: string): HistoryFailure => ({ ok: false, status, code, error })

export function parseBatchExportQuery(batchId: string, sp: URLSearchParams): { ok: true; value: BatchExportQuery } | HistoryFailure {
  if (!BATCH_ID_PATTERN.test(batchId)) return fail(400, "INVALID_BATCH_ID", "Invalid batch identifier.")
  const format = (sp.get("format") ?? "").toLowerCase()
  if (!(BATCH_EXPORT_FORMATS as readonly string[]).includes(format)) return fail(400, "INVALID_FORMAT", "format must be csv, txt, json or xlsx.")
  const scope = sp.get("scope") ?? "completed"
  if (scope !== "completed") return fail(400, "INVALID_SCOPE", "scope must be completed.")
  return { ok: true, value: { batchId: batchId.toLowerCase(), format: format as BatchExportFormat, scope } }
}

const safeId = (batchId: string) => batchId.replace(/[^a-z0-9-]/gi, "").slice(0, 64)
export const batchExportFilename = (batchId: string, format: BatchExportFormat) =>
  format === "xlsx" ? `alt-text-batch-${safeId(batchId)}.xlsx` : `batch-${safeId(batchId)}-alt-text.${format}`

export function toBatchExportRecord(batch: Pick<BatchRow, "id" | "name" | "settings">, a: BatchExportAssetRow): BatchExportRecord {
  const s = resolveEffectiveSettings(batch.settings, a.settingsOverride ?? undefined)
  return {
    batchId: batch.id,
    batchName: batch.name,
    assetId: a.id,
    fileName: a.fileName,
    classification: a.classification,
    imagePurpose: s.imagePurpose,
    subject: s.subject,
    chapterTopic: s.chapterTopic || null,
    language: a.language,
    // Decorative images intentionally carry alt="": keep it as an empty string, never null.
    shortAlt: a.classification === "decorative" ? (a.shortAlt ?? "") : a.shortAlt,
    longDescription: a.longDescription,
    extractedText: a.extractedText,
    warnings: a.warnings,
    modelId: a.modelId,
    savedVersion: a.currentVersion,
    updatedAt: a.updatedAt,
  }
}

const CSV_COLUMNS = [
  "batchId",
  "batchName",
  "assetId",
  "fileName",
  "classification",
  "imagePurpose",
  "subject",
  "chapterTopic",
  "language",
  "shortAlt",
  "longDescription",
  "extractedText",
  "warnings",
  "modelId",
  "savedVersion",
  "updatedAt",
] as const

export function buildBatchCsv(_meta: BatchExportMeta, records: BatchExportRecord[]): string {
  return toCsv(
    records.map((r) => ({ ...r, warnings: r.warnings.join("\n") })),
    { bom: true, columns: CSV_COLUMNS },
  )
}

const lookup = (map: Record<string, unknown>, key: string | null) => {
  if (!key) return null
  const v = map[key]
  return typeof v === "string" ? v : v && typeof v === "object" && "label" in v ? String((v as { label: unknown }).label) : key
}
const SEPARATOR = "-".repeat(40)

export function buildBatchTxt(meta: BatchExportMeta, records: BatchExportRecord[]): string {
  const head = [`Batch: ${meta.name}`, `Batch ID: ${meta.id}`, `Export Date: ${meta.exportedAt}`, `Total Exported Images: ${meta.totalExported}`].join("\n")
  const blocks = records.map((r, i) => {
    const field = (label: string, value: string | null) => (value ? [`${label}: ${value}`] : [])
    const section = (label: string, value: string | null | undefined) => (value ? ["", `${label}:`, value] : [])
    const shortAlt = r.classification === "decorative" && !r.shortAlt ? '(empty — decorative image, use alt="")' : r.shortAlt
    return [
      `Image ${i + 1}`,
      "",
      ...field("Filename", r.fileName),
      ...field("Classification", lookup(CLASSIFICATION_LABELS as Record<ImageClassification, string>, r.classification)),
      ...field("Purpose", lookup(GENERATION_PURPOSES, r.imagePurpose)),
      ...field("Subject", lookup(SUBJECTS, r.subject)),
      ...field("Chapter / Topic", r.chapterTopic),
      ...field("Language", lookup(LANGUAGES, r.language)),
      ...section("Short Alt Text", shortAlt),
      ...section("Detailed Description", r.longDescription),
      ...section("Visible Text", r.extractedText),
      ...section("Accessibility Warnings", r.warnings.length ? r.warnings.map((w) => `- ${w}`).join("\n") : null),
    ].join("\n")
  })
  return `${[head, ...blocks].join(`\n\n${SEPARATOR}\n\n`)}\n`
}

export function buildBatchJson(meta: BatchExportMeta, records: BatchExportRecord[]): string {
  return JSON.stringify(
    {
      batch: meta,
      images: records.map(({ batchId: _b, batchName: _n, ...r }) => r),
    },
    null,
    2,
  )
}

const BUILDERS: Record<ExportFormat, (meta: BatchExportMeta, records: BatchExportRecord[]) => string> = {
  csv: buildBatchCsv,
  txt: buildBatchTxt,
  json: buildBatchJson,
}

export function exportOwner(actor: HistoryActor): { ok: true; owner?: BatchExportOwner } | { ok: false } {
  const view=actor.viewScope,action=actor.exportScope??view
  if(view==="none"||action==="none")return {ok:false}
  if((view==="added"&&action==="owned")||(view==="owned"&&action==="added"))return {ok:true,owner:{userId:actor.userId,match:"intersection"}}
  const scope=view==="all"?action:action==="all"?view:view==="both"?action:action==="both"?view:view
  if (scope === "all") return { ok: true }
  if (scope === "added" || scope === "owned" || scope === "both") return { ok: true, owner: { userId: actor.userId, match: scope } }
  return { ok: false }
}

async function exportBatchWorkbook(batch: BatchRow, owner: BatchExportOwner | undefined, actor: HistoryActor): Promise<{ ok: true; file: BatchExportFile; count: number } | HistoryFailure> {
  const total = await countBatchWorkbookRows(batch.id, owner)
  if (total > BATCH_EXPORT_MAX_ROWS)
    return fail(413, "EXPORT_TOO_LARGE", `This batch has ${total} images; synchronous Excel export supports up to ${BATCH_EXPORT_MAX_ROWS}.`)
  if (total === 0) return fail(409, "NO_EXPORTABLE_RECORDS", "This batch has no images to export.")

  const assets: BatchWorkbookAssetRow[] = []
  let afterId = 0
  for (;;) {
    const page = await listBatchWorkbookRows(batch.id, { afterId, limit: BATCH_EXPORT_CHUNK, owner })
    assets.push(...page)
    if (page.length < BATCH_EXPORT_CHUNK) break
    afterId = page[page.length - 1].id
    if (assets.length > BATCH_EXPORT_MAX_ROWS) return fail(413, "EXPORT_TOO_LARGE", `Synchronous Excel export supports up to ${BATCH_EXPORT_MAX_ROWS} images.`)
  }
  if (assets.length === 0) return fail(409, "NO_EXPORTABLE_RECORDS", "This batch has no images to export.")

  let body: Uint8Array
  try {
    body = await buildBatchWorkbook(batch, assets)
  } catch (err) {
    console.error("[alt-text] xlsx generation failed", err instanceof Error ? err.message : err)
    return fail(500, "XLSX_GENERATION_FAILED", "The Excel workbook could not be generated. Please try again.")
  }
  // History is written only after the workbook was fully generated.
  await recordExport("xlsx", "batch", batch.projectId, assets.length, actor.userId, null, batch.id)
  return { ok: true, count: assets.length, file: { body, contentType: XLSX_CONTENT_TYPE, filename: batchExportFilename(batch.id, "xlsx") } }
}

export async function exportBatchAltText(q: BatchExportQuery, actor: HistoryActor): Promise<{ ok: true; file: BatchExportFile; count: number } | HistoryFailure> {
  const batch = await getBatch(q.batchId)
  // Unknown, foreign-tenant and out-of-scope batches are indistinguishable.
  if (!batch || !ownsBatch(actor, batch)) return fail(404, "NOT_FOUND", "Batch not found.")
  const scope = exportOwner(actor)
  if (!scope.ok) return fail(404, "NOT_FOUND", "Batch not found.")
  if (q.format === "xlsx") return exportBatchWorkbook(batch, scope.owner, actor)
  const format: ExportFormat = q.format

  const candidates = await countBatchExportRows(batch.id, scope.owner)
  if (candidates > BATCH_EXPORT_MAX_ROWS)
    return fail(413, "EXPORT_TOO_LARGE", `This batch has ${candidates} completed images; synchronous export supports up to ${BATCH_EXPORT_MAX_ROWS}.`)

  const records: BatchExportRecord[] = []
  let afterId = 0
  for (;;) {
    const page = await listBatchExportRows(batch.id, { afterId, limit: BATCH_EXPORT_CHUNK, owner: scope.owner })
    for (const a of page) if (isExportable(a)) records.push(toBatchExportRecord(batch, a))
    if (page.length < BATCH_EXPORT_CHUNK) break
    afterId = page[page.length - 1].id
    if (records.length > BATCH_EXPORT_MAX_ROWS) return fail(413, "EXPORT_TOO_LARGE", `Synchronous export supports up to ${BATCH_EXPORT_MAX_ROWS} images.`)
  }
  if (records.length === 0) return fail(409, "NO_EXPORTABLE_RECORDS", "This batch has no completed images with saved alt text to export.")

  const meta: BatchExportMeta = { id: batch.id, name: batch.name, exportedAt: new Date().toISOString(), totalExported: records.length }
  const body = BUILDERS[format](meta, records)
  // History is written only after the full file was generated.
  await recordExport(format, "batch", batch.projectId, records.length, actor.userId, null, batch.id)
  return { ok: true, count: records.length, file: { body, contentType: CONTENT_TYPES[format], filename: batchExportFilename(batch.id, format) } }
}
