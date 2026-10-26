"use client"

/**
 * @file components/publishing/alt-text/alt-text-asset-drawer.tsx
 * @module Publishing
 * @kind React client component
 * @summary History details drawer (Task 18): asset detail, manual edit with optimistic
 *   concurrency (PATCH expectedVersion), read-only version history and single-asset export.
 */
import { useEffect, useState, type ReactNode } from "react"
import useSWR, { useSWRConfig } from "swr"
import { toast } from "sonner"
import { AlertCircle, Download, History, Pencil, Save, SquarePen, X } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { ErrorState } from "@/components/enterprise/data-state"
import type { ExportFormat } from "@/lib/alt-text/export"
import type { AltTextAssetResponse, AltTextAssetView, AltTextVersionList } from "@/lib/alt-text/history"
import {
  AltTextApiError,
  altTextFetcher,
  assetUrl,
  assetVersionsUrl,
  isAltTextAssetKey,
  isVersionConflict,
  saveAltTextEdit,
  type ApiError,
} from "@/lib/alt-text/client"
import { AssetImage, StatusBadge, classificationLabel, exportAsset, formatDateTime, languageLabel } from "./alt-text-history"
import { ImageClassificationPanel } from "./image-classification-panel"
import { ImageOcrPanel } from "./image-ocr-panel"
import { ImageRegionsPanel } from "./image-regions-panel"
import { MathRecognitionPanel } from "./math-recognition-panel"
import {ChartStructurePanel} from "./chart-structure-panel"

export type DrawerFocus = "view" | "edit" | "versions"

const CHANGE_LABELS: Record<string, string> = { generate: "AI generated", regenerate: "AI regenerated", edit: "Manual edit", manual_edit: "Manual edit" }

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  )
}

function TextBlock({ text, lang, empty }: { text: string | null; lang: string; empty: string }) {
  return text ? (
    <p className="whitespace-pre-wrap rounded-md border bg-muted/20 p-3 text-sm leading-relaxed text-foreground" lang={lang}>
      {text}
    </p>
  ) : (
    <p className="text-sm text-muted-foreground">{empty}</p>
  )
}

function VersionHistory({ asset }: { asset: AltTextAssetView }) {
  const { data, error, isLoading, mutate } = useSWR<AltTextVersionList, AltTextApiError>(assetVersionsUrl(asset.id), altTextFetcher, {
    revalidateOnFocus: false,
  })
  if (error) return <ErrorState title="Could not load versions" message={error.apiError.message} onRetry={() => mutate()} />
  if (isLoading || !data) return <Skeleton className="h-24 w-full" />
  if (data.versions.length === 0) return <p className="text-sm text-muted-foreground">No versions recorded yet.</p>
  return (
    <ol className="flex flex-col gap-2">
      {data.versions.map((v) => (
        <li key={v.version}>
          <details className="group rounded-md border bg-card">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 p-3 text-sm focus-visible:outline-2 focus-visible:outline-ring">
              <span className="font-mono font-semibold tabular-nums">v{v.version}</span>
              <Badge variant="outline">{CHANGE_LABELS[v.changeType] ?? v.changeType}</Badge>
              {v.version === asset.currentVersion && <Badge variant="secondary">Current</Badge>}
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                {v.editor ? `${v.editor.name} · ` : ""}
                <time dateTime={v.createdAt}>{formatDateTime(v.createdAt)}</time>
              </span>
            </summary>
            <div className="flex flex-col gap-3 border-t p-3">
              {v.modelId && <p className="text-xs text-muted-foreground">Model: <span className="font-mono">{v.modelId}</span></p>}
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-muted-foreground">Short Alt Text</p>
                <TextBlock text={v.shortAlt} lang={asset.language} empty="Empty" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-muted-foreground">Detailed Description</p>
                <TextBlock text={v.longDescription} lang={asset.language} empty="Empty" />
              </div>
            </div>
          </details>
        </li>
      ))}
    </ol>
  )
}

