/**
 * @file lib/ai/error-diagnostics.ts
 * @module AI Features
 * @kind Server-side library
 * @summary AI Features domain logic (safeAiErrorMetadata, missingModuleSpecifier).
 * @exports safeAiErrorMetadata, missingModuleSpecifier
 * @usedBy app/api/ai/assistant/route.ts, lib/ai/assistant-service.ts; 2 test files
 * @see docs/CODEBASE-GUIDE.md for module ownership, conventions and where to add new code.
 */
/** Allowlisted error metadata only. SDK errors can contain prompts or request headers. */
export function safeAiErrorMetadata(error: unknown): Record<string, string | number> {
  if (!error || typeof error !== "object") return { kind: "unknown" }
  const value = error as Record<string, unknown>
  const result: Record<string, string | number> = {}
  for (const field of ["name", "code", "sqlState"] as const) {
    const item = value[field]
    const pattern = field === "sqlState" ? /^[A-Za-z0-9]{5}$/ : /^[A-Za-z][A-Za-z0-9_]{0,79}$/
    if (typeof item === "string" && pattern.test(item)) result[field] = item
  }
  const status = value.status ?? value.statusCode
  if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) result.status = status
  const missing = missingModuleSpecifier(error)
  if (missing) result.module = missing
  return Object.keys(result).length ? result : { kind: "unknown" }
}

const MODULE_SPECIFIER = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:\/[\w.-]+)*$/i

/**
 * For module-resolution failures, extract only the bare package specifier the
 * loader could not find (e.g. `sanitize-html`, `@ai-sdk/openai`). Self-hosted
 * deploys whose file tracing drops a nested dependency surface as exactly this
 * error, and without the specifier the failure is not actionable. Absolute
 * filesystem paths and anything else in the message are never returned.
 */
export function missingModuleSpecifier(error: unknown): string | null {
  if (!error || typeof error !== "object") return null
  const { code, message } = error as { code?: unknown; message?: unknown }
  if (code !== "MODULE_NOT_FOUND" && code !== "ERR_MODULE_NOT_FOUND") return null
  if (typeof message !== "string") return null
  const match = /Cannot find (?:module|package) '([^']{1,120})'/.exec(message)
  const specifier = match?.[1]
  if (!specifier || specifier.startsWith(".") || specifier.startsWith("/") || !MODULE_SPECIFIER.test(specifier)) return null
  return specifier
}
