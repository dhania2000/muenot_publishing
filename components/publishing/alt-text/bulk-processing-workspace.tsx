"use client"

/**
 * @file components/publishing/alt-text/bulk-processing-workspace.tsx
 * @module Publishing
 * @kind React client component
 * @summary Bulk Processing workspace: selection, upload, batch settings and "Start Processing",
 *   which creates the batch (POST /api/alt-text/batches, idempotency-keyed) and queues it
 *   (POST /api/alt-text/batches/[id]/submit), then opens the Batch Progress Dashboard.
 *   A created batch ID is kept on submit failure so retries never create a second batch.
 */
import { useMemo, useRef, useState } from "react"
import {
  AlertCircle,
  Ban,
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Eraser,
  FilePlus2,
  History,
  ImagePlus,
  Images,
  Layers,
  Loader2,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Upload,
} from "lucide-react"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { cn } from "@/lib/utils"
import { KpiStrip, StepNav, ToolbarDivider, Workbench, WorkbenchDrawer, WorkbenchScroll, WorkbenchToolbar, type StepItem } from "./workbench"
import { buildUploadedAssets, planBatchSubmission, type UploadEntry, type UploadStatus } from "@/lib/alt-text/bulk-upload"
import { createAltTextBatch, describeBatchError, newIdempotencyKey, submitAltTextBatch } from "@/lib/alt-text/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { useBulkUpload } from "./use-bulk-upload"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  BATCH_FIELD_LIMITS,
  EMPTY_BATCH_INFO,
  buildBatchConfiguration,
  overriddenFields,
  pruneOverrides,
  resolveEffectiveSettings,
  sameSettings,
  validateBatchInfo,
  type BatchInfo,
  type ImageOverride,
} from "@/lib/alt-text/batch-settings"
import { DESCRIPTION_MODES, GENERATION_IMAGE_TYPES, LANGUAGES, validateGenerationSettings } from "@/lib/alt-text/core"
import { ImageOverrideSheet } from "./image-override-sheet"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DEFAULT_GENERATION_SETTINGS, normalizeGenerationSettings, type GenerationSettings } from "@/lib/alt-text/core"
import type { AltTextAssetView } from "@/lib/alt-text/history"
import { BatchProgressDashboard, type BatchOpenRequest } from "./batch-progress-dashboard"
import { BatchHistory } from "./batch-history"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BulkImagePicker } from "./bulk-image-picker"
import { GenerationSettingsPanel } from "./generation-settings-panel"
import { useBulkImageQueue } from "./use-bulk-image-queue"

const TABLE_COLUMNS = ["Image Preview", "Filename", "Image Type", "Processing Status", "Short Alt Text Preview", "Actions"] as const
const ROW_LIMIT = 100
type WizardStep = "details" | "images" | "settings" | "review"
const WIZARD_STEPS: StepItem<WizardStep>[] = [
  { id: "details", label: "Details", icon: FilePlus2 },
  { id: "images", label: "Images", icon: ImagePlus },
  { id: "settings", label: "Settings", icon: SlidersHorizontal },
  { id: "review", label: "Review & Start", icon: ClipboardCheck },
]
type SubmissionPhase = "idle" | "creating" | "submitting" | "queued" | "error"
type SubmissionState = {
  phase: SubmissionPhase
  /** Reused while the payload fingerprint is unchanged so a lost create response replays instead of duplicating. */
  idempotencyKey: string | null
  fingerprint: string | null
  batchId: string | null
  error: string | null
  message: string | null
}
const IDLE_SUBMISSION: SubmissionState = { phase: "idle", idempotencyKey: null, fingerprint: null, batchId: null, error: null, message: null }

const UPLOAD_LABELS: Record<UploadStatus, string> = {
  ready: "Ready to upload",
  uploading: "Uploading",
  uploaded: "Uploaded",
  scan_pending: "Uploaded · scan pending",
  failed: "Upload failed",
  cancelled: "Cancelled",
}

