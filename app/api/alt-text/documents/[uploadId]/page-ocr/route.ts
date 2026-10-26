import { after, NextResponse } from "next/server"
import { gateAltTextHistory, jsonError, jsonOk, unexpected } from "@/lib/alt-text/route-gate"
import { getDocumentForExtraction, ownerScopeFor } from "@/lib/alt-text/document-service"
import { currentTenantId } from "@/lib/tenant-scope"
import { checkRateLimit } from "@/lib/rate-limit"
import { requestBackgroundJobCancel, runDueBackgroundJobs } from "@/lib/background-jobs"
import { enqueuePageOcr, latestPageOcrJob, pageOcrSummary, readOcrPages } from "@/lib/alt-text/pdf-page-ocr-store"
import { getPageOcrPolicy } from "@/lib/alt-text/pdf-page-ocr-policy"
import { parsePageOcrRequest, PDF_PAGE_OCR_LIMITS } from "@/lib/alt-text/pdf-page-ocr-types"
import type { HistoryActor } from "@/lib/alt-text/history"
import { readBody } from "@/lib/alt-text/document-extraction-run"
import type { PermissionScope } from "@/lib/permission-model"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300
type Ctx = { params: Promise<{ uploadId: string }> }
async function document(ctx: Ctx, actor: HistoryActor, uploadScope?: PermissionScope) {
  const id = (await ctx.params).uploadId
  const scope = uploadScope && uploadScope !== "all" ? { uploadedBy: actor.userId } : ownerScopeFor(actor)
  return /^[1-9]\d{0,9}$/.test(id) ? getDocumentForExtraction(Number(id), scope) : null
}
const missing = () => jsonError({ status: 404, code: "NOT_FOUND", error: "The PDF could not be found." })
export async function GET(req: Request, ctx: Ctx) {
  const gate = await gateAltTextHistory()
  if (!gate.ok) return gate.response
  try {
    const doc = await document(ctx, gate.actor)
    if (!doc || doc.documentType !== "pdf") return missing()
    if (doc.securityStatus !== "clean") return jsonError({ status: 409, code: "DOCUMENT_NOT_CLEAN", error: "Security clearance is required." })
    const search = new URL(req.url).searchParams
    const offset = Number(search.get("offset") ?? 0), selected = search.get("pageIndex"), pageIndex = selected == null ? undefined : Number(selected)
    if (!Number.isInteger(offset) || offset < 0 || offset >= PDF_PAGE_OCR_LIMITS.maxPages || (pageIndex != null && (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= PDF_PAGE_OCR_LIMITS.maxPages)))
      return jsonError({ status: 400, code: "INVALID_PAGE", error: "Invalid page selection." })
    const [pages, summary, policy, job, permission] = await Promise.all([readOcrPages(doc.id, pageIndex == null ? offset : 0, pageIndex == null ? PDF_PAGE_OCR_LIMITS.pageSize : 1, pageIndex), pageOcrSummary(doc.id), getPageOcrPolicy(), latestPageOcrJob(doc.id), gateAltTextHistory({ upload: true })])
    return jsonOk({ success: true, pages, ...summary, offset, policy, job, canRun: permission.ok && (permission.uploadScope === "all" || doc.uploadedBy === gate.actor.userId) })
  } catch (err) { return unexpected("page-ocr/read", err) }
}
export async function POST(req: Request, ctx: Ctx) {
  const gate = await gateAltTextHistory({ upload: true })
  if (!gate.ok) return gate.response
  try {
    const doc = await document(ctx, gate.actor, gate.uploadScope)
    if (!doc || doc.documentType !== "pdf") return missing()
    if (doc.securityStatus !== "clean") return jsonError({ status: 409, code: "DOCUMENT_NOT_CLEAN", error: "Security clearance is required." })
    const limit = await checkRateLimit(`pdf-page-ocr:${currentTenantId()}:${gate.actor.userId}`, { max: 10, windowMs: 60_000 })
    if (!limit.allowed) return jsonError({ status: 429, code: "RATE_LIMITED", error: "Please wait before starting more page OCR work." })
    const bytes = await readBody(req.body, 12_000)
    const request = bytes ? parsePageOcrRequest(JSON.parse(bytes.toString("utf8"))) : null
    if (!request) return jsonError({ status: 400, code: "INVALID_REQUEST", error: "Check the page selection, language and render settings." })
    if (request.action === "recognize") {
      const policy = await getPageOcrPolicy()
      if (!policy.enabled || !policy.modes.find((m) => m.id === request.languageMode)?.available) return jsonError({ status: 409, code: "OCR_UNAVAILABLE", error: policy.reason ?? "The selected OCR language is unavailable." })
    }
    const result = await enqueuePageOcr(doc.id, gate.actor.userId, request)
    if (result.created) after(() => runDueBackgroundJobs({ maxJobs: 1 }).catch(() => console.error("[page-ocr] worker kick failed")))
    return NextResponse.json({ success: true, ...result }, { status: 202, headers: { "Cache-Control": "private, no-store" } })
  } catch (err) {
    if (err instanceof Error && err.message === "PAGE_OCR_JOB_ACTIVE") return jsonError({ status: 409, code: err.message, error: "This PDF already has active page OCR work. Finish or cancel it before changing the selection." })
    if (err instanceof SyntaxError) return jsonError({ status: 400, code: "INVALID_REQUEST", error: "Invalid request body." })
    if (err instanceof Error && ["NO_ELIGIBLE_PAGES", "PAGE_SELECTION_CHANGED", "DOCUMENT_NOT_CLEAN"].includes(err.message)) return jsonError({ status: 409, code: err.message, error: "The selected pages are no longer eligible. Refresh and review the page selection." })
    return unexpected("page-ocr/start", err)
  }
}
export async function DELETE(_req: Request, ctx: Ctx) {
  const gate = await gateAltTextHistory({ upload: true })
  if (!gate.ok) return gate.response
  try {
    const doc = await document(ctx, gate.actor, gate.uploadScope)
    if (!doc || doc.documentType !== "pdf") return missing()
    const job = await latestPageOcrJob(doc.id)
    return jsonOk({ success: true, result: job ? await requestBackgroundJobCancel(job.id, currentTenantId()) : "not_active" })
  } catch (err) { return unexpected("page-ocr/cancel", err) }
}
