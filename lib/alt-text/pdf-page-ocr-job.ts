import "server-only"
import { isBackgroundJobCancelRequested, type BackgroundJob, type PdfPageOcrJobPayload } from "@/lib/background-jobs"
import { runForTenant } from "@/lib/tenant-scope"
import { JobCancelledError, JobDeferredError } from "@/lib/job-retry-policy"
import { query } from "@/lib/db"
import { getDocumentForExtraction } from "./document-service"
import { readVerifiedOriginal } from "./document-extraction-run"
import { ALT_TEXT_UPLOAD_MAX_MB } from "./upload"
import { inspectPdfPages, recognizePdfPage, executionIdentity } from "./pdf-page-ocr-pipeline"
import { confirmedTextImages, ensurePageOcrSchema, hasPendingOcr, nextOcrPage, pageOcrJobOutcome, saveInspectedPages, writePageState } from "./pdf-page-ocr-store"
import { getPageOcrPolicy } from "./pdf-page-ocr-policy"
import { DONE_PAGE_STATUSES } from "./pdf-page-ocr-contract"
import { OcrEngineError } from "./ocr-engine"
import { PageRenderError } from "./pdf-page-renderer"
import { PDF_PAGE_OCR_LIMITS } from "./pdf-page-ocr-types"

/** Up to ten sequential pages per delivery, with a thirty-second soft checkpoint, then defer.
 * The last page may use its bounded render/OCR time budget. This bounds worker duration,
 * keeps memory to one raster, and preserves completed pages across crashes and worker restarts. */
export async function runPdfPageOcrJob(payload: PdfPageOcrJobPayload, { job, signal }: { job: BackgroundJob; signal: AbortSignal }) {
  return runForTenant({ tenantId: job.tenant_id }, async () => {
    await ensurePageOcrSchema()
    const guard = async () => {
      if (signal.aborted) throw Object.assign(new Error("PAGE_OCR_TIMEOUT"), { name: "AbortError" })
      if (await isBackgroundJobCancelRequested(job.id)) throw new JobCancelledError("PAGE_OCR_CANCELLED")
      const lease = await query<any[]>("SELECT id FROM platform_background_jobs WHERE id=? AND tenant_id=? AND worker_id=? AND status='running' AND lease_expires_at>UTC_TIMESTAMP()", [job.id, job.tenant_id, job.worker_id])
      if (!lease.length) throw new Error("OCR_LEASE_LOST")
    }
    await guard()
    const doc = await getDocumentForExtraction(payload.documentId, null)
    if (!doc || doc.documentType !== "pdf" || doc.securityStatus !== "clean") throw Object.assign(new Error("DOCUMENT_NOT_CLEAN"), { status: 409 })
    const original = await readVerifiedOriginal(doc, ALT_TEXT_UPLOAD_MAX_MB * 1024 * 1024)
    if (!original.ok) throw Object.assign(new Error(original.code), { status: original.status })
    if (payload.request.action === "inspect") {
      const pages = await inspectPdfPages(doc.id, original.bytes, await confirmedTextImages(doc.id))
      await guard()
      await saveInspectedPages(doc.id, pages, job)
      return { inspectedPages: pages.length }
    }
    const request = payload.request
    const policy = await getPageOcrPolicy()
    if (!policy.enabled || !policy.modes.find((m) => m.id === request.languageMode)?.available) throw Object.assign(new Error("OCR_POLICY_UNAVAILABLE"), { status: 409 })
    const started = Date.now()
    for (let processed = 0; processed < 10 && Date.now() - started < 30_000; processed++) {
      await guard()
      const next = await nextOcrPage(doc.id, job)
      if (!next) {
        if (await hasPendingOcr(job)) throw new JobDeferredError("PAGE_OCR_BACKOFF", 30)
        return pageOcrJobOutcome(job)
      }
      const { page, runAttempts } = next
      if (runAttempts >= PDF_PAGE_OCR_LIMITS.maxAttempts) {
        await writePageState(job, page.pageIndex, "failed", { errorCode: "PAGE_ATTEMPTS_EXHAUSTED" })
      } else if (request.mode !== "reprocess" && page.result?.runId === job.id && page.result.identity === executionIdentity(doc.id, page, request) && DONE_PAGE_STATUSES.has(page.result.status)) {
        await writePageState(job, page.pageIndex, page.result.status)
      } else {
        await writePageState(job, page.pageIndex, "rendering", { attempt: true })
        try {
          const result = await recognizePdfPage({ documentId: doc.id, page, bytes: original.bytes, runId: job.id, request, guard,
            onRecognizing: () => writePageState(job, page.pageIndex, "recognizing") })
          await writePageState(job, page.pageIndex, result.status, { result })
        } catch (err) {
          if (err instanceof JobCancelledError || signal.aborted || (err instanceof Error && err.message === "OCR_LEASE_LOST")) throw err
          // Persistence failures must retry the delivery; do not turn a failed save into OCR success.
          if (!(err instanceof OcrEngineError) && !(err instanceof PageRenderError) && !(err instanceof Error && ["SOURCE_VERSION_MISMATCH", "OCR_RESULT_LIMIT"].includes(err.message))) throw err
          const code = err instanceof OcrEngineError ? err.category : err instanceof PageRenderError ? err.code : (err as Error).message
          const permanent = ["PAGE_PIXEL_LIMIT", "PASSWORD_PROTECTED", "INVALID_PAGE", "SOURCE_VERSION_MISMATCH", "OCR_RESULT_LIMIT"].includes(code)
          const retry = !permanent && runAttempts + 1 < PDF_PAGE_OCR_LIMITS.maxAttempts
          await writePageState(job, page.pageIndex, retry ? "queued" : permanent ? "unsupported" : "failed", { errorCode: code, retrySeconds: retry ? 30 * 2 ** runAttempts : 0 })
        }
      }
    }
    await guard()
    if (await hasPendingOcr(job)) throw new JobDeferredError("PAGE_OCR_CONTINUE", 30)
    return pageOcrJobOutcome(job)
  }).catch((err) => {
    if (err && ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(err.code)) err.status = 503
    throw err
  })
}
