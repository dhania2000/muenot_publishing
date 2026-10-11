import "server-only"
import { query } from "@/lib/db"
import { currentTenantId } from "@/lib/tenant-scope"
import type { FileObject } from "./file-metadata"

export type ScanStatus = "pending" | "scanning" | "clean" | "infected" | "error"
export type SafetyStatus = "safe" | "unsafe" | "unknown"
export type QuarantineStatus = "none" | "quarantined" | "released"
export type ScanFinding = { rule: string; detail?: string }

export type ScanRecord = {
  id: number
  fileId: number
  fileRef: string | null
  objectKey: string
  scanStatus: ScanStatus
  safety: SafetyStatus
  quarantineStatus: QuarantineStatus
  provider: string | null
  findings: ScanFinding[]
  detail: string | null
  attempts: number
  approved: boolean
  approvedBy: number | null
  approvedAt: string | null
  requestedBy: number | null
  scannedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type DownloadGatePolicy = { blockUntilClean: boolean; failureMode: "fail_closed" | "fail_open" }
export type DownloadDecision = { allowed: boolean; reason: string }

export function downloadGatePolicyFor(file: Pick<FileObject, "classification">): DownloadGatePolicy {
  if (file.classification === "public") return { blockUntilClean: false, failureMode: "fail_open" }
  return { blockUntilClean: true, failureMode: "fail_closed" }
}

export function canDownload(state: { scanStatus: ScanStatus; approved: boolean }, policy: DownloadGatePolicy): DownloadDecision {
  if (state.scanStatus === "infected") return { allowed: false, reason: "File is infected and permanently blocked" }
  if (state.scanStatus === "clean") return { allowed: true, reason: "Clean" }
  if (state.approved) return { allowed: true, reason: "Released by administrator" }
  if (!policy.blockUntilClean) return { allowed: true, reason: "Downloads are not gated for this file" }
  if (state.scanStatus === "error" && policy.failureMode === "fail_open") return { allowed: true, reason: "Scan unavailable; allowed by fail-open policy" }
  return { allowed: false, reason: "Awaiting security scan" }
}

const SAFETY: Record<ScanStatus, SafetyStatus> = { clean: "safe", infected: "unsafe", pending: "unknown", scanning: "unknown", error: "unknown" }
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))

export async function getScanForFile(fileId: number): Promise<ScanRecord | null> {
  const rows = await query<any[]>(
    "SELECT id, file_ref, object_key, scan_status, created_at, updated_at FROM app_files WHERE tenant_id = ? AND id = ? LIMIT 1",
    [currentTenantId(), fileId],
  )
  const r = rows[0]
  if (!r) return null
  const scanStatus = r.scan_status as ScanStatus
  return {
    id: Number(r.id), fileId: Number(r.id), fileRef: r.file_ref, objectKey: r.object_key, scanStatus, safety: SAFETY[scanStatus],
    quarantineStatus: scanStatus === "infected" ? "quarantined" : "none", provider: "signature", findings: [], detail: null, attempts: 1,
    approved: false, approvedBy: null, approvedAt: null, requestedBy: null, scannedAt: iso(r.created_at), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  }
}
