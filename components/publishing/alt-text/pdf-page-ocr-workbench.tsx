"use client"
import {OcrEvidenceReviewButton} from "./ocr-evidence-review"
import { useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { WorkbenchDrawer } from "./workbench"
import { altTextFetcher } from "@/lib/alt-text/client"
import { OCR_LANGUAGE_MODES, type OcrLanguageMode, type OcrPageSegmentation } from "@/lib/alt-text/ocr-contract"
import { DOCUMENT_CLASS_LABELS, PAGE_CLASS_LABELS, PAGE_OCR_STATUS_LABELS } from "@/lib/alt-text/pdf-page-ocr-contract"
import { canSelectPage, type PageOcrRequest, type PageOcrResponse } from "@/lib/alt-text/pdf-page-ocr-types"
import type { DocumentRecord } from "@/lib/alt-text/document-records"

/** Saved evidence only on open. Rendering, inspection and OCR each require an explicit action. */
export function PdfPageOcrWorkbench({ document: doc }: { document: DocumentRecord }) {
  const [open, setOpen] = useState(false)
  return <><Button size="sm" variant="outline" onClick={() => setOpen(true)}>Page OCR &amp; results</Button>
    <WorkbenchDrawer size="full" open={open} onOpenChange={setOpen} title="Scanned page text recognition" description={doc.filename}
      footer={<Button size="sm" onClick={() => setOpen(false)}>Close</Button>}>
      {open && <PageOcrPanel key={doc.id} document={doc} />}
    </WorkbenchDrawer></>
}
function PageOcrPanel({ document: doc }: { document: DocumentRecord }) {
  const base = `/api/alt-text/documents/${doc.id}/page-ocr`
  const [offset, setOffset] = useState(0), [selected, setSelected] = useState<number[]>([])
  const [pageIndex, setPageIndex] = useState<number | null>(null), [preview, setPreview] = useState(false)
  const [raw, setRaw] = useState(false), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false)
  const [language, setLanguage] = useState<OcrLanguageMode | "">("")
  const [mode, setMode] = useState<"auto" | "selected" | "retry" | "reprocess">("selected")
  const [dpi, setDpi] = useState(300), [segmentation, setSegmentation] = useState<OcrPageSegmentation>("auto")
  const list = useSWR<PageOcrResponse>(`${base}?offset=${offset}`, altTextFetcher, { revalidateOnFocus: false, refreshInterval: (data) => data?.job && ["queued", "running"].includes(data.job.status) ? 3000 : 0 })
  const detail = useSWR<PageOcrResponse>(pageIndex == null ? null : `${base}?pageIndex=${pageIndex}`, altTextFetcher, { revalidateOnFocus: false, refreshInterval: list.data?.progress.outcome === "running" ? 3000 : 0 })
  const data = list.data, page = detail.data?.pages[0], result = page?.result
  const active = data?.job && ["queued", "running"].includes(data.job.status)
  const languageMode = language || data?.policy.defaultMode || "eng"
  const request: Extract<PageOcrRequest, { action: "recognize" }> = { action: "recognize", mode, pages: selected, languageMode, dpi, segmentation }
  const languageAvailable = data?.policy.modes.find((m) => m.id === languageMode)?.available
  const count = mode === "auto" ? data?.progress.eligible ?? 0 : mode === "retry" && !selected.length ? (data?.progress.failed ?? 0) + (data?.progress.cancelled ?? 0) : selected.length
  async function send(body: unknown, method = "POST") {
    setBusy(true)
    try {
      const response = await fetch(base, { method, headers: { "Content-Type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error || "The request failed.")
      setConfirm(false); setSelected([])
      await Promise.all([list.mutate(), detail.mutate()])
      toast.success(method === "DELETE" ? "Cancellation requested" : "Work saved to the processing queue")
    } catch (e) { toast.error(e instanceof Error ? e.message : "The request failed.") } finally { setBusy(false) }
  }
  return <section aria-label="Page OCR workbench" className="flex min-w-0 flex-col gap-4">
    <p className="text-xs text-muted-foreground">Recognizes printed text locally. The original PDF stays unchanged. OCR text is unverified evidence; it does not make a PDF accessible or validate equations.</p>
    {list.error && <p role="alert">Saved page results could not be loaded. <Button size="sm" variant="outline" onClick={() => list.mutate()}>Try again</Button></p>}
    {!data ? <p role="status">Loading saved page evidence…</p> : <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{data.total ? DOCUMENT_CLASS_LABELS[data.documentClass] : "Pages not inspected"}</span>
        <Button size="sm" variant="outline" disabled={!data.canRun || !!active || busy} onClick={() => send({ action: "inspect" })}>Inspect pages</Button>
        <Button size="sm" disabled={!data.canRun || !data.policy.enabled || !languageAvailable || !!active || busy || !count} onClick={() => setConfirm(true)}>Recognize Scanned Pages</Button>
        {!!active && data.canRun && <Button size="sm" variant="outline" disabled={busy} onClick={() => send(null, "DELETE")}>Cancel OCR work</Button>}
      </div>
      {!data.policy.enabled && <p className="text-xs" role="status">{data.policy.reason}</p>}
      {data.job && <p className="text-xs" role="status">{data.job.action === "inspect" ? "Page inspection" : "OCR job"}: {data.job.status}{data.job.outcome ? ` · page outcome: ${data.job.outcome}` : ""}{data.job.errorCode ? ` · ${data.job.errorCode}` : ""}</p>}
      <div aria-live="polite" className="rounded-md border bg-muted/30 p-3 text-xs leading-relaxed">
        {data.total} total · {data.progress.eligible} eligible · {data.progress.needsReview} need review · {data.progress.notRequired} not required · {data.progress.queued} queued · {data.progress.rendering} rendering · {data.progress.recognizing} recognizing · {data.progress.completed + data.progress.completedWithWarnings} completed · {data.progress.noTextDetected} no text · {data.progress.failed} failed · {data.progress.unsupported} unsupported · {data.progress.cancelled} cancelled
        {data.progress.inScope > 0 && <span> · {data.progress.scopePercent}% of OCR scope finished ({data.progress.outcome})</span>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs">Recognition language<select className="mt-1 w-full rounded border bg-background p-2" value={languageMode} onChange={(e) => setLanguage(e.target.value as OcrLanguageMode)}>{data.policy.modes.map((m) => <option key={m.id} value={m.id} disabled={!m.available}>{m.label}{!m.available ? " — unavailable" : ""}</option>)}</select></label>
        <label className="text-xs">Processing scope<select className="mt-1 w-full rounded border bg-background p-2" value={mode} onChange={(e) => { setMode(e.target.value as typeof mode); setSelected([]) }}><option value="selected">Reviewed selection</option><option value="auto">Eligible scanned pages</option><option value="retry">Failed or cancelled pages</option><option value="reprocess">Explicitly reprocess selection</option></select></label>
        <label className="text-xs">Render resolution<select className="mt-1 w-full rounded border bg-background p-2" value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>{[200,300,400].map((n) => <option key={n} value={n}>{n} DPI (bounded fallback)</option>)}</select></label>
        <label className="text-xs">Printed text layout<select className="mt-1 w-full rounded border bg-background p-2" value={segmentation} onChange={(e) => setSegmentation(e.target.value as OcrPageSegmentation)}><option value="auto">Automatic blocks / columns</option><option value="single_block">Single text block</option><option value="single_line">Single line</option><option value="sparse_text">Sparse labels</option></select></label>
      </div>
      {confirm && <div role="dialog" aria-modal="false" aria-labelledby="page-ocr-confirm" className="rounded-md border bg-muted p-4 text-sm">
        <h3 id="page-ocr-confirm" className="font-semibold">Confirm page text recognition</h3>
        <p>{doc.filename} · {data.total} pages · {count} selected · {data.progress.completed + data.progress.completedWithWarnings + data.progress.noTextDetected} already processed · {OCR_LANGUAGE_MODES[languageMode].label}</p>
        <p className="mt-2 text-xs">Scope: {mode}. One page at a time; up to 500 pages, 25 million pixels per raster; render 30 seconds, recognition 120 seconds. Photos may produce no text. Existing native text and previous OCR evidence are kept separately.</p>
        {mode === "reprocess" && <p className="mt-2 text-xs">This explicitly authorizes new recognition for the selected pages, including pages with an existing text layer.</p>}
        <div className="mt-3 flex gap-2"><Button size="sm" disabled={busy} onClick={() => send({ ...request, confirmReprocess: mode === "reprocess" })}>Confirm recognition</Button><Button size="sm" variant="outline" onClick={() => setConfirm(false)}>Back</Button></div>
      </div>}
      <p className="text-xs text-muted-foreground">A full-page image is a scan candidate, and may be a photo. Review candidates before selecting OCR. Pages with native text require explicit reprocessing.</p>
      <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 overflow-auto rounded border">
          <table className="w-full text-left text-xs"><caption className="p-2 text-left font-medium">Pages — {selected.length} selected</caption><thead><tr><th className="p-2">Select</th><th>Page / type</th><th>Status / language / date</th><th>Actions</th></tr></thead>
            <tbody>{data.pages.map((p) => <tr key={p.pageIndex} className="border-t align-top"><td className="p-2"><input type="checkbox" aria-label={`Select page ${p.pageNumber}`} checked={selected.includes(p.pageIndex)} disabled={!!active || mode === "auto" || !canSelectPage(p, request)} onChange={(e) => setSelected((s) => e.target.checked ? [...s, p.pageIndex] : s.filter((i) => i !== p.pageIndex))} /></td><td className="p-2">{p.pageNumber} · {PAGE_CLASS_LABELS[p.classification.pageClass]}</td><td className="p-2">{PAGE_OCR_STATUS_LABELS[p.status]}{p.result && <><br />{OCR_LANGUAGE_MODES[p.result.languageMode].label}<br />{new Date(p.result.createdAt).toLocaleString()}<br />{p.result.normalizedText.slice(0,100)}</>}{p.errorCode && <p>{p.errorCode}</p>}</td><td className="p-2"><Button variant="outline" size="sm" onClick={() => { setPageIndex(p.pageIndex); setPreview(false) }}>View text</Button>{["failed", "cancelled"].includes(p.status) && <Button size="sm" variant="outline" disabled={!data.canRun || !!active || busy || !data.policy.enabled} onClick={() => { setMode("retry"); setSelected([p.pageIndex]); setConfirm(true) }}>Retry page</Button>}</td></tr>)}</tbody></table>
          <div className="flex items-center justify-between border-t p-2"><Button size="sm" variant="outline" disabled={!offset} onClick={() => setOffset((n) => Math.max(0,n-25))}>Previous</Button><span>{data.total ? offset + 1 : 0}–{Math.min(offset+25,data.total)} / {data.total}</span><Button size="sm" variant="outline" disabled={offset+25>=data.total} onClick={() => setOffset((n) => n+25)}>Next</Button></div>
        </div>
        <div className="min-w-0 rounded border p-3"><h3 className="text-sm font-medium">Source page {pageIndex == null ? "" : pageIndex + 1}</h3>{pageIndex == null ? <p className="text-xs">Choose a page to inspect.</p> : !preview ? <Button className="mt-3" size="sm" variant="outline" onClick={() => setPreview(true)}>View page preview</Button> : <img className="mt-2 max-h-[60vh] w-full object-contain" src={`${base}/preview?pageIndex=${pageIndex}`} alt={`Original PDF page ${pageIndex + 1}`} onError={() => toast.error("The page preview could not be rendered. Try again later.")} />}</div>
        <div className="min-w-0 rounded border p-3"><h3 className="text-sm font-medium">Text evidence inspector</h3>
          {detail.error && <p role="alert">The saved page evidence could not be loaded.</p>}
          {page && <><p className="my-2 text-xs">{PAGE_OCR_STATUS_LABELS[page.status]} · {page.attempts} attempts{result ? ` · ${OCR_LANGUAGE_MODES[result.languageMode].label} · engine confidence ${result.meanConfidence ?? "unavailable"}` : ""}</p>
            {page.classification.reasons.map((r) => <p key={r} className="text-xs text-muted-foreground">{r}</p>)}
            {page.nativeText && <details className="my-2 text-xs"><summary>Native PDF text (unchanged)</summary><pre className="max-h-40 overflow-auto whitespace-pre-wrap">{page.nativeText}</pre></details>}
            {(result||["failed","cancelled"].includes(page.status))&&<OcrEvidenceReviewButton target={{kind:"page_ocr",sourceId:result?.identity??`failure_${page.jobId??0}`,assetId:null,occurrenceId:null,documentId:doc.id,pageIndex:page.pageIndex}}/>}
            {result ? <><p className="my-2 text-xs">OCR page text · run {result.runId} · {result.render.dpi} DPI{result.runId !== page.jobId ? " · previous successful result" : ""}</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setRaw(!raw)}>{raw ? "Show normalized text" : "Show raw text"}</Button><Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(raw ? result.rawText : result.normalizedText).then(() => toast.success("Text copied")).catch(() => toast.error("Copy failed"))}>Copy text</Button></div><pre className="my-3 max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm" lang={result.languageMode === "hin" ? "hi" : undefined}>{raw ? result.rawText : result.normalizedText || "No text detected."}</pre>{result.warnings.map((w) => <p key={w} className="mt-1 text-xs">{w}</p>)}<details className="mt-2 text-xs"><summary>Supported page coordinates and lines</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{JSON.stringify({ coordinateSystems: result.coordinateSystems, viewportTransform: result.render.viewportTransform, lines: result.lines }, null, 2)}</pre></details></> : <p className="mt-3 text-xs">No saved OCR result for this page.</p>}</>}
        </div>
      </div>
    </>}
  </section>
}
