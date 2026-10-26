/**
 * @file lib/alt-text/accessibility-backend.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Phase 3 Task 2 — reports which advanced accessibility engines actually exist in this
 *   deployment. This is the only place a capability may be registered as implemented; later tasks
 *   (math, charts, science) add their engine id here once it is integrated and verified.
 */
import "server-only"
import { getTenantAiSettings } from "@/lib/ai/assistant-store"
import { resolveTenantModels } from "@/lib/ai/model-catalog"
import type { AccessibilityBackend, CapabilityId } from "./accessibility-settings"
import { checkOcrReadiness } from "./ocr-engine"
import { isVisionCompatible } from "./vision-service"
import { checkMathReadiness } from "./math-engine"

/**
 * Engines implemented today: Phase 1 vision generation (which also returns an image
 * classification), Phase 3 Task 4 vision region detection and Phase 3 Task 5 self-hosted OCR.
 */
export const IMPLEMENTED_ACCESSIBILITY_ENGINES: readonly CapabilityId[] = ["standard_description", "auto_classification", "region_detection", "ocr", "math_analysis", "math_ocr", "latex_output", "mathml_output", "chart_analysis", "chart_axes", "chart_data_extraction", "scientific_diagram_analysis"]

const OCR_CHECK_FAILED = "The OCR engine health check failed. Reload this page to try again."

type OcrSummary = { languages: readonly string[]; modes: readonly string[]; issue: string | null }

/**
 * Uses the lightweight readiness check, never the full worker probe: starting Tesseract WASM workers
 * for every language mode inside a page request exhausted memory on the host and returned 503s.
 */
async function summarizeOcr(): Promise<OcrSummary> {
  try {
    const health = await checkOcrReadiness()
    if (health.status !== "available") return { languages: [], modes: [], issue: health.reason }
    const modes = Object.entries(health.modes).flatMap(([m, h]) => (h.status === "available" ? [m] : []))
    return { languages: health.languages, modes, issue: null }
  } catch (err) {
    console.error("[alt-text/accessibility-backend] OCR readiness check failed", err instanceof Error ? err.name : "unknown")
    return { languages: [], modes: [], issue: OCR_CHECK_FAILED }
  }
}

export async function detectAccessibilityBackend(tenantId: number, role: "admin" | "employee"): Promise<AccessibilityBackend> {
  let visionModelAvailable: boolean | null = null
  const [ocr, math] = await Promise.all([
    summarizeOcr(),
    checkMathReadiness(),
    (async () => {
      try {
        const resolved = await resolveTenantModels(tenantId, await getTenantAiSettings(), role)
        visionModelAvailable = resolved.usable.some(isVisionCompatible)
      } catch (err) {
        console.error("[alt-text/accessibility-backend] model resolution failed", err instanceof Error ? err.name : "unknown")
      }
    })(),
  ])
  return {
    implemented: IMPLEMENTED_ACCESSIBILITY_ENGINES,
    visionModelAvailable,
    // Only languages whose pack passed the engine's integrity check and worker start-up.
    ocrLanguagePacks: ocr.languages,
    ocrModes: ocr.modes,
    ocrIssue: ocr.issue,
    mathReady: math.available,
    mathIssue: math.reason,
    disabledByPolicy: [...(process.env.ALT_TEXT_OCR_DISABLED === "1" ? ["ocr" as const] : []), ...(process.env.ALT_TEXT_MATH_DISABLED === "1" ? ["math_analysis" as const,"math_ocr" as const] : []),...(process.env.ALT_TEXT_ADVANCED_DISABLED==="1"?["chart_analysis" as const,"chart_axes" as const,"chart_data_extraction" as const,"scientific_diagram_analysis" as const]:[])],
  }
}
