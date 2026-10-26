import "server-only"
import { query } from "@/lib/db"
import { currentTenantId } from "@/lib/tenant-scope"
import { ensurePageOcrSchema } from "./pdf-page-ocr-store"
import type { ContextEvidence } from "./document-context"

/** Used only by explicit context analysis. Never updates an approved context or starts OCR. */
export async function addPageOcrEvidence(documentId: number, pageNumber: number, existing: ContextEvidence): Promise<ContextEvidence> {
  await ensurePageOcrSchema()
  const rows = await query<any[]>(`SELECT evidence_json, JSON_UNQUOTE(JSON_EXTRACT(result_json,'$.normalizedText')) AS text,
    JSON_UNQUOTE(JSON_EXTRACT(result_json,'$.languageMode')) AS language,
    JSON_EXTRACT(result_json,'$.warnings') AS warnings,
    JSON_UNQUOTE(JSON_EXTRACT(result_json,'$.identity')) AS identity
    FROM alt_text_document_page_ocr WHERE tenant_id=? AND document_id=? AND page_index=?
      AND result_json IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(result_json,'$.status')) IN ('completed','completed_with_warnings') LIMIT 1`,
    [currentTenantId(), documentId, pageNumber - 1])
  const row = rows[0]
  if (!row?.text) return existing
  const data = typeof row.evidence_json === "string" ? JSON.parse(row.evidence_json) : row.evidence_json
  // A meaningful native layer wins; uncertain OCR never silently replaces or duplicates it.
  if (data.evidence.textChars >= 40) return existing
  const warnings = typeof row.warnings === "string" ? JSON.parse(row.warnings) : row.warnings
  return { ...existing, nearby: [...(existing.nearby ?? []), { text: String(row.text).slice(0,1200), provenance: "approximate",
    source: { kind: "ocr_page_text", ref: `pdf:p${pageNumber}:ocr:${row.identity}` }, method: `page_ocr_${row.language}`, relation: "same_page", distance: 1000 }],
    warnings: [...(existing.warnings ?? []), { code: "READING_ORDER_UNVERIFIED", message: `Page ${pageNumber} OCR (${row.language}) is unverified source evidence; reading order was not reconstructed.` },
      ...(Array.isArray(warnings) ? warnings.slice(0,8).map((w: string) => ({ code: "TEXT_UNREADABLE" as const, message: `Page OCR: ${String(w).slice(0,300)}` })) : [])] }
}
