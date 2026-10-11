"use client"

/**
 * @file components/publishing/alt-text/document-upload-status.tsx
 * @module Publishing
 * @kind React client component
 * @summary Phase 3 Task 3 — per-document upload + security status. Polls the
 *   status endpoint only while the security scan is still running.
 */
import useSWR from "swr"
import { Loader2, RotateCcw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { altTextFetcher, documentStatusUrl } from "@/lib/alt-text/client"
import { isDocumentScanSettled, type DocumentUploadReference } from "@/lib/alt-text/document-upload-contract"
import type { DocumentUploadState } from "@/lib/alt-text/document-upload-queue"
import { cn } from "@/lib/utils"

const SCAN_POLL_MS = 4000

const TONE = {
  neutral: "",
  info: "border-sky-600/30 bg-sky-50 text-sky-700",
  success: "border-emerald-600/30 bg-emerald-50 text-emerald-700",
  warning: "border-amber-600/30 bg-amber-50 text-amber-800",
  danger: "border-destructive/30 bg-destructive/5 text-destructive",
} as const

export function StatusBadge({ tone, children, spinning }: { tone: keyof typeof TONE; children: React.ReactNode; spinning?: boolean }) {
  return (
    <Badge variant="outline" className={cn("w-fit gap-1", TONE[tone])}>
      {spinning && <Loader2 className="size-3 animate-spin" aria-hidden="true" />}
      {children}
    </Badge>
  )
}

function UploadedStatus({ reference }: { reference: DocumentUploadReference }) {
  const { data } = useSWR<{ document: DocumentUploadReference }>(documentStatusUrl(reference.uploadId), altTextFetcher, {
    fallbackData: { document: reference },
    revalidateOnMount: !isDocumentScanSettled(reference.processingStatus),
    revalidateOnFocus: false,
    refreshInterval: (latest) => (latest && isDocumentScanSettled(latest.document.processingStatus) ? 0 : SCAN_POLL_MS),
  })
  const doc = data?.document ?? reference

  const badge =
    doc.processingStatus === "ready_for_processing" ? (
      <StatusBadge tone="success">Ready for Processing</StatusBadge>
    ) : doc.processingStatus === "quarantined" ? (
      <StatusBadge tone="danger">Quarantined</StatusBadge>
    ) : doc.processingStatus === "held_for_review" ? (
      <StatusBadge tone="warning">Held for Review</StatusBadge>
    ) : (
      <StatusBadge tone="info" spinning>
        Uploaded · Scanning
      </StatusBadge>
    )

  return (
    <div className="flex flex-col gap-1">
      {badge}
      {doc.processingStatus !== "ready_for_processing" && doc.processingStatus !== "scanning" && doc.securityDetail && (
        <span className={cn("text-xs", doc.processingStatus === "quarantined" ? "text-destructive" : "text-amber-800")}>{doc.securityDetail}</span>
      )}
      <span className="font-mono text-[11px] text-muted-foreground">
        {doc.documentId != null && <>Document #{doc.documentId} · </>}
        {doc.storageReferenceId}
      </span>
    </div>
  )
}

export function DocumentUploadStatus({
  state,
  name,
  onRetry,
}: {
  state: DocumentUploadState | undefined
  name: string
  onRetry: () => void
}) {
  if (!state) return <span className="text-xs text-muted-foreground">Not uploaded</span>
  switch (state.phase) {
    case "queued":
      return <StatusBadge tone="neutral">Queued</StatusBadge>
    case "uploading":
      return (
        <div className="flex min-w-32 flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            {state.progress == null || state.progress >= 100 ? "Uploading…" : `Uploading ${state.progress}%`}
          </span>
          <Progress value={state.progress ?? 0} aria-label={`Upload progress for ${name}`} className="h-1.5" />
        </div>
      )
    case "uploaded":
      return <UploadedStatus reference={state.reference} />
    case "failed":
      return (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge tone="danger">Upload Failed</StatusBadge>
          <span className="text-xs text-destructive">{state.error}</span>
          <Button type="button" variant="outline" size="sm" className="h-7" onClick={onRetry}>
            <RotateCcw aria-hidden="true" /> Retry<span className="sr-only"> upload of {name}</span>
          </Button>
        </div>
      )
    case "rejected":
      return (
        <div className="flex flex-col gap-1">
          <StatusBadge tone="danger">Rejected</StatusBadge>
          <span className="text-xs text-destructive">{state.error}</span>
        </div>
      )
  }
}
