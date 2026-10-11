/**
 * @file lib/alt-text/export.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Task 16: single-asset TXT / CSV / JSON download of the latest saved (generated or manually edited) version.
 * @usedBy app/api/alt-text/export/route.ts
 *
 * Reads only the persisted asset row (never client drafts). Record scope follows `publishing.alt_text:view`;
 * out-of-scope or other-tenant assets are reported as 404.
 */
import "server-only"
import { CLASSIFICATION_LABELS, LANGUAGES, toCsv, type ImageClassification } from "./core"
import { parseAssetId, toAssetView, withinScope, type HistoryActor, type HistoryFailure } from "./history"
import { getAsset, recordExport, type AssetRow } from "./store"

export const EXPORT_FORMATS = ["txt", "csv", "json"] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]
export type ExportQuery = { assetId: number; format: ExportFormat }
export type ExportFile = { body: string; contentType: string; filename: string }

const EXPORTABLE_STATUSES = new Set(["in_review", "approved", "rejected"])
const CONTENT_TYPES: Record<ExportFormat, string> = {
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
}

const fail = (status: number, code: string, error: string): HistoryFailure => ({ ok: false, status, code, error })

export function parseExportQuery(sp: URLSearchParams): { ok: true; value: ExportQuery } | HistoryFailure {
  const rawId = sp.get("assetId")
  const rawFormat = sp.get("format")
  if (!rawId || !rawFormat) return fail(400, "MISSING_PARAMETER", "assetId and format are required.")
  const assetId = parseAssetId(rawId)
  if (assetId == null) return fail(400, "INVALID_ID", "Invalid asset identifier.")
  const format = rawFormat.toLowerCase()
  if (!(EXPORT_FORMATS as readonly string[]).includes(format)) return fail(400, "INVALID_FORMAT", "format must be txt, csv or json.")
  return { ok: true, value: { assetId, format: format as ExportFormat } }
}

/** A saved result exists once generation/edit produced a classification; decorative assets legitimately have empty alt. */
export function isExportable(a: Pick<AssetRow, "status" | "classification" | "shortAlt" | "longDescription">): boolean {
  if (!EXPORTABLE_STATUSES.has(a.status) || !a.classification) return false
  return a.classification === "decorative" || a.shortAlt != null || a.longDescription != null
}

const classificationLabel = (c: string | null) => (c ? (CLASSIFICATION_LABELS[c as ImageClassification] ?? c) : null)
const languageLabel = (l: string) => LANGUAGES[l as keyof typeof LANGUAGES] ?? l
const NOT_AVAILABLE = "(not available)"

export function buildTxt(a: AssetRow): string {
  const section = (title: string, value: string) => `${title}\n${"-".repeat(title.length)}\n${value}`
  const shortAlt =
    a.classification === "decorative" && !a.shortAlt ? '(empty — decorative image, use alt="")' : a.shortAlt == null ? NOT_AVAILABLE : a.shortAlt || "(empty)"
  const parts = [
    section("Image Filename", a.fileName),
    section("Image Classification", classificationLabel(a.classification) ?? NOT_AVAILABLE),
    section("Output Language", languageLabel(a.language)),
    section("Short Alt Text", shortAlt),
    section("Detailed Description", a.longDescription || NOT_AVAILABLE),
  ]
  if (a.extractedText) parts.push(section("Extracted Visible Text", a.extractedText))
  if (a.warnings.length) parts.push(section("Review Warnings", a.warnings.map((w) => `- ${w}`).join("\n")))
  return `${parts.join("\n\n")}\n`
}

const CSV_COLUMNS = ["assetId", "fileName", "classification", "language", "shortAlt", "longDescription", "extractedText", "warnings", "updatedAt"] as const

export function buildCsv(a: AssetRow): string {
  const row = {
    assetId: a.id,
    fileName: a.fileName,
    classification: a.classification,
    language: a.language,
    shortAlt: a.shortAlt ?? "",
    longDescription: a.longDescription,
    extractedText: a.extractedText,
    warnings: a.warnings.join("\n"),
    updatedAt: a.updatedAt,
  }
  return toCsv([row], { bom: true, columns: CSV_COLUMNS })
}

export function buildJson(a: AssetRow): string {
  const v = toAssetView(a)
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      asset: {
        id: v.id,
        fileName: v.fileName,
        projectName: v.projectName,
        classification: v.classification,
        status: v.status,
        language: v.language,
        shortAlt: v.shortAlt,
        longDescription: v.longDescription,
        extractedText: v.extractedText,
        warnings: v.warnings,
        treatment: v.treatment,
        modelId: v.modelId,
        currentVersion: v.currentVersion,
        approvedAt: v.approvedAt,
        updatedAt: v.updatedAt,
      },
    },
    null,
    2,
  )
}

const BUILDERS: Record<ExportFormat, (a: AssetRow) => string> = { txt: buildTxt, csv: buildCsv, json: buildJson }

export async function exportAltText(q: ExportQuery, actor: HistoryActor): Promise<{ ok: true; file: ExportFile } | HistoryFailure> {
  const asset = await getAsset(q.assetId)
  if (!asset || !withinScope(actor.viewScope, actor.userId, asset)) return fail(404, "NOT_FOUND", "Asset not found.")
  if (!isExportable(asset)) return fail(409, "NOT_EXPORTABLE", "This asset has no saved alt text to export yet.")
  const { storageKey: _omit, ...row } = asset
  const body = BUILDERS[q.format](row)
  await recordExport(q.format, "single", asset.projectId, 1, actor.userId, asset.id)
  return { ok: true, file: { body, contentType: CONTENT_TYPES[q.format], filename: `alt-text-${asset.id}.${q.format}` } }
}
