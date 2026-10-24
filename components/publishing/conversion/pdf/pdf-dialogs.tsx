"use client"

/**
 * @file components/publishing/conversion/pdf/pdf-dialogs.tsx
 * @module Publishing › Conversion › PDF
 * @kind React client component
 * @summary Accessible dialogs for the PDF module: confirm action (incl. destructive and unsaved changes),
 *   error details and file information (Task 8.10). Focus trap, Escape and focus return come from Radix.
 * @exports PdfConfirmDialog, PdfUnsavedChangesDialog, PdfErrorDetailsDialog, PdfFileInfoDialog
 */
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
import { PdfFileMetadata, type PdfFileMetadataFields } from "@/components/publishing/conversion/pdf/pdf-file-components"

type DialogControl = { open: boolean; onOpenChange: (open: boolean) => void }

export function PdfConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  children,
}: DialogControl & {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  children?: React.ReactNode
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction variant={destructive ? "destructive" : "default"} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function PdfUnsavedChangesDialog({ open, onOpenChange, onDiscard }: DialogControl & { onDiscard: () => void }) {
  return (
    <PdfConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Discard unsaved changes?"
      description="Your setting changes have not been saved and will be lost."
      confirmLabel="Discard Changes"
      cancelLabel="Keep Editing"
      destructive
      onConfirm={onDiscard}
    />
  )
}

export function PdfErrorDetailsDialog({
  open,
  onOpenChange,
  title = "Error details",
  message,
  details,
  onRetry,
}: DialogControl & {
  title?: string
  message: string
  /** Raw diagnostic text (error code, stack, log excerpt) exactly as reported. */
  details?: string
  onRetry?: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </AlertDialogHeader>
        {details && (
          <pre className="max-h-60 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
            {details}
          </pre>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Close</AlertDialogCancel>
          {onRetry && <AlertDialogAction onClick={onRetry}>Retry</AlertDialogAction>}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function PdfFileInfoDialog({
  open,
  onOpenChange,
  fields,
  unavailableNote,
}: DialogControl & { fields: PdfFileMetadataFields; unavailableNote?: string }) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="truncate">{fields.filename ?? "File information"}</AlertDialogTitle>
          <AlertDialogDescription>Details reported for this file.</AlertDialogDescription>
        </AlertDialogHeader>
        <PdfFileMetadata fields={fields} title="Metadata" unavailableNote={unavailableNote} />
        <AlertDialogFooter>
          <AlertDialogCancel>Close</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
