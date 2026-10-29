/**
 * @file lib/alt-text/batch-settings.ts
 * @module Publishing
 * @summary Phase 2 Task 4 — batch information and per-image overrides layered on the Phase 1
 *   generation settings. Images inherit batch defaults; an override stores only the fields that differ.
 */
import { normalizeGenerationSettings, validateGenerationSettings, type GenerationSettings, type GenerationSettingsErrors } from "./core"

export const BATCH_FIELD_LIMITS = { name: 150, description: 500 } as const

export type BatchInfo = { name: string; projectId: number | null; description: string }
export const EMPTY_BATCH_INFO: BatchInfo = { name: "", projectId: null, description: "" }

export type BatchInfoErrors = Partial<Record<"name" | "description", string>>

export function validateBatchInfo(info: BatchInfo): BatchInfoErrors {
  const errors: BatchInfoErrors = {}
  const name = info.name.trim()
  if (!name) errors.name = "Batch name is required."
  else if (name.length > BATCH_FIELD_LIMITS.name) errors.name = `Keep the batch name to ${BATCH_FIELD_LIMITS.name} characters or fewer.`
  if (info.description.length > BATCH_FIELD_LIMITS.description) errors.description = `Description must be ${BATCH_FIELD_LIMITS.description} characters or fewer.`
  return errors
}

/** Batch-wide only: content type and target audience cannot be overridden per image. */
export const OVERRIDABLE_FIELDS = [
  "clientGuidelineId",
  "clientGuidelineVersion",
  "imageType",
  "imagePurpose",
  "subject",
  "gradeLevel",
  "chapterTopic",
  "imageContext",
  "outputLanguage",
  "descriptionMode",
  "descriptionLength",
] as const satisfies readonly (keyof GenerationSettings)[]
export type OverridableField = (typeof OVERRIDABLE_FIELDS)[number]
export type ImageOverride = Partial<Pick<GenerationSettings, OverridableField>>

export function resolveEffectiveSettings(defaults: GenerationSettings, override?: ImageOverride): GenerationSettings {
  return override ? normalizeGenerationSettings({ ...defaults, ...override }) : defaults
}

/** Keeps only overridable fields that differ from the batch defaults; returns null when nothing differs. */
export function buildOverride(defaults: GenerationSettings, edited: GenerationSettings): ImageOverride | null {
  const normalized = normalizeGenerationSettings(edited)
  const override: Record<string, unknown> = {}
  for (const key of OVERRIDABLE_FIELDS) if (normalized[key] !== defaults[key]) override[key] = normalized[key]
  if(normalized.clientGuidelineId!==defaults.clientGuidelineId||normalized.clientGuidelineVersion!==defaults.clientGuidelineVersion){override.clientGuidelineId=normalized.clientGuidelineId??null;override.clientGuidelineVersion=normalized.clientGuidelineVersion??null}
  return Object.keys(override).length ? (override as ImageOverride) : null
}

export const overriddenFields = (override?: ImageOverride) => (override ? (Object.keys(override) as OverridableField[]) : [])

export const sameSettings = (a: GenerationSettings, b: GenerationSettings) =>
  (Object.keys(a) as (keyof GenerationSettings)[]).every((key) => a[key] === b[key])

/** Drops overrides for images no longer in the queue. Returns the same object when nothing changed. */
export function pruneOverrides(overrides: Record<string, ImageOverride>, liveIds: Iterable<string>): Record<string, ImageOverride> {
  const live = new Set(liveIds)
  const stale = Object.keys(overrides).filter((id) => !live.has(id))
  if (!stale.length) return overrides
  const next = { ...overrides }
  for (const id of stale) delete next[id]
  return next
}

/** JSON-safe batch configuration for Task 7 submission. Never contains File objects. */
export type BatchConfiguration = {
  batchName: string
  projectId: number | null
  description: string
  settings: GenerationSettings
  imageIds: string[]
  overrides: Record<string, ImageOverride>
  images: { imageId: string; hasOverride: boolean; effectiveSettings: GenerationSettings }[]
  errors: { batch: BatchInfoErrors; settings: GenerationSettingsErrors; images: Record<string, GenerationSettingsErrors> }
  isValid: boolean
}

export function buildBatchConfiguration(
  info: BatchInfo,
  defaults: GenerationSettings,
  validImageIds: readonly string[],
  overrides: Record<string, ImageOverride>,
): BatchConfiguration {
  const settings = normalizeGenerationSettings(defaults)
  const batchErrors = validateBatchInfo(info)
  const settingsErrors = validateGenerationSettings(settings)
  const imageErrors: Record<string, GenerationSettingsErrors> = {}
  const activeOverrides: Record<string, ImageOverride> = {}
  const images = validImageIds.map((imageId) => {
    const override = overrides[imageId]
    if (override) activeOverrides[imageId] = override
    const effectiveSettings = resolveEffectiveSettings(settings, override)
    const errors = validateGenerationSettings(effectiveSettings)
    if (Object.keys(errors).length) imageErrors[imageId] = errors
    return { imageId, hasOverride: Boolean(override), effectiveSettings }
  })
  return {
    batchName: info.name.trim(),
    projectId: info.projectId,
    description: info.description.trim(),
    settings,
    imageIds: [...validImageIds],
    overrides: activeOverrides,
    images,
    errors: { batch: batchErrors, settings: settingsErrors, images: imageErrors },
    isValid:
      validImageIds.length > 0 && !Object.keys(batchErrors).length && !Object.keys(settingsErrors).length && !Object.keys(imageErrors).length,
  }
}
