"use client"

/**
 * @file components/publishing/alt-text/document-preparation-status.tsx
 * @module Publishing
 * @kind React client component
 * @summary Phase 3 Task 11 — shows durable document preparation progress (stage, job status, attempts,
 *   counts, AI readiness) separately from AI generation status. Never implies images were generated.
 */
import { AlertTriangle, Check, Circle, Loader2, X } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  JOB_STATUS_LABEL,
  PREPARATION_STAGE_LABEL,
  WORK_STAGES,
  type DocumentPreparationProgress,
  type WorkStage,
} from "@/lib/alt-text/document-preparation-contract"
import { cn } from "@/lib/utils"

type StepState = "done" | "current" | "pending" | "failed"

function stepState(p: DocumentPreparationProgress, step: WorkStage): StepState {
  if (p.stage === "ready") return "done"
  const idx = WORK_STAGES.indexOf(step)
  const cur = p.stage && (WORK_STAGES as readonly string[]).includes(p.stage) ? WORK_STAGES.indexOf(p.stage as WorkStage) : -1
  if (cur === -1) return "pending"
  if (idx < cur) return "done"
  if (idx > cur) return "pending"
  if (p.jobStatus === "failed") return "failed"
  return p.active ? "current" : "pending"
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "done") return <Check className="size-3.5" aria-hidden="true" />
  if (state === "current") return <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
  if (state === "failed") return <X className="size-3.5" aria-hidden="true" />
  return <Circle className="size-3" aria-hidden="true" />
}

const STEP_STYLE: Record<StepState, string> = {
  done: "border-primary bg-primary text-primary-foreground",
  current: "border-primary text-primary",
  failed: "border-destructive bg-destructive text-white",
  pending: "border-border text-muted-foreground",
}

const STEP_TEXT: Record<StepState, string> = { done: "completed", current: "in progress", failed: "failed", pending: "not started" }

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  )
}

export function DocumentPreparationStatus({
  preparation: p,
  stale,
  cancelling,
  onCancel,
}: {
  preparation: DocumentPreparationProgress
  stale: boolean
  cancelling: boolean
  onCancel: () => void
}) {
  if (!p.jobId && !p.stage) return null
  const c = p.counts
  const statusVariant = p.jobStatus === "failed" ? "destructive" : p.jobStatus === "completed" ? "default" : "secondary"
  const canCancel = p.active && p.jobStatus !== "cancel_requested"
  const generated = Object.entries(p.aiGeneration.byAssetStatus).filter(([, n]) => n > 0)

  return (
    <section aria-labelledby="prep-heading" className="flex flex-col gap-4 rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="prep-heading" className="text-sm font-semibold text-foreground">
            Document preparation
          </h3>
          {p.jobStatus && <Badge variant={statusVariant}>{JOB_STATUS_LABEL[p.jobStatus]}</Badge>}
          {p.stage && <span className="text-xs text-muted-foreground">{PREPARATION_STAGE_LABEL[p.stage]}</span>}
          {p.attempts > 1 && <span className="text-xs text-muted-foreground">{`Attempt ${p.attempts} of ${p.maxAttempts}`}</span>}
        </div>
        {canCancel && (
          <Button size="sm" variant="outline" onClick={onCancel} disabled={cancelling}>
            {cancelling && <Loader2 className="animate-spin" aria-hidden="true" />}
            Cancel processing
          </Button>
        )}
      </div>

      <ol className="flex flex-col gap-2 sm:flex-row sm:gap-4" aria-label="Preparation stages">
        {WORK_STAGES.map((s) => {
          const state = stepState(p, s)
          return (
            <li key={s} className="flex items-center gap-2" aria-current={state === "current" ? "step" : undefined}>
              <span className={cn("flex size-6 items-center justify-center rounded-full border", STEP_STYLE[state])}>
                <StepIcon state={state} />
              </span>
              <span className={cn("text-sm", state === "pending" ? "text-muted-foreground" : "text-foreground")}>{PREPARATION_STAGE_LABEL[s]}</span>
              <span className="sr-only">{`, ${STEP_TEXT[state]}`}</span>
            </li>
          )
        })}
      </ol>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Image occurrences" value={c.totalKnown ?? "—"} />
        <Stat label="Extracted" value={c.extracted} />
        <Stat label="Failed / unsupported" value={c.failed + c.unsupported} />
        <Stat label="Locations mapped" value={c.mapping ? `${c.mapping.mapped + c.mapping.partial} / ${c.mapping.mapped + c.mapping.partial + c.mapping.unavailable}` : "—"} />
        <Stat label="Context ready" value={c.context.ready} />
        <Stat label="Context unavailable" value={c.context.unavailable + c.context.failed} />
        <Stat label="Selected for AI" value={p.readiness?.selected ?? "—"} />
        <Stat label="Eligible for AI" value={p.readiness?.eligible ?? "—"} />
      </dl>

      <p className="text-xs text-muted-foreground">
        {p.aiGeneration.status === "pending_generation"
          ? "AI generation has not run. Selected images are prepared and waiting for generation."
          : "AI generation has not run. Select eligible images to prepare them for generation."}
        {generated.length > 0 && ` Asset statuses: ${generated.map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`).join(", ")}.`}
      </p>

      {p.jobStatus === "failed" && (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>Processing failed</AlertTitle>
          <AlertDescription>{`Stopped during ${p.stage ? PREPARATION_STAGE_LABEL[p.stage].toLowerCase() : "processing"}${p.errorCode ? ` (${p.errorCode})` : ""}. You can start processing again.`}</AlertDescription>
        </Alert>
      )}
      {stale && (
        <p role="status" className="text-xs text-muted-foreground">
          Could not refresh progress. Showing the last confirmed state.
        </p>
      )}
    </section>
  )
}
