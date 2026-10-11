/**
 * @file app/api/alt-text/settings/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary GET / PATCH /api/alt-text/settings — read or update tenant Alt Text defaults.
 * @security GET: history gate (view). PATCH: history gate + admin or publishing.alt_text:manage_settings grant.
 *   A preferred model is only accepted if it is governed-usable and vision-capable for this tenant.
 */
import type { NextRequest } from "next/server"
import { getSession } from "@/lib/auth"
import { getTenantAiSettings } from "@/lib/ai/assistant-store"
import { resolveTenantModels } from "@/lib/ai/model-catalog"
import { normalizeSettings, type AltTextSettings } from "@/lib/alt-text/core"
import { gateAltTextHistory, jsonError, jsonOk, unexpected } from "@/lib/alt-text/route-gate"
import { getSettings, saveSettings } from "@/lib/alt-text/store"
import { isVisionCompatible } from "@/lib/alt-text/vision-service"
import { hasActionGrant } from "@/lib/permission-store"
import { currentTenantIdOrNull } from "@/lib/tenant-scope"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BODY_BYTES = 4 * 1024
const SETTING_KEYS = new Set<keyof AltTextSettings>(["defaultLanguage", "defaultAudience", "preferredModelId", "shortMaxChars", "requireReview", "maxFileMb", "maxBatchSize"])

export async function GET() {
  const gate = await gateAltTextHistory()
  if (!gate.ok) return gate.response
  try {
    return jsonOk({ success: true, settings: await getSettings() })
  } catch (err) {
    return unexpected("settings", err)
  }
}

export async function PATCH(req: NextRequest) {
  const gate = await gateAltTextHistory()
  if (!gate.ok) return gate.response
  const session = await getSession()
  const tenantId = currentTenantIdOrNull()
  if (!session || tenantId == null) return jsonError({ status: 401, code: "UNAUTHENTICATED", error: "Unauthorized" })
  if (session.role !== "admin" && !(await hasActionGrant(session.userId, session.role, "publishing.alt_text", "manage_settings"))) {
    return jsonError({ status: 403, code: "FORBIDDEN", error: "You do not have permission to change Alt Text settings." })
  }

  if (Number(req.headers.get("content-length")) > MAX_BODY_BYTES) return jsonError({ status: 413, code: "PAYLOAD_TOO_LARGE", error: "Request body is too large." })
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError({ status: 400, code: "INVALID_REQUEST", error: "Send a valid JSON body." })
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError({ status: 400, code: "INVALID_REQUEST", error: "Send a JSON object." })
  const unknown = Object.keys(body).filter((k) => !SETTING_KEYS.has(k as keyof AltTextSettings))
  if (unknown.length) return jsonError({ status: 400, code: "INVALID_REQUEST", error: "Unexpected fields in request.", details: { fields: unknown } })

  try {
    const next = normalizeSettings({ ...(await getSettings()), ...body })
    if (next.preferredModelId) {
      const resolved = await resolveTenantModels(tenantId, await getTenantAiSettings(), session.role === "admin" ? "admin" : "employee")
      const model = resolved.usable.find((m) => m.id === next.preferredModelId)
      if (!model || !isVisionCompatible(model)) {
        return jsonError({ status: 400, code: "MODEL_NOT_ALLOWED", error: "Choose an approved model that supports image input." })
      }
    }
    await saveSettings(next, session.userId)
    return jsonOk({ success: true, settings: next })
  } catch (err) {
    return unexpected("settings", err)
  }
}
