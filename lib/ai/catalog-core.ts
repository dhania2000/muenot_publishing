export type ModelTier = "economy" | "standard" | "advanced"

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
  /** USD per million tokens; null when pricing is unknown. */
  inputPricePerMTok: number | null
  outputPricePerMTok: number | null
  cachedInputPricePerMTok: number | null
  releasedAt: string | null
  deprecatedAt: string | null
  firstSeenAt: string
}

export function costTier(m: Pick<CatalogModel, "inputPricePerMTok" | "outputPricePerMTok">): ModelTier {
  // Unknown pricing is treated as the most expensive tier so budgets fail closed.
  if (m.inputPricePerMTok == null || m.outputPricePerMTok == null) return "advanced"
  const blended = (m.inputPricePerMTok + 3 * m.outputPricePerMTok) / 4
  if (blended < 1.5) return "economy"
  if (blended < 6) return "standard"
  return "advanced"
}
