/**
 * @file components/publishing/conversion/pdf/pdf-workspace-config.ts
 * @module Publishing › Conversion › PDF
 * @kind Pure configuration
 * @summary Workspace contracts: workflow steps, local source-file model, settings groups and the optional-guidelines state.
 * @exports PDF_WORKFLOW_STEPS, PDF_SETTINGS_GROUPS, PDF_GUIDELINE_STATES, PDF_GUIDELINE_PRIORITY, PDF_SOURCE_EXTENSIONS,
 *   describeLocalFile, formatBytes, getTargetFormatOptions, getWorkflowStepState, nextWorkflowStep, resolveSettingsProfile,
 *   deriveGuidelineState
 * @see PDF_PHASE1_TASK2_UI_ARCHITECTURE.md §7
 *
 * Phase 1 Task 7 is a UI foundation. Nothing here talks to a server: files are held in browser memory only,
 * no step is ever reported as completed, and guideline states other than "not-provided" are contracts for Phase 6.
 */
import { deriveFormatAvailability, type PdfCapabilityStatus } from "@/components/publishing/conversion/pdf/pdf-capabilities"
import {
  assessGuidelineCompliance,
  GUIDELINE_PRIORITY_LEVELS,
  hasGuidelines,
  type GuidelineContext,
} from "@/lib/guidelines/guideline-contracts"

// ─── Workflow ────────────────────────────────────────────────────────────────

export type PdfWorkflowStepId = "upload" | "configure" | "guidelines" | "preview" | "validate" | "export"

/** Where the step's work happens in the workspace, used to move focus when a step is chosen. */
export type PdfWorkspaceRegion = "source" | "settings" | "guidelines" | "preview" | "processing"

/**
 * - ui-ready: the workspace UI for this step exists (local-only, no server processing).
 * - planned: the step's functionality arrives in a later phase.
 */
export type PdfWorkflowStepAvailability = "ui-ready" | "planned"

export type PdfWorkflowStep = {
  id: PdfWorkflowStepId
  label: string
  description: string
  optional: boolean
  availability: PdfWorkflowStepAvailability
  region: PdfWorkspaceRegion
}

export const PDF_WORKFLOW_STEPS: readonly PdfWorkflowStep[] = [
  { id: "upload", label: "Upload", description: "Add source documents", optional: false, availability: "ui-ready", region: "source" },
  { id: "configure", label: "Configure", description: "Choose target format and options", optional: false, availability: "ui-ready", region: "settings" },
  { id: "guidelines", label: "Guidelines", description: "Optional client instructions", optional: true, availability: "ui-ready", region: "guidelines" },
  { id: "preview", label: "Preview", description: "Review source and output", optional: false, availability: "planned", region: "preview" },
  { id: "validate", label: "Validate", description: "Quality and compliance checks", optional: false, availability: "planned", region: "processing" },
  { id: "export", label: "Export", description: "Download converted output", optional: false, availability: "planned", region: "processing" },
]

/** "completed" is intentionally absent: no processing exists, so no step can be reported as done. */
export type PdfWorkflowStepState = "current" | "upcoming" | "planned"

export function getWorkflowStepState(step: PdfWorkflowStep, currentStepId: PdfWorkflowStepId): PdfWorkflowStepState {
  if (step.id === currentStepId) return "current"
  return step.availability === "planned" ? "planned" : "upcoming"
}

/** Guidelines are optional, so moving on from Configure skips them unless the user opts in. */
export function nextWorkflowStep(currentStepId: PdfWorkflowStepId, { includeGuidelines = false } = {}): PdfWorkflowStepId | null {
  const index = PDF_WORKFLOW_STEPS.findIndex((step) => step.id === currentStepId)
  for (const step of PDF_WORKFLOW_STEPS.slice(index + 1)) {
    if (step.optional && !includeGuidelines) continue
    return step.id
  }
  return null
}

// ─── Source files (browser memory only) ─────────────────────────────────────

/** Extensions accepted by the PDF module's capability registry (PDF sources plus Documents-to-PDF inputs). */
export const PDF_SOURCE_EXTENSIONS = ["pdf", "docx", "xlsx", "pptx", "html", "htm", "xhtml", "xml", "jpg", "jpeg", "png", "tif", "tiff"] as const

export type PdfLocalFileIssue = "unsupported-type" | "empty-file" | "duplicate"

export const PDF_FILE_ISSUE_MESSAGES: Record<PdfLocalFileIssue, string> = {
  "unsupported-type": "This file type is not supported by the PDF module.",
  "empty-file": "This file is empty (0 bytes).",
  duplicate: "A file with the same name and size is already in the list.",
}

export type PdfLocalFile = {
  id: string
  name: string
  extension: string
  /** As reported by the browser; may be empty for unknown types. */
  mimeType: string
  sizeBytes: number
  lastModified: number
  issue: PdfLocalFileIssue | null
}

type FileLike = { name: string; type: string; size: number; lastModified: number }

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
}

