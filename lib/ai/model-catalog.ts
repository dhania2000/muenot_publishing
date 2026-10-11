import "server-only"
import type { CatalogModel } from "@/lib/ai/catalog-core"
import type { TenantAiSettings } from "@/lib/ai/governance-core"
import { gatewayAuthAvailable } from "@/lib/ai/provider"

type CatalogStatus = "ok" | "stale" | "error" | "not_configured"

export type ResolvedModels = {
  status: CatalogStatus
  lastSyncedAt: string | null
  error: string | null
  usable: CatalogModel[]
  all: { model: CatalogModel; usable: boolean; reason: string | null }[]
  defaultModel: CatalogModel | null
  fallbackModel: CatalogModel | null
  baselineAt: string
}

const BASELINE = "2026-01-01T00:00:00.000Z"

function vision(id: string, displayName: string, family: string, input: number, output: number, reasoning = false): CatalogModel {
  return {
    id,
    provider: id.split("/")[0],
    displayName,
    description: `${displayName} via Vercel AI Gateway`,
    family,
    contextWindow: 128_000,
    maxOutputTokens: 16_000,
    inputTypes: ["text", "image"],
    outputTypes: ["text"],
    supportsVision: true,
    supportsTools: true,
    supportsReasoning: reasoning,
    supportsFiles: true,
    supportsStructuredOutput: true,
    inputPricePerMTok: input,
    outputPricePerMTok: output,
    cachedInputPricePerMTok: input / 4,
    releasedAt: null,
    deprecatedAt: null,
    firstSeenAt: BASELINE,
  }
}

/** Curated vision-capable models; standalone deployments do not sync the full gateway catalog. */
const STATIC_CATALOG: CatalogModel[] = [
  vision("openai/gpt-5-mini", "GPT-5 mini", "gpt-5", 0.25, 2),
  vision("openai/gpt-5", "GPT-5", "gpt-5", 1.25, 10, true),
  vision("google/gemini-2.5-flash", "Gemini 2.5 Flash", "gemini-2.5", 0.3, 2.5),
  vision("anthropic/claude-sonnet-4.5", "Claude Sonnet 4.5", "claude-4.5", 3, 15),
]

function providerConfigured() {
  return gatewayAuthAvailable() || Boolean(process.env.OPENAI_API_KEY)
}

function pick(models: CatalogModel[], ...ids: (string | null | undefined)[]) {
  for (const id of ids) {
    const found = id ? models.find((m) => m.id === id) : undefined
    if (found) return found
  }
  return null
}

export async function resolveTenantModels(
  _tenantId: number,
  settings: TenantAiSettings,
  _role: "admin" | "employee",
  _opts: { force?: boolean } = {},
): Promise<ResolvedModels> {
  if (!providerConfigured()) {
    return { status: "not_configured", lastSyncedAt: null, error: null, usable: [], all: [], defaultModel: null, fallbackModel: null, baselineAt: "" }
  }
  const allowed = settings.allowedModels
  const all = STATIC_CATALOG.map((model) => {
    const usable = !allowed || allowed.length === 0 || allowed.includes(model.id)
    return { model, usable, reason: usable ? null : "Not in the organisation's allowed models." }
  })
  const usable = all.filter((m) => m.usable).map((m) => m.model)
  const defaultModel = pick(usable, settings.defaultModel, process.env.AI_DEFAULT_MODEL) ?? usable[0] ?? null
  const fallbackModel = pick(usable.filter((m) => m.id !== defaultModel?.id), process.env.AI_FALLBACK_MODEL) ?? usable.find((m) => m.id !== defaultModel?.id) ?? null
  return { status: "ok", lastSyncedAt: BASELINE, error: null, usable, all, defaultModel, fallbackModel, baselineAt: BASELINE }
}
