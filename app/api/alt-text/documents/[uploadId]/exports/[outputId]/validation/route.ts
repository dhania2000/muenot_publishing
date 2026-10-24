/**
 * @file app/api/alt-text/documents/[uploadId]/exports/[outputId]/validation/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary Phase 3 Task 18 — accessible-output quality validation.
 *   GET   latest report summary + paginated/filterable findings, or `?download=json|csv`.
 *   POST  run (or replay) validation. Body: `{ "force"?: boolean }`.
 *   PATCH acknowledge one manual-review item. Body: `{ runId, checkId, note? }`.
 * @security Session + publishing module + publishing.alt_text:export (PATCH also :approve);
 *   tenant + owner scoped; never cached; CSV cells are formula-neutralised.
 */
import { NextResponse } from "next/server"
import { gateAltTextHistory, jsonError, unexpected } from "@/lib/alt-text/route-gate"
import { notFound, parsePaging, rateLimited, readJsonBody, resolveDocument } from "@/lib/alt-text/document-review-route"
import {
  findingsCsv,
  isCheckStatus,
  isSeverity,
  parseAcknowledgeRequest,
  type FindingsQuery,
} from "@/lib/alt-text/output-validation-contract"
import { acknowledgeManualCheck, getOutputValidation, getOutputValidationReport, runOutputValidation } from "@/lib/alt-text/output-validation-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const NO_STORE = { "Cache-Control": "no-store, private" }
type Ctx = { params: Promise<{ uploadId: string; outputId: string }> }

function parseQuery(url: string): { ok: true; query: FindingsQuery } | { ok: false; response: NextResponse } {
  const sp = new URL(url).searchParams
  const paging = parsePaging(sp, 25, 100)
  if (!paging.ok) return paging
  const status = sp.get("status") ?? ""
  const severity = sp.get("severity") ?? ""
  const bad = (error: string) => ({ ok: false as const, response: jsonError({ status: 400, code: "INVALID_QUERY", error }) })
  if (status && !isCheckStatus(status)) return bad("Unknown status filter.")
  if (severity && !isSeverity(severity)) return bad("Unknown severity filter.")
  return { ok: true, query: { page: paging.page, pageSize: paging.pageSize, status: status as FindingsQuery["status"], severity: severity as FindingsQuery["severity"], search: (sp.get("search") ?? "").slice(0, 100) } }
}

function attachment(name: string) {
  const ascii = name.replace(/[^\x20-\x7E]+/g, "_").replace(/["\\]/g, "_")
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

const baseName = (filename: string) => filename.replace(/\.[^.]+$/, "") || "output"

export async function GET(req: Request, ctx: Ctx) {
  const gate = await gateAltTextHistory({ export: true, withPermissions: true })
  if (!gate.ok) return gate.response
  const { uploadId, outputId } = await ctx.params
  if (!UUID.test(outputId)) return notFound("export")
  try {
    const limited = await rateLimited("output-validation-read", gate.actor, { max: 60, windowMs: 60_000 })
    if (limited) return limited
    const doc = await resolveDocument(uploadId, gate.actor)
    if (!doc.ok) return doc.response

    const download = new URL(req.url).searchParams.get("download")
    if (download) {
      if (download !== "json" && download !== "csv") return jsonError({ status: 400, code: "INVALID_QUERY", error: "download must be json or csv." })
      const result = await getOutputValidationReport(doc.id, outputId, gate.actor)
      if (!result.ok) return jsonError(result)
      const name = `${baseName(result.report.outputFilename)}-validation-${result.report.runId.slice(0, 8)}.${download}`
      const body = download === "csv" ? findingsCsv(result.report) : JSON.stringify(result.report, null, 2)
      return new NextResponse(body, {
        status: 200,
        headers: {
          ...NO_STORE,
          "Content-Type": download === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
          "Content-Disposition": attachment(name),
          "X-Content-Type-Options": "nosniff",
        },
      })
    }

    const q = parseQuery(req.url)
    if (!q.ok) return q.response
    const result = await getOutputValidation(doc.id, outputId, gate.actor, q.query, gate.permissions?.canReview ?? false)
    if (!result.ok) return jsonError(result)
    return NextResponse.json(result.response, { headers: NO_STORE })
  } catch (err) {
    return unexpected("documents/output-validation-read", err)
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const gate = await gateAltTextHistory({ export: true, withPermissions: true })
  if (!gate.ok) return gate.response
  const { uploadId, outputId } = await ctx.params
  if (!UUID.test(outputId)) return notFound("export")
  try {
    const limited = await rateLimited("output-validation-run", gate.actor, { max: 10, windowMs: 60_000 })
    if (limited) return limited
    const body = await readJsonBody(req)
    if (!body.ok) return body.response
    const b = body.body as Record<string, unknown> | null
    if (!b || typeof b !== "object" || Array.isArray(b) || Object.keys(b).some((k) => k !== "force") || (b.force != null && typeof b.force !== "boolean")) {
      return jsonError({ status: 400, code: "INVALID_REQUEST", error: 'Send { "force"?: boolean }.' })
    }
    const q = parseQuery(req.url)
    if (!q.ok) return q.response
    const doc = await resolveDocument(uploadId, gate.actor)
    if (!doc.ok) return doc.response
    const result = await runOutputValidation(doc.id, outputId, gate.actor, { force: b.force === true, query: q.query, canAcknowledge: gate.permissions?.canReview ?? false })
    if (!result.ok) return jsonError(result)
    return NextResponse.json(result.response, { status: result.response.replayed ? 200 : 201, headers: NO_STORE })
  } catch (err) {
    return unexpected("documents/output-validation-run", err)
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const gate = await gateAltTextHistory({ export: true, review: true })
  if (!gate.ok) return gate.response
  const { uploadId, outputId } = await ctx.params
  if (!UUID.test(outputId)) return notFound("export")
  try {
    const limited = await rateLimited("output-validation-ack", gate.actor, { max: 30, windowMs: 60_000 })
    if (limited) return limited
    const body = await readJsonBody(req)
    if (!body.ok) return body.response
    const parsed = parseAcknowledgeRequest(body.body)
    if (!parsed.ok) return jsonError({ status: 400, code: "INVALID_REQUEST", error: parsed.error })
    const q = parseQuery(req.url)
    if (!q.ok) return q.response
    const doc = await resolveDocument(uploadId, gate.actor)
    if (!doc.ok) return doc.response
    const result = await acknowledgeManualCheck(doc.id, outputId, gate.actor, parsed.request, q.query)
    if (!result.ok) return jsonError(result)
    return NextResponse.json(result.response, { headers: NO_STORE })
  } catch (err) {
    return unexpected("documents/output-validation-ack", err)
  }
}
