"use client"

/**
 * @file components/publishing/alt-text/document-context-sheet.tsx
 * @module Publishing
 * @kind React client component
 * @summary Phase 3 Task 9 — per-image document context drawer. Shows the stored, bounded context
 *   (headings, caption, nearby text, table, notes, existing alt text) with its confidence and
 *   warnings, and lets the reviewer re-run analysis for that image. All text is source-document
 *   evidence, never AI output, and is rendered as plain text.
 */
import { useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { altTextFetcher, analyzeDocumentContext, type DocumentImageContextResponse } from "@/lib/alt-text/client"
import { CONTEXT_CONFIDENCE_LABEL, type ContextConfidence, type ContextText, type DocumentImageContext } from "@/lib/alt-text/document-context"
import { StatusBadge } from "./document-upload-status"

export const CONFIDENCE_TONE: Record<ContextConfidence, "success" | "info" | "warning" | "neutral"> = {
  high: "success",
  medium: "info",
  low: "warning",
  unavailable: "neutral",
}

export const documentImageContextUrl = (documentId: number, imageId: number) =>
  `/api/alt-text/documents/${documentId}/context?imageId=${imageId}`

export type ContextSheetTarget = { documentId: number; imageId: number; label: string }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm leading-relaxed text-foreground">{children}</dd>
    </div>
  )
}

function SourceText({ item }: { item: ContextText }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="whitespace-pre-wrap break-words">
        {item.text}
        {item.truncated ? "…" : ""}
      </span>
      <span className="text-xs text-muted-foreground">
        {item.provenance}
        {` · ${item.source.kind} · ${item.source.ref ?? "reference unavailable"} · ${item.method}`}
        {item.provenance === "approximate" ? " · may be unrelated" : ""}
      </span>
    </span>
  )
}

function ContextDetails({ ctx }: { ctx: DocumentImageContext }) {
  const where = ctx.location.slide != null ? `Slide ${ctx.location.slide}` : ctx.location.page != null ? `Page ${ctx.location.page}` : ctx.location.label
  return (
    <dl className="flex flex-col gap-4">
      {where && <Field label="Location">{where}</Field>}
      {ctx.documentTitle && <Field label="Document title"><SourceText item={ctx.documentTitle} /></Field>}
      {ctx.pageTitle && <Field label={ctx.documentType === "pptx" ? "Slide title" : "Page title"}><SourceText item={ctx.pageTitle} /></Field>}
      {ctx.subtitle && <Field label="Subtitle"><SourceText item={ctx.subtitle} /></Field>}
      {ctx.headings.length > 0 && (
        <Field label="Heading path">
          <ol className="flex flex-col gap-1">
            {ctx.headings.map((h, i) => (
              <li key={i} style={{ paddingInlineStart: `${i * 0.75}rem` }}>
                <SourceText item={h} />
              </li>
            ))}
          </ol>
        </Field>
      )}
      {ctx.caption && (
        <Field label={ctx.caption.label ? `Caption (${ctx.caption.label})` : "Caption"}>
          <SourceText item={ctx.caption} />
        </Field>
      )}
      {ctx.captionAlternatives?.map((caption,i)=><Field key={i} label="Conflicting caption candidate"><SourceText item={caption}/></Field>)}
      {ctx.labels.length > 0 && (
        <Field label="Labels">
          <ul className="flex flex-col gap-1">
            {ctx.labels.map((l, i) => (
              <li key={i}><SourceText item={l} /></li>
            ))}
          </ul>
        </Field>
      )}
      {ctx.nearbyText.length > 0 && (
        <Field label="Nearby text">
          <ul className="flex flex-col gap-2">
            {ctx.nearbyText.map((n, i) => (
              <li key={i}><SourceText item={n} /></li>
            ))}
          </ul>
        </Field>
      )}
      {ctx.table && (
        <Field label="Table">
          <span className="flex flex-col gap-0.5">
            {ctx.table.caption && <span>{ctx.table.caption}</span>}
            <span className="text-muted-foreground">
              {[ctx.table.row != null && `Row ${ctx.table.row}`, ctx.table.column != null && `Column ${ctx.table.column}`, ctx.table.rowLabel].filter(Boolean).join(" · ")}
            </span>
            {ctx.table.headerCells.length > 0 && <span className="text-xs text-muted-foreground">Headers: {ctx.table.headerCells.join(" | ")}</span>}
          </span>
        </Field>
      )}
      {ctx.speakerNotes && <Field label="Speaker notes (not shown on slide)"><SourceText item={ctx.speakerNotes} /></Field>}
      <Field label="Existing alt text">
        {ctx.existingAltText ? <span className="whitespace-pre-wrap break-words">{ctx.existingAltText.text}</span> : <span className="text-muted-foreground">None in source</span>}
      </Field>
      {ctx.scripts.length > 0 && <Field label="Scripts detected">{ctx.scripts.join(", ")}</Field>}
    </dl>
  )
}

