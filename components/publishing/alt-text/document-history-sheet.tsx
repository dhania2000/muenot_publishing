"use client"

/**
 * @file components/publishing/alt-text/document-history-sheet.tsx
 * @module Publishing · Alt Text
 * @kind Client component
 * @summary Phase 3 Task 19 — read-only document details drawer: overview, processing jobs and AI
 *   batches, per-image alt text reviews, outputs, validation runs and a combined timeline.
 *   Data loads only while open and is never polled for terminal records.
 */
import { useState } from "react"
import useSWR from "swr"
import { AlertTriangle, Download, FolderOpen, Info, RefreshCw } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { altTextFetcher } from "@/lib/alt-text/client"
import { documentHistoryUrl, originalDownloadUrl, type DocumentHistoryDetail, type TimelineEvent } from "@/lib/alt-text/document-history-contract"
import { StatusBadge } from "./document-upload-status"
import { actorLabel, downloadWithToast, Fact, fmtBytes, fmtDateTime, GenericStatus, PROCESSING_LABELS, SECURITY_LABELS, ValidationBadge } from "./document-history-labels"
import { DocumentHistoryReviews } from "./document-history-reviews"
import { DocumentHistoryOutputs, DocumentHistoryValidations } from "./document-history-outputs"

export type HistorySheetTab = "overview" | "processing" | "reviews" | "outputs" | "validation" | "timeline"
const TABS: { value: HistorySheetTab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "processing", label: "Processing" },
  { value: "reviews", label: "Reviews" },
  { value: "outputs", label: "Outputs" },
  { value: "validation", label: "Validation" },
  { value: "timeline", label: "Timeline" },
]

export function DocumentHistorySheet({
  target,
  onClose,
  onOpenDocument,
  onOpenBatch,
}: {
  target: { id: number; tab: HistorySheetTab } | null
  onClose: () => void
  onOpenDocument: (id: number) => void
  onOpenBatch?: (id: string) => void
}) {
  return (
    <Sheet open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        {target && <SheetBody key={`${target.id}-${target.tab}`} documentId={target.id} initialTab={target.tab} onOpenDocument={onOpenDocument} onOpenBatch={onOpenBatch} />}
      </SheetContent>
    </Sheet>
  )
}