function DrawerBody({
  asset,
  focus,
  onDirtyChange,
  onOpenInEditor,
}: {
  asset: AltTextAssetView
  focus: DrawerFocus
  onDirtyChange: (dirty: boolean) => void
  onOpenInEditor: (asset: AltTextAssetView) => void
}) {
  const { mutate } = useSWRConfig()
  const [editing, setEditing] = useState(focus === "edit")
  const [shortAlt, setShortAlt] = useState(asset.shortAlt ?? "")
  const [longDescription, setLongDescription] = useState(asset.longDescription ?? "")
  const [baseVersion, setBaseVersion] = useState(asset.currentVersion)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<ApiError | null>(null)
  const [showVersions, setShowVersions] = useState(focus === "versions")

  const dirty = editing && (shortAlt !== (asset.shortAlt ?? "") || longDescription !== (asset.longDescription ?? ""))
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  const resetDrafts = (a: AltTextAssetView) => {
    setShortAlt(a.shortAlt ?? "")
    setLongDescription(a.longDescription ?? "")
    setBaseVersion(a.currentVersion)
    setSaveError(null)
  }

  const save = async () => {
    setSaving(true)
    setSaveError(null)
    const r = await saveAltTextEdit(asset.id, { expectedVersion: baseVersion, shortAlt, longDescription })
    setSaving(false)
    if (!r.ok) {
      setSaveError(r.error)
      return
    }
    await mutate(assetUrl(asset.id), { success: true, asset: r.data.asset } satisfies AltTextAssetResponse, { revalidate: false })
    void mutate((k) => isAltTextAssetKey(k) && k !== assetUrl(asset.id))
    resetDrafts(r.data.asset)
    setEditing(false)
    toast.success(`Saved version ${r.data.asset.currentVersion}`)
  }

  const reloadLatest = async () => {
    const latest = await mutate<AltTextAssetResponse>(assetUrl(asset.id))
    if (latest) resetDrafts(latest.asset)
    void mutate(assetVersionsUrl(asset.id))
  }

  const conflict = saveError && isVersionConflict(saveError)

  return (
    <div className="flex flex-col gap-5 px-4 pb-6">
      <div className="overflow-hidden rounded-lg border bg-muted/30">
        <AssetImage id={asset.id} alt={asset.shortAlt ?? `Preview of ${asset.fileName}`} className="max-h-72 w-full !object-contain" />
      </div>

      <div className="flex flex-wrap gap-2">
        {!editing && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil aria-hidden="true" /> Edit
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => onOpenInEditor(asset)} disabled={dirty}>
          <SquarePen aria-hidden="true" /> Open in Editor
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={dirty}>
              <Download aria-hidden="true" /> Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {(["txt", "csv", "json"] as ExportFormat[]).map((f) => (
              <DropdownMenuItem key={f} onSelect={() => void exportAsset(asset, f)}>
                {f.toUpperCase()}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <dl className="grid grid-cols-2 gap-4">
        <Field label="Classification">{classificationLabel(asset.classification)}</Field>
        <Field label="Output language">{languageLabel(asset.language)}</Field>
        <Field label="Status">
          <StatusBadge status={asset.status} />
        </Field>
        <Field label="Version">
          <span className="font-mono tabular-nums">v{asset.currentVersion}</span>
        </Field>
        {asset.modelId && (
          <Field label="AI model">
            <span className="break-all font-mono text-xs">{asset.modelId}</span>
          </Field>
        )}
        {asset.projectName && <Field label="Project">{asset.projectName}</Field>}
        {asset.reviewerName && <Field label="Reviewer">{asset.reviewerName}</Field>}
        <Field label="Created">
          <time dateTime={asset.createdAt}>{formatDateTime(asset.createdAt)}</time>
        </Field>
        <Field label="Last updated">
          <time dateTime={asset.updatedAt}>{formatDateTime(asset.updatedAt)}</time>
        </Field>
      </dl>

      <Separator />

      {saveError && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>{conflict ? "Newer version on the server" : "Could not save"}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>{saveError.message}</span>
            {conflict && (
              <Button size="sm" variant="outline" className="w-fit" onClick={() => void reloadLatest()}>
                Load latest (discard my edits)
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {editing ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="drawer-short-alt">Short Alt Text</Label>
            <Textarea id="drawer-short-alt" rows={3} value={shortAlt} lang={asset.language} onChange={(e) => setShortAlt(e.target.value)} maxLength={1000} disabled={saving} />
            <p className="text-xs tabular-nums text-muted-foreground">{shortAlt.length} characters</p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="drawer-long-desc">Detailed Description</Label>
            <Textarea id="drawer-long-desc" rows={7} value={longDescription} lang={asset.language} onChange={(e) => setLongDescription(e.target.value)} maxLength={20000} disabled={saving} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void save()} disabled={!dirty || saving || !!conflict}>
              {saving ? <Spinner /> : <Save aria-hidden="true" />}
              {saving ? "Saving" : "Save Changes"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() => {
                resetDrafts(asset)
                setEditing(false)
              }}
            >
              <X aria-hidden="true" /> Cancel
            </Button>
            {dirty && <span className="text-xs text-amber-700">Unsaved changes</span>}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-2" aria-labelledby="drawer-short-h">
            <h3 id="drawer-short-h" className="text-sm font-semibold">Short Alt Text</h3>
            <TextBlock text={asset.shortAlt} lang={asset.language} empty={asset.classification === "decorative" ? 'Intentionally empty (alt="").' : "Not generated."} />
          </section>
          <section className="flex flex-col gap-2" aria-labelledby="drawer-long-h">
            <h3 id="drawer-long-h" className="text-sm font-semibold">Detailed Description</h3>
            <TextBlock text={asset.longDescription} lang={asset.language} empty="No detailed description." />
          </section>
        </div>
      )}

      <section className="flex flex-col gap-2" aria-labelledby="drawer-text-h">
        <h3 id="drawer-text-h" className="text-sm font-semibold">Extracted Visible Text</h3>
        <TextBlock text={asset.extractedText} lang={asset.language} empty="No visible text extracted." />
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="drawer-warn-h">
        <h3 id="drawer-warn-h" className="text-sm font-semibold">Accessibility Warnings</h3>
        {asset.warnings.length ? (
          <ul className="flex flex-col gap-1.5">
            {asset.warnings.map((w, i) => (
              <li key={i} className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {w}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No warnings.</p>
        )}
      </section>

      <Separator />

      <ImageClassificationPanel assetId={asset.id} />

      <Separator />

      <ImageRegionsPanel assetId={asset.id} />

      <Separator />

      <ImageOcrPanel assetId={asset.id} />
      <MathRecognitionPanel key={`math-${asset.id}`} assetId={asset.id} />
      <ChartStructurePanel key={`chart-${asset.id}`} assetId={asset.id}/>

      <Separator />

      <section className="flex flex-col gap-3" aria-labelledby="drawer-versions-h">
        <div className="flex items-center justify-between gap-2">
          <h3 id="drawer-versions-h" className="flex items-center gap-2 text-sm font-semibold">
            <History className="size-4 text-muted-foreground" aria-hidden="true" /> Version History
          </h3>
          <Button size="sm" variant="ghost" aria-expanded={showVersions} onClick={() => setShowVersions((s) => !s)}>
            {showVersions ? "Hide" : "Show"}
          </Button>
        </div>
        {showVersions && <VersionHistory asset={asset} />}
      </section>
    </div>
  )
}

export function AltTextAssetDrawer({
  assetId,
  focus,
  onClose,
  onOpenInEditor,
}: {
  assetId: number | null
  focus: DrawerFocus
  onClose: () => void
  onOpenInEditor: (asset: AltTextAssetView) => void
}) {
  const { data, error, isLoading, mutate } = useSWR<AltTextAssetResponse, AltTextApiError>(assetId ? assetUrl(assetId) : null, altTextFetcher, {
    revalidateOnFocus: false,
  })
  const [dirty, setDirty] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  const close = () => {
    setDirty(false)
    setConfirmClose(false)
    onClose()
  }
  const asset = data?.asset

  return (
    <>
      <Sheet open={assetId !== null} onOpenChange={(open) => !open && (dirty ? setConfirmClose(true) : close())}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle className="truncate pr-6">{asset?.fileName ?? "Alt text details"}</SheetTitle>
            <SheetDescription>Saved alt text, accessibility review and version history.</SheetDescription>
          </SheetHeader>
          {error ? (
            <ErrorState title="Could not load asset" message={error.apiError.message} onRetry={() => mutate()} />
          ) : isLoading || !asset ? (
            <div className="flex flex-col gap-3 px-4">
              <Skeleton className="h-56 w-full" />
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <DrawerBody key={`${asset.id}-${focus}`} asset={asset} focus={focus} onDirtyChange={setDirty} onOpenInEditor={onOpenInEditor} />
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>Your edits to this alt text have not been saved and will be lost.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={close}>Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
