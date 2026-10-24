/**
 * @file lib/alt-text/docx-export-contract.ts
 * @module Publishing · Alt Text
 * @kind Shared contract (browser-safe, no I/O)
 * @summary Phase 3 Task 15 — request/response shapes for "Download Accessible Document" (DOCX).
 *   Policies:
 *   - strict         every mapped occurrence must be approved and insertable, otherwise no output
 *   - approved_only  insert approved occurrences; report everything skipped or unsupported
 */

export const DOCX_EXPORT_POLICIES = ["strict", "approved_only"] as const
export type DocxExportPolicy = (typeof DOCX_EXPORT_POLICIES)[number]

export const DOCX_EXPORT_POLICY_LABELS: Record<DocxExportPolicy, string> = {
  strict: "All mapped images must be approved",
  approved_only: "Insert approved images only",
}

export const ACCESSIBLE_EXPORT_FORMATS = ["docx", "pptx"] as const
export type AccessibleExportFormat = (typeof ACCESSIBLE_EXPORT_FORMATS)[number]

export const ACCESSIBLE_EXPORT_MIME: Record<AccessibleExportFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

export const isAccessibleExportFormat = (v: unknown): v is AccessibleExportFormat => typeof v === "string" && (ACCESSIBLE_EXPORT_FORMATS as readonly string[]).includes(v)

export type DocxExportRequest = { format: AccessibleExportFormat; policy: DocxExportPolicy; idempotencyKey: string; snapshot: string | null }

const KEY = /^[A-Za-z0-9_-]{8,64}$/
const HASH = /^[0-9a-f]{64}$/

export function parseDocxExportRequest(body: unknown): { ok: true; request: DocxExportRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "The request body must be a JSON object." }
  const b = body as Record<string, unknown>
  const allowed = new Set(["format", "policy", "idempotencyKey", "snapshot"])
  if (Object.keys(b).some((k) => !allowed.has(k))) return { ok: false, error: "The request contains unknown fields." }
  if (!isAccessibleExportFormat(b.format)) return { ok: false, error: "Only DOCX or PPTX output is supported." }
  if (typeof b.policy !== "string" || !(DOCX_EXPORT_POLICIES as readonly string[]).includes(b.policy)) return { ok: false, error: "Choose an export policy." }
  if (typeof b.idempotencyKey !== "string" || !KEY.test(b.idempotencyKey)) return { ok: false, error: "A valid idempotency key is required." }
  if (b.snapshot != null && (typeof b.snapshot !== "string" || !HASH.test(b.snapshot))) return { ok: false, error: "The approval snapshot is invalid." }
  return { ok: true, request: { format: b.format, policy: b.policy as DocxExportPolicy, idempotencyKey: b.idempotencyKey, snapshot: (b.snapshot as string | null) ?? null } }
}

export type DocxExportItemStatus = "updated" | "unchanged" | "skipped" | "unsupported" | "failed"

export type DocxExportItem = {
  occurrenceId: number
  status: DocxExportItemStatus
  code: string
  message: string
  region: "body" | "header" | "footer" | "footnotes" | "endnotes" | null
  placement: "inline" | "floating" | null
  decorative: boolean
  /** PPTX only. */
  slideNumber?: number | null
  /** PPTX only: the picture sits inside a group shape. */
  grouped?: boolean
}

export type DocxExportSummary = {
  updated: number
  unchanged: number
  skipped: number
  unsupported: number
  failed: number
  existingAltTextPreserved: number
  pictureCount: number
  uniqueMediaCount: number
  /** PPTX only. */
  slideCount?: number
  /** PPTX only. */
  groupedPictureCount?: number
  warnings: { code: string; message: string }[]
}

export type DocxExportStatus = "processing" | "completed" | "failed"

export type DocxExportRecord = {
  outputId: string
  format: AccessibleExportFormat
  status: DocxExportStatus
  policy: DocxExportPolicy
  filename: string
  sizeBytes: number | null
  updated: number
  skipped: number
  unsupported: number
  failed: number
  errorCode: string | null
  createdAt: string
  completedAt: string | null
  downloadUrl: string | null
}

export type DocxExportPreflight = {
  success: true
  documentId: number
  filename: string
  documentType: string
  supported: boolean
  unavailableReason: string | null
  snapshot: string
  totals: { occurrences: number; eligible: number; pendingReview: number; unmapped: number; blocked: number }
  plan: (DocxExportSummary & { items: DocxExportItem[] }) | null
  exports: DocxExportRecord[]
}

export type DocxExportResponse = { success: true; replayed: boolean; export: DocxExportRecord; summary: DocxExportSummary; items: DocxExportItem[] }

export const docxExportDownloadUrl = (documentId: number, outputId: string) => `/api/alt-text/documents/${documentId}/exports/${outputId}`