function UploadStatusCell({ entry, onRetry }: { entry?: UploadEntry; onRetry?: () => void }) {
  if (!entry) return <span className="text-muted-foreground">Not started</span>
  const { uploadStatus: status } = entry
  const Icon =
    status === "uploading" ? Loader2 : status === "uploaded" || status === "scan_pending" ? CheckCircle2 : status === "failed" ? AlertCircle : null
  const tone =
    status === "failed" ? "text-destructive" : status === "uploaded" || status === "scan_pending" ? "text-foreground" : "text-muted-foreground"
  return (
    <div className="flex min-w-36 flex-col items-start gap-1">
      <span className={`flex items-center gap-1.5 whitespace-nowrap ${tone}`}>
        {Icon && <Icon className={`size-3.5 ${status === "uploading" ? "animate-spin" : ""}`} aria-hidden="true" />}
        {UPLOAD_LABELS[status]}
        {status === "uploading" && entry.attempts > 1 && <span className="text-xs text-muted-foreground">(attempt {entry.attempts})</span>}
      </span>
      {entry.error && <span className="max-w-56 text-xs text-muted-foreground">{entry.error}</span>}
      {(status === "failed" || status === "cancelled") && onRetry && (
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={onRetry}>
          <RotateCcw aria-hidden="true" /> Retry<span className="sr-only"> upload of {entry.filename}</span>
        </Button>
      )}
    </div>
  )
}

