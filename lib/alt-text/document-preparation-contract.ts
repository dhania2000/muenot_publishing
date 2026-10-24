/**
 * @file lib/alt-text/document-preparation-contract.ts
 * @module Publishing · Alt Text
 * @kind Shared contract (client-safe)
 * @summary Phase 3 Task 11 — durable document preparation state as exposed to the UI.
 *   Preparation (extraction → location mapping → context → AI readiness) is tracked separately
 *   from AI generation; completing preparation never implies any image was generated.
 */

export const PREPARATION_STAGES = ["queued", "extraction", "mapping", "context", "readiness", "ready", "failed", "cancelled"] as const
export type PreparationStage = (typeof PREPARATION_STAGES)[number]
export const isPreparationStage = (v: unknown): v is PreparationStage => typeof v === "string" && (PREPARATION_STAGES as readonly string[]).includes(v)

/** Ordered work stages; the worker resumes from the first one not yet completed. */
export const WORK_STAGES = ["extraction", "mapping", "context", "readiness"] as const
export type WorkStage = (typeof WORK_STAGES)[number]

export const PREPARATION_STAGE_LABEL: Record<PreparationStage, string> = {
  queued: "Queued",
  extraction: "Extracting images",
  mapping: "Mapping locations",
  context: "Preparing context",
  readiness: "Checking AI readiness",
  ready: "Ready for AI",
  failed: "Failed",
  cancelled: "Cancelled",
}

export type PreparationJobStatus = "queued" | "running" | "retrying" | "completed" | "failed" | "cancel_requested" | "cancelled"
export const TERMINAL_JOB_STATUSES: readonly PreparationJobStatus[] = ["completed", "failed", "cancelled"]
export const isTerminalJobStatus = (s: PreparationJobStatus | null | undefined) => s == null || TERMINAL_JOB_STATUSES.includes(s)

export const JOB_STATUS_LABEL: Record<PreparationJobStatus, string> = {
  queued: "Queued",
  running: "Running",
  retrying: "Retrying",
  completed: "Completed",
  failed: "Failed",
  cancel_requested: "Cancel requested",
  cancelled: "Cancelled",
}

/** Maps a Phase 2 queue row to the preparation job status shown to users. */
export function derivePreparationJobStatus(job: { status: string; attempts: number; cancelRequested: boolean }): PreparationJobStatus {
  if (job.status === "completed") return "completed"
  if (job.status === "cancelled") return "cancelled"
  if (job.status === "failed" || job.status === "dead_letter") return "failed"
  if (job.cancelRequested) return "cancel_requested"
  if (job.status === "running") return "running"
  return job.attempts > 0 ? "retrying" : "queued"
}

export type MappingCounts = { mapped: number; partial: number; unavailable: number }

export type PreparationCounts = {
  /** null until extraction has produced at least one persisted occurrence row. */
  totalKnown: number | null
  extracted: number
  failed: number
  unsupported: number
  /** null until the mapping stage has run for this document. */
  mapping: MappingCounts | null
  context: { ready: number; unavailable: number; failed: number; notAnalyzed: number }
}

export type AiGenerationStatus = {
  /** not_started: nothing selected+eligible; pending_generation: eligible selections await Task 12. */
  status: "not_started" | "pending_generation"
  /** Actual Alt Text asset statuses of selected occurrences (persisted; never inferred from preparation). */
  byAssetStatus: Record<string, number>
}

export type ReadinessSummary = {
  selected: number
  eligible: number
  ineligible: number
  /** Selected occurrences whose binary also backs another selected occurrence (kept as separate items). */
  sharedBinaryOccurrences: number
  preparedAt: string
}

export type DocumentPreparationProgress = {
  documentId: number
  jobId: number | null
  stage: PreparationStage | null
  jobStatus: PreparationJobStatus | null
  attempts: number
  maxAttempts: number
  errorCode: string | null
  counts: PreparationCounts
  readiness: ReadinessSummary | null
  aiGeneration: AiGenerationStatus
  startedAt: string | null
  updatedAt: string | null
  /** True while the job may still change state (the UI polls only then). */
  active: boolean
}
