"use client"

/**
 * @file components/publishing/alt-text/alt-text-workspace.tsx
 * @module Publishing
 * @kind React client component
 * @summary AI Alt Text Writer workspace: Generate / History tabs and the 40/60
 *   image-settings / results layout. History (Task 18) can open a saved asset
 *   back into the Generate editor, where it is saved, regenerated and exported
 *   through the existing Alt Text APIs.
 */
import { useEffect, useRef, useState } from "react"
import { useSWRConfig } from "swr"
import { FileText, History, ImagePlus, Layers, Settings2, SlidersHorizontal, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Workbench, WorkbenchDrawer, WorkbenchScroll, WorkbenchToolbar } from "./workbench"
import { AccessibilitySettingsWorkspace } from "./accessibility-settings-workspace"
import { BulkProcessingWorkspace } from "./bulk-processing-workspace"
import { DocumentProcessingWorkspace } from "./document-processing-workspace"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ImageInputPanel, type SelectedImage } from "./image-input-panel"
import {
  DEFAULT_GENERATION_SETTINGS,
  DESCRIPTION_MODES,
  GENERATION_IMAGE_TYPES,
  IMAGE_CLASSIFICATIONS,
  LANGUAGES,
  type GenerationImageType,
  type GenerationSettings,
  type ImageClassification,
  type LanguageCode,
} from "@/lib/alt-text/core"
import type { ExportFormat } from "@/lib/alt-text/export"
import type { AltTextAssetView } from "@/lib/alt-text/history"
import {
  fetchAltTextExport,
  generateAltText,
  getAltTextAsset,
  isAltTextAssetKey,
  isScanPending,
  isVersionConflict,
  newRequestId,
  saveAltTextEdit,
  triggerDownload,
  uploadAltTextImage,
} from "@/lib/alt-text/client"

const SCAN_RETRY_DELAYS_MS = [1500, 2500, 4000, 6000, 8000]
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
import { GenerationSettingsPanel, PURPOSE_LABELS } from "./generation-settings-panel"
import {
  AltTextResultsPanel,
  type GeneratedOutput,
  type GenerationStatus,
  type GenerationUsage,
  type SavedContent,
} from "./alt-text-results-panel"
import { AltTextHistory, AssetImage, StatusBadge } from "./alt-text-history"

type Drafts = { shortAlt?: string; longDescription?: string }