export function BulkProcessingWorkspace({
  onOpenInEditor,
  externalOpenRequest,
}: { onOpenInEditor?: (asset: AltTextAssetView) => void; externalOpenRequest?: BatchOpenRequest | null } = {}) {
  const [batchInfo, setBatchInfo] = useState<BatchInfo>(EMPTY_BATCH_INFO)
  const [nameTouched, setNameTouched] = useState(false)
  const [draftSettings, setDraftSettings] = useState<GenerationSettings>(DEFAULT_GENERATION_SETTINGS)
  const [batchDefaults, setBatchDefaults] = useState<GenerationSettings>(DEFAULT_GENERATION_SETTINGS)
  const [overrides, setOverrides] = useState<Record<string, ImageOverride>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [view, setView] = useState<"current" | "history">("current")
  const [openRequest, setOpenRequest] = useState<BatchOpenRequest | null>(null)
  const [mode, setMode] = useState<"draft" | "monitor">("draft")
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState<WizardStep>("details")
  const openBatch = (id: string) => {
    setOpenRequest((prev) => ({ id, nonce: (prev?.nonce ?? 0) + 1 }))
    setView("current")
    setMode("monitor")
    setWizardOpen(false)
  }
  const [handledExternal, setHandledExternal] = useState(0)
  if (externalOpenRequest && externalOpenRequest.nonce !== handledExternal) {
    setHandledExternal(externalOpenRequest.nonce)
    setOpenRequest((prev) => ({ id: externalOpenRequest.id, nonce: (prev?.nonce ?? 0) + 1 }))
    setView("current")
    setMode("monitor")
  }
  const imageQueue = useBulkImageQueue()
  const [trackedItems, setTrackedItems] = useState(imageQueue.items)
  if (trackedItems !== imageQueue.items) {
    setTrackedItems(imageQueue.items)
    setOverrides((current) => pruneOverrides(current, imageQueue.items.map((item) => item.id)))
  }

  const batchErrors = validateBatchInfo(batchInfo)
  const draftInvalid = Object.keys(validateGenerationSettings(draftSettings)).length > 0
  const hasUnappliedChanges = !sameSettings(draftSettings, batchDefaults)
  const validItems = useMemo(() => imageQueue.items.filter((item) => item.status === "valid"), [imageQueue.items])
  const overrideCount = validItems.filter((item) => overrides[item.id]).length
  /** Typed, JSON-safe configuration consumed by Task 7 batch submission. */
  const batchConfig = useMemo(
    () => buildBatchConfiguration(batchInfo, batchDefaults, validItems.map((item) => item.id), overrides),
    [batchInfo, batchDefaults, validItems, overrides],
  )
  const settingsSummary = [
    { label: "Valid images", value: validItems.length },
    { label: "Batch defaults", value: validItems.length - overrideCount },
    { label: "Custom settings", value: overrideCount },
    { label: "Output language", value: LANGUAGES[batchDefaults.outputLanguage] },
    { label: "Description mode", value: DESCRIPTION_MODES[batchDefaults.descriptionMode] },
  ]
  const upload = useBulkUpload(imageQueue.items)
  /** Server-confirmed assets with effective settings — the Task 7 submission input. */
  const uploadedAssets = useMemo(
    () => buildUploadedAssets(upload.entries, batchDefaults, overrides),
    [upload.entries, batchDefaults, overrides],
  )
  const canUpload = !upload.running && upload.summary.pending > 0
  const canRetryUploads = !upload.running && upload.summary.failed + upload.summary.cancelled > 0
  const uploadSummary = [
    { label: "Total", value: upload.summary.total },
    { label: "Uploaded", value: uploadedAssets.uploaded.length },
    { label: "Uploading", value: upload.summary.uploading },
    { label: "Pending", value: upload.summary.pending },
    { label: "Failed", value: upload.summary.failed + upload.summary.cancelled },
  ]
  const plan = useMemo(
    () => planBatchSubmission(validItems.map((item) => item.id), upload.entries, batchInfo, batchDefaults, overrides),
    [validItems, upload.entries, batchInfo, batchDefaults, overrides],
  )
  const [submission, setSubmission] = useState<SubmissionState>(IDLE_SUBMISSION)
  const inFlight = useRef(false)
  if (submission.phase === "queued" && plan.ok && plan.fingerprint !== submission.fingerprint) setSubmission(IDLE_SUBMISSION)
  const submitting = submission.phase === "creating" || submission.phase === "submitting"
  const pendingDraftId = submission.phase === "error" ? submission.batchId : null
  const startBlocker = pendingDraftId
    ? null
    : upload.running
      ? "Wait for uploads to finish before starting processing."
      : hasUnappliedChanges
        ? "Apply or discard your settings changes before starting processing."
        : plan.ok
          ? null
          : plan.reason
  const canStart = !submitting && submission.phase !== "queued" && !startBlocker

  const startProcessing = async () => {
    if (inFlight.current) return
    let batchId = pendingDraftId
    if (!batchId && !plan.ok) return
    inFlight.current = true
    try {
      if (!batchId && plan.ok) {
        const key = submission.idempotencyKey && submission.fingerprint === plan.fingerprint ? submission.idempotencyKey : newIdempotencyKey()
        setSubmission({ ...IDLE_SUBMISSION, phase: "creating", idempotencyKey: key, fingerprint: plan.fingerprint })
        const created = await createAltTextBatch(plan.payload, key)
        if (!created.ok) {
          setSubmission((s) => ({ ...s, phase: "error", error: describeBatchError(created.error) }))
          return
        }
        batchId = created.data.batch.id
      }
      if (!batchId) return
      const id = batchId
      setSubmission((s) => ({ ...s, phase: "submitting", batchId: id, error: null }))
      const queued = await submitAltTextBatch(id)
      if (!queued.ok && queued.error.code !== "BATCH_ALREADY_SUBMITTED") {
        setSubmission((s) => ({ ...s, phase: "error", error: describeBatchError(queued.error) }))
        return
      }
      setSubmission((s) => ({
        ...s,
        phase: "queued",
        error: null,
        message: queued.ok
          ? `${queued.data.acceptedImageCount} image${queued.data.acceptedImageCount === 1 ? "" : "s"} queued. ${queued.data.message}`
          : "This batch was already queued on the server.",
      }))
      openBatch(id)
    } finally {
      inFlight.current = false
    }
  }

  const startLabel =
    submission.phase === "creating"
      ? "Creating batch…"
      : submission.phase === "submitting"
        ? "Queuing batch…"
        : submission.phase === "queued"
          ? "Queued"
          : pendingDraftId
            ? "Retry Queuing"
            : "Start Processing"

  const editingItem = editingId ? validItems.find((item) => item.id === editingId) : undefined
  const visibleRows = validItems.slice(0, ROW_LIMIT)

  const saveOverride = (id: string, override: ImageOverride | null) =>
    setOverrides((current) => {
      const next = { ...current }
      if (override) next[id] = override
      else delete next[id]
      return next
    })

  const openWizard = (step: WizardStep) => {
    setWizardStep(step)
    setWizardOpen(true)
  }
  const applyDraftSettings = () => {
    const normalized = normalizeGenerationSettings(draftSettings)
    setBatchDefaults(normalized)
    setDraftSettings(normalized)
  }
  const wizardIndex = WIZARD_STEPS.findIndex((s) => s.id === wizardStep)
  const goNext = () => {
    if (wizardStep === "details") setNameTouched(true)
    if (wizardStep === "settings" && hasUnappliedChanges) {
      if (draftInvalid) return
      applyDraftSettings()
    }
    const next = WIZARD_STEPS[wizardIndex + 1]
    if (next) setWizardStep(next.id)
  }
  const nextBlocked = (wizardStep === "details" && Boolean(batchErrors.name)) || (wizardStep === "settings" && draftInvalid)
  const batchStatus = submission.phase === "queued" ? "Queued" : pendingDraftId ? "Draft saved" : batchConfig.isValid && plan.ok ? "Ready" : "Draft"

  const startButton = (
    <Button size="sm" onClick={startProcessing} disabled={!canStart} aria-busy={submitting || undefined} aria-describedby="bulk-start-status">
      {submitting ? (
        <Loader2 className="animate-spin" aria-hidden="true" />
      ) : submission.phase === "queued" ? (
        <CheckCircle2 aria-hidden="true" />
      ) : pendingDraftId ? (
        <RotateCcw aria-hidden="true" />
      ) : (
        <Play aria-hidden="true" />
      )}
      {startLabel}
    </Button>
  )

  const uploadActions = (
    <>
      <Button size="sm" variant={canUpload ? "default" : "outline"} onClick={upload.start} disabled={!canUpload}>
        <Upload aria-hidden="true" /> {upload.running ? "Uploading…" : "Upload Images"}
      </Button>
      <Button size="sm" variant="outline" onClick={() => upload.retry()} disabled={!canRetryUploads}>
        <RotateCcw aria-hidden="true" /> Retry Failed
      </Button>
      <Button size="sm" variant="outline" onClick={upload.cancel} disabled={!upload.running}>
        <Ban aria-hidden="true" /> Cancel Upload
      </Button>
    </>
  )

  const submissionStatus = (
    <div id="bulk-start-status" aria-live="polite">
      {submission.phase === "error" && submission.error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>{pendingDraftId ? "Batch created but not queued" : "Batch could not be created"}</AlertTitle>
          <AlertDescription>
            <p>{submission.error}</p>
            {pendingDraftId && (
              <p>
                Draft batch <span className="font-mono text-xs">{pendingDraftId}</span> is saved. Retry Queuing submits this same batch without
                creating another one.
              </p>
            )}
          </AlertDescription>
        </Alert>
      ) : submission.phase === "queued" && submission.batchId ? (
        <Alert>
          <CheckCircle2 aria-hidden="true" />
          <AlertTitle>Batch queued</AlertTitle>
          <AlertDescription>
            <p>{submission.message}</p>
            <Button size="sm" variant="outline" className="mt-1" onClick={() => submission.batchId && openBatch(submission.batchId)}>
              View Progress
            </Button>
          </AlertDescription>
        </Alert>
      ) : submitting ? (
        <p className="text-xs text-muted-foreground">
          {submission.phase === "creating" ? "Creating the batch on the server…" : "Submitting the batch to the processing queue…"}
        </p>
      ) : startBlocker ? (
        <p className="text-xs text-muted-foreground">{startBlocker}</p>
      ) : null}
    </div>
  )

  const viewSwitcher = (
    <TabsList className="h-8" aria-label="Bulk processing views">
      <TabsTrigger value="current" className="gap-1.5 px-2.5 text-xs">
        <Layers aria-hidden="true" /> Current Batch
      </TabsTrigger>
      <TabsTrigger value="history" className="gap-1.5 px-2.5 text-xs">
        <History aria-hidden="true" /> Batch History
      </TabsTrigger>
    </TabsList>
  )

  return (
    <Tabs value={view} onValueChange={(v) => setView(v as "current" | "history")} className="flex min-w-0 flex-col gap-3 lg:h-full lg:min-h-0">
      {/* Kept mounted so unsaved batch settings, uploads and the open dashboard survive view switches. */}
      <TabsContent value="current" keepMounted hidden={view !== "current"} className="mt-0 min-w-0 lg:min-h-0 lg:flex-1">
        <Workbench>
          <WorkbenchToolbar
            label="Batch toolbar"
            title={viewSwitcher}
            meta={
              <div className="flex shrink-0 items-center gap-1 rounded-md border bg-muted/40 p-0.5" role="group" aria-label="Batch workspace mode">
                {(
                  [
                    ["draft", "Prepare"],
                    ["monitor", "Monitor"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={mode === value}
                    onClick={() => setMode(value)}
                    className={cn(
                      "rounded px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      mode === value ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            }
          >
            {mode === "draft" ? (
              <>
                <span className="hidden max-w-48 truncate text-sm font-medium 2xl:inline" title={batchInfo.name || "Untitled batch"}>
                  {batchInfo.name || "Untitled batch"}
                </span>
                <Badge variant={batchStatus === "Ready" || batchStatus === "Queued" ? "secondary" : "outline"}>{batchStatus}</Badge>
                <ToolbarDivider />
                <Button size="sm" variant="outline" onClick={() => openWizard("details")}>
                  <FilePlus2 aria-hidden="true" /> Batch Setup
                </Button>
                <Button size="sm" variant="outline" onClick={() => openWizard("images")}>
                  <ImagePlus aria-hidden="true" /> Add Images
                </Button>
                <Button size="sm" variant="outline" onClick={() => openWizard("settings")}>
                  <SlidersHorizontal aria-hidden="true" /> Common Settings
                  {hasUnappliedChanges && <span className="size-1.5 rounded-full bg-primary" aria-label="Unapplied changes" />}
                </Button>
                <ToolbarDivider />
                {startButton}
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setMode("draft")}>
                <FilePlus2 aria-hidden="true" /> Back to Draft
              </Button>
            )}
          </WorkbenchToolbar>

          <div hidden={mode !== "monitor"} className="min-w-0 lg:min-h-0 lg:flex-1">
            <WorkbenchScroll label="Batch progress" className="lg:h-full">
              <BatchProgressDashboard onOpenInEditor={onOpenInEditor} openRequest={openRequest} />
            </WorkbenchScroll>
          </div>

          <div hidden={mode !== "draft"} className="flex min-w-0 flex-col gap-3 lg:min-h-0 lg:flex-1">
            <div className="flex min-w-0 shrink-0 flex-col gap-2 rounded-lg border bg-card px-3 py-2">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <KpiStrip
                  items={[
                    { label: "Images", value: validItems.length },
                    { label: "Uploaded", value: uploadedAssets.uploaded.length, tone: "success" },
                    { label: "Uploading", value: upload.summary.uploading },
                    { label: "Pending", value: upload.summary.pending },
                    {
                      label: "Failed",
                      value: upload.summary.failed + upload.summary.cancelled,
                      tone: upload.summary.failed + upload.summary.cancelled ? "danger" : "default",
                    },
                    { label: "Custom settings", value: overrideCount },
                    { label: "Language", value: LANGUAGES[batchDefaults.outputLanguage] },
                  ]}
                />
                <div className="flex flex-wrap gap-2" role="group" aria-label="Upload actions">
                  {uploadActions}
                </div>
              </div>
              {upload.summary.total > 0 && (
                <Progress
                  value={(uploadedAssets.uploaded.length / upload.summary.total) * 100}
                  className="h-1.5"
                  aria-label={`${uploadedAssets.uploaded.length} of ${upload.summary.total} images uploaded`}
                />
              )}
              {uploadedAssets.awaitingScan.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {uploadedAssets.awaitingScan.length} uploaded image{uploadedAssets.awaitingScan.length === 1 ? " is" : "s are"} awaiting the security
                  scan before AI processing.
                </p>
              )}
              {submissionStatus}
            </div>

            <WorkbenchScroll label="Batch images" className="rounded-lg border bg-card">
              {visibleRows.length === 0 ? (
                <Empty className="py-12">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Images aria-hidden="true" />
                    </EmptyMedia>
                    <EmptyTitle>No images in this batch</EmptyTitle>
                    <EmptyDescription>Set up the batch and add images. Valid images appear here once validation finishes.</EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button size="sm" onClick={() => openWizard(batchInfo.name ? "images" : "details")}>
                      <FilePlus2 aria-hidden="true" /> {batchInfo.name ? "Add Images" : "Create Batch"}
                    </Button>
                  </EmptyContent>
                </Empty>
              ) : (
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                      {TABLE_COLUMNS.map((c) => (
                        <TableHead key={c} className="whitespace-nowrap">
                          {c}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleRows.map((item) => {
                      const fields = overriddenFields(overrides[item.id])
                      const effective = resolveEffectiveSettings(batchDefaults, overrides[item.id])
                      return (
                        <TableRow key={item.id}>
                          <TableCell>
                            {/* eslint-disable-next-line @next/next/no-img-element -- local blob: preview */}
                            <img src={item.previewUrl} alt="" loading="lazy" decoding="async" className="size-10 rounded object-cover" />
                          </TableCell>
                          <TableCell className="max-w-48 truncate text-sm" title={item.name}>
                            {item.name}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">
                            <div className="flex flex-col items-start gap-1">
                              <span>{GENERATION_IMAGE_TYPES[effective.imageType]}</span>
                              {fields.length > 0 ? (
                                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]" title={`Overrides: ${fields.join(", ")}`}>
                                  Custom Settings
                                  <span className="sr-only"> ({fields.length} field{fields.length === 1 ? "" : "s"} overridden)</span>
                                </Badge>
                              ) : (
                                <span className="text-[11px] text-muted-foreground">Batch Defaults</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">
                            <UploadStatusCell entry={upload.byId.get(item.id)} onRetry={upload.running ? undefined : () => upload.retry([item.id])} />
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">—</TableCell>
                          <TableCell>
                            <Button size="sm" variant="outline" onClick={() => setEditingId(item.id)}>
                              <SlidersHorizontal aria-hidden="true" /> Edit AI Settings
                              <span className="sr-only"> for {item.name}</span>
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
              {validItems.length > ROW_LIMIT && (
                <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                  Showing first {ROW_LIMIT} of {validItems.length} valid images.
                </p>
              )}
            </WorkbenchScroll>
          </div>
        </Workbench>

        <ImageOverrideSheet
          target={editingItem ? { id: editingItem.id, name: editingItem.name, override: overrides[editingItem.id] } : null}
          defaults={batchDefaults}
          onSave={saveOverride}
          onClose={() => setEditingId(null)}
        />

        <WorkbenchDrawer
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          size="xl"
          title="Batch Setup"
          description="Everything you enter is kept while this page is open, even if you close this panel."
          footer={
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <Button size="sm" variant="ghost" onClick={() => setWizardStep(WIZARD_STEPS[Math.max(0, wizardIndex - 1)].id)} disabled={wizardIndex === 0}>
                <ChevronLeft aria-hidden="true" /> Back
              </Button>
              {wizardStep === "review" ? (
                startButton
              ) : (
                <Button size="sm" onClick={goNext} disabled={nextBlocked}>
                  {wizardStep === "settings" && hasUnappliedChanges ? "Apply & Continue" : "Continue"} <ChevronRight aria-hidden="true" />
                </Button>
              )}
            </div>
          }
        >
          <div className="flex flex-col gap-5">
            <StepNav label="Batch setup steps" steps={WIZARD_STEPS} value={wizardStep} onChange={setWizardStep} />

            {wizardStep === "details" && (
              <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))]">
                <div className="col-span-full flex flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <Label htmlFor="bulk-batch-name">
                      Batch name <span className="text-destructive" aria-hidden="true">*</span>
                    </Label>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {batchInfo.name.length} / {BATCH_FIELD_LIMITS.name}
                    </span>
                  </div>
                  <Input
                    id="bulk-batch-name"
                    required
                    value={batchInfo.name}
                    onChange={(e) => setBatchInfo((b) => ({ ...b, name: e.target.value }))}
                    onBlur={() => setNameTouched(true)}
                    placeholder="e.g. Biology Class 10 — Chapter 6"
                    maxLength={BATCH_FIELD_LIMITS.name}
                    aria-invalid={nameTouched && batchErrors.name ? true : undefined}
                    aria-describedby={nameTouched && batchErrors.name ? "bulk-batch-name-error" : undefined}
                  />
                  {nameTouched && batchErrors.name && (
                    <p id="bulk-batch-name-error" className="text-xs text-destructive">
                      {batchErrors.name}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="bulk-project">
                    Project <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Select disabled>
                    <SelectTrigger id="bulk-project" className="w-full" aria-describedby="bulk-project-hint">
                      <SelectValue placeholder="Unavailable" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No projects</SelectItem>
                    </SelectContent>
                  </Select>
                  <p id="bulk-project-hint" className="text-xs text-muted-foreground">
                    Project selection becomes available once an Alt Text projects endpoint is published.
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="bulk-model">AI model</Label>
                  <Select disabled>
                    <SelectTrigger id="bulk-model" className="w-full">
                      <SelectValue placeholder="Workspace default" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Workspace default</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-full flex flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <Label htmlFor="bulk-batch-description">
                      Description <span className="font-normal text-muted-foreground">(optional)</span>
                    </Label>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {batchInfo.description.length} / {BATCH_FIELD_LIMITS.description}
                    </span>
                  </div>
                  <Textarea
                    id="bulk-batch-description"
                    rows={3}
                    value={batchInfo.description}
                    onChange={(e) => setBatchInfo((b) => ({ ...b, description: e.target.value }))}
                    maxLength={BATCH_FIELD_LIMITS.description}
                    placeholder="Notes for reviewers about this batch."
                  />
                </div>
              </div>
            )}

            {wizardStep === "images" && (
              <div className="flex flex-col gap-4">
                <BulkImagePicker queue={imageQueue} />
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
                  <KpiStrip
                    items={[
                      { label: "Valid", value: validItems.length },
                      { label: "Uploaded", value: uploadedAssets.uploaded.length, tone: "success" },
                      { label: "Pending", value: upload.summary.pending },
                    ]}
                  />
                  <div className="flex flex-wrap gap-2">{uploadActions}</div>
                </div>
              </div>
            )}

            {wizardStep === "settings" && (
              <div className="flex flex-col gap-4">
                <GenerationSettingsPanel
                  bare
                  settings={draftSettings}
                  onChange={setDraftSettings}
                  description="Defaults for every image in this batch. Per-image overrides take precedence."
                />
                <div className="flex flex-col gap-3 border-t pt-4">
                  <p className="text-xs text-muted-foreground" aria-live="polite">
                    {draftInvalid
                      ? "Fix the highlighted settings before applying them."
                      : hasUnappliedChanges
                        ? "You have changes that are not applied to the images yet."
                        : `Applied to ${validItems.length} image${validItems.length === 1 ? "" : "s"}${overrideCount ? ` · ${overrideCount} with overrides` : ""}.`}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={applyDraftSettings} disabled={!hasUnappliedChanges || draftInvalid}>
                      <CheckCheck aria-hidden="true" /> Apply to All Images
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setDraftSettings(batchDefaults)} disabled={!hasUnappliedChanges}>
                      Discard Changes
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button type="button" size="sm" variant="outline" disabled={overrideCount === 0}>
                          <Eraser aria-hidden="true" /> Clear All Overrides
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Clear overrides on {overrideCount} images?</AlertDialogTitle>
                          <AlertDialogDescription>These images will go back to using the batch defaults. The images themselves are not changed.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => setOverrides({})}>Clear Overrides</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </div>
            )}

            {wizardStep === "review" && (
              <div className="flex flex-col gap-4">
                <dl className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(min(100%,10rem),1fr))]">
                  {[{ label: "Batch name", value: batchInfo.name || "—" }, ...settingsSummary, ...uploadSummary.slice(1)].map(({ label, value }) => (
                    <div key={label} className="min-w-0 rounded-md border px-3 py-2">
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="truncate text-sm font-semibold tabular-nums" title={String(value)}>
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={batchConfig.isValid ? "secondary" : "outline"}>{batchConfig.isValid ? "Configuration valid" : "Not ready"}</Badge>
                  {!batchConfig.isValid && (
                    <span className="text-xs text-muted-foreground">
                      {validItems.length === 0
                        ? "Add at least one valid image."
                        : batchConfig.errors.batch.name ?? batchConfig.errors.batch.description ?? "Some image settings need attention."}
                    </span>
                  )}
                </div>
                {canUpload && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
                    <p className="text-xs text-muted-foreground">
                      {upload.summary.pending} image{upload.summary.pending === 1 ? "" : "s"} still need to be uploaded.
                    </p>
                    <Button size="sm" variant="outline" onClick={upload.start}>
                      <Upload aria-hidden="true" /> Upload Images
                    </Button>
                  </div>
                )}
                {submissionStatus}
              </div>
            )}
          </div>
        </WorkbenchDrawer>
      </TabsContent>

      <TabsContent value="history" className="mt-0 min-w-0 lg:min-h-0 lg:flex-1">
        <Workbench>
          <WorkbenchToolbar label="Batch history toolbar" title={viewSwitcher} />
          <WorkbenchScroll label="Batch history">
            <BatchHistory onOpenBatch={openBatch} />
          </WorkbenchScroll>
        </Workbench>
      </TabsContent>
    </Tabs>
  )
}
