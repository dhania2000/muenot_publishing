/**
 * @file lib/ai/catalog-core.ts
 * @module AI Features
 * @kind Server-side library
 * @summary AI Features domain logic (GatewayCatalogEntry, CatalogModel, CatalogSnapshot, REQUIRED_SPECIFICATION, …).
 * @exports GatewayCatalogEntry, CatalogModel, CatalogSnapshot, REQUIRED_SPECIFICATION, familyOf, ExclusionReason, CompatibilityOptions, exclusionReason, … (20 total)
 * @usedBy lib/ai/assistant-service.ts, lib/ai/catalog-store.ts, lib/ai/model-catalog.ts
 * @see docs/CODEBASE-GUIDE.md for module ownership, conventions and where to add new code.
 */
/**
 * Dynamic AI model catalog (pure). Turns a provider model listing into the
 * set of models the ERP assistant may offer. No model IDs are hard-coded:
 * compatibility is decided from catalog metadata (type, modalities, API
 * specification, deprecation) and organisation policy.
 */
import type { TenantAiSettings } from "./governance-core"
import { blendedPrice, checkModelAccess, type AiModel, type ModelTier } from "./models-core"

/** Shape of one entry from the AI Gateway `GET /v1/models` listing. Every field is optional by design. */
export type GatewayCatalogEntry = {
  id?: unknown
  name?: unknown
  description?: unknown
  owned_by?: unknown
  type?: unknown
  released?: unknown
  context_window?: unknown
  max_tokens?: unknown
  tags?: unknown
  modalities?: { input?: unknown; output?: unknown } | null
  supported_specifications?: unknown
  deprecated_at?: unknown
  pricing?: { input?: unknown; output?: unknown; input_cache_read?: unknown } | null
}

export type CatalogModel = {
  id: string
  provider: string
  displayName: string
  description: string
  family: string
  contextWindow: number | null
  maxOutputTokens: number | null
  inputTypes: string[]
  outputTypes: string[]
  supportsVision: boolean
  supportsTools: boolean
  supportsReasoning: boolean
  supportsFiles: boolean
  supportsStructuredOutput: boolean
  /** USD per million tokens; null when the catalog does not publish pricing. */
  inputPricePerMTok: number | null
  outputPricePerMTok: number | null
  cachedInputPricePerMTok: number | null
  releasedAt: string | null
  /** Provider-announced deprecation/shutdown date (may be in the future). */
  deprecatedAt: string | null
  /** When this tenant's catalog first observed the model. */
  firstSeenAt: string
}

export type CatalogSnapshot = {
  models: CatalogModel[]
  syncedAt: string
  /** First successful sync. Models first seen at the baseline are never flagged NEW. */
  baselineAt: string
  source: "gateway" | "gateway+openai" | "openai"
}

/** The AI SDK language model specification this deployment calls through. */
export const REQUIRED_SPECIFICATION = "v4"

/** Endpoints this assistant cannot drive through a text generation call. */
const NON_CHAT_ENDPOINT = /(^|[-/])(realtime|audio|tts|transcribe|search-preview|image|embedding|moderation)([-.]|$)/i