function SheetBody({ documentId, initialTab, onOpenDocument, onOpenBatch }: { documentId: number; initialTab: HistorySheetTab; onOpenDocument: (id: number) => void; onOpenBatch?: (id: string) => void }) {
  const [tab, setTab] = useState<HistorySheetTab>(initialTab)
  const [validationOutput, setValidationOutput] = useState<string | null>(null)
  const { data, error, isLoading, mutate, isValidating } = useSWR<DocumentHistoryDetail>(documentHistoryUrl(documentId), altTextFetcher, { revalidateOnFocus: false })
  const doc = data?.document

  return (
    <>
      <SheetHeader>
        <SheetTitle className="break-words pr-6">{doc?.filename ?? `Document #${documentId}`}</SheetTitle>
        <SheetDescription>Read-only history. Nothing here re-runs extraction, AI generation, export or validation.</SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-4 px-4 pb-6">
        {isLoading ? (
          <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading document history">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : error || !data || !doc ? (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>Could not load this document</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              {(error as Error | undefined)?.message ?? "Please try again."}
              <Button size="sm" variant="outline" onClick={() => mutate()}>
                <RefreshCw aria-hidden="true" /> Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => onOpenDocument(doc.id)}>
                <FolderOpen aria-hidden="true" /> Open document
              </Button>
              <Button size="sm" variant="outline" disabled={!doc.originalAvailable} onClick={() => void downloadWithToast(originalDownloadUrl(doc.id), doc.filename)}>
                <Download aria-hidden="true" /> Download original
              </Button>
              <Button size="sm" variant="ghost" onClick={() => mutate()} disabled={isValidating}>
                <RefreshCw className={isValidating ? "animate-spin" : undefined} aria-hidden="true" /> Refresh
              </Button>
            </div>

            <Tabs value={tab} onValueChange={(v) => setTab(v as HistorySheetTab)} className="flex flex-col gap-4">
              <div className="overflow-x-auto">
                <TabsList className="w-max">
                  {TABS.map((t) => (
                    <TabsTrigger key={t.value} value={t.value}>
                      {t.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>

              <TabsContent value="overview" className="mt-0">
                <Overview data={data} />
              </TabsContent>
              <TabsContent value="processing" className="mt-0">
                <Processing data={data} onOpenBatch={onOpenBatch} />
              </TabsContent>
              <TabsContent value="reviews" className="mt-0">
                <DocumentHistoryReviews documentId={doc.id} total={doc.totalOccurrences} />
              </TabsContent>
              <TabsContent value="outputs" className="mt-0">
                <DocumentHistoryOutputs
                  documentId={doc.id}
                  outputs={data.outputs}
                  onViewValidation={(outputId) => {
                    setValidationOutput(outputId)
                    setTab("validation")
                  }}
                />
              </TabsContent>
              <TabsContent value="validation" className="mt-0">
                <DocumentHistoryValidations documentId={doc.id} outputs={data.outputs} runs={data.validations} outputFilter={validationOutput} onOutputFilterChange={setValidationOutput} />
              </TabsContent>
              <TabsContent value="timeline" className="mt-0">
                <Timeline events={data.timeline} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </>
  )
}

function Overview({ data }: { data: DocumentHistoryDetail }) {
  const d = data.document
  const processing = PROCESSING_LABELS[d.processingStatus]
  const security = SECURITY_LABELS[d.securityStatus]
  const latestBatch = data.batches[0] ?? null
  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="history-status" className="flex flex-col gap-2">
        <h3 id="history-status" className="text-sm font-semibold text-foreground">Status</h3>
        <dl className="grid gap-2 sm:grid-cols-2">
          <StatusTile label="Security scan"><StatusBadge tone={security.tone}>{security.label}</StatusBadge></StatusTile>
          <StatusTile label="Preparation"><StatusBadge tone={processing.tone} spinning={d.processingStatus === "extracting"}>{processing.label}</StatusBadge></StatusTile>
          <StatusTile label="AI generation">
            {latestBatch ? <GenericStatus status={latestBatch.status} /> : <span className="text-xs text-muted-foreground">Not started</span>}
          </StatusTile>
          <StatusTile label="Review">
            <span className="text-sm tabular-nums text-foreground">{`${d.approvedImages} of ${d.totalOccurrences} approved`}</span>
          </StatusTile>
          <StatusTile label="Output">
            <span className="text-sm text-foreground">{d.completedExports ? `${d.completedExports} completed` : "None"}</span>
          </StatusTile>
          <StatusTile label="Latest validation"><ValidationBadge status={d.latestValidation} /></StatusTile>
        </dl>
      </section>

      <section aria-labelledby="history-facts" className="flex flex-col gap-1">
        <h3 id="history-facts" className="text-sm font-semibold text-foreground">Document</h3>
        <dl>
          <Fact label="Document ID" mono>{`#${d.id}`}</Fact>
          <Fact label="Original filename">{d.filename}</Fact>
          <Fact label="Type">{`${d.documentType.toUpperCase()} · ${d.mimeType}`}</Fact>
          <Fact label="Size">{fmtBytes(d.size)}</Fact>
          <Fact label="Project">{d.projectId ? `#${d.projectId}` : "—"}</Fact>
          <Fact label="Uploaded by">{actorLabel(d.uploaderName, d.uploadedBy)}</Fact>
          <Fact label="Uploaded">{fmtDateTime(d.createdAt)}</Fact>
          <Fact label="Last updated">{fmtDateTime(d.updatedAt)}</Fact>
          <Fact label="Original file">{d.originalAvailable ? "Stored privately" : "Not available"}</Fact>
          {d.preparationStage && <Fact label="Last preparation stage">{d.preparationStage.replace(/_/g, " ")}</Fact>}
          {d.preparationErrorCode && <Fact label="Preparation error" mono>{d.preparationErrorCode}</Fact>}
        </dl>
      </section>

      <section aria-labelledby="history-images" className="flex flex-col gap-2">
        <h3 id="history-images" className="text-sm font-semibold text-foreground">Images</h3>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Count label="Occurrences" value={d.totalOccurrences} />
          <Count label="AI results" value={d.aiGeneratedImages} />
          <Count label="Approved" value={d.approvedImages} />
          <Count label="Decorative" value={d.decorativeApproved} />
        </dl>
      </section>
    </div>
  )
}

function StatusTile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col rounded-md border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  )
}

function LimitNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

function Processing({ data, onOpenBatch }: { data: DocumentHistoryDetail; onOpenBatch?: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="history-jobs" className="flex flex-col gap-2">
        <h3 id="history-jobs" className="text-sm font-semibold text-foreground">Preparation jobs</h3>
        {data.jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No preparation job has run for this document.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.jobs.map((j) => (
              <li key={j.id} className="flex flex-col gap-1.5 rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{`Job #${j.id}${j.isCurrent ? " · current" : ""}`}</span>
                  <GenericStatus status={j.status} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {[`Queued ${fmtDateTime(j.createdAt)}`, j.startedAt && `started ${fmtDateTime(j.startedAt)}`, j.completedAt && `finished ${fmtDateTime(j.completedAt)}`, `attempt ${j.attempts} of ${j.maxAttempts}`]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {j.errorCode && <p className="font-mono text-xs text-destructive">{j.errorCode}</p>}
              </li>
            ))}
          </ul>
        )}
        {!data.limits.stageHistoryPersisted && <LimitNote>Individual stage timings are not stored; only each job&apos;s queued, start and finish times are shown.</LimitNote>}
      </section>

      <section aria-labelledby="history-batches" className="flex flex-col gap-2">
        <h3 id="history-batches" className="text-sm font-semibold text-foreground">AI generation batches</h3>
        {data.batches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No AI generation has been queued for this document.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.batches.map((b) => (
              <li key={b.id} className="flex flex-col gap-1.5 rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium text-foreground" title={b.name}>{b.name}</span>
                  <GenericStatus status={b.status} />
                </div>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {[`${b.submitted} submitted`, `${b.completed} completed`, b.failed ? `${b.failed} failed` : null, b.modelId].filter(Boolean).join(" · ")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {`Created ${fmtDateTime(b.createdAt)}${b.completedAt ? ` · completed ${fmtDateTime(b.completedAt)}` : ""}`}
                </p>
                {onOpenBatch && (
                  <Button size="sm" variant="outline" className="self-start" onClick={() => onOpenBatch(b.id)}>
                    <FolderOpen aria-hidden="true" /> Open batch
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

const GROUP_LABELS: Record<TimelineEvent["group"], string> = { processing: "Processing", review: "Review", output: "Output" }

function Timeline({ events }: { events: TimelineEvent[] }) {
  const [group, setGroup] = useState<TimelineEvent["group"] | "all">("all")
  const shown = group === "all" ? events : events.filter((e) => e.group === group)
  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Filter timeline" className="flex flex-wrap gap-1.5">
        {(["all", "processing", "review", "output"] as const).map((g) => (
          <Button key={g} size="sm" variant={group === g ? "secondary" : "ghost"} aria-pressed={group === g} onClick={() => setGroup(g)}>
            {g === "all" ? "All" : GROUP_LABELS[g]}
          </Button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No events recorded.</p>
      ) : (
        <ol className="flex flex-col border-l pl-4">
          {shown.map((e) => (
            <li key={e.id} className="relative flex flex-col gap-0.5 pb-4 last:pb-0">
              <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-background bg-primary" aria-hidden="true" />
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium text-foreground">{e.label}</span>
                <span className="text-xs text-muted-foreground">{GROUP_LABELS[e.group]}</span>
              </div>
              <time dateTime={e.at} className="text-xs text-muted-foreground">
                {`${fmtDateTime(e.at)}${e.actor ? ` · ${e.actor}` : ""}`}
              </time>
              {e.detail && <p className="text-xs text-muted-foreground text-pretty">{e.detail}</p>}
            </li>
          ))}
        </ol>
      )}
      <LimitNote>Downloads are authorized and logged server-side but are not shown in this timeline.</LimitNote>
    </div>
  )
}
