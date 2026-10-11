/**
 * @file lib/ai/model-catalog.ts
 * @module AI Features
 * @kind Server-side library
 * @summary AI Features domain logic (accessContext, ModelView, CatalogStatus, ModelCatalogResponse, …).
 * @exports accessContext, ModelView, CatalogStatus, ModelCatalogResponse, resolveTenantModels, toModelView, buildCatalogResponse, governanceRows
 * @usedBy app/api/ai/governance/route.ts, app/api/ai/models/route.ts, lib/ai/assistant-service.ts
 * @see docs/CODEBASE-GUIDE.md for module ownership, conventions and where to add new code.
 */
import "server-only"
import {
  canChooseModel,
  costTier,
  isLatestModel,
  isNewModel,
  policyDecision,
  resolveDefaults,
  toAiModel,
  type CatalogModel,
  type UserRole,
} from "./catalog-core"
import { getModelCatalog, providerConfigured } from "./catalog-store"
import type { TenantAiSettings } from "./governance-core"
import type { AiModel, ModelAccessContext } from "./models-core"

export function accessContext(tenantId: number, settings: TenantAiSettings): ModelAccessContext {
  return { tenantId, planKey: null, tenantAllowedModels: settings.allowedModels, advancedEntitled: true, needsTools: false }
}

/** Client-facing model description. Contains no pricing secrets or credentials. */
export type ModelView = {
  id: string
  displayName: string
  description: string
  family: string
  provider: string
  status: "available"
  recommended: boolean
  isDefault: boolean
  isFallback: boolean
  latest: boolean
  isNew: boolean
  deprecated: boolean
  deprecatedAt: string | null
  releasedAt: string | null
  contextWindow: number | null
  maxOutputTokens: number | null
  inputTypes: string[]
  outputTypes: string[]
  supportsVision: boolean
  supportsTools: boolean
  supportsReasoning: boolean
  supportsFiles: boolean
  costTier: "economy" | "standard" | "advanced"
}

export type CatalogStatus = "ok" | "stale" | "error" | "not_configured"

export type ModelCatalogResponse = {
  status: CatalogStatus
  provider: { name: string; configured: boolean }
  lastSyncedAt: string | null
  error: string | null
  canSelect: boolean
  canRefresh: boolean
  defaultModelId: string | null
  fallbackModelId: string | null
  models: ModelView[]
  permissions: { vision: boolean; tools: boolean; files: boolean }
}

type Resolved = {
  status: CatalogStatus
  lastSyncedAt: string | null
  error: string | null
  usable: CatalogModel[]
  all: { model: CatalogModel; usable: boolean; reason: string | null }[]
  defaultModel: CatalogModel | null
  fallbackModel: CatalogModel | null
  baselineAt: string
}

export async function resolveTenantModels(
  tenantId: number,
  settings: TenantAiSettings,
  role: UserRole,
  opts: { force?: boolean; schedule?: (task: () => Promise<unknown>) => void } = {},
): Promise<Resolved> {
  if (!providerConfigured()) {
    return { status: "not_configured", lastSyncedAt: null, error: null, usable: [], all: [], defaultModel: null, fallbackModel: null, baselineAt: "" }
  }
  const state = await getModelCatalog(tenantId, { force: opts.force, allowFineTuned: settings.allowFineTunedModels, schedule: opts.schedule })
  const models = state.snapshot?.models ?? []
  const all = models.map((model) => ({ model, ...policyDecision(model, settings, role, tenantId) }))
  const usable = all.filter((m) => m.usable).map((m) => m.model)
  const { defaultModel, fallbackModel } = resolveDefaults(usable, settings, {
    defaultModel: process.env.AI_DEFAULT_MODEL,
    fallbackModel: process.env.AI_FALLBACK_MODEL,
  })
  const status: CatalogStatus = !state.snapshot ? "error" : state.lastError && state.stale ? "stale" : "ok"
  return {
    status,
    lastSyncedAt: state.snapshot?.syncedAt ?? null,
    error: state.lastError,
    usable,
    all,
    defaultModel,
    fallbackModel,
    baselineAt: state.snapshot?.baselineAt ?? "",
  }
}

export function toModelView(m: CatalogModel, r: Pick<Resolved, "defaultModel" | "fallbackModel" | "baselineAt">, settings: TenantAiSettings, now = new Date()): ModelView {
  const isDefault = r.defaultModel?.id === m.id
  const isFallback = r.fallbackModel?.id === m.id
  return {
    id: m.id,
    displayName: m.displayName,
    description: m.description,
    family: m.family,
    provider: m.provider,
    status: "available",
    recommended: isDefault || isFallback,
    isDefault,
    isFallback,
    latest: isLatestModel(m, now),
    isNew: isNewModel(m, { baselineAt: r.baselineAt }, settings.newModelBadgeDays, now),
    deprecated: m.deprecatedAt != null,
    deprecatedAt: m.deprecatedAt,
    releasedAt: m.releasedAt,
    contextWindow: m.contextWindow,
    maxOutputTokens: m.maxOutputTokens,
    inputTypes: m.inputTypes,
    outputTypes: m.outputTypes,
    supportsVision: m.supportsVision,
    supportsTools: m.supportsTools,
    supportsReasoning: m.supportsReasoning,
    supportsFiles: m.supportsFiles,
    costTier: costTier(m),
  }
}

const PROVIDER_NAMES: Record<string, string> = { openai: "OpenAI" }

export function buildCatalogResponse(r: Resolved, settings: TenantAiSettings, role: UserRole): ModelCatalogResponse {
  const providerKey = (process.env.AI_MODEL_PROVIDERS || "openai").split(",")[0].trim().toLowerCase()
  return {
    status: r.status,
    provider: { name: PROVIDER_NAMES[providerKey] ?? providerKey, configured: r.status !== "not_configured" },
    lastSyncedAt: r.lastSyncedAt,
    error: role === "admin" ? r.error : r.error ? "The model catalog could not be refreshed." : null,
    canSelect: canChooseModel(settings, role) && r.usable.length > 1,
    canRefresh: role === "admin",
    defaultModelId: r.defaultModel?.id ?? null,
    fallbackModelId: r.fallbackModel?.id ?? null,
    models: r.usable.map((m) => toModelView(m, r, settings)),
    permissions: { vision: settings.allowVision, tools: settings.allowToolUse, files: settings.allowFileAnalysis },
  }
}

/** Governance-side rows: every compatible model with its policy outcome. */
export function governanceRows(r: Resolved, settings: TenantAiSettings) {
  return r.all.map(({ model, usable, reason }) => {
    const ai: AiModel = toAiModel(model)
    return {
      ...toModelView(model, r, settings),
      tier: ai.tier,
      speed: ai.speed,
      inputPricePerMTok: model.inputPricePerMTok,
      outputPricePerMTok: model.outputPricePerMTok,
      firstSeenAt: model.firstSeenAt,
      platformEnabled: true,
      usable,
      reason,
    }
  })
}
