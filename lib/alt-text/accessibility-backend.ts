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
import { probeOcrEngine } from "./ocr-engine"
import { isVisionCompatible } from "./vision-service"

/**
 * Engines implemented today: Phase 1 vision generation (which also returns an image
 * classification), Phase 3 Task 4 vision region detection and Phase 3 Task 5 self-hosted OCR.
 */
export const IMPLEMENTED_ACCESSIBILITY_ENGINES: readonly CapabilityId[] = ["standard_description", "auto_classification", "region_detection", "ocr"]

/**
 * The OCR probe initialises real Tesseract workers for every language mode on a cold process, which
 * can take longer than a request budget allows. Settings reads therefore wait at most this long; the
 * probe keeps running in the background and caches its result, so the next read is instant.
 */
const OCR_PROBE_BUDGET_MS = 6_000
const OCR_PROBE_PENDING = "The OCR engine is still starting up. Reload this page in a moment to see OCR availability."
const OCR_PROBE_FAILED = "The OCR engine health check failed. Reload this page to try again."

type OcrProbe = Awaited<ReturnType<typeof probeOcrEngine>>
type OcrSummary = { languages: readonly string[]; issue: string | null }

async function probeOcrWithinBudget(): Promise<OcrSummary> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), OCR_PROBE_BUDGET_MS)
    timer.unref?.()
  })
  const probe = probeOcrEngine()
  // Keep the probe alive past the budget so its result lands in the engine's in-process cache.
  probe.catch(() => undefined)
  try {
    const outcome = await Promise.race<OcrProbe | "timeout">([probe, timeout])
    if (outcome === "timeout") {
      console.warn("[alt-text/accessibility-backend] OCR probe exceeded budget", { budgetMs: OCR_PROBE_BUDGET_MS })
      return { languages: [], issue: OCR_PROBE_PENDING }
    }
    return outcome.status === "available" ? { languages: outcome.languages, issue: null } : { languages: [], issue: outcome.reason }
  } catch (err) {
    console.error("[alt-text/accessibility-backend] OCR probe failed", err instanceof Error ? err.name : "unknown")
    return { languages: [], issue: OCR_PROBE_FAILED }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function detectAccessibilityBackend(tenantId: number, role: "admin" | "employee"): Promise<AccessibilityBackend> {
  let visionModelAvailable: boolean | null = null
  const [ocr] = await Promise.all([
    probeOcrWithinBudget(),
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
    ocrIssue: ocr.issue,
    disabledByPolicy: process.env.ALT_TEXT_OCR_DISABLED === "1" ? ["ocr"] : [],
  }
}
