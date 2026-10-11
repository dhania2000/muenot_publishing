/**
 * @file lib/jobs/registry.ts
 * @module Platform Core
 * @kind Shared library (pure, no I/O)
 * @summary Central registry of reviewed background job types: category, risk,
 *          priority ceiling, retry defaults, manual-retry policy and retention
 *          class. Handlers live in lib/background-jobs.ts; this file is the
 *          single source of operational metadata for each type.
 * @exports JOB_REGISTRY, JobRegistryEntry, getJobDefinition, PRIORITY_CLASSES, priorityClass, clampPriority
 * @usedBy lib/background-jobs.ts, lib/job-manual-retry.ts, lib/background-job-view.ts
 * @see docs/background-jobs/04_JOB_REGISTRY.md
 */

export type JobCategory = "communication" | "data" | "automation" | "platform"
/**
 * low: re-running cannot duplicate an external or business effect.
 * business_mutation: resumable/idempotent store writes guarded by the owning service.
 * external_side_effect: a provider call (e.g. SMTP) whose outcome can be uncertain.
 */
export type JobRisk = "low" | "business_mutation" | "external_side_effect"
export type ManualRetryPolicy = "allowed" | "requires_acknowledgement" | "never"
export type RetentionClass = "standard" | "extended"

export type JobRegistryEntry = {
  type: string
  label: string
  category: JobCategory
  description: string
  risk: JobRisk
  defaultPriority: number
  /** Callers cannot raise a job above this; prevents marking everything critical. */
  maxPriority: number
  defaultMaxAttempts: number
  defaultTimeoutSeconds: number
  manualRetry: ManualRetryPolicy
  retention: RetentionClass
  /** Owning service that remains authoritative for business state. */
  owner: string
}

export const PRIORITY_CLASSES = {
  CRITICAL: 9,
  HIGH: 7,
  NORMAL: 5,
  LOW: 3,
  BACKGROUND: 1,
} as const
export type PriorityClass = keyof typeof PRIORITY_CLASSES

export function priorityClass(priority: number): PriorityClass {
  if (priority >= 9) return "CRITICAL"
  if (priority >= 7) return "HIGH"
  if (priority >= 5) return "NORMAL"
  if (priority >= 3) return "LOW"
  return "BACKGROUND"
}

/** Waiting jobs gain one priority step per interval so low classes never starve. */
export const PRIORITY_AGING_MINUTES = 15

export const JOB_REGISTRY = {
  "email.send": {
    type: "email.send",
    label: "Transactional email",
    category: "communication",
    description: "Sends one email through the tenant/department SMTP or user mailbox, updating the email ledger.",
    risk: "external_side_effect",
    defaultPriority: PRIORITY_CLASSES.NORMAL,
    // Password-reset and session-security mail is enqueued at CRITICAL by trusted server code.
    maxPriority: PRIORITY_CLASSES.CRITICAL,
    defaultMaxAttempts: 3,
    defaultTimeoutSeconds: 300,
    manualRetry: "requires_acknowledgement",
    retention: "standard",
    owner: "lib/email + lib/email-engine",
  },
  "bulk.action": {
    type: "bulk.action",
    label: "Bulk record action",
    category: "data",
    description: "Resumes a persisted bulk-action run; per-record progress is checkpointed by the run.",
    risk: "business_mutation",
    defaultPriority: PRIORITY_CLASSES.LOW,
    maxPriority: PRIORITY_CLASSES.NORMAL,
    defaultMaxAttempts: 3,
    defaultTimeoutSeconds: 900,
    manualRetry: "allowed",
    retention: "standard",
    owner: "lib/bulk-actions/service",
  },
  "tenant.scheduled_job": {
    type: "tenant.scheduled_job",
    label: "Tenant scheduled job",
    category: "automation",
    description: "Executes one occurrence of a tenant-configured scheduled job run.",
    risk: "business_mutation",
    defaultPriority: PRIORITY_CLASSES.NORMAL,
    maxPriority: PRIORITY_CLASSES.NORMAL,
    defaultMaxAttempts: 3,
    defaultTimeoutSeconds: 300,
    manualRetry: "requires_acknowledgement",
    retention: "extended",
    owner: "lib/tenant-jobs/store",
  },
  "data.import_batch": {
    type: "data.import_batch",
    label: "Data import batch",
    category: "data",
    description: "Processes a staged, tenant-scoped import batch with progress and row results.",
    risk: "business_mutation",
    defaultPriority: PRIORITY_CLASSES.BACKGROUND,
    maxPriority: PRIORITY_CLASSES.LOW,
    defaultMaxAttempts: 3,
    defaultTimeoutSeconds: 900,
    manualRetry: "requires_acknowledgement",
    retention: "extended",
    owner: "lib/data-import-batches-store",
  },
  "alt_text.batch_processing": {
    type: "alt_text.batch_processing",
    label: "Alt Text batch processing",
    category: "data",
    description: "Processes a submitted, tenant-scoped Alt Text batch. The payload carries only the batch id.",
    risk: "business_mutation",
    defaultPriority: PRIORITY_CLASSES.BACKGROUND,
    maxPriority: PRIORITY_CLASSES.LOW,
    defaultMaxAttempts: 5,
    defaultTimeoutSeconds: 900,
    manualRetry: "requires_acknowledgement",
    retention: "extended",
    owner: "lib/alt-text/batch-job",
  },
} as const satisfies Record<string, JobRegistryEntry>

export type RegisteredJobType = keyof typeof JOB_REGISTRY

export function getJobDefinition(type: string): JobRegistryEntry | null {
  return Object.prototype.hasOwnProperty.call(JOB_REGISTRY, type) ? JOB_REGISTRY[type as RegisteredJobType] : null
}

/** Default when omitted; never above the type's ceiling; 0..9 storage range. */
export function clampPriority(type: string, requested: number | null | undefined): number {
  const def = getJobDefinition(type)
  const fallback = def?.defaultPriority ?? PRIORITY_CLASSES.NORMAL
  const ceiling = def?.maxPriority ?? PRIORITY_CLASSES.NORMAL
  const value = requested == null || !Number.isFinite(Number(requested)) ? fallback : Math.floor(Number(requested))
  return Math.max(0, Math.min(ceiling, value))
}
