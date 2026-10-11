/**
 * @file app/api/alt-text/upload/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary POST /api/alt-text/upload — single JPG/PNG/WEBP intake into private tenant storage.
 * @security Session + publishing module toggle/plan + publishing.view_alt_text + publishing.alt_text:upload.
 */
import { NextResponse, type NextRequest } from "next/server"
import { requireFeatureInModule } from "@/lib/api-auth"
import { hasActionGrant } from "@/lib/permission-store"
import { currentTenantIdOrNull } from "@/lib/tenant-scope"
import { checkRateLimit } from "@/lib/rate-limit"
import { ALT_TEXT_UPLOAD_MAX_MB, processAltTextUpload } from "@/lib/alt-text/upload"

export const dynamic = "force-dynamic"

const MULTIPART_OVERHEAD_BYTES = 64 * 1024
const RATE_LIMIT = { max: 30, windowMs: 60_000 }

const NO_STORE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }

const error = (status: number, code: string, message: string, headers?: Record<string, string>) =>
  NextResponse.json({ success: false, error: message, code }, { status, headers: { ...NO_STORE, ...(headers ?? {}) } })

export async function POST(req: NextRequest) {
  const gate = await requireFeatureInModule("publishing", "publishing.view_alt_text")
  if (!gate.ok) return error(gate.status, "code" in gate ? gate.code : gate.status === 401 ? "UNAUTHENTICATED" : gate.status === 404 ? "NOT_FOUND" : "FORBIDDEN", gate.error)
  const { session } = gate

  if (session.role !== "admin" && !(await hasActionGrant(session.userId, session.role, "publishing.alt_text", "upload"))) {
    return error(403, "FORBIDDEN", "You do not have permission to upload images.")
  }
  const tenantId = currentTenantIdOrNull()
  if (tenantId == null) return error(403, "FORBIDDEN", "No tenant in context")

  const limit = await checkRateLimit(`alt-text-upload:${tenantId}:${session.userId}`, RATE_LIMIT)
  if (!limit.allowed) return error(429, "RATE_LIMITED", "Too many uploads. Please wait and try again.", { "Retry-After": String(limit.retryAfter) })

  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
    return error(415, "UNSUPPORTED_MEDIA_TYPE", "Send the image as multipart/form-data.")
  }
  const declaredLength = Number(req.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > ALT_TEXT_UPLOAD_MAX_MB * 1024 * 1024 + MULTIPART_OVERHEAD_BYTES) {
    return error(413, "FILE_TOO_LARGE", `Images must be ${ALT_TEXT_UPLOAD_MAX_MB} MB or smaller.`)
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return error(400, "INVALID_REQUEST", "The upload could not be read.")
  }
  const files = [...form.values()].filter((v): v is File => v instanceof File)
  if (files.length === 0) return error(400, "MISSING_FILE", "An image file is required.")
  if (files.length > 1) return error(400, "MULTIPLE_FILES", "Upload one image at a time.")

  try {
    const result = await processAltTextUpload(files[0], { userId: session.userId, reuseExisting: form.get("reuseExisting") === "1" })
    if (!result.ok) return error(result.status, result.code, result.error)
    return NextResponse.json({ success: true, asset: result.asset, reused: result.reused === true }, { status: result.reused ? 200 : 201, headers: NO_STORE })
  } catch (err) {
    console.error("[alt-text/upload] unexpected failure", err instanceof Error ? err.name : "unknown")
    return error(500, "UPLOAD_FAILED", "The image could not be uploaded. Please try again.")
  }
}
