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

/**
 * Resolve a catalog model ID into something `generateText` can call.
 * An explicitly configured OpenAI key takes precedence for OpenAI models.
 * Deployment-platform flags alone do not authenticate AI Gateway requests.
 */
export async function resolveLanguageModel(id: string): Promise<LanguageModel> {
  const openAiKey = process.env.OPENAI_API_KEY
  if (openAiKey && id.startsWith("openai/")) {
    const { createOpenAI } = await import("@ai-sdk/openai")
    return createOpenAI({ apiKey: openAiKey })(id.slice("openai/".length))
  }
  return id
}
