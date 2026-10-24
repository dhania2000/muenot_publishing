"use client"

/**
 * @file components/publishing/alt-text/image-ocr-panel.tsx
 * @module Publishing · Alt Text
 * @kind Client component
 * @summary Phase 3 Task 5 — shows saved OCR text for the full image and detected text regions, and
 *   lets authorised users run self-hosted OCR explicitly. Loading this panel never runs the engine.
 *   OCR text is review evidence: it is never inserted into alt text or marked as approved.
 */
import { useRef, useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import { AlertCircle, Check, Copy, Info, ScanText } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { ErrorState } from "@/components/enterprise/data-state"
import { cn } from "@/lib/utils"
import { AltTextApiError, altTextFetcher, altTextImageUrl, assetOcrUrl, runOcr, type OcrResponse } from "@/lib/alt-text/client"
import { OCR_STATUS_LABELS, type OcrResult } from "@/lib/alt-text/ocr-contract"
import { formatDateTime } from "./alt-text-history"

const newRequestId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`)

type RunTarget = { regionId: string | null; reprocess: boolean }
const targetKey = (t: RunTarget) => `${t.regionId ?? "full"}:${t.reprocess ? 1 : 0}`

export function ImageOcrPanel({ assetId, occurrenceId = null }: { assetId: number; occurrenceId?: number | null }) {
  const key = assetOcrUrl(assetId, occurrenceId)
  const { data, error, isLoading, mutate } = useSWR<OcrResponse, AltTextApiError>(key, altTextFetcher, { revalidateOnFocus: false })
  const [running, setRunning] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  // Per-target request ids survive retries of a failed attempt so a lost response is replayed.
  const pending = useRef(new Map<string, string>())

  async function run(target: RunTarget) {
    const k = targetKey(target)
    const requestId = pending.current.get(k) ?? newRequestId()
    pending.current.set(k, requestId)
    setRunning(target.regionId ?? "full")
    setRunError(null)
    try {
      const r = await runOcr(assetId, { requestId, occurrenceId, regionId: target.regionId, reprocess: target.reprocess })
      if (!r.ok) {
        if (r.error.status >= 400 && r.error.status < 500) pending.current.delete(k)
        setRunError(r.error.message)
        return
      }
      pending.current.delete(k)
      await mutate(r.data, { revalidate: false })
      const res = r.data.result
      toast[res.status === "failed" ? "error" : "success"](
        r.data.replayed ? "Loaded the saved result for this request." : r.data.reused ? "This image was already read with the same settings. Showing the saved text." : OCR_STATUS_LABELS[res.status],
      )
    } catch {
      setRunError("Text recognition failed. Please try again.")
    } finally {
      setRunning(null)
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby={`ocr-h-${assetId}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 id={`ocr-h-${assetId}`} className="flex items-center gap-2 text-sm font-semibold">
          <ScanText className="size-4 text-muted-foreground" aria-hidden="true" />
          Text in image (OCR)
        </h3>
        {data?.permissions.canRun ? (
          <Button size="sm" variant="outline" onClick={() => run({ regionId: null, reprocess: !!data.full.active })} disabled={running !== null}>
            {running === "full" ? <Spinner className="size-4" /> : null}
            {running === "full" ? "Reading…" : data.full.active ? "Re-run OCR" : "Extract text"}
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : error ? (
        <ErrorState title="Could not load OCR results" message={error.message} onRetry={() => void mutate()} />
      ) : data ? (
        <OcrBody data={data} assetId={assetId} running={running} onRun={run} />
      ) : null}

      {runError ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>Text recognition failed</AlertTitle>
          <AlertDescription>{runError}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  )
}

function OcrBody({ data, assetId, running, onRun }: { data: OcrResponse; assetId: number; running: string | null; onRun: (t: RunTarget) => void }) {
  const textRegions = data.regions.filter((r) => r.eligible || r.active || r.latestFailure)
  return (
    <div className="flex flex-col gap-3">
      {data.capability.status !== "available" || !data.policy.enabled ? (
        <Alert>
          <Info className="size-4" aria-hidden="true" />
          <AlertTitle>{data.capability.status !== "available" ? "OCR is not available" : "OCR is turned off"}</AlertTitle>
          <AlertDescription>{data.policy.reason ?? "OCR cannot run for this image."}</AlertDescription>
        </Alert>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Recognised text is evidence for review. It is not alt text and is never added to the description automatically. Printed English only, using {data.engine.label}.
      </p>

      <ScopeResult title="Whole image" view={data.full} assetId={assetId} />

      {textRegions.length ? (
        <div className="flex flex-col gap-2">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Detected text regions</h4>
          <ul className="flex flex-col gap-2">
            {textRegions.map((r) => (
              <li key={r.regionId} className="flex flex-col gap-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">{r.index}</span>
                    <span className="font-medium">{r.label}</span>
                  </span>
                  {data.permissions.canRun && r.eligible ? (
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={running !== null} onClick={() => onRun({ regionId: r.regionId, reprocess: !!r.active })}>
                      {running === r.regionId ? <Spinner className="size-3" /> : null}
                      {running === r.regionId ? "Reading…" : r.active ? "Re-read" : "Read text"}
                    </Button>
                  ) : null}
                </div>
                {!r.eligible && r.ineligibleReason ? <p className="text-xs text-muted-foreground">{r.ineligibleReason}</p> : null}
                {r.active || r.latestFailure ? <ResultDetails view={r} assetId={null} /> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : data.regionAnalysis ? null : (
        <p className="text-xs text-muted-foreground">Run region detection above to read individual text regions.</p>
      )}
    </div>
  )
}

function ScopeResult({ title, view, assetId }: { title: string; view: OcrResponse["full"]; assetId: number }) {
  if (!view.active && !view.latestFailure) {
    return <p className="text-sm text-muted-foreground">No text has been extracted from this image yet.</p>
  }
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h4>
      <ResultDetails view={view} assetId={assetId} />
    </div>
  )
}

function ResultDetails({ view, assetId }: { view: OcrResponse["full"]; assetId: number | null }) {
  const { active, latestFailure } = view
  return (
    <div className="flex flex-col gap-2">
      {latestFailure ? (
        <p className="flex gap-1.5 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          {`Latest attempt failed (${formatDateTime(latestFailure.createdAt)}): ${latestFailure.warnings[0] ?? "Unknown error."}`}
          {active ? " The previous result is still shown." : ""}
        </p>
      ) : null}
      {active ? <ActiveResult result={active} assetId={assetId} /> : null}
    </div>
  )
}

function ActiveResult({ result, assetId }: { result: OcrResult; assetId: number | null }) {
  const [copied, setCopied] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const text = showRaw ? result.rawText : result.normalizedText
  const drawable = assetId !== null && result.layout?.drawable && result.layout.lines.length > 0

  async function copy() {
    try {
      await navigator.clipboard.writeText(result.normalizedText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Could not copy to the clipboard.")
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant={result.status === "completed" ? "secondary" : "outline"}>{OCR_STATUS_LABELS[result.status]}</Badge>
        {result.meanConfidence !== null ? <span>Engine confidence {Math.round(result.meanConfidence)}/100</span> : null}
        <span aria-hidden="true">·</span>
        <span>Version {result.version}</span>
        <span aria-hidden="true">·</span>
        <span>{formatDateTime(result.createdAt)}</span>
      </div>

      {drawable ? (
        <div className="relative overflow-hidden rounded-md border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-gated image route */}
          <img src={altTextImageUrl(assetId!)} alt="" className="block h-auto w-full" />
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            {result.layout!.lines.map((l, i) => (
              <div
                key={i}
                className={cn("absolute rounded-sm border", l.confidence < 60 ? "border-dashed border-amber-500 bg-amber-500/10" : "border-primary/70 bg-primary/10")}
                style={{
                  left: `${(l.box.left / result.source.storedWidth) * 100}%`,
                  top: `${(l.box.top / result.source.storedHeight) * 100}%`,
                  width: `${(l.box.width / result.source.storedWidth) * 100}%`,
                  height: `${(l.box.height / result.source.storedHeight) * 100}%`,
                }}
              />
            ))}
          </div>
        </div>
      ) : null}

      {result.normalizedText ? (
        <>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed" aria-label={showRaw ? "Raw OCR output" : "Recognised text"}>
            {text}
          </pre>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={copy}>
              {copied ? <Check className="size-3" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}
              {copied ? "Copied" : "Copy text"}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" aria-pressed={showRaw} onClick={() => setShowRaw((v) => !v)}>
              {showRaw ? "Show cleaned text" : "Show raw output"}
            </Button>
          </div>
        </>
      ) : null}

      {result.warnings.length ? (
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          {result.warnings.map((w) => (
            <li key={w} className="flex gap-1.5">
              <AlertCircle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              {w}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
