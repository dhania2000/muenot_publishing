"use client"

/**
 * @file components/publishing/alt-text/batch-retry-actions.tsx
 * @summary Phase 2 Task 14 — "Retry Failed" (whole batch, confirmed) and per-image Retry buttons.
 * Eligibility is decided by the server; toasts report what was re-queued and what was skipped.
 */
import { useState } from "react"
import { Loader2, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import type { BatchProgressView } from "@/lib/alt-text/batch-dashboard"
import { RETRY_BATCH_STATUSES } from "@/lib/alt-text/retry-policy"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

type RetryBody = { success?: boolean; acceptedCount?: number; skippedCount?: number; error?: string }

async function postRetry(url: string): Promise<RetryBody> {
  let res: Response
  try {
    res = await fetch(url, { method: "POST", credentials: "same-origin", cache: "no-store" })
  } catch {
    throw new Error("Network error. Check your connection and try again.")
  }
  const body = (await res.json().catch(() => null)) as RetryBody | null
  if (!res.ok || body?.success !== true) throw new Error(body?.error || "The retry could not be started.")
  return body
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

export function RetryFailedAction({ view, onChanged }: { view: BatchProgressView; onChanged: () => void }) {
  const [pending, setPending] = useState(false)
  const [open, setOpen] = useState(false)
  const statusOk = RETRY_BATCH_STATUSES.has(view.status)
  const disabledReason = view.failed === 0 ? "No failed images" : !statusOk ? "This batch cannot be retried" : undefined

  const run = async () => {
    if (pending) return
    setPending(true)
    try {
      const r = await postRetry(`/api/alt-text/batches/${encodeURIComponent(view.batchId)}/retry-failed`)
      const accepted = r.acceptedCount ?? 0
      const skipped = r.skippedCount ?? 0
      const skippedNote = skipped ? ` ${plural(skipped, "image")} could not be retried and were skipped.` : ""
      if (accepted > 0) toast.success(`${plural(accepted, "image")} queued for retry.${skippedNote}`)
      else toast.warning(`No images were eligible for retry.${skippedNote}`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setPending(false)
      onChanged()
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={pending || Boolean(disabledReason)} title={disabledReason}>
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
        Retry Failed
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retry {plural(view.failed, "failed image")}?</AlertDialogTitle>
            <AlertDialogDescription>
              Eligible images are added back to this batch and processed again, which uses AI credits. Images with permanent errors, files that
              failed their security check, and images that reached the attempt limit are skipped. Completed alt text is not changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setOpen(false)
                void run()
              }}
            >
              Retry images
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function RetryImageButton({
  batchId,
  assetId,
  fileName,
  batchStatus,
  onChanged,
}: {
  batchId: string
  assetId: number
  fileName: string
  batchStatus: BatchProgressView["status"]
  onChanged: () => void
}) {
  const [pending, setPending] = useState(false)
  const run = async () => {
    if (pending) return
    setPending(true)
    try {
      await postRetry(`/api/alt-text/batches/${encodeURIComponent(batchId)}/assets/${assetId}/retry`)
      toast.success(`${fileName} queued for retry.`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setPending(false)
      onChanged()
    }
  }
  return (
    <Button size="sm" variant="outline" onClick={() => void run()} disabled={pending || !RETRY_BATCH_STATUSES.has(batchStatus)}>
      {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
      Retry<span className="sr-only"> {fileName}</span>
    </Button>
  )
}
