"use client"

/**
 * @file components/publishing/alt-text/image-override-sheet.tsx
 * @module Publishing
 * @kind React client component
 * @summary Phase 2 Task 4 — per-image AI settings override drawer. Saves only fields that differ
 *   from the batch defaults so later batch changes still flow to untouched fields.
 */
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { buildOverride, resolveEffectiveSettings, type ImageOverride } from "@/lib/alt-text/batch-settings"
import {
  DESCRIPTION_LENGTHS,
  DESCRIPTION_MODES,
  GENERATION_FIELD_LIMITS,
  GENERATION_IMAGE_TYPES,
  GRADE_LEVELS,
  LANGUAGES,
  SUBJECTS,
  validateGenerationSettings,
  type GenerationSettings,
} from "@/lib/alt-text/core"
import { cn } from "@/lib/utils"
import { PURPOSE_LABELS, SelectField } from "./generation-settings-panel"

type Target = { id: string; name: string; override?: ImageOverride }

export function ImageOverrideSheet({
  target,
  defaults,
  onSave,
  onClose,
}: {
  target: Target | null
  defaults: GenerationSettings
  onSave: (id: string, override: ImageOverride | null) => void
  onClose: () => void
}) {
  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        {target && <OverrideForm key={target.id} target={target} defaults={defaults} onSave={onSave} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  )
}

function OverrideForm({ target, defaults, onSave, onClose }: { target: Target; defaults: GenerationSettings; onSave: (id: string, o: ImageOverride | null) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(() => resolveEffectiveSettings(defaults, target.override))
  const update = <K extends keyof GenerationSettings>(key: K, value: GenerationSettings[K]) => setDraft((s) => ({ ...s, [key]: value }))
  const errors = validateGenerationSettings(draft)
  const isDecorative = draft.imagePurpose === "decorative"
  const pendingOverride = buildOverride(defaults, draft)
  const changedCount = pendingOverride ? Object.keys(pendingOverride).length : 0

  return (
    <>
      <SheetHeader>
        <SheetTitle className="truncate pr-6">Edit AI Settings</SheetTitle>
        <SheetDescription className="truncate" title={target.name}>
          {target.name}
        </SheetDescription>
      </SheetHeader>

      <form
        className="flex flex-col gap-4 px-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (Object.keys(errors).length) return
          onSave(target.id, pendingOverride)
          onClose()
        }}
      >
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground" aria-live="polite">
          {changedCount ? `${changedCount} field${changedCount === 1 ? "" : "s"} differ from batch defaults.` : "Matches batch defaults. Saving keeps this image inheriting."}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField id="ov-image-type" label="Image type" value={draft.imageType} options={GENERATION_IMAGE_TYPES} onChange={(v) => update("imageType", v)} />
          <SelectField id="ov-purpose" label="Image purpose" value={draft.imagePurpose} options={PURPOSE_LABELS} onChange={(v) => update("imagePurpose", v)} />
          <SelectField id="ov-subject" label="Subject" value={draft.subject} options={SUBJECTS} onChange={(v) => update("subject", v)} />
          <SelectField id="ov-grade" label="Grade / level" value={draft.gradeLevel} options={GRADE_LEVELS} onChange={(v) => update("gradeLevel", v)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ov-chapter">Chapter / topic</Label>
          <Input id="ov-chapter" value={draft.chapterTopic} onChange={(e) => update("chapterTopic", e.target.value)} maxLength={GENERATION_FIELD_LIMITS.chapterTopic} />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor="ov-context">Image context</Label>
            <span className={cn("text-xs tabular-nums", errors.imageContext ? "text-destructive" : "text-muted-foreground")}>
              {draft.imageContext.length.toLocaleString()} / {GENERATION_FIELD_LIMITS.imageContext.toLocaleString()}
            </span>
          </div>
          <Textarea id="ov-context" rows={4} value={draft.imageContext} onChange={(e) => update("imageContext", e.target.value)} aria-invalid={errors.imageContext ? true : undefined} />
          {errors.imageContext && <p role="alert" className="text-xs text-destructive">{errors.imageContext}</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField id="ov-language" label="Output language" value={draft.outputLanguage} options={LANGUAGES} onChange={(v) => update("outputLanguage", v)} />
          <SelectField id="ov-mode" label="Description mode" value={draft.descriptionMode} options={DESCRIPTION_MODES} onChange={(v) => update("descriptionMode", v)} disabled={isDecorative} />
          <SelectField id="ov-length" label="Description length" value={draft.descriptionLength} options={DESCRIPTION_LENGTHS} onChange={(v) => update("descriptionLength", v)} disabled={isDecorative} />
        </div>

        <SheetFooter className="flex-row flex-wrap justify-end gap-2 px-0">
          <Button type="button" variant="ghost" onClick={() => setDraft(defaults)} disabled={!changedCount}>
            Reset to Batch Defaults
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={Object.keys(errors).length > 0}>
            Save Override
          </Button>
        </SheetFooter>
      </form>
    </>
  )
}
