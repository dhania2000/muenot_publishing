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
import { cachedOcrEngineHealth, probeOcrEngine } from "./ocr-engine"
import { isVisionCompatible } from "./vision-service"

/**
 * Engines implemented today: Phase 1 vision generation (which also returns an image
 * classification), Phase 3 Task 4 vision region detection and Phase 3 Task 5 self-hosted OCR.
 */
export const IMPLEMENTED_ACCESSIBILITY_ENGINES: readonly CapabilityId[] = ["standard_description", "auto_classification", "region_detection", "ocr"]

/**
 * A cold OCR probe boots several Tesseract workers and can take minutes. Requests wait at most this
 * long; the probe keeps running in the background and its cached result is used on the next request.
 */
const OCR_PROBE_WAIT_MS = 3_000

type OcrProbeOutcome = { status: "available"; languages: string[] } | { status: "unavailable"; reason: string | null }

async function boundedOcrProbe(): Promise<OcrProbeOutcome> {
  const cached = cachedOcrEngineHealth()
  const probe = probeOcrEngine().catch((err) => {
    console.error("[alt-text/accessibility-backend] OCR probe failed", err instanceof Error ? err.name : "unknown")
    return cached
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  const waited = new Promise<"pending">((resolve) => {
    timer = setTimeout(() => resolve("pending"), OCR_PROBE_WAIT_MS)
    timer.unref?.()
  })
  const result = await Promise.race([probe, waited])
  if (timer) clearTimeout(timer)
  const health = result === "pending" ? cached : result
  if (health?.status === "available") return { status: "available", languages: health.languages }
  if (health) return { status: "unavailable", reason: health.reason }
  return { status: "unavailable", reason: "The OCR engine is still starting. Reload settings in a moment to see OCR options." }
}

export async function detectAccessibilityBackend(tenantId: number, role: "admin" | "employee"): Promise<AccessibilityBackend> {
  let visionModelAvailable: boolean | null = null
  const [ocr] = await Promise.all([
    boundedOcrProbe(),
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
    ocrLanguagePacks: ocr.status === "available" ? ocr.languages : [],
    ocrIssue: ocr.status === "available" ? null : (ocr.reason ?? "The OCR engine could not be started."),
    disabledByPolicy: process.env.ALT_TEXT_OCR_DISABLED === "1" ? ["ocr"] : [],
  }
}