export function DocumentContextSheet({ target, onClose, onAnalyzed }: { target: ContextSheetTarget | null; onClose: () => void; onAnalyzed?: () => void }) {
  const key = target ? documentImageContextUrl(target.documentId, target.imageId) : null
  const { data, error, isLoading, mutate } = useSWR<DocumentImageContextResponse>(key, altTextFetcher, { revalidateOnFocus: false })
  const [running, setRunning] = useState(false)
  const ctx = data?.context ?? null

  async function analyze() {
    if (!target || running) return
    setRunning(true)
    const r = await analyzeDocumentContext(target.documentId, target.imageId)
    setRunning(false)
    if (!r.ok) {
      toast.error("Context analysis failed", { description: r.error.message })
      return
    }
    await mutate()
    onAnalyzed?.()
  }

  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="truncate pr-6">Document context</SheetTitle>
          <SheetDescription>{target?.label ?? ""}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {ctx ? (
                <StatusBadge tone={CONFIDENCE_TONE[ctx.confidence]}>{CONTEXT_CONFIDENCE_LABEL[ctx.confidence]}</StatusBadge>
              ) : data ? (
                <StatusBadge tone={data.status === "failed" ? "danger" : "neutral"}>{data.status === "failed" ? "Analysis failed" : data.status === "unavailable" ? "Unavailable" : "Not analyzed"}</StatusBadge>
              ) : null}
              {data?.stale && <StatusBadge tone="warning">Outdated — re-analyze</StatusBadge>}
            </div>
            <Button size="sm" variant="outline" onClick={analyze} disabled={!target || running}>
              {running ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
              {running ? "Analyzing…" : data?.status && data.status !== "not_analyzed" ? "Re-analyze" : "Analyze"}
            </Button>
          </div>
          {data?.analyzedAt && <p className="text-xs text-muted-foreground">Last analyzed {new Date(data.analyzedAt).toLocaleString()}</p>}

          {isLoading ? (
            <div className="flex flex-col gap-3" aria-busy="true">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : error ? (
            <p role="alert" className="text-sm text-destructive">The context could not be loaded.</p>
          ) : ctx ? (
            <>
              {data?.imageAssetId && <img src={`/api/alt-text/assets/${data.imageAssetId}/image`} alt="Original image for document context review" className="max-h-52 w-full rounded border object-contain" />}
              {data?.packet && <details className="rounded border p-3 text-sm"><summary className="cursor-pointer font-medium">Context used for generation · source references</summary><p className="mt-2 text-xs text-muted-foreground">Occurrence {data.packet.occurrenceId} · context v{data.packet.contextVersion}. Presenter notes {data.packet.policy.speakerNotes?"included as untrusted context":"excluded"}. Source text and scientific accuracy remain unverified.</p><ul className="mt-2 max-h-64 space-y-3 overflow-auto">{data.packet.snippets.map(s=><li key={s.id}><p className="whitespace-pre-wrap">{s.text}</p><p className="text-xs text-muted-foreground">{s.role} · {s.sourceKind} · {s.sourceRef} · {s.association}</p>{s.duplicateReferences.length>0&&<p className="text-xs text-muted-foreground">Duplicate sources: {s.duplicateReferences.map(r=>`${r.sourceKind}: ${r.sourceRef}`).join("; ")}</p>}</li>)}</ul>{data.packet.warnings.map((w,i)=><p key={i} className="mt-2 text-xs text-amber-700">{w}</p>)}</details>}
              {ctx.warnings.length > 0 && (
                <ul aria-label="Context warnings" className="flex flex-col gap-2 rounded-md border border-amber-600/30 bg-amber-50 p-3">
                  {ctx.warnings.map((w) => (
                    <li key={w.code} className="flex gap-2 text-xs text-amber-900">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      {w.message}
                    </li>
                  ))}
                </ul>
              )}
              <ContextDetails ctx={ctx} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {data?.status === "unavailable"
                ? "No reliable surrounding text was found for this image."
                : "No context stored yet. Run analysis to collect surrounding document text for this image."}
            </p>
          )}

          <Separator />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Context is copied from the source document, not generated by AI. It is evidence for a later description step and is never treated as approved alt text.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}
