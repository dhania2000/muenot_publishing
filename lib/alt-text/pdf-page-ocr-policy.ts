import "server-only"
import { getSettingsRecord } from "./store"
import { checkOcrReadiness } from "./ocr-engine"
import { resolveEffectiveAccessibilitySettings } from "./accessibility-settings"
import { resolveOcrLanguageModes } from "./ocr-service"
import type { PageOcrPolicy } from "./pdf-page-ocr-types"
import { rendererAvailable } from "./pdf-page-renderer"

/** Tenant settings are the only persisted OCR scope today. Never uses Alt Text output language. */
export async function getPageOcrPolicy(): Promise<PageOcrPolicy> {
  const [record, health, renderer] = await Promise.all([getSettingsRecord(), checkOcrReadiness(), rendererAvailable()])
  const modes = Object.entries(health.modes).flatMap(([m,h]) => h.status === "available" ? [m] : [])
  const resolved = resolveEffectiveAccessibilitySettings({ storedAccessibility: record.accessibility, revision: record.revision, tenant: record.settings,
    backend: { implemented: ["ocr"], visionModelAvailable: null, ocrLanguagePacks: health.languages, ocrModes: modes, ocrIssue: health.reason,
      disabledByPolicy: process.env.ALT_TEXT_OCR_DISABLED === "1" ? ["ocr"] : [] } })
  const ocr = resolved.effective.ocr
  const language = resolveOcrLanguageModes({ languages: [...ocr.languages], engineModes: modes, defaultMode: ocr.defaultLanguageMode })
  const enabled = renderer && ocr.enabled && language.modes.some((m) => m.available) && health.status === "available"
  return { ...language, enabled, reason: enabled ? null : !renderer ? "The local PDF renderer is unavailable in this deployment." : health.reason ?? "OCR is disabled or its languages are unavailable in Accessibility settings." }
}
