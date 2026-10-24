/**
 * @file app/api/alt-text/assets/[id]/classification/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary Phase 3 Task 3 — GET the resolved image classification, PUT a manual correction, DELETE
 *   a manual correction. `occurrenceId` (query for GET/DELETE, body for PUT) targets one document
 *   image occurrence instead of the whole asset.
 * @security History gate (view; update for PUT/DELETE). Tenant comes from the trusted session.
 *   Per-asset scope and the tenant "allow category correction" policy are enforced in the service.
 */
import type { NextRequest } from "next/server"
import { getSession } from "@/lib/auth"
import { clearClassificationCorrection, correctClassification, parseOccurrenceId, readClassification } from "@/lib/alt-text/classification-service"
import { parseAssetId } from "@/lib/alt-text/history"
import { gateAltTextHistory, jsonError, jsonOk, unexpected } from "@/lib/alt-text/route-gate"
import { currentTenantIdOrNull } from "@/lib/tenant-scope"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }
const MAX_BODY_BYTES = 8 * 1024
const INVALID_ID = { status: 400, code: "INVALID_ID", error: "Invalid asset id." }
const INVALID_OCCURRENCE = { status: 400, code: "INVALID_REQUEST", error: "occurrenceId must be a positive integer." }

async function context(canEdit: boolean) {
  const session = await getSession()
  const tenantId = currentTenantIdOrNull()
  if (!session || tenantId == null) return null
  return { tenantId, role: session.role === "admin" ? ("admin" as const) : ("employee" as const), canEdit }
}

const UNAUTHENTICATED = { status: 401, code: "UNAUTHENTICATED", error: "Unauthorized" }

export async function GET(req: NextRequest, { params }: Ctx) {
  const id = parseAssetId((await params).id)
  if (id == null) return jsonError(INVALID_ID)
  const occurrenceId = parseOccurrenceId(req.nextUrl.searchParams.get("occurrenceId"))
  if (occurrenceId === undefined) return jsonError(INVALID_OCCURRENCE)
  const gate = await gateAltTextHistory({ withPermissions: true })
  if (!gate.ok) return gate.response
  try {
    const canEdit = gate.permissions?.canEdit ?? false
    const ctx = await context(canEdit)
    if (!ctx) return jsonError(UNAUTHENTICATED)
    const editGate = canEdit ? await gateAltTextHistory({ edit: true }) : null
    const actor = editGate?.ok ? editGate.actor : gate.actor
    const result = await readClassification(id, occurrenceId, actor, { ...ctx, canEdit: !!editGate?.ok })
    return result.ok ? jsonOk(result.body) : jsonError(result)
  } catch (err) {
    return unexpected("classification", err)
  }
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const id = parseAssetId((await params).id)
  if (id == null) return jsonError(INVALID_ID)
  const gate = await gateAltTextHistory({ edit: true })
  if (!gate.ok) return gate.response
  if (Number(req.headers.get("content-length")) > MAX_BODY_BYTES) return jsonError({ status: 413, code: "PAYLOAD_TOO_LARGE", error: "Request body is too large." })
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError({ status: 400, code: "INVALID_REQUEST", error: "Send a valid JSON body." })
  }
  try {
    const ctx = await context(true)
    if (!ctx) return jsonError(UNAUTHENTICATED)
    const result = await correctClassification(id, body, gate.actor, ctx)
    return result.ok ? jsonOk(result.body) : jsonError(result)
  } catch (err) {
    return unexpected("classification-correct", err)
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const id = parseAssetId((await params).id)
  if (id == null) return jsonError(INVALID_ID)
  const occurrenceId = parseOccurrenceId(req.nextUrl.searchParams.get("occurrenceId"))
  if (occurrenceId === undefined) return jsonError(INVALID_OCCURRENCE)
  const gate = await gateAltTextHistory({ edit: true })
  if (!gate.ok) return gate.response
  try {
    const ctx = await context(true)
    if (!ctx) return jsonError(UNAUTHENTICATED)
    const result = await clearClassificationCorrection(id, occurrenceId, gate.actor, ctx)
    return result.ok ? jsonOk(result.body) : jsonError(result)
  } catch (err) {
    return unexpected("classification-clear", err)
  }
}
