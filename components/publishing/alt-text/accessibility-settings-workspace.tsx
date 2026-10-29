"use client"

/**
 * @file components/publishing/alt-text/accessibility-settings-workspace.tsx
 * @module Publishing · Alt Text
 * @kind React client component
 * @summary Phase 3 Task 2 — Accessibility Settings tab. Loads the resolved tenant configuration from
 *   GET /api/alt-text/settings, keeps a local draft, and saves only changed fields with optimistic
 *   revision checks. Capability states and permissions come from the server response.
 */
import { useEffect, useMemo, useState } from "react"
import {ClientGuidelineLibrary} from "./client-guideline-library"
import useSWR from "swr"
import {
  BarChart3,
  BookOpen,
  CheckCircle2,
  FlaskConical,
  Info,
  ListChecks,
  Lock,
  type LucideIcon,
  RotateCcw,
  ScanText,
  Settings2,
  ShieldCheck,
  Sigma,
} from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  ACCESSIBILITY_SCHEMA,
  ACCESSIBILITY_SECTION_IDS,
  ACTIVE_QA_CHECKS,
  ADVANCED_QA_CHECKS,
  fieldDefaultValue,
  type AccessibilityField,
  type AccessibilityPatch,
  type AccessibilityPreferences,
  type AccessibilitySectionId,
  type FieldError,
  type FieldValue,
} from "@/lib/alt-text/accessibility-settings"
import {
  ALT_TEXT_SETTINGS_URL,
  getAltTextSettings,
  updateAltTextSettings,
  type AltTextSettingsPatch,
  type AltTextSettingsResponse,
} from "@/lib/alt-text/client"
import { AUDIENCES, LANGUAGES, type AltTextSettings } from "@/lib/alt-text/core"
import { cn } from "@/lib/utils"
import { CapabilityBadge, CapabilityList, FieldErrorText, LockedPolicyList, SettingsFieldControl } from "./accessibility-settings-fields"

type SectionId = AccessibilitySectionId | "guidelines"
type TenantDraft = Pick<AltTextSettings, "defaultLanguage" | "defaultAudience" | "shortMaxChars" | "requireReview">
type Draft = { tenant: TenantDraft; accessibility: AccessibilityPreferences }
type Loose = Record<string, Record<string, FieldValue>>

const TENANT_KEYS = ["defaultLanguage", "defaultAudience", "shortMaxChars", "requireReview"] as const
const SHORT_MIN = 60
const SHORT_MAX = 250

const SECTION_META: Record<SectionId, { label: string; icon: LucideIcon }> = {
  general: { label: "General", icon: Settings2 },
  ocr: { label: "OCR & Text", icon: ScanText },
  math: { label: "Mathematics", icon: Sigma },
  graphs: { label: "Graphs & Charts", icon: BarChart3 },
  science: { label: "Scientific Diagrams", icon: FlaskConical },
  descriptions: { label: "Descriptions", icon: BookOpen },
  quality: { label: "Quality & Review", icon: ListChecks },
  guidelines: { label: "Client Guidelines", icon: ShieldCheck },
}
const SECTION_ORDER: SectionId[] = [...ACCESSIBILITY_SECTION_IDS, "guidelines"]

const fetcher = async () => {
  const r = await getAltTextSettings()
  if (!r.ok) throw r.error
  return r.data
}

const draftFrom = (data: AltTextSettingsResponse): Draft => ({
  tenant: Object.fromEntries(TENANT_KEYS.map((k) => [k, data.settings[k]])) as TenantDraft,
  accessibility: structuredClone(data.accessibility.configured),
})

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function buildPatch(base: Draft, draft: Draft, revision: number): AltTextSettingsPatch {
  const body: AltTextSettingsPatch = { expectedRevision: revision }
  for (const k of TENANT_KEYS) if (draft.tenant[k] !== base.tenant[k]) Object.assign(body, { [k]: draft.tenant[k] })
  const a = draft.accessibility as unknown as Loose
  const b = base.accessibility as unknown as Loose
  const patch: Loose = {}
  for (const s of ACCESSIBILITY_SECTION_IDS) {
    for (const key of Object.keys(a[s])) if (!same(a[s][key], b[s][key])) (patch[s] ??= {})[key] = a[s][key]
  }
  if (Object.keys(patch).length) body.accessibility = patch as AccessibilityPatch
  return body
}

