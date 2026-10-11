/**
 * @file lib/ai/provider.ts
 * @module AI Features
 * @kind Server-side library
 * @summary AI Features domain logic (gatewayAuthAvailable, resolveLanguageModel).
 * @exports gatewayAuthAvailable, resolveLanguageModel
 * @usedBy lib/ai/assistant-service.ts; 1 test file
 * @see docs/CODEBASE-GUIDE.md for module ownership, conventions and where to add new code.
 */
import "server-only"
import type { LanguageModel } from "ai"

/** True when requests have explicit AI Gateway credentials. */
export function gatewayAuthAvailable(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN)
}

/** Catalog IDs are `provider/model` strings that the AI SDK routes through Vercel AI Gateway. */
export async function resolveLanguageModel(id: string): Promise<LanguageModel> {
  return id
}
