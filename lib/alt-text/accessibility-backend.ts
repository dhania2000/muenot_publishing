/**
 * @file lib/alt-text/accessibility-backend.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Phase 3 Task 2 — reports which advanced accessibility engines actually exist in this
 *   deployment. This is the only place a capability may be registered as implemented; later tasks
 *   (OCR, math, charts, science) add their engine id here once it is integrated and verified.
 */
import "server-only"
import { getTenantAiSettings } from "@/lib/ai/assistant-store"
import { resolveTenantModels } from "@/lib/ai/model-catalog"
import type { AccessibilityBackend, CapabilityId } from "./accessibility-settings"
import { isVisionCompatible } from "./vision-service"

/**
 * Engines implemented today: Phase 1 vision generation (which also returns an image
 * classification) and Phase 3 Task 4 vision region detection.
 */
export const IMPLEMENTED_ACCESSIBILITY_ENGINES: readonly CapabilityId[] = ["standard_description", "auto_classification", "region_detection"]

/** No OCR provider is installed (Task 5), so no recognition language pack is available. */
export const INSTALLED_OCR_LANGUAGE_PACKS: readonly string[] = []

export async function detectAccessibilityBackend(tenantId: number, role: "admin" | "employee"): Promise<AccessibilityBackend> {
  let visionModelAvailable: boolean | null = null
  try {
    const resolved = await resolveTenantModels(tenantId, await getTenantAiSettings(), role)
    visionModelAvailable = resolved.usable.some(isVisionCompatible)
  } catch (err) {
    console.error("[alt-text/accessibility-backend] model resolution failed", err instanceof Error ? err.name : "unknown")
  }
  return {
    implemented: IMPLEMENTED_ACCESSIBILITY_ENGINES,
    visionModelAvailable,
    ocrLanguagePacks: INSTALLED_OCR_LANGUAGE_PACKS,
    disabledByPolicy: [],
  }
}
