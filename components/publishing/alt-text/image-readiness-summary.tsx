"use client"

/**
 * @file components/publishing/alt-text/image-readiness-summary.tsx
 * @module Publishing
 * @kind React client component
 * @summary Processing readiness counters from the persisted summary. Occurrence counts and
 *   binary counts are labelled separately; no completion percentages are derived.
 */
import { CheckSquare, Copy, FileText, ImageOff, Images, ListChecks, ShieldCheck, type LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import type { ReadinessSummary } from "@/lib/alt-text/document-image-review"

function Tile({ label, value, hint, icon: Icon }: { label: string; value: number | null; hint?: string; icon: LucideIcon }) {
  return (
    <li>
      <Card className="h-full gap-1 py-3">
        <CardContent className="flex flex-col gap-1 px-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{label}</span>
          </div>
          <p className="text-xl font-semibold tabular-nums text-foreground">{value ?? "—"}</p>
          {hint && <p className="text-[11px] leading-tight text-muted-foreground">{hint}</p>}
        </CardContent>
      </Card>
    </li>
  )
}

export function ImageReadinessSummary({ summary }: { summary: ReadinessSummary | null }) {
  const s = summary
  return (
    <section aria-labelledby="readiness-heading" className="flex flex-col gap-2">
      <h3 id="readiness-heading" className="text-sm font-semibold text-foreground">
        Processing Readiness
      </h3>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        <Tile label="Extracted occurrences" icon={Images} value={s?.extractedOccurrences ?? null} hint={s ? `${s.totalOccurrences} recorded in total` : undefined} />
        <Tile label="Eligible images" icon={ShieldCheck} value={s?.eligibleOccurrences ?? null} hint="Occurrences" />
        <Tile label="Selected images" icon={CheckSquare} value={s?.selectedOccurrences ?? null} hint="Eligible occurrences" />
        <Tile label="With existing alt text" icon={FileText} value={s?.withExistingAlt ?? null} hint="From source document" />
        <Tile
          label="Duplicate binary groups"
          icon={Copy}
          value={s?.duplicateBinaryGroups ?? null}
          hint={s ? `${s.duplicateOccurrences} occurrences · ${s.uniqueBinaries} unique files` : undefined}
        />
        <Tile label="Unsupported / failed" icon={ImageOff} value={s?.unsupportedOrFailed ?? null} hint="Occurrences" />
        <Tile label="Needing review" icon={ListChecks} value={s?.needingReview ?? null} hint={s ? `${s.needsAttention} flagged needs attention` : undefined} />
      </ul>
    </section>
  )
}
