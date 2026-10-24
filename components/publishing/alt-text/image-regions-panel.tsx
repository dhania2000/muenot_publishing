"use client"

/**
 * @file components/publishing/alt-text/image-regions-panel.tsx
 * @module Publishing · Alt Text
 * @kind Client component
 * @summary Phase 3 Task 4 — shows the saved region analysis over the image and lets authorised
 *   users run region detection explicitly. Loading this panel never calls a provider or charges credits.
 */
import { useMemo, useRef, useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import { AlertCircle, Info, ScanSearch } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { ErrorState } from "@/components/enterprise/data-state"
import { cn } from "@/lib/utils"
import { COMPLEXITY_LEVELS } from "@/lib/alt-text/classification"
import {
  AltTextApiError,
  altTextFetcher,
  altTextImageUrl,
  assetRegionsUrl,
  detectRegions,
  type RegionAnalysisResponse,
} from "@/lib/alt-text/client"
import {
  boxToPercentStyle,
  filterGroupOf,
  REGION_ANALYSIS_STATUSES,
  REGION_FILTER_GROUPS,
  REGION_TYPES,
  type ComplexityRecommendation,
  type ImageRegion,
  type RegionFilterGroup,
} from "@/lib/alt-text/region-analysis"
import { formatDateTime } from "./alt-text-history"

const RECOMMENDATION_COPY: Record<ComplexityRecommendation, string> = {
  not_needed: "This image was classified as low complexity. Region detection is usually not needed.",
  major_regions: "Medium complexity: detecting the major regions can help structure the description.",
  detailed_regions: "High complexity: detailed region detection is recommended before writing a long description.",
  review_first: "Complexity is unknown. Review the classification before deciding whether to detect regions.",
}

const newRequestId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`)

export function ImageRegionsPanel({ assetId, occurrenceId = null }: { assetId: number; occurrenceId?: number | null }) {
  const key = assetRegionsUrl(assetId, occurrenceId)
  const { data, error, isLoading, mutate } = useSWR<RegionAnalysisResponse, AltTextApiError>(key, altTextFetcher, { revalidateOnFocus: false })
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  // Kept across retries of a failed attempt so a lost response is replayed, not re-billed.
  const pendingRequestId = useRef<string | null>(null)

  async function run() {
    pendingRequestId.current ??= newRequestId()
    setRunning(true)
    setRunError(null)
    try {
      const r = await detectRegions(assetId, { requestId: pendingRequestId.current, occurrenceId })
      if (!r.ok) {
        // Network/5xx/in-progress keep the id so a retry replays; a definitive 4xx starts fresh next time.
        if (r.error.status !== 409 && r.error.status >= 400 && r.error.status < 500) pendingRequestId.current = null
        setRunError(r.error.message)
        return
      }
      pendingRequestId.current = null
      await mutate(r.data, { revalidate: false })
      const count = r.data.analysis?.regions.length ?? 0
      toast.success(r.data.replayed ? "Loaded the saved analysis for this request." : `Detected ${count} region${count === 1 ? "" : "s"}.`)
    } catch {
      setRunError("Region detection failed. Please try again.")
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby={`regions-h-${assetId}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 id={`regions-h-${assetId}`} className="flex items-center gap-2 text-sm font-semibold">
          <ScanSearch className="size-4 text-muted-foreground" aria-hidden="true" />
          Image regions
        </h3>
        {data?.permissions.canAnalyze ? (
          <Button size="sm" variant="outline" onClick={run} disabled={running}>
            {running ? <Spinner className="size-4" /> : null}
            {running ? "Detecting…" : data.analysis ? "Re-run detection" : "Detect regions"}
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : error ? (
        <ErrorState title="Could not load regions" message={error.message} onRetry={() => void mutate()} />
      ) : data ? (
        <RegionsBody data={data} assetId={assetId} />
      ) : null}

      {runError ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>Region detection failed</AlertTitle>
          <AlertDescription>{runError}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  )
}

function RegionsBody({ data, assetId }: { data: RegionAnalysisResponse; assetId: number }) {
  const { analysis, capability, complexity, recommendation, staleReasons } = data
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Complexity: {COMPLEXITY_LEVELS[complexity] ?? "Unknown"}.</span> {RECOMMENDATION_COPY[recommendation]}
      </p>

      {capability.status !== "available" ? (
        <Alert>
          <Info className="size-4" aria-hidden="true" />
          <AlertTitle>Region detection is not available</AlertTitle>
          <AlertDescription>{capability.reason ?? "Your administrator has not enabled a vision model for region detection."}</AlertDescription>
        </Alert>
      ) : null}

      {staleReasons.length ? (
        <Alert>
          <Info className="size-4" aria-hidden="true" />
          <AlertTitle>This analysis may be out of date</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {staleReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {analysis ? <RegionViewer analysis={analysis} assetId={assetId} /> : <p className="text-sm text-muted-foreground">No regions have been detected for this image yet.</p>}
    </div>
  )
}

type Analysis = NonNullable<RegionAnalysisResponse["analysis"]>

function RegionViewer({ analysis, assetId }: { analysis: Analysis; assetId: number }) {
  const presentGroups = useMemo(() => {
    const s = new Set<RegionFilterGroup>()
    for (const r of analysis.regions) s.add(filterGroupOf(r.primaryType))
    return (Object.keys(REGION_FILTER_GROUPS) as RegionFilterGroup[]).filter((g) => s.has(g))
  }, [analysis.regions])
  const [hidden, setHidden] = useState<Set<RegionFilterGroup>>(new Set())
  const [selected, setSelected] = useState<string | null>(null)

  const visible = analysis.regions.filter((r) => !hidden.has(filterGroupOf(r.primaryType)))
  const drawable = visible.filter((r) => r.locationStatus === "verified_frame")
  const unverifiedCount = visible.length - drawable.length
  const indexOf = new Map(analysis.regions.map((r, i) => [r.id, i + 1]))

  const toggle = (g: RegionFilterGroup) =>
    setHidden((prev) => {
      const next = new Set(prev)
      next.has(g) ? next.delete(g) : next.add(g)
      return next
    })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant={analysis.status === "completed" ? "secondary" : "outline"}>{REGION_ANALYSIS_STATUSES[analysis.status]}</Badge>
        <span>Version {analysis.version}</span>
        <span aria-hidden="true">·</span>
        <span>{formatDateTime(analysis.createdAt)}</span>
      </div>

      <div className="relative overflow-hidden rounded-md border bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-gated image route */}
        <img src={altTextImageUrl(assetId)} alt="" className="block h-auto w-full" />
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          {drawable.map((r) => (
            <div
              key={r.id}
              style={boxToPercentStyle(r.box)}
              className={cn(
                "absolute rounded-sm border-2 transition-colors",
                selected === r.id ? "border-primary bg-primary/20" : r.needsReview ? "border-dashed border-amber-500 bg-amber-500/5" : "border-primary/70 bg-primary/5",
              )}
            >
              <span className="absolute left-0 top-0 rounded-br-sm bg-primary px-1 text-[10px] font-medium leading-4 text-primary-foreground">{indexOf.get(r.id)}</span>
            </div>
          ))}
        </div>
      </div>

      {unverifiedCount > 0 ? (
        <p className="text-xs text-muted-foreground">
          {unverifiedCount} region{unverifiedCount === 1 ? " is" : "s are"} listed but not drawn because the image orientation could not be confirmed.
        </p>
      ) : null}

      {presentGroups.length > 1 ? (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show region types">
          {presentGroups.map((g) => (
            <Button key={g} size="sm" variant={hidden.has(g) ? "ghost" : "secondary"} className="h-7 px-2 text-xs" aria-pressed={!hidden.has(g)} onClick={() => toggle(g)}>
              {REGION_FILTER_GROUPS[g].label}
            </Button>
          ))}
        </div>
      ) : null}

      {analysis.warnings.length ? (
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          {analysis.warnings.map((w) => (
            <li key={w} className="flex gap-1.5">
              <AlertCircle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              {w}
            </li>
          ))}
        </ul>
      ) : null}

      {visible.length ? (
        <ol className="flex flex-col divide-y rounded-md border" aria-label="Detected regions">
          {visible.map((r) => (
            <RegionRow key={r.id} region={r} index={indexOf.get(r.id) ?? 0} selected={selected === r.id} onSelect={() => setSelected((s) => (s === r.id ? null : r.id))} />
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">{analysis.regions.length ? "All region types are hidden." : "No regions were detected."}</p>
      )}

      <p className="text-xs text-muted-foreground">Locations are AI estimates and the list order is not a verified reading order. Review before relying on them.</p>
    </div>
  )
}

function RegionRow({ region, index, selected, onSelect }: { region: ImageRegion; index: number; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn("flex w-full flex-col gap-1 px-3 py-2 text-left text-sm outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring", selected && "bg-muted")}
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{index}</span>
          <span className="font-medium">{REGION_TYPES[region.primaryType]}</span>
          {region.parentId ? <span className="text-xs text-muted-foreground">nested</span> : null}
          {region.needsReview ? (
            <Badge variant="outline" className="border-amber-500/60 text-amber-700 dark:text-amber-400">
              Needs review
            </Badge>
          ) : null}
          {region.locationStatus === "unverified" ? <Badge variant="outline">Location unverified</Badge> : null}
        </span>
        {region.evidence ? <span className="text-xs text-muted-foreground">{region.evidence}</span> : null}
        {region.needsReview && region.reviewReasons.length ? <span className="text-xs text-amber-700 dark:text-amber-400">{region.reviewReasons.join(" · ")}</span> : null}
      </button>
    </li>
  )
}
