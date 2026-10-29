/**
 * @file app/api/alt-text/settings/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary GET / PATCH /api/alt-text/settings — read or update tenant Alt Text defaults and the
 *   Phase 3 Advanced Accessibility preferences stored in the same tenant settings row.
 * @security GET: history gate (view). PATCH: history gate + admin or publishing.alt_text:manage_settings grant.
 *   Tenant always comes from the trusted session context. A preferred model is only accepted if it is
 *   governed-usable and vision-capable for this tenant. Capability-gated preferences can only be
 *   enabled when the backend reports the capability as available.
 */
import type { NextRequest } from "next/server"
import {normalizeClientGuideline} from "@/lib/alt-text/client-guideline"
import {readBody} from "@/lib/alt-text/document-extraction-run"
import { getSession } from "@/lib/auth"
import { getTenantAiSettings } from "@/lib/ai/assistant-store"
import { resolveTenantModels } from "@/lib/ai/model-catalog"
import { detectAccessibilityBackend } from "@/lib/alt-text/accessibility-backend"
import {
  changedAccessibilityFields,
  deriveCapabilityStates,
  mergeAccessibilityPreferences,
  normalizeAccessibilityPreferences,
  resolveEffectiveAccessibilitySettings,
  validateAccessibilityPatch,
} from "@/lib/alt-text/accessibility-settings"
import { normalizeSettings, type AltTextSettings } from "@/lib/alt-text/core"
import { gateAltTextHistory, jsonError, jsonOk, unexpected } from "@/lib/alt-text/route-gate"
import { getSettingsRecord, saveSettingsRecord, type AltTextSettingsRecord } from "@/lib/alt-text/store"
import { isVisionCompatible } from "@/lib/alt-text/vision-service"
import { hasActionGrant } from "@/lib/permission-store"
import { currentTenantIdOrNull } from "@/lib/tenant-scope"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BODY_BYTES = 16 * 1024
const SETTING_KEYS = new Set<keyof AltTextSettings>(["defaultLanguage", "defaultAudience", "preferredModelId", "shortMaxChars", "requireReview", "maxFileMb", "maxBatchSize"])
const BODY_KEYS = new Set<string>([...SETTING_KEYS, "accessibility", "clientGuideline", "expectedRevision"])

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>
const modelRole = (s: Session) => (s.role === "admin" ? "admin" : "employee")
const canManage = async (s: Session) => s.role === "admin" || (await hasActionGrant(s.userId, s.role, "publishing.alt_text", "manage_settings"))

async function settingsPayload(record: AltTextSettingsRecord, tenantId: number, session: Session, manage: boolean) {
  const backend = await detectAccessibilityBackend(tenantId, modelRole(session))
  return {
    success: true,
    settings: record.settings,
    clientGuideline:normalizeClientGuideline(record.clientGuideline),
    revision: record.revision,
    updatedAt: record.updatedAt,
    accessibility: resolveEffectiveAccessibilitySettings({ storedAccessibility: record.accessibility,clientGuideline:record.clientGuideline, revision: record.revision, tenant: record.settings, backend }),
    permissions: { canManage: manage },
  }
}

