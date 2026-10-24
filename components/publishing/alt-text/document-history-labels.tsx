"use client"

/**
 * @file components/publishing/alt-text/document-history-labels.tsx
 * @module Publishing · Alt Text
 * @kind Client UI helpers
 * @summary Phase 3 Task 19 — shared labels, tones and small presentational pieces for Document History.
 *   Every label maps a real persisted status; unknown values fall back to a neutral, honest label.
 */
import { toast } from "sonner"
import type { DocumentRecordProcessingStatus } from "@/lib/alt-text/document-records"
import type { DocumentSecurityStatus } from "@/lib/alt-text/document-upload-contract"
import type { HistoryOutputStatus, HistorySortKey } from "@/lib/alt-text/document-history-contract"
import { VALIDATION_LABELS } from "@/lib/alt-text/document-history-contract"
import type { OverallStatus } from "@/lib/alt-text/output-validation-contract"
import { downloadProtectedFile } from "@/lib/alt-text/client"
import { StatusBadge } from "./document-upload-status"

export type Tone = "neutral" | "info" | "success" | "warning" | "danger"

export const PROCESSING_LABELS: Record<DocumentRecordProcessingStatus, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "neutral" },
  extracting: { label: "Extracting", tone: "info" },
  extracted: { label: "Extracted", tone: "success" },
  partially_extracted: { label: "Partially extracted", tone: "warning" },
  unsupported: { label: "Unsupported", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
}

export const SECURITY_LABELS: Record<DocumentSecurityStatus, { label: string; tone: Tone }> = {
  scanning: { label: "Scanning", tone: "info" },
  clean: { label: "Clean", tone: "success" },
  held: { label: "Held for review", tone: "warning" },
  quarantined: { label: "Quarantined", tone: "danger" },
}

export const VALIDATION_TONE: Record<OverallStatus, Tone> = {
  passed: "success",
  passed_with_warnings: "warning",
  failed: "danger",
  not_verified: "neutral",
  manual_review_required: "warning",
}

export const OUTPUT_FILTER_LABELS: Record<HistoryOutputStatus, string> = {
  none: "No output",
  available: "Output available",
  passed: "Validation passed",
  warnings: "Passed with warnings",
  failed: "Validation failed",
  not_verified: "Not verified",
}

export const SORT_LABELS: Record<HistorySortKey, string> = {
  updated_desc: "Recently updated",
  created_desc: "Newest uploads",
  created_asc: "Oldest uploads",
  name_asc: "Name (A–Z)",
}

const GENERIC_STATUS: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "Queued", tone: "neutral" },
  pending: { label: "Pending", tone: "neutral" },
  processing: { label: "Processing", tone: "info" },
  running: { label: "Running", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  partially_completed: { label: "Partially completed", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  paused: { label: "Paused", tone: "neutral" },
  draft: { label: "Draft", tone: "neutral" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  needs_review: { label: "Needs review", tone: "warning" },
  in_review: { label: "In review", tone: "info" },
  changes_requested: { label: "Changes requested", tone: "warning" },
  not_reviewed: { label: "Not reviewed", tone: "neutral" },
  unreviewed: { label: "Not reviewed", tone: "neutral" },
}

const humanize = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())

export function GenericStatus({ status }: { status: string }) {
  const s = GENERIC_STATUS[status] ?? { label: humanize(status), tone: "neutral" as const }
  return <StatusBadge tone={s.tone} spinning={status === "processing" || status === "running"}>{s.label}</StatusBadge>
}

export function ValidationBadge({ status }: { status: OverallStatus | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">Not validated</span>
  return <StatusBadge tone={VALIDATION_TONE[status]}>{VALIDATION_LABELS[status]}</StatusBadge>
}

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })
export const fmtDateTime = (iso: string | null) => (iso ? dateTime.format(new Date(iso)) : "—")

export const fmtBytes = (bytes: number | null) =>
  bytes == null ? "—" : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`

export const actorLabel = (name: string | null, id?: number | null) => name ?? (id ? `User #${id}` : "Unknown user")

/** Downloads through the authorized route; reports success only when the server actually returned the file. */
export async function downloadWithToast(url: string, fallbackName: string) {
  const r = await downloadProtectedFile(url, fallbackName)
  if (!r.ok) toast.error("Download failed", { description: r.error.message })
  else toast.success(`Downloaded ${r.data.filename}`)
  return r.ok
}

export function Fact({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b py-2 last:border-0">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className={`min-w-0 text-right text-sm break-words text-foreground ${mono ? "font-mono text-xs" : ""}`}>{children}</dd>
    </div>
  )
}
