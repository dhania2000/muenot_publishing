/**
 * @file lib/demo/outbound-guard.ts
 * @module Demo Data
 * @kind Server-side library
 * @summary Demo Data domain logic (assertOutboundAllowed, guardedExternalFetch).
 * @exports assertOutboundAllowed, guardedExternalFetch
 * @usedBy lib/ai/assistant-service.ts, lib/background-jobs.ts, lib/email.ts
 * @see docs/CODEBASE-GUIDE.md for module ownership, conventions and where to add new code.
 */
/**
 * Demo Sandbox Mode — outbound side-effect guard (defense-in-depth).
 * ---------------------------------------------------------------------------
 * Provider clients (mail transport, queue producer, AI assistant, outbound
 * fetch) call this immediately before the external effect. Demo requests are
 * already refused by the proxy and `getSession()` never authenticates them, so
 * reaching this guard from a demo session means another layer was bypassed —
 * it throws instead of letting the side effect happen.
 */
import type { DemoAction } from "./capabilities"
import { demoPolicy } from "./policy"

export async function assertOutboundAllowed(action: DemoAction): Promise<void> {
  await demoPolicy.assertAllowed(action)
}

/** `fetch` for third-party APIs that refuses to leave the server for demo callers. */
export async function guardedExternalFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  await assertOutboundAllowed("EXTERNAL_API")
  return fetch(input, init)
}
