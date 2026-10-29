"use client"

/**
 * @file components/publishing/alt-text/generation-settings-panel.tsx
 * @module Publishing
 * @kind React client component
 * @summary Controlled generation settings form. State lives in the workspace so
 *   the future generation request can read it alongside the selected image.
 */
import { useId, useState, type ReactNode } from "react"
import { ChevronDown, Info, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {ClientGuidelineSelector} from "./client-guideline-selector"
import {
  CONTENT_TYPES,
  DEFAULT_GENERATION_SETTINGS,
  DESCRIPTION_LENGTHS,
  DESCRIPTION_MODES,
  GENERATION_FIELD_LIMITS,
  GENERATION_IMAGE_TYPES,
  GENERATION_PURPOSES,
  GRADE_LEVELS,
  LANGUAGES,
  SUBJECTS,
  TARGET_AUDIENCES,
  validateGenerationSettings,
  type GenerationSettings,
} from "@/lib/alt-text/core"

type Options<T extends string> = Record<T, string>

export const PURPOSE_LABELS = Object.fromEntries(
  Object.entries(GENERATION_PURPOSES).map(([key, value]) => [key, value.label]),
) as Options<keyof typeof GENERATION_PURPOSES>

export function SelectField<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
  disabled,
  describedBy,
}: {
  id: string
  label: string
  value: T
  options: Options<T>
  onChange: (value: T) => void
  disabled?: boolean
  describedBy?: string
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
        <SelectTrigger id={id} className="w-full" aria-describedby={describedBy}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.entries(options) as [T, string][]).map(([optionValue, optionLabel]) => (
            <SelectItem key={optionValue} value={optionValue}>
              {optionLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-4">
      <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</legend>
      {children}
    </fieldset>
  )
}

function Hint({ id, children, tone = "muted" }: { id?: string; children: ReactNode; tone?: "muted" | "warning" }) {
  return (
    <p
      id={id}
      className={cn(
        "flex items-start gap-2 text-xs leading-relaxed",
        tone === "warning"
          ? "rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900"
          : "text-muted-foreground",
      )}
    >
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

// Columns follow the panel's own width, so fields never shrink below a readable
// size whether the panel sits in a narrow column or spans the page.
const FIELD_GRID = "grid gap-4 grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))]"

export function GenerationSettingsPanel({
  settings,
  onChange,
  title = "Generation Settings",
  description = "Help the AI understand how the image is used.",
  footer,
  layout = "vertical",
  collapsible = false,
  bare = false,
}: {
  settings: GenerationSettings
  onChange: (settings: GenerationSettings) => void
  title?: string
  description?: string
  footer?: ReactNode
  layout?: "vertical" | "horizontal"
  collapsible?: boolean
  /** Render without the card chrome, for use inside a drawer that already provides a heading. */
  bare?: boolean
}) {
  const horizontal = layout === "horizontal"
  const [open, setOpen] = useState(true)
  const contentId = useId()
  const update = <K extends keyof GenerationSettings>(key: K, value: GenerationSettings[K]) =>
    onChange({ ...settings, [key]: value })

  const errors = validateGenerationSettings(settings)
  const isDefault = (Object.keys(DEFAULT_GENERATION_SETTINGS) as (keyof GenerationSettings)[]).every(
    (key) => settings[key] === DEFAULT_GENERATION_SETTINGS[key],
  )
  const isDecorative = settings.imagePurpose === "decorative"
  const contextLength = settings.imageContext.length
  const contextMax = GENERATION_FIELD_LIMITS.imageContext

  const sections = (
    <>
        <ClientGuidelineSelector settings={settings} onChange={onChange}/>
        <Section title="Image">
          <div className={FIELD_GRID}>
            <SelectField
              id="alt-image-type"
              label="Image type"
              value={settings.imageType}
              options={GENERATION_IMAGE_TYPES}
              onChange={(v) => update("imageType", v)}
              describedBy={settings.imageType === "auto" ? "alt-image-type-hint" : undefined}
            />
            <SelectField
              id="alt-purpose"
              label="Image purpose"
              value={settings.imagePurpose}
              options={PURPOSE_LABELS}
              onChange={(v) => update("imagePurpose", v)}
              describedBy="alt-purpose-hint"
            />
          </div>
          {settings.imageType === "auto" && (
            <Hint id="alt-image-type-hint">The AI will determine the image type during generation.</Hint>
          )}
          <Hint id="alt-purpose-hint">{GENERATION_PURPOSES[settings.imagePurpose].help}</Hint>
        </Section>

        <Section title="Content context">
          <div className={FIELD_GRID}>
            <SelectField
              id="alt-content-type"
              label="Content type"
              value={settings.contentType}
              options={CONTENT_TYPES}
              onChange={(v) => update("contentType", v)}
            />
            <SelectField
              id="alt-subject"
              label="Subject"
              value={settings.subject}
              options={SUBJECTS}
              onChange={(v) => update("subject", v)}
            />
            <SelectField
              id="alt-grade-level"
              label="Grade / level"
              value={settings.gradeLevel}
              options={GRADE_LEVELS}
              onChange={(v) => update("gradeLevel", v)}
            />
            <SelectField
              id="alt-audience"
              label="Target audience"
              value={settings.targetAudience}
              options={TARGET_AUDIENCES}
              onChange={(v) => update("targetAudience", v)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="alt-chapter">
              Chapter / topic <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="alt-chapter"
              value={settings.chapterTopic}
              onChange={(e) => update("chapterTopic", e.target.value)}
              placeholder="e.g. Chapter 4 — Cell Division"
              maxLength={GENERATION_FIELD_LIMITS.chapterTopic}
              aria-invalid={errors.chapterTopic ? true : undefined}
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="alt-context">Image context</Label>
              <span
                id="alt-context-count"
                className={cn(
                  "text-xs tabular-nums",
                  errors.imageContext ? "font-medium text-destructive" : "text-muted-foreground",
                )}
              >
                {contextLength.toLocaleString()} / {contextMax.toLocaleString()}
              </span>
            </div>
            <Textarea
              id="alt-context"
              value={settings.imageContext}
              onChange={(e) => update("imageContext", e.target.value)}
              placeholder="Describe where this image appears and what information it supports."
              rows={4}
              className="resize-y"
              aria-invalid={errors.imageContext ? true : undefined}
              aria-describedby={errors.imageContext ? "alt-context-count alt-context-error" : "alt-context-count"}
            />
            {errors.imageContext && (
              <p id="alt-context-error" role="alert" className="text-xs text-destructive">
                {errors.imageContext}
              </p>
            )}
          </div>
        </Section>

        <Section title="Output">
          <div className={FIELD_GRID}>
            <SelectField
              id="alt-language"
              label="Output language"
              value={settings.outputLanguage}
              options={LANGUAGES}
              onChange={(v) => update("outputLanguage", v)}
            />
            <SelectField
              id="alt-mode"
              label="Description mode"
              value={settings.descriptionMode}
              options={DESCRIPTION_MODES}
              onChange={(v) => update("descriptionMode", v)}
              disabled={isDecorative}
              describedBy="alt-output-hint"
            />
            <SelectField
              id="alt-length"
              label="Description length"
              value={settings.descriptionLength}
              options={DESCRIPTION_LENGTHS}
              onChange={(v) => update("descriptionLength", v)}
              disabled={isDecorative}
              describedBy="alt-output-hint"
            />
          </div>
          {isDecorative ? (
            <Hint id="alt-output-hint">
              Description mode and length do not apply to decorative images. Your selections are kept if you change
              the purpose.
            </Hint>
          ) : settings.imagePurpose === "complex" && settings.descriptionMode === "short" ? (
            <Hint id="alt-output-hint" tone="warning">
              Complex images usually need a detailed description. Consider selecting &ldquo;Both&rdquo;.
            </Hint>
          ) : (
            <Hint id="alt-output-hint">
              Length is an authoring preference, not a WCAG limit. Essential information is never cut to fit.
            </Hint>
          )}
        </Section>
        {footer && <div className="col-span-full">{footer}</div>}
    </>
  )

  const resetButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => onChange(DEFAULT_GENERATION_SETTINGS)}
      disabled={isDefault}
      className="shrink-0"
    >
      <RotateCcw className="size-3.5" aria-hidden="true" />
      Reset
      <span className="sr-only"> settings to defaults</span>
    </Button>
  )

  if (bare) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{description}</p>
          {resetButton}
        </div>
        <div id={contentId} className="flex flex-col gap-6">
          {sections}
        </div>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="flex min-w-0 flex-col gap-1.5">
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange(DEFAULT_GENERATION_SETTINGS)}
          disabled={isDefault}
          className="shrink-0"
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Reset
          <span className="sr-only"> settings to defaults</span>
        </Button>
        {collapsible && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={contentId}
            className="shrink-0"
          >
            <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
            {open ? "Collapse" : "Expand"}
            <span className="sr-only"> {title}</span>
          </Button>
        )}
      </CardHeader>

      <CardContent
        id={contentId}
        hidden={!open}
        className={cn(
          "flex flex-col gap-6",
          horizontal && "[&>fieldset+fieldset]:border-t [&>fieldset+fieldset]:pt-5",
        )}
      >
        {sections}
      </CardContent>
    </Card>
  )
}