/** Builds the metadata the browser actually exposes. Page count, dimensions etc. need a parser (Phase 3/4). */
export function describeLocalFile(file: FileLike, existing: readonly PdfLocalFile[], id: string): PdfLocalFile {
  const extension = fileExtension(file.name)
  let issue: PdfLocalFileIssue | null = null
  if (!(PDF_SOURCE_EXTENSIONS as readonly string[]).includes(extension)) issue = "unsupported-type"
  else if (file.size === 0) issue = "empty-file"
  else if (existing.some((f) => f.name === file.name && f.sizeBytes === file.size)) issue = "duplicate"
  return { id, name: file.name, extension, mimeType: file.type, sizeBytes: file.size, lastModified: file.lastModified, issue }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB"]
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`
}

// ─── Settings ───────────────────────────────────────────────────────────────

export type PdfSettingsGroupId = "input" | "output" | "preservation" | "advanced" | "guidelines"

export type PdfSettingsGroup = {
  id: PdfSettingsGroupId
  label: string
  /** Settings shown as planned rows; working controls are rendered separately by the panel. */
  plannedItems: readonly string[]
}

export const PDF_SETTINGS_GROUPS: readonly PdfSettingsGroup[] = [
  { id: "input", label: "Input Settings", plannedItems: ["Document Type", "Source Language", "Page Range", "Digital / Scanned Document"] },
  { id: "output", label: "Output Settings", plannedItems: ["Output Format Version", "Output Quality", "File Naming"] },
  {
    id: "preservation",
    label: "Content Preservation",
    plannedItems: ["Text Formatting", "Headings", "Images", "Tables", "Hyperlinks", "Bookmarks", "References", "Equations", "Document Structure"],
  },
  { id: "advanced", label: "Advanced Settings", plannedItems: ["OCR", "Layout Preservation", "Image Resolution", "Compression", "Metadata", "Structured Extraction"] },
  { id: "guidelines", label: "Client Guidelines", plannedItems: [] },
]

export const DEFAULT_EXPANDED_SETTINGS: readonly PdfSettingsGroupId[] = ["input", "output", "guidelines"]

export type PdfTargetFormatOption = { format: string; status: PdfCapabilityStatus }

/** Output formats from the capability registry; the panel shows each format's real status. */
export function getTargetFormatOptions(): PdfTargetFormatOption[] {
  return deriveFormatAvailability("output")
}

// ─── Optional guidelines ─────────────────────────────���──────────────────────

export type PdfGuidelineState =
  | "not-provided"
  | "profile-selected"
  | "pending-review"
  | "applied"
  | "conflict"
  | "unsupported"
  | "verification-pending"
  | "verified"

/** `tone` follows the shared status scale in pdf-status-model.ts. "not-provided" is neutral, never an error. */
export const PDF_GUIDELINE_STATES: Record<
  PdfGuidelineState,
  { label: string; description: string; tone: "neutral" | "info" | "success" | "warning" }
> = {
  "not-provided": { label: "Not provided", tone: "neutral", description: "Company guidelines are optional. Standard settings will be used." },
  "profile-selected": { label: "Guidelines selected", tone: "info", description: "A company guideline profile is selected for this job." },
  "pending-review": { label: "Pending review", tone: "info", description: "Guidelines were supplied and are awaiting review." },
  applied: { label: "Applied", tone: "info", description: "Applicable guideline rules are mapped to this job's settings. Output is not yet verified." },
  conflict: { label: "Conflict", tone: "warning", description: "Some guideline rules conflict and need review before processing." },
  unsupported: { label: "Unsupported", tone: "neutral", description: "Some requirements cannot be applied by this module. Standard settings cover the rest." },
  "verification-pending": { label: "Verification pending", tone: "info", description: "Output has not yet been verified against the guidelines." },
  verified: { label: "Verified", tone: "success", description: "Output was checked against each applicable guideline rule." },
}

/**
 * Highest priority first, from the shared contract. Safety constraints and mandatory technical requirements
 * sit above all of these.
 */
export const PDF_GUIDELINE_PRIORITY = GUIDELINE_PRIORITY_LEVELS

export const STANDARD_PROFILE = { id: "standard", label: "Standard Profile" } as const

/**
 * One-word summary of a job's guideline context for compact UI. It is derived from the separate document,
 * rule, application and verification records and never promotes a state: an upload alone stays
 * "pending-review", and "verified" requires an evidenced compliance verdict.
 */
export function deriveGuidelineState(context: GuidelineContext | null | undefined): PdfGuidelineState {
  if (!hasGuidelines(context)) return "not-provided"
  const { verdict, counts } = assessGuidelineCompliance(context)
  if (verdict === "compliant" || verdict === "compliant-with-exceptions") return "verified"
  if (counts && counts.unresolvedConflicts > 0) return "conflict"
  if (counts && counts.unsupported > 0 && verdict === "review-required") return "unsupported"
  const awaitingReview =
    verdict === "requirements-pending" ||
    (counts !== null && counts.pendingReview > 0) ||
    context.documents.some((d) => d.status === "uploaded" || d.status === "pending-review")
  if (awaitingReview) return "pending-review"
  if ((context.results ?? []).length > 0) return "verification-pending"
  if (counts && counts.applied > 0) return "applied"
  return "profile-selected"
}

/**
 * The settings profile in effect. Without guidelines the Standard Profile always applies, so processing
 * is never blocked on a guideline upload.
 */
export function resolveSettingsProfile(guidelineState: PdfGuidelineState, companyProfileLabel?: string) {
  if (guidelineState === "not-provided" || !companyProfileLabel) return { ...STANDARD_PROFILE, requiresGuidelines: false as const }
  return { id: "company", label: companyProfileLabel, requiresGuidelines: false as const }
}
