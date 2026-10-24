/**
 * @file app/api/alt-text/documents/[uploadId]/exports/[outputId]/validation/[runId]/route.ts
 * @module Publishing · Alt Text
 * @kind API route handler
 * @summary Phase 3 Task 19 — downloads one historical validation report (`?format=json|csv`).
 *   Serves the persisted report exactly as recorded; never re-runs validation.
 * @security Session + publishing module + publishing.alt_text:export; tenant + owner scoped;
 *   run must belong to this document's output; CSV cells are formula-neutralised.
 */
import { NextResponse } from "next/server"
import { gateAltTextHistory, unexpected } from "@/lib/alt-text/route-gate"
import { notFound, rateLimited, resolveDocument } from "@/lib/alt-text/document-review-route"
import { findingsCsv } from "@/lib/alt-text/output-validation-contract"
import { getValidationRunReport } from "@/lib/alt-text/document-history-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function attachment(name: string) {
  const ascii = name.replace(/[^\x20-\x7E]+/g, "_").replace(/["\\]/g, "_")
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

export async function GET(req: Request, ctx: { params: Promise<{ uploadId: string; outputId: string; runId: string }> }) {
  const gate = await gateAltTextHistory({ export: true })
  if (!gate.ok) return gate.response
  const { uploadId, outputId, runId } = await ctx.params
  if (!UUID.test(outputId) || !UUID.test(runId)) return notFound("report")
  const format = new URL(req.url).searchParams.get("format") === "csv" ? "csv" : "json"
  try {
    const limited = await rateLimited("validation-history-download", gate.actor, { max: 30, windowMs: 60_000 })
    if (limited) return limited
    const doc = await resolveDocument(uploadId, gate.actor)
    if (!doc.ok) return doc.response
    const run = await getValidationRunReport(doc.id, outputId, runId)
    if (!run || run.status !== "completed" || !run.report) return notFound("report")
    const base = `${run.outputFilename.replace(/\.[^.]+$/, "") || "output"}-validation-${runId.slice(0, 8)}`
    const body = format === "csv" ? findingsCsv(run.report) : JSON.stringify(run.report, null, 2)
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
        "Content-Disposition": attachment(`${base}.${format}`),
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (err) {
    return unexpected("documents/validation-history-download", err)
  }
}