const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])
const posNum = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null
}
const perMTok = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.round(n * 1_000_000 * 10_000) / 10_000 : null
}
const toIso = (v: unknown): string | null => {
  if (v == null || v === "") return null
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Coarse family key used for governance allow-lists, e.g. `openai/gpt-5`. */
export function familyOf(id: string): string {
  const [provider, name = ""] = id.includes("/") ? id.split("/", 2) : ["", id]
  const m = name.toLowerCase().match(/^([a-z]+)(?:-?(\d+))?/)
  const fam = m ? (m[2] ? `${m[1]}-${m[2]}` : m[1]) : name
  return provider ? `${provider}/${fam}` : fam
}

export type ExclusionReason = "not_language" | "not_text" | "provider" | "endpoint" | "specification" | "retired" | "not_in_account" | "fine_tuned"

export type CompatibilityOptions = {
  providers: string[]
  /** IDs the organisation's own provider account can access; null = not checked. */
  accountModelIds: Set<string> | null
  allowFineTuned: boolean
  now: Date
}

/** Why an entry cannot serve the assistant, or null when compatible. */
export function exclusionReason(e: GatewayCatalogEntry, opts: CompatibilityOptions): ExclusionReason | null {
  const id = typeof e.id === "string" ? e.id : ""
  if (!id || !/^[a-z0-9-]+\/[a-z0-9.\-:_]+$/i.test(id)) return "endpoint"
  const provider = typeof e.owned_by === "string" ? e.owned_by : id.split("/")[0]
  if (!opts.providers.includes(provider)) return "provider"
  if (e.type !== "language") return "not_language"
  const input = strArr(e.modalities?.input)
  const output = strArr(e.modalities?.output)
  if ((input.length && !input.includes("text")) || (output.length && !output.includes("text"))) return "not_text"
  if (NON_CHAT_ENDPOINT.test(id.split("/")[1] ?? "")) return "endpoint"
  const specs = strArr(e.supported_specifications)
  if (specs.length && !specs.includes(REQUIRED_SPECIFICATION)) return "specification"
  const dep = toIso(e.deprecated_at)
  if (dep && new Date(dep) <= opts.now) return "retired"
  if (!opts.allowFineTuned && /(^|\/)ft:/.test(id)) return "fine_tuned"
  if (opts.accountModelIds && !opts.accountModelIds.has(id)) return "not_in_account"
  return null
}

export function toCatalogModel(e: GatewayCatalogEntry, firstSeenAt: string): CatalogModel {
  const id = String(e.id)
  const tags = strArr(e.tags)
  const input = strArr(e.modalities?.input)
  const output = strArr(e.modalities?.output)
  return {
    id,
    provider: typeof e.owned_by === "string" ? e.owned_by : id.split("/")[0],
    displayName: typeof e.name === "string" && e.name.trim() ? e.name.trim() : id.split("/")[1] ?? id,
    description: typeof e.description === "string" ? e.description.trim().slice(0, 400) : "",
    family: familyOf(id),
    contextWindow: posNum(e.context_window),
    maxOutputTokens: posNum(e.max_tokens),
    inputTypes: input.length ? input : ["text"],
    outputTypes: output.length ? output : ["text"],
    supportsVision: tags.includes("vision") || input.includes("image"),
    supportsTools: tags.includes("tool-use"),
    supportsReasoning: tags.includes("reasoning"),
    supportsFiles: tags.includes("file-input") || input.includes("pdf") || input.includes("file"),
    supportsStructuredOutput: tags.includes("structured-output"),
    inputPricePerMTok: perMTok(e.pricing?.input),
    outputPricePerMTok: perMTok(e.pricing?.output),
    cachedInputPricePerMTok: perMTok(e.pricing?.input_cache_read),
    releasedAt: toIso(e.released),
    deprecatedAt: toIso(e.deprecated_at),
    firstSeenAt,
  }
}

/** Build a snapshot, carrying `firstSeenAt` forward from the previous sync. */
export function buildSnapshot(
  entries: GatewayCatalogEntry[],
  previous: CatalogSnapshot | null,
  opts: CompatibilityOptions & { source: CatalogSnapshot["source"] },
): CatalogSnapshot {
  const now = opts.now.toISOString()
  const seen = new Map(previous?.models.map((m) => [m.id, m.firstSeenAt]) ?? [])
  const unique = new Map<string, CatalogModel>()
  for (const e of entries) {
    if (exclusionReason(e, opts)) continue
    const id = String(e.id)
    if (!unique.has(id)) unique.set(id, toCatalogModel(e, seen.get(id) ?? now))
  }
  return { models: [...unique.values()], syncedAt: now, baselineAt: previous?.baselineAt ?? now, source: opts.source }
}

export function costTier(m: Pick<CatalogModel, "inputPricePerMTok" | "outputPricePerMTok">): ModelTier {
  // Unknown pricing is treated as the most expensive tier so budgets fail closed.
  if (m.inputPricePerMTok == null || m.outputPricePerMTok == null) return "advanced"
  const blended = (m.inputPricePerMTok + 3 * m.outputPricePerMTok) / 4
  if (blended < 1.5) return "economy"
  if (blended < 6) return "standard"
  return "advanced"
}

const OUTPUT_CAP = 4_000

/** Adapter into the governance/cost model used by selection and the usage ledger. */
export function toAiModel(c: CatalogModel): AiModel {
  const tier = costTier(c)
  return {
    id: c.id,
    provider: c.provider,
    displayName: c.displayName,
    description: c.description,
    enabled: true,
    availability: "available",
    tier,
    speed: tier === "economy" ? "fast" : tier === "standard" ? "balanced" : "thorough",
    supportsTools: c.supportsTools,
    supportsStructuredOutput: c.supportsStructuredOutput,
    supportsReasoning: c.supportsReasoning,
    contextWindow: c.contextWindow ?? 0,
    maxOutputTokens: Math.min(c.maxOutputTokens ?? OUTPUT_CAP, OUTPUT_CAP),
    inputPricePerMTok: c.inputPricePerMTok ?? 0,
    outputPricePerMTok: c.outputPricePerMTok ?? 0,
    cachedInputPricePerMTok: c.cachedInputPricePerMTok,
    pricingVersion: 1,
    recommendedFor: [],
    deprecated: c.deprecatedAt != null,
    replacementModelId: null,
    allowedPlans: null,
    allowedTenantIds: null,
    monthlyTokenCap: null,
  }
}

export type UserRole = "admin" | "employee"

export type PolicyDecision = { usable: true; reason: null } | { usable: false; reason: string }

const TIER_RANK: Record<ModelTier, number> = { economy: 0, standard: 1, advanced: 2 }

/**
 * Organisation + role policy for one model:
 * account ∩ compatible (already applied) ∩ governance ∩ role.
 */
export function policyDecision(c: CatalogModel, settings: TenantAiSettings, role: UserRole, tenantId: number): PolicyDecision {
  const tier = costTier(c)
  if (TIER_RANK[tier] > TIER_RANK[settings.maxModelTier]) return { usable: false, reason: `Above the ${settings.maxModelTier} cost tier allowed by AI governance` }
  if (settings.blockedModels.includes(c.id)) return { usable: false, reason: "Blocked by AI governance" }
  if (settings.allowedFamilies && !settings.allowedFamilies.includes(c.family)) return { usable: false, reason: "Model family is not allowed by AI governance" }
  const access = checkModelAccess(toAiModel(c), {
    tenantId,
    planKey: null,
    tenantAllowedModels: settings.allowedModels,
    advancedEntitled: true,
    needsTools: false,
  })
  if (!access.allowed) return { usable: false, reason: access.reason }
  if (role !== "admin" && settings.employeeModels && !settings.employeeModels.includes(c.id)) {
    return { usable: false, reason: "Not permitted for your role" }
  }
  return { usable: true, reason: null }
}

export function canChooseModel(settings: TenantAiSettings, role: UserRole): boolean {
  return role === "admin" || settings.employeeModelSelection
}

const byNewest = (a: CatalogModel, b: CatalogModel) => (b.releasedAt ?? b.firstSeenAt).localeCompare(a.releasedAt ?? a.firstSeenAt)

/**
 * Resolve the organisation default and fallback from what is actually usable.
 * Order: governance setting → deployment env → newest usable model in the
 * preferred cost tier → newest usable model. Never a hard-coded ID.
 */
export function resolveDefaults(
  usable: CatalogModel[],
  settings: Pick<TenantAiSettings, "defaultModel" | "fallbackModel">,
  env: { defaultModel?: string | null; fallbackModel?: string | null } = {},
): { defaultModel: CatalogModel | null; fallbackModel: CatalogModel | null } {
  const byId = new Map(usable.map((m) => [m.id, m]))
  const sorted = [...usable].sort(byNewest)
  const newestIn = (tier: ModelTier, exclude?: string) => sorted.find((m) => m.id !== exclude && costTier(m) === tier) ?? null

  const defaultModel =
    (settings.defaultModel && byId.get(settings.defaultModel)) ||
    (env.defaultModel && byId.get(env.defaultModel)) ||
    newestIn("standard") ||
    newestIn("economy") ||
    sorted[0] ||
    null

  const fallbackModel =
    (settings.fallbackModel && settings.fallbackModel !== defaultModel?.id && byId.get(settings.fallbackModel)) ||
    (env.fallbackModel && env.fallbackModel !== defaultModel?.id && byId.get(env.fallbackModel)) ||
    newestIn("economy", defaultModel?.id) ||
    null

  return { defaultModel, fallbackModel }
}

export function isNewModel(c: CatalogModel, snapshot: Pick<CatalogSnapshot, "baselineAt">, days: number, now: Date): boolean {
  if (days <= 0 || c.firstSeenAt <= snapshot.baselineAt) return false
  return now.getTime() - new Date(c.firstSeenAt).getTime() < days * 86_400_000
}

const LATEST_WINDOW_DAYS = 120

export function isLatestModel(c: CatalogModel, now: Date): boolean {
  if (!c.releasedAt) return false
  return now.getTime() - new Date(c.releasedAt).getTime() < LATEST_WINDOW_DAYS * 86_400_000
}

export { blendedPrice }