function SettingsSummary({ settings, onEdit }: { settings: GenerationSettings; onEdit: () => void }) {
  const items = [
    { label: "Purpose", value: PURPOSE_LABELS[settings.imagePurpose] },
    { label: "Image type", value: GENERATION_IMAGE_TYPES[settings.imageType] },
    { label: "Output", value: DESCRIPTION_MODES[settings.descriptionMode] },
    { label: "Language", value: LANGUAGES[settings.outputLanguage] },
  ]
  return (
    <section aria-labelledby="gen-settings-summary" className="flex flex-col gap-2 rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="gen-settings-summary" className="text-sm font-semibold text-foreground">
          Generation settings
        </h2>
        <Button variant="ghost" size="sm" onClick={onEdit} aria-haspopup="dialog">
          <SlidersHorizontal aria-hidden="true" /> Edit
        </Button>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {items.map((item) => (
          <div key={item.label} className="flex min-w-0 flex-col">
            <dt className="text-muted-foreground">{item.label}</dt>
            <dd className="truncate font-medium text-foreground">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function settingsForAsset(asset: AltTextAssetView, base: GenerationSettings): GenerationSettings {
  const imageType = asset.classification && asset.classification in GENERATION_IMAGE_TYPES ? (asset.classification as GenerationImageType) : "auto"
  return {
    ...base,
    imageType,
    imagePurpose: asset.classification === "decorative" ? "decorative" : base.imagePurpose === "decorative" ? "informative" : base.imagePurpose,
    outputLanguage: asset.language in LANGUAGES ? (asset.language as LanguageCode) : base.outputLanguage,
  }
}

function outputForAsset(asset: AltTextAssetView, settings: GenerationSettings): GeneratedOutput | null {
  if (asset.shortAlt === null && asset.longDescription === null && asset.extractedText === null) return null
  const classification = (IMAGE_CLASSIFICATIONS as readonly string[]).includes(asset.classification ?? "")
    ? (asset.classification as ImageClassification)
    : "other"
  return {
    result: {
      classification,
      shortAlt: asset.shortAlt ?? "",
      longDescription: asset.longDescription ?? "",
      extractedText: asset.extractedText ?? "",
      warnings: asset.warnings,
      treatment: asset.treatment ?? "",
    },
    language: settings.outputLanguage,
    purpose: settings.imagePurpose,
  }
}

export function AltTextWorkspace() {
  const { mutate } = useSWRConfig()
  const [tab, setTab] = useState("generate")
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [settingsKey, setSettingsKey] = useState(0)
  const [pendingTab, setPendingTab] = useState<string | null>(null)
  const changeTab = (next: string) => {
    if (tab === "settings" && next !== "settings" && settingsDirty) setPendingTab(next)
    else setTab(next)
  }
  const [batchRequest, setBatchRequest] = useState<{ id: string; nonce: number } | null>(null)
  const [settings, setSettings] = useState<GenerationSettings>(DEFAULT_GENERATION_SETTINGS)
  const [image, setImage] = useState<SelectedImage | null>(null)
  const [savedAsset, setSavedAsset] = useState<AltTextAssetView | null>(null)
  const [status, setStatus] = useState<GenerationStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const [output, setOutput] = useState<GeneratedOutput | null>(null)
  const [saved, setSaved] = useState<SavedContent | null>(null)
  const [usage, setUsage] = useState<GenerationUsage | null>(null)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [saveError, setSaveError] = useState<{ title: string; message: string } | null>(null)
  const [dirtyFields, setDirtyFields] = useState({ shortAlt: false, longDescription: false })
  const [pendingOpen, setPendingOpen] = useState<AltTextAssetView | "new" | null>(null)
  const [editorKey, setEditorKey] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const drafts = useRef<Drafts>({})
  const dirty = dirtyFields.shortAlt || dirtyFields.longDescription

  const previewUrl = image?.previewUrl
  useEffect(() => {
    if (!previewUrl) return
    return () => URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  const resetEditor = () => {
    setStatus("idle")
    setError(null)
    setOutput(null)
    setSaved(null)
    setUsage(null)
    setSaveError(null)
    setDirtyFields({ shortAlt: false, longDescription: false })
    drafts.current = {}
    setEditorKey((k) => k + 1)
  }

  const handleImageChange = (next: SelectedImage | null) => {
    setImage(next)
    resetEditor()
  }

  const loadAsset = (asset: AltTextAssetView) => {
    const nextSettings = settingsForAsset(asset, settings)
    resetEditor()
    setImage(null)
    setSavedAsset(asset)
    setSettings(nextSettings)
    setOutput(outputForAsset(asset, nextSettings))
    setSaved({ shortAlt: asset.shortAlt, longDescription: asset.longDescription, version: asset.currentVersion })
    setTab("generate")
  }

  const startNew = () => {
    setSavedAsset(null)
    setImage(null)
    resetEditor()
  }

  const requestOpen = (target: AltTextAssetView | "new") => {
    if (dirty) return setPendingOpen(target)
    if (target === "new") startNew()
    else loadAsset(target)
  }

  const refreshHistory = () => void mutate(isAltTextAssetKey)

  const handleSave = async () => {
    if (!savedAsset || !saved) return
    setSaving(true)
    setSaveError(null)
    const r = await saveAltTextEdit(savedAsset.id, { expectedVersion: saved.version, ...drafts.current })
    setSaving(false)
    if (!r.ok) {
      setSaveError(
        isVersionConflict(r.error)
          ? { title: "Newer version on the server", message: `${r.error.message} Reopen this asset from History to load the latest version.` }
          : { title: "Could not save", message: r.error.message },
      )
      return
    }
    const a = r.data.asset
    setSavedAsset(a)
    setSaved({ shortAlt: a.shortAlt, longDescription: a.longDescription, version: a.currentVersion })
    drafts.current = {}
    refreshHistory()
  }

  const uploadSelectedImage = async (selected: SelectedImage): Promise<AltTextAssetView | null> => {
    const up = await uploadAltTextImage(selected.file)
    if (!up.ok) {
      setError(up.error.message)
      return null
    }
    const fetched = await getAltTextAsset(up.data.id)
    if (!fetched.ok) {
      setError(fetched.error.message)
      return null
    }
    setSavedAsset(fetched.data.asset)
    setImage(null)
    refreshHistory()
    return fetched.data.asset
  }

  /** Scan rejection happens before any credit claim, so retrying with the same request id cannot double-bill. */
  const generateWhenScanned = async (assetId: number) => {
    const requestId = newRequestId()
    let r = await generateAltText(assetId, settings, requestId)
    for (const delay of SCAN_RETRY_DELAYS_MS) {
      if (r.ok || !isScanPending(r.error)) break
      await wait(delay)
      r = await generateAltText(assetId, settings, requestId)
    }
    return r
  }

  const handleRegenerate = async () => {
    if (!savedAsset && !image) return
    setStatus("generating")
    setError(null)
    setSaveError(null)
    const asset = savedAsset ?? (image ? await uploadSelectedImage(image) : null)
    if (!asset) {
      setStatus("idle")
      return
    }
    const r = await generateWhenScanned(asset.id)
    setStatus("idle")
    if (!r.ok) {
      setError(
        isScanPending(r.error)
          ? "The image was uploaded and saved, but its security scan is still running. Try generating again in a moment."
          : r.error.message,
      )
      return
    }
    const { result, version, usage: u } = r.data
    setOutput({ result, language: settings.outputLanguage, purpose: settings.imagePurpose })
    setSaved({ shortAlt: result.shortAlt, longDescription: result.longDescription, version })
    setUsage({ model: u.model, creditsCharged: u.creditsCharged, creditsReserved: u.creditsReserved })
    setSavedAsset((prev) => (prev ? { ...prev, ...result, currentVersion: version } : prev))
    drafts.current = {}
    refreshHistory()
  }

  const handleExport = async (format: ExportFormat) => {
    if (!savedAsset) return
    setExporting(true)
    const r = await fetchAltTextExport(savedAsset.id, format)
    setExporting(false)
    if (!r.ok) return setSaveError({ title: "Export failed", message: r.error.message })
    triggerDownload(r.data.blob, r.data.filename)
  }

  const generateBlockedReason: string | null = null
  const customizedSettings = (Object.keys(DEFAULT_GENERATION_SETTINGS) as (keyof GenerationSettings)[]).filter(
    (key) => settings[key] !== DEFAULT_GENERATION_SETTINGS[key],
  ).length

  return (
    <>
      <Tabs value={tab} onValueChange={changeTab} className="flex min-h-0 min-w-0 flex-col gap-3 lg:flex-1">
        <TabsList className="w-full shrink-0 overflow-x-auto sm:w-fit">
          <TabsTrigger value="generate" className="flex-1 gap-2 sm:flex-none">
            <Sparkles className="size-4" aria-hidden="true" />
            Generate
          </TabsTrigger>
          <TabsTrigger value="bulk" className="flex-1 gap-2 sm:flex-none">
            <Layers className="size-4" aria-hidden="true" />
            Bulk Processing
          </TabsTrigger>
          <TabsTrigger value="documents" className="flex-1 gap-2 sm:flex-none">
            <FileText className="size-4" aria-hidden="true" />
            Document Processing
          </TabsTrigger>
          <TabsTrigger value="history" className="flex-1 gap-2 sm:flex-none">
            <History className="size-4" aria-hidden="true" />
            History
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex-1 gap-2 sm:flex-none">
            <Settings2 className="size-4" aria-hidden="true" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="generate" className="mt-0 min-h-0 flex-1">
          <Workbench>
            <WorkbenchToolbar
              label="Generate actions"
              title={savedAsset ? <span title={savedAsset.fileName}>{savedAsset.fileName}</span> : image ? image.file.name : "New image"}
              meta={
                savedAsset ? (
                  <>
                    <span className="hidden font-mono text-xs tabular-nums text-muted-foreground sm:inline">#{savedAsset.id}</span>
                    <StatusBadge status={savedAsset.status} />
                  </>
                ) : null
              }
            >
              <Button
                variant="outline"
                size="sm"
                onClick={() => requestOpen("new")}
                disabled={(!savedAsset && !image) || saving || status === "generating"}
              >
                <ImagePlus aria-hidden="true" /> New Image
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)} aria-haspopup="dialog">
                <SlidersHorizontal aria-hidden="true" /> Configure
                {customizedSettings > 0 ? (
                  <Badge variant="secondary" className="ml-0.5 h-4 px-1.5 text-[10px] tabular-nums">
                    {customizedSettings}
                    <span className="sr-only"> customized</span>
                  </Badge>
                ) : null}
              </Button>
            </WorkbenchToolbar>

            <div className="flex min-h-0 min-w-0 flex-col gap-3 lg:flex-1 lg:flex-row">
              <WorkbenchScroll className="flex flex-col gap-3 lg:w-[42%] lg:max-w-xl lg:flex-none">
                {savedAsset ? (
                  <div className="flex flex-col gap-3 rounded-lg border bg-card p-3">
                    <div className="flex items-center justify-center overflow-hidden rounded-md border bg-muted/30">
                      <AssetImage
                        id={savedAsset.id}
                        alt={savedAsset.shortAlt ?? `Preview of ${savedAsset.fileName}`}
                        className="max-h-[min(55dvh,28rem)] w-full !object-contain"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Saved asset opened from History. Use New Image to start over with a different file.
                    </p>
                  </div>
                ) : (
                  <ImageInputPanel image={image} onImageChange={handleImageChange} />
                )}
                <SettingsSummary settings={settings} onEdit={() => setSettingsOpen(true)} />
              </WorkbenchScroll>
              <WorkbenchScroll className="lg:flex-1">
              <AltTextResultsPanel
                key={`${savedAsset?.id ?? "local"}-${editorKey}`}
                imageSelected={image !== null || savedAsset !== null}
                status={status}
                error={error}
                output={output}
                actions={{
                  generateBlockedReason,
                  onGenerate: () => void handleRegenerate(),
                  onRegenerate: () => void handleRegenerate(),
                  onSave: () => void handleSave(),
                  onExport: (f) => void handleExport(f),
                  onDraftChange: (field, draft, isDirty) => {
                    drafts.current[field] = draft
                    setDirtyFields((d) => (d[field] === isDirty ? d : { ...d, [field]: isDirty }))
                  },
                  saving,
                  exporting,
                  dirty,
                  saveError,
                  usage,
                  saved,
                  canSave: savedAsset !== null && saved !== null,
                  canExport: savedAsset !== null,
                }}
              />
            </WorkbenchScroll>
          </div>
          </Workbench>
          <WorkbenchDrawer
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            title="Generation Settings"
            description="Applied to the next Generate or Regenerate. Changes are kept when you close this drawer."
            footer={
              <Button size="sm" onClick={() => setSettingsOpen(false)}>
                Done
              </Button>
            }
          >
            <GenerationSettingsPanel bare settings={settings} onChange={setSettings} />
          </WorkbenchDrawer>
        </TabsContent>

        <TabsContent value="bulk" className="mt-0 min-h-0 flex-1">
          <BulkProcessingWorkspace onOpenInEditor={requestOpen} externalOpenRequest={batchRequest} />
        </TabsContent>

        <TabsContent value="documents" className="mt-0 min-h-0 flex-1">
          <DocumentProcessingWorkspace
            onOpenBatch={(id) => {
              setBatchRequest((prev) => ({ id, nonce: (prev?.nonce ?? 0) + 1 }))
              setTab("bulk")
            }}
          />
        </TabsContent>

        <TabsContent value="history" className="mt-0 min-h-0 flex-1">
          <AltTextHistory onOpenInEditor={requestOpen} />
        </TabsContent>

        <TabsContent value="settings" className="mt-0 min-h-0 flex-1">
          <AccessibilitySettingsWorkspace key={settingsKey} onDirtyChange={setSettingsDirty} />
        </TabsContent>
      </Tabs>

      <AlertDialog open={pendingTab !== null} onOpenChange={(o) => !o && setPendingTab(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave with unsaved settings?</AlertDialogTitle>
            <AlertDialogDescription>Your Accessibility Settings changes have not been saved and will be discarded.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = pendingTab
                setPendingTab(null)
                setSettingsDirty(false)
                setSettingsKey((k) => k + 1)
                if (target) setTab(target)
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingOpen !== null} onOpenChange={(o) => !o && setPendingOpen(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved edits?</AlertDialogTitle>
            <AlertDialogDescription>
              The Generate editor has unsaved changes. {pendingOpen === "new" ? "Starting over" : "Opening another asset"} will discard them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = pendingOpen
                setPendingOpen(null)
                if (target === "new") startNew()
                else if (target) loadAsset(target)
              }}
            >
              Discard and continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
