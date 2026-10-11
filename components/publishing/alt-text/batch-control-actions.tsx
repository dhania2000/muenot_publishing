"use client"

/**
 * @file components/publishing/alt-text/batch-control-actions.tsx
 * @summary Phase 2 Task 13 — Pause / Resume / Cancel buttons for the Bulk Processing dashboard.
 * Buttons reflect the persisted batch status only; success toasts fire after the server confirms.
 */
import { useState } from "react"
import { Ban, Loader2, Pause, Play } from "lucide-react"
import { toast } from "sonner"
import type { BatchProgressView } from "@/lib/alt-text/batch-dashboard"
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

type Action = "pause" | "resume" | "cancel"
const PAUSABLE = new Set(["queued", "processing"])
const CANCELLABLE = new Set(["queued", "processing", "pause_requested", "paused"])
const RESUMABLE = new Set(["paused", "pause_requested"])

const SUCCESS: Record<Action, (status: string) => string> = {
  pause: (s) => (s === "paused" ? "Batch paused." : "Pause requested. In-progress images will finish first."),
  resume: () => "Batch resumed. Remaining images will be processed.",
  cancel: (s) => (s === "cancelled" ? "Batch cancelled. Completed results were kept." : "Cancel requested. In-progress images will finish first."),
}

async function postControl(batchId: string, action: Action) {
  let res: Response
  try {
    res = await fetch(`/api/alt-text/batches/${encodeURIComponent(batchId)}/${action}`, { method: "POST", credentials: "same-origin", cache: "no-store" })
  } catch {
    throw new Error("Network error. Check your connection and try again.")
  }
  const body = (await res.json().catch(() => null)) as { success?: boolean; status?: string; error?: string } | null
  if (!res.ok || body?.success !== true) throw new Error(body?.error || "The request could not be completed.")
  return body.status ?? ""
}

export function BatchControlActions({ view, onChanged }: { view: BatchProgressView; onChanged: () => void }) {
  const [pending, setPending] = useState<Action | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const status = view.status

  const run = async (action: Action) => {
    if (pending) return
    setPending(action)
    try {
      const next = await postControl(view.batchId, action)
      toast.success(SUCCESS[action](next))
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setPending(null)
      onChanged()
    }
  }

  const busy = pending !== null
  const icon = (a: Action, Icon: typeof Pause) => (pending === a ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Icon aria-hidden="true" />)

  return (
    <>
      {RESUMABLE.has(status) ? (
        <Button size="sm" variant="outline" onClick={() => void run("resume")} disabled={busy}>
          {icon("resume", Play)}
          Resume
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void run("pause")}
          disabled={busy || !PAUSABLE.has(status)}
          title={PAUSABLE.has(status) ? undefined : "Batch is not running"}
        >
          {icon("pause", Pause)}
          {status === "pause_requested" ? "Pausing…" : "Pause"}
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        onClick={() => setConfirmOpen(true)}
        disabled={busy || !CANCELLABLE.has(status)}
        title={CANCELLABLE.has(status) ? undefined : status === "cancel_requested" ? "Cancellation in progress" : "Batch is not running"}
      >
        {icon("cancel", Ban)}
        {status === "cancel_requested" ? "Cancelling…" : "Cancel"}
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this batch?</AlertDialogTitle>
            <AlertDialogDescription>
              Images that have not started will not be processed. Completed alt text stays saved. Images already being processed by the AI provider
              will finish and may still use AI credits. A cancelled batch cannot be resumed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep processing</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setConfirmOpen(false)
                void run("cancel")
              }}
            >
              Cancel batch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
