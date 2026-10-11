import "server-only"
import { defaultTenantSettings, type TenantAiSettings } from "@/lib/ai/governance-core"

/**
 * Standalone Publishing has no ERP-wide AI admin screen, so the organisation
 * policy is the platform default with AI switched on. Set AI_DISABLED=true to
 * turn every AI feature off, or AI_ALLOWED_MODELS to a comma-separated allowlist.
 */
export async function getTenantAiSettings(): Promise<TenantAiSettings> {
  const base = defaultTenantSettings()
  const allowed = process.env.AI_ALLOWED_MODELS?.split(",").map((s) => s.trim()).filter(Boolean)
  return {
    ...base,
    enabled: process.env.AI_DISABLED !== "true",
    allowedModels: allowed?.length ? allowed : base.allowedModels,
  }
}
