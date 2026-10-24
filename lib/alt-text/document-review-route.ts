/**
 * @file lib/alt-text/document-review-route.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Shared parsing/resolution helpers for the Phase 3 Task 14 review routes: id validation,
 *   owner-scoped document lookup, bounded JSON bodies and per-user rate limits.
 */
import "server-only"
import type { NextResponse } from "next/server"
import { checkRateLimit } from "@/lib/rate-limit"
import { currentTenantIdOrNull } from "@/lib/tenant-scope"
import { ownerScopeFor } from "./document-service"
import { getDocument } from "./document-store"
import type { HistoryActor } from "./history"
import { jsonError } from "./route-gate"

const ID = /^[1-9]\d{0,9}$/
export const MAX_REVIEW_BODY_BYTES = 64 * 1024

export const notFound = (what = "document") => jsonError({ status: 404, code: "NOT_FOUND", error: `The ${what} could not be found.` })

export const parseId = (raw: string): number | null => (ID.test(raw) ? Number(raw) : null)

export async function resolveDocument(rawId: string, actor: HistoryActor): Promise<{ ok: true; id: number } | { ok: false; response: NextResponse }> {
  const id = parseId(rawId)
  if (id == null) return { ok: false, response: notFound() }
  const doc = await getDocument(id, ownerScopeFor(actor))
  return doc ? { ok: true, id: doc.id } : { ok: false, response: notFound() }
}

export async function rateLimited(bucket: string, actor: HistoryActor, opts: { max: number; windowMs: number }): Promise<NextResponse | null> {
  const limit = await checkRateLimit(`alt-text-review-${bucket}:${currentTenantIdOrNull()}:${actor.userId}`, opts)
  if (limit.allowed) return null
  const res = jsonError({ status: 429, code: "RATE_LIMITED", error: "Too many requests. Please slow down." })
  res.headers.set("Retry-After", String(limit.retryAfter))
  return res
}

export async function readJsonBody(req: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  if (Number(req.headers.get("content-length")) > MAX_REVIEW_BODY_BYTES) {
    return { ok: false, response: jsonError({ status: 413, code: "PAYLOAD_TOO_LARGE", error: "Request body is too large." }) }
  }
  try {
    const text = await req.text()
    if (text.length > MAX_REVIEW_BODY_BYTES) return { ok: false, response: jsonError({ status: 413, code: "PAYLOAD_TOO_LARGE", error: "Request body is too large." }) }
    return { ok: true, body: JSON.parse(text) }
  } catch {
    return { ok: false, response: jsonError({ status: 400, code: "INVALID_REQUEST", error: "Send a valid JSON body." }) }
  }
}

export function parsePaging(sp: URLSearchParams, defaultSize: number, maxSize: number): { ok: true; page: number; pageSize: number } | { ok: false; response: NextResponse } {
  const page = sp.get("page") ?? "1"
  const pageSize = sp.get("pageSize") ?? String(defaultSize)
  const bad = (error: string) => ({ ok: false as const, response: jsonError({ status: 400, code: "INVALID_QUERY", error }) })
  if (!/^\d{1,6}$/.test(page) || Number(page) < 1) return bad("page must be a positive integer.")
  if (!/^\d{1,3}$/.test(pageSize) || Number(pageSize) < 1 || Number(pageSize) > maxSize) return bad(`pageSize must be between 1 and ${maxSize}.`)
  return { ok: true, page: Number(page), pageSize: Number(pageSize) }
}