/** Changed field paths per section, used for nav indicators and the save bar. */
function changedPaths(base: Draft, draft: Draft): Record<SectionId, number> {
  const counts = Object.fromEntries(SECTION_ORDER.map((s) => [s, 0])) as Record<SectionId, number>
  const a = draft.accessibility as unknown as Loose
  const b = base.accessibility as unknown as Loose
  for (const s of ACCESSIBILITY_SECTION_IDS) for (const key of Object.keys(a[s])) if (!same(a[s][key], b[s][key])) counts[s]++
  for (const k of ["defaultLanguage", "defaultAudience", "shortMaxChars"] as const) if (draft.tenant[k] !== base.tenant[k]) counts.descriptions++
  if (draft.tenant.requireReview !== base.tenant.requireReview) counts.quality++
  return counts
}

export function AccessibilitySettingsWorkspace({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const { data, error, isLoading, mutate } = useSWR(ALT_TEXT_SETTINGS_URL, fetcher, { revalidateOnFocus: false })
  const [section, setSection] = useState<SectionId>("general")
  const [draft, setDraft] = useState<Draft | null>(null)
  const [base, setBase] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [libraryDirty,setLibraryDirty]=useState(false)
  const [saveError, setSaveError] = useState<{ message: string; conflict: boolean } | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [savedAt, setSavedAt] = useState<string | null>(null)

  // Adopt server data when it first arrives or after a save/reload; never clobber an in-progress draft.
  const [adoptedRevision, setAdoptedRevision] = useState<number | null>(null)
  if (data && data.revision !== adoptedRevision && (!draft || !base || same(draft, base))) {
    const next = draftFrom(data)
    setBase(next)
    setDraft(structuredClone(next))
    setAdoptedRevision(data.revision)
  }

  const counts = useMemo(() => (base && draft ? changedPaths(base, draft) : null), [base, draft])
  const totalChanges = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0
  const dirty = totalChanges > 0
  const shortInvalid = !!draft && (!Number.isInteger(draft.tenant.shortMaxChars) || draft.tenant.shortMaxChars < SHORT_MIN || draft.tenant.shortMaxChars > SHORT_MAX)

  useEffect(() => onDirtyChange?.(dirty||libraryDirty), [dirty,libraryDirty, onDirtyChange])
  useEffect(() => {
    if (!dirty&&!libraryDirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty,libraryDirty])

  if (isLoading && !data) return <SettingsSkeleton />
  if (error && !data) {
    const e = error as { message?: string; status?: number }
    return (
      <Alert variant="destructive">
        <AlertTitle>{e.status === 403 ? "Settings are not available to you" : "Could not load settings"}</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">
          <span>{e.message ?? "Something went wrong."}</span>
          {e.status !== 403 ? (
            <Button size="sm" variant="outline" onClick={() => void mutate()}>
              Try again
            </Button>
          ) : null}
        </AlertDescription>
      </Alert>
    )
  }
  if (!data || !draft || !base || !counts) return <SettingsSkeleton />

  const readOnly = !data.permissions.canManage || saving
  const caps = data.accessibility.capabilities

  const setField = (s: AccessibilitySectionId, key: string, value: FieldValue) => {
    setDraft((d) => {
      if (!d) return d
      const next = structuredClone(d)
      ;(next.accessibility as unknown as Loose)[s][key] = value
      return next
    })
    setFieldErrors(({ [`${s}.${key}`]: _removed, ...rest }) => rest)
    setSavedAt(null)
  }
  const setTenant = <K extends keyof TenantDraft>(key: K, value: TenantDraft[K]) => {
    setDraft((d) => (d ? { ...d, tenant: { ...d.tenant, [key]: value } } : d))
    setSavedAt(null)
  }

  const restoreSection = () => {
    if (section === "guidelines") return
    setDraft((d) => {
      if (!d) return d
      const next = structuredClone(d)
      const target = (next.accessibility as unknown as Loose)[section]
      for (const f of ACCESSIBILITY_SCHEMA[section].fields as readonly AccessibilityField[]) {
        // Restoring never re-enables a capability that is unavailable; gated defaults are all off.
        target[f.key] = fieldDefaultValue(f)
      }
      return next
    })
    setSavedAt(null)
  }

  const discard = () => {
    setDraft(structuredClone(base))
    setFieldErrors({})
    setSaveError(null)
  }

  const save = async () => {
    if (shortInvalid) {
      setSection("descriptions")
      return
    }
    setSaving(true)
    setSaveError(null)
    setFieldErrors({})
    const r = await updateAltTextSettings(buildPatch(base, draft, data.revision))
    setSaving(false)
    if (!r.ok) {
      const errs = (r.error.details?.fieldErrors as FieldError[] | undefined) ?? []
      if (errs.length) {
        setFieldErrors(Object.fromEntries(errs.map((e) => [e.path, e.message])))
        const first = errs[0].path.split(".")[0] as SectionId
        if (SECTION_ORDER.includes(first)) setSection(first)
      }
      return setSaveError({ message: r.error.message, conflict: r.error.code === "SETTINGS_CONFLICT" })
    }
    const next = draftFrom(r.data)
    setBase(next)
    setDraft(structuredClone(next))
    setAdoptedRevision(r.data.revision)
    setSavedAt(new Date().toLocaleTimeString())
    void mutate(r.data, { revalidate: false })
  }

  const reloadLatest = async () => {
    setSaveError(null)
    const fresh = await mutate()
    if (fresh) {
      const next = draftFrom(fresh)
      setBase(next)
      setDraft(structuredClone(next))
      setAdoptedRevision(fresh.revision)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 lg:h-full lg:min-h-0">
      <header className="flex shrink-0 flex-col gap-0.5 rounded-lg border bg-card px-3 py-2 shadow-xs">
        <h2 className="text-sm font-semibold text-balance">Accessibility Settings</h2>
        <p className="text-xs leading-relaxed text-muted-foreground text-pretty">
          Tenant-wide preferences for advanced image accessibility. Availability reflects the installed engine, model configuration and platform policy. Recognition and QA run when requested; AI results still require review.
        </p>
      </header>

      {!data.permissions.canManage ? (
        <Alert>
          <Lock aria-hidden="true" />
          <AlertTitle>View only</AlertTitle>
          <AlertDescription>Changing these settings requires an administrator or the Manage settings permission.</AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={section} onValueChange={(v) => setSection(v as SectionId)} orientation="vertical" className="flex min-w-0 flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row lg:items-stretch">
        <div className="lg:hidden">
          <Label htmlFor="settings-section" className="sr-only">
            Settings section
          </Label>
          <Select value={section} onValueChange={(v) => setSection(v as SectionId)}>
            <SelectTrigger id="settings-section" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SECTION_ORDER.map((s) => (
                <SelectItem key={s} value={s}>
                  {SECTION_META[s].label}
                  {counts[s] ? ` (${counts[s]} unsaved)` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <TabsList className="hidden h-fit w-56 shrink-0 flex-col items-stretch justify-start gap-0.5 bg-transparent p-0 lg:flex" aria-label="Settings sections">
          {SECTION_ORDER.map((s) => {
            const Icon = SECTION_META[s].icon
            return (
              <TabsTrigger key={s} value={s} className="h-9 w-full flex-none justify-start gap-2 px-3 data-active:bg-muted">
                <Icon aria-hidden="true" />
                <span className="flex-1 truncate text-left">{SECTION_META[s].label}</span>
                {counts[s] ? (
                  <span className="size-2 rounded-full bg-primary" aria-label={`${counts[s]} unsaved changes`} />
                ) : null}
              </TabsTrigger>
            )
          })}
        </TabsList>

        <div
          className="flex min-w-0 flex-1 flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-1"
          role="region"
          aria-label={`${SECTION_META[section].label} settings`}
          tabIndex={0}
        >
          {ACCESSIBILITY_SECTION_IDS.map((s) => (
            <TabsContent key={s} value={s} className="mt-0 flex flex-col gap-4">
              <SchemaSection
                sectionId={s}
                values={(draft.accessibility as unknown as Loose)[s]}
                baseValues={(base.accessibility as unknown as Loose)[s]}
                data={data}
                readOnly={readOnly}
                errors={fieldErrors}
                onChange={(key, value) => setField(s, key, value)}
                onRestore={restoreSection}
              >
                {s === "descriptions" ? <TenantDefaults draft={draft.tenant} readOnly={readOnly} onChange={setTenant} shortInvalid={shortInvalid} /> : null}
                {s === "quality" ? <QualityExtras draft={draft.tenant} readOnly={readOnly} onChange={setTenant} data={data} /> : null}
                {s === "ocr" ? <OcrLanguages data={data} /> : null}
              </SchemaSection>
            </TabsContent>
          ))}
          <TabsContent value="guidelines" keepMounted className="mt-0">
            <GuidelinesSection active={section==="guidelines"} onDirtyChange={setLibraryDirty} />
          </TabsContent>
        </div>
      </Tabs>

      <div
        className="sticky bottom-0 z-10 flex shrink-0 flex-col gap-3 lg:static rounded-lg border bg-background/95 px-4 py-3 shadow-sm backdrop-blur sm:flex-row sm:items-center sm:justify-between"
        aria-live="polite"
      >
        <div className="flex min-w-0 flex-col gap-0.5 text-sm">
          {libraryDirty ? (<span className="font-medium">Client guideline changes pending — use Save client.</span>) : saveError ? (
            <span className="font-medium text-destructive">{saveError.message}</span>
          ) : dirty ? (
            <span className="font-medium">
              {totalChanges} unsaved {totalChanges === 1 ? "change" : "changes"}
            </span>
          ) : savedAt ? (
            <span className="flex items-center gap-1.5 font-medium text-emerald-700">
              <CheckCircle2 className="size-4" aria-hidden="true" /> Settings saved at {savedAt}
            </span>
          ) : (
            <span className="text-muted-foreground">All changes saved</span>
          )}
          <span className="text-xs text-muted-foreground">
            Revision {data.revision}
            {data.updatedAt ? ` · Last updated ${new Date(data.updatedAt).toLocaleString()}` : " · Using platform defaults"}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {saveError?.conflict ? (
            <Button variant="outline" size="sm" onClick={() => void reloadLatest()}>
              Reload latest
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={discard} disabled={!dirty || saving}>
            Discard
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={!dirty || readOnly || shortInvalid}>
            {saving ? <Spinner /> : null}
            {saving ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </div>
    </div>
  )
}

function SchemaSection({
  sectionId,
  values,
  baseValues,
  data,
  readOnly,
  errors,
  onChange,
  onRestore,
  children,
}: {
  sectionId: AccessibilitySectionId
  values: Record<string, FieldValue>
  baseValues: Record<string, FieldValue>
  data: AltTextSettingsResponse
  readOnly: boolean
  errors: Record<string, string>
  onChange: (key: string, value: FieldValue) => void
  onRestore: () => void
  children?: React.ReactNode
}) {
  const def = ACCESSIBILITY_SCHEMA[sectionId]
  const fields = def.fields as readonly AccessibilityField[]
  const groups = [...new Set(fields.map((f) => f.group ?? "Settings"))]
  const isDefault = fields.every((f) => same(values[f.key], fieldDefaultValue(f)))

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1.5">
            <CardTitle className="text-base">{def.title}</CardTitle>
            <CardDescription className="leading-relaxed">{def.description}</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={onRestore} disabled={readOnly || isDefault} className="shrink-0">
            <RotateCcw aria-hidden="true" /> Restore defaults
          </Button>
        </CardHeader>
        <CardContent>
          <CapabilityList ids={def.capabilities} capabilities={data.accessibility.capabilities} />
        </CardContent>
      </Card>

      {groups.map((group) => (
        <Card key={group}>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">{group}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {fields
              .filter((f) => (f.group ?? "Settings") === group)
              .map((f) => (
                <SettingsFieldControl
                  key={f.key}
                  id={`acc-${sectionId}-${f.key}`}
                  field={f}
                  value={values[f.key]}
                  onChange={(v) => onChange(f.key, v)}
                  capabilities={data.accessibility.capabilities}
                  readOnly={readOnly}
                  error={errors[`${sectionId}.${f.key}`]}
                  changed={!same(values[f.key], baseValues[f.key])}
                />
              ))}
          </CardContent>
        </Card>
      ))}

      {children}

      {sectionId === "graphs" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Always-on safeguards</CardTitle>
            <CardDescription>Platform rules that no setting can switch off.</CardDescription>
          </CardHeader>
          <CardContent>
            <LockedPolicyList items={data.accessibility.mandatory.filter((m) => ["visible_data_only", "no_fabricated_confidence", "no_auto_approve"].includes(m.id))} />
          </CardContent>
        </Card>
      ) : null}
    </>
  )
}

function TenantDefaults({
  draft,
  readOnly,
  onChange,
  shortInvalid,
}: {
  draft: TenantDraft
  readOnly: boolean
  onChange: <K extends keyof TenantDraft>(key: K, value: TenantDraft[K]) => void
  shortInvalid: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Tenant defaults</CardTitle>
        <CardDescription>Existing tenant defaults used by every generation request unless overridden per request.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="tenant-language">Alt Text output language</Label>
          <Select value={draft.defaultLanguage} onValueChange={(v) => onChange("defaultLanguage", v as TenantDraft["defaultLanguage"])} disabled={readOnly}>
            <SelectTrigger id="tenant-language" className="w-full" aria-describedby="tenant-language-help">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(LANGUAGES).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id="tenant-language-help" className="text-xs text-muted-foreground">
            Separate from OCR recognition languages.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="tenant-audience">Default audience</Label>
          <Select value={draft.defaultAudience} onValueChange={(v) => onChange("defaultAudience", v as TenantDraft["defaultAudience"])} disabled={readOnly}>
            <SelectTrigger id="tenant-audience" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(AUDIENCES).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="tenant-short-max">Short Alt Text target length (characters)</Label>
          <Input
            id="tenant-short-max"
            type="number"
            inputMode="numeric"
            min={SHORT_MIN}
            max={SHORT_MAX}
            className="sm:max-w-40"
            value={Number.isFinite(draft.shortMaxChars) ? draft.shortMaxChars : ""}
            onChange={(e) => onChange("shortMaxChars", e.target.value === "" ? Number.NaN : Number(e.target.value))}
            disabled={readOnly}
            aria-invalid={shortInvalid || undefined}
            aria-describedby={shortInvalid ? "tenant-short-max-error" : "tenant-short-max-help"}
          />
          {shortInvalid ? (
            <FieldErrorText id="tenant-short-max-error" message={`Enter a whole number between ${SHORT_MIN} and ${SHORT_MAX}.`} />
          ) : (
            <p id="tenant-short-max-help" className="text-xs text-muted-foreground">
              An editorial target, not a WCAG limit. Essential meaning is never truncated.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function QualityExtras({
  draft,
  readOnly,
  onChange,
  data,
}: {
  draft: TenantDraft
  readOnly: boolean
  onChange: <K extends keyof TenantDraft>(key: K, value: TenantDraft[K]) => void
  data: AltTextSettingsResponse
}) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Approval workflow</CardTitle>
          <CardDescription>Uses the existing review and approval workflow; no separate review system.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label htmlFor="tenant-require-review" className="flex cursor-not-allowed items-start gap-2.5 text-sm text-muted-foreground">
            <input
              id="tenant-require-review"
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-primary"
              checked={true}
              disabled={true}
            />
            <span className="leading-snug">Human review required before AI output is approved</span>
          </label>
          <LockedPolicyList items={data.accessibility.mandatory.filter((m) => m.source === "platform")} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Quality checks</CardTitle>
          <CardDescription>Output Validation checks document files. Advanced QA checks saved image evidence when requested; human-only findings remain review requirements.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <QaList title="Active" items={ACTIVE_QA_CHECKS} status="available" />
          <QaList title="Advanced evidence checks" items={ADVANCED_QA_CHECKS} status={data.accessibility.capabilities.advanced_qa.status} />
        </CardContent>
      </Card>
    </>
  )
}

function QaList({ title, items, status }: { title: string; items: readonly { id: string; label: string }[]; status: import("@/lib/alt-text/accessibility-settings").CapabilityStatus }) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      <ul className="flex flex-col gap-1.5">
        {items.map((q) => (
          <li key={q.id} className="flex items-center justify-between gap-2 text-sm">
            <span>{q.label}</span>
            <CapabilityBadge status={status} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function OcrLanguages({ data }: { data: AltTextSettingsResponse }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Language pack status</CardTitle>
        <CardDescription>Saved languages are used only when the matching recognition pack is installed.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2 sm:grid-cols-2">
          {data.accessibility.ocrLanguages.map((l) => (
            <li key={l.code} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <span className="min-w-0 truncate">
                {l.label}
                {l.configured ? <span className="ml-1.5 text-xs text-muted-foreground">(saved)</span> : null}
              </span>
              <CapabilityBadge status={l.packInstalled ? "available" : "not_configured"} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function GuidelinesSection({active,onDirtyChange}:{active:boolean;onDirtyChange:(dirty:boolean)=>void}) {
  return <Card><CardContent className="pt-5"><ClientGuidelineLibrary active={active} onDirtyChange={onDirtyChange}/></CardContent></Card>
}

function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading settings">
      <Skeleton className="h-6 w-56" />
      <div className="flex gap-4">
        <Skeleton className="hidden h-72 w-56 lg:block" />
        <div className="flex flex-1 flex-col gap-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    </div>
  )
}