export async function GET() {
  const gate = await gateAltTextHistory()
  if (!gate.ok) return gate.response
  const session = await getSession()
  const tenantId = currentTenantIdOrNull()
  if (!session || tenantId == null) return jsonError({ status: 401, code: "UNAUTHENTICATED", error: "Unauthorized" })
  try {
    const [record, manage] = await Promise.all([getSettingsRecord(), canManage(session)])
    return jsonOk(await settingsPayload(record, tenantId, session, manage))
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
  if (!(await canManage(session))) {
    return jsonError({ status: 403, code: "FORBIDDEN", error: "You do not have permission to change Alt Text settings." })
  }

  if (Number(req.headers.get("content-length")) > MAX_BODY_BYTES) return jsonError({ status: 413, code: "PAYLOAD_TOO_LARGE", error: "Request body is too large." })
  let body: unknown
  try {
    const bytes=await readBody(req.body,MAX_BODY_BYTES)
    if(!bytes)return jsonError({status:413,code:"PAYLOAD_TOO_LARGE",error:"Settings body is empty or exceeds the byte limit."})
    body = JSON.parse(bytes.toString("utf8"))
  } catch {
    return jsonError({ status: 400, code: "INVALID_REQUEST", error: "Send a valid JSON body." })
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError({ status: 400, code: "INVALID_REQUEST", error: "Send a JSON object." })
  const unknown = Object.keys(body).filter((k) => !BODY_KEYS.has(k))
  if (unknown.length) return jsonError({ status: 400, code: "INVALID_REQUEST", error: "Unexpected fields in request.", details: { fields: unknown } })

  const { accessibility: accessibilityPatch,clientGuideline:rawGuideline, expectedRevision: rawRevision, ...legacy } = body as Record<string, unknown>
  if(rawGuideline!==undefined)return jsonError({status:400,code:"CLIENT_GUIDELINE_LIBRARY_REQUIRED",error:"Client guidelines are now saved separately for each client. Reload Settings and use the client library."})
  if (rawRevision !== undefined && !(Number.isSafeInteger(rawRevision) && Number(rawRevision) >= 0)) {
    return jsonError({ status: 400, code: "INVALID_REQUEST", error: "expectedRevision must be a non-negative integer." })
  }
  const expectedRevision = rawRevision === undefined ? null : Number(rawRevision)

  try {
    const record = await getSettingsRecord()
    if (expectedRevision != null && expectedRevision !== record.revision) return conflict(record.revision)

    let nextAccessibility: unknown = undefined
    let changedFields: string[] = []
    if (accessibilityPatch !== undefined) {
      const backend = await detectAccessibilityBackend(tenantId, modelRole(session))
      const checked = validateAccessibilityPatch(accessibilityPatch, deriveCapabilityStates(backend))
      if (!checked.ok) {
        return jsonError({ status: 400, code: "VALIDATION_FAILED", error: "Some settings are invalid.", details: { fieldErrors: checked.errors } })
      }
      const current = normalizeAccessibilityPreferences(record.accessibility).preferences
      const merged = mergeAccessibilityPreferences(current, checked.patch)
      changedFields = changedAccessibilityFields(current, merged)
      nextAccessibility = merged
    }

    const next = normalizeSettings({ ...record.settings, ...legacy })
    if (next.preferredModelId && next.preferredModelId !== record.settings.preferredModelId) {
      const resolved = await resolveTenantModels(tenantId, await getTenantAiSettings(), modelRole(session))
      const model = resolved.usable.find((m) => m.id === next.preferredModelId)
      if (!model || !isVisionCompatible(model)) {
        return jsonError({ status: 400, code: "MODEL_NOT_ALLOWED", error: "Choose an approved model that supports image input." })
      }
    }

    const saved = await saveSettingsRecord({ settings: next, accessibility: nextAccessibility, expectedRevision: expectedRevision ?? record.revision }, session.userId)
    if (!saved.ok) return conflict(saved.revision)
    const changedLegacy = (Object.keys(next) as (keyof AltTextSettings)[]).filter((k) => next[k] !== record.settings[k])
    console.info("[alt-text/settings] updated", { tenantId, actorId: session.userId, revision: saved.revision, fields: [...changedLegacy, ...changedFields] })

    return jsonOk(await settingsPayload(await getSettingsRecord(), tenantId, session, true))
  } catch (err) {
    return unexpected("settings", err)
  }
}

function conflict(revision: number) {
  return jsonError({
    status: 409,
    code: "SETTINGS_CONFLICT",
    error: "Settings were changed by someone else. Reload to see the latest values before saving.",
    details: { revision },
  })
}
