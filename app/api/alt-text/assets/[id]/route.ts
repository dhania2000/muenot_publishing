/**
 * @file app/api/alt-text/assets/[id]/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary GET / PATCH /api/alt-text/assets/[id] — read one asset, or save a manual edit with optimistic concurrency.
 * @security See lib/alt-text/route-gate.ts. PATCH also requires publishing.alt_text:update record scope.
 */
import type { NextRequest } from "next/server"
import { parseAssetId, parseEditRequest, readAsset, updateAsset } from "@/lib/alt-text/history"
import { gateAltTextHistory, jsonError, jsonOk, unexpected } from "@/lib/alt-text/route-gate"

export const dynamic = "force-dynamic"

const MAX_BODY_BYTES = 64 * 1024
const INVALID_ID = { status: 400, code: "INVALID_ID", error: "Invalid asset identifier." }

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const id = parseAssetId((await params).id)
  if (id == null) return jsonError(INVALID_ID)
  const gate = await gateAltTextHistory()
  if (!gate.ok) return gate.response
  try {
    const result = await readAsset(id, gate.actor)
    return result.ok ? jsonOk(result.body) : jsonError(result)
  } catch (err) {
    return unexpected("asset", err)
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
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
  const parsed = parseEditRequest(body)
  if (!parsed.ok) return jsonError(parsed)
  try {
    const result = await updateAsset(id, parsed.value, gate.actor)
    return result.ok ? jsonOk(result.body) : jsonError(result)
  } catch (err) {
    return unexpected("asset-edit", err)
  }
}
