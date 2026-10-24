/**
 * @file lib/alt-text/route-gate.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Shared session/module/tenant/permission gate and JSON responses for the Alt Text history routes.
 * @security Session + publishing module toggle/plan + publishing.view_alt_text + publishing.alt_text:view (and :update when editing).
 */
import "server-only"
import { NextResponse } from "next/server"
import { requireFeatureInModule } from "@/lib/api-auth"
import { getActionScope, getScope } from "@/lib/permission-store"
import { currentTenantIdOrNull } from "@/lib/tenant-scope"
import { storeErrorToFailure, type HistoryActor, type HistoryFailure } from "./history"

const NO_STORE = { "Cache-Control": "private, no-store" }

export const jsonError = (f: Omit<HistoryFailure, "ok">) =>
  NextResponse.json({ success: false, error: f.error, code: f.code, ...(f.details ?? {}) }, { status: f.status, headers: NO_STORE })

export const jsonOk = (body: unknown) => NextResponse.json(body, { headers: NO_STORE })

export type ReviewPermissions = { canEdit: boolean; canReview: boolean }

export async function gateAltTextHistory(
  opts: {
    edit?: boolean
    export?: boolean
    /** Document processing creates assets, so it needs the upload action. */
    upload?: boolean
    /** Task 14 review decisions need the publishing.alt_text:approve action. */
    review?: boolean
    /** Also resolve edit/review capability flags for the UI (never trusted for enforcement). */
    withPermissions?: boolean
  } = {},
): Promise<{ ok: true; actor: HistoryActor; permissions?: ReviewPermissions } | { ok: false; response: NextResponse }> {
  const gate = await requireFeatureInModule("publishing", "publishing.view_alt_text")
  if (!gate.ok) {
    const code = "code" in gate ? String(gate.code) : gate.status === 401 ? "UNAUTHENTICATED" : gate.status === 404 ? "NOT_FOUND" : "FORBIDDEN"
    return { ok: false, response: jsonError({ status: gate.status, code, error: gate.error }) }
  }
  const { session } = gate
  if (currentTenantIdOrNull() == null) return { ok: false, response: jsonError({ status: 403, code: "FORBIDDEN", error: "No tenant in context" }) }
  try {
    const viewScope = await getScope(session.userId, session.role, "publishing.alt_text", "view")
    if (viewScope === "none") return { ok: false, response: jsonError({ status: 403, code: "FORBIDDEN", error: "You do not have permission to view alt text." }) }
    if (opts.export) {
      const exportScope = await getActionScope(session.userId, session.role, "publishing.alt_text", "export")
      if (exportScope === "none") return { ok: false, response: jsonError({ status: 403, code: "FORBIDDEN", error: "You do not have permission to export alt text." }) }
    }
    if (opts.upload) {
      const uploadScope = await getActionScope(session.userId, session.role, "publishing.alt_text", "upload")
      if (uploadScope === "none") return { ok: false, response: jsonError({ status: 403, code: "FORBIDDEN", error: "You do not have permission to process documents." }) }
    }
    let permissions: ReviewPermissions | undefined
    if (opts.review || opts.withPermissions) {
      const [approveScope, update] = await Promise.all([
        getActionScope(session.userId, session.role, "publishing.alt_text", "approve"),
        getScope(session.userId, session.role, "publishing.alt_text", "update"),
      ])
      permissions = { canReview: approveScope !== "none" && update !== "none", canEdit: update !== "none" }
      if (opts.review && !permissions.canReview) {
        return { ok: false, response: jsonError({ status: 403, code: "FORBIDDEN", error: "You do not have permission to review or approve alt text." }) }
      }
    }
    if (!opts.edit) return { ok: true, actor: { userId: session.userId, viewScope }, ...(permissions ? { permissions } : {}) }
    const updateScope = await getScope(session.userId, session.role, "publishing.alt_text", "update")
    if (updateScope === "none") return { ok: false, response: jsonError({ status: 403, code: "FORBIDDEN", error: "You do not have permission to edit alt text." }) }
    return { ok: true, actor: { userId: session.userId, viewScope, updateScope }, ...(permissions ? { permissions } : {}) }
  } catch (err) {
    return { ok: false, response: unexpected("gate", err) }
  }
}

export function unexpected(where: string, err: unknown) {
  console.error(`[alt-text/${where}] unexpected failure`, err instanceof Error ? err.name : "unknown")
  return jsonError(storeErrorToFailure(err))
}
