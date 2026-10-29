import {readBody} from "@/lib/alt-text/document-extraction-run"
/**
 * @file app/api/alt-text/assets/[id]/ocr/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary Phase 3 Task 5 — GET saved OCR results (never runs the engine); POST runs self-hosted OCR
 *   on the full image or one detected text region and saves a new version. `occurrenceId` (query for
 *   GET, body for POST) targets one document image occurrence.
 * @security History gate (view; update for POST). Tenant and role come from the trusted session.
 *   Per-asset scope, occurrence ownership, OCR capability and tenant OCR policy are enforced in the service.
 */
import type { NextRequest } from "next/server"
import { getSession } from "@/lib/auth"
import { parseOccurrenceId } from "@/lib/alt-text/classification-service"
import { parseAssetId } from "@/lib/alt-text/history"
import { readOcrResults, runOcr } from "@/lib/alt-text/ocr-service"
import { gateAltTextHistory, jsonError, jsonOk, unexpected } from "@/lib/alt-text/route-gate"
import { currentTenantIdOrNull } from "@/lib/tenant-scope"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

type Ctx = { params: Promise<{ id: string }> }
const MAX_BODY_BYTES = 2 * 1024
const INVALID_ID = { status: 400, code: "INVALID_ID", error: "Invalid asset id." }
const INVALID_OCCURRENCE = { status: 400, code: "INVALID_REQUEST", error: "occurrenceId must be a positive integer." }
const UNAUTHENTICATED = { status: 401, code: "UNAUTHENTICATED", error: "Unauthorized" }

async function context() {
  const session = await getSession()
  const tenantId = currentTenantIdOrNull()
  if (!session || tenantId == null) return null
  return { tenantId, role: session.role === "admin" ? ("admin" as const) : ("employee" as const) }
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const id = parseAssetId((await params).id)
  if (id == null) return jsonError(INVALID_ID)
  const occurrenceId = parseOccurrenceId(req.nextUrl.searchParams.get("occurrenceId"))
  if (occurrenceId === undefined) return jsonError(INVALID_OCCURRENCE)
  const gate = await gateAltTextHistory({ withPermissions: true })
  if (!gate.ok) return gate.response
  try {
    const ctx = await context()
    if (!ctx) return jsonError(UNAUTHENTICATED)
    // Resolve update scope only so the UI can show the action; POST re-checks it.
    const editGate = gate.permissions?.canEdit ? await gateAltTextHistory({ edit: true }) : null
    const actor = editGate?.ok ? editGate.actor : gate.actor
    const result = await readOcrResults(id, occurrenceId, { ...actor, ...ctx })
    return result.ok ? jsonOk(result.body) : jsonError(result)
  } catch (err) {
    return unexpected("ocr", err)
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const id = parseAssetId((await params).id)
  if (id == null) return jsonError(INVALID_ID)
  const gate = await gateAltTextHistory({ edit: true })
  if (!gate.ok) return gate.response
  if (Number(req.headers.get("content-length")) > MAX_BODY_BYTES) return jsonError({ status: 413, code: "PAYLOAD_TOO_LARGE", error: "Request body is too large." })
  let body: unknown
  try {
    const bytes = await readBody(req.body,MAX_BODY_BYTES)
    if(!bytes)return jsonError({status:413,code:"PAYLOAD_TOO_LARGE",error:"Request body is empty or exceeds the byte limit."})
    const text=bytes.toString("utf8")
    if (text.length > MAX_BODY_BYTES) return jsonError({ status: 413, code: "PAYLOAD_TOO_LARGE", error: "Request body is too large." })
    body = JSON.parse(text)
  } catch {
    return jsonError({ status: 400, code: "INVALID_JSON", error: "Request body must be valid JSON." })
  }
  try {
    const ctx = await context()
    if (!ctx) return jsonError(UNAUTHENTICATED)
    const result = await runOcr(id, body, { ...gate.actor, ...ctx })
    return result.ok ? jsonOk(result.body) : jsonError(result)
  } catch (err) {
    return unexpected("ocr", err)
  }
}
