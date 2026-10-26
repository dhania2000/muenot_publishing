/**
 * @file lib/alt-text/pdf-page-renderer.ts
 * @module Publishing · Alt Text
 * @kind Server-side library (renderer adapter)
 * @summary Phase 3 Task 7 — renders one PDF page to a PNG raster for OCR using pdf.js (legacy Node
 *   build) drawing onto @napi-rs/canvas. The rendered raster stays in memory and is never stored.
 * @security Document JavaScript, XFA, font-face injection and system-font lookups are disabled; the
 *   render is time-bounded and cancelled on timeout; decoded image size is capped by pdf.js.
 */
import "server-only"
import { PAGE_RENDER_LIMITS, planRender, type Matrix6, type RenderPlan } from "./pdf-page-ocr-contract"

export const PAGE_RENDERER_ID = "pdfjs-dist+napi-rs-canvas"

export class PageRenderError extends Error {
  constructor(
    readonly code: "RENDER_UNAVAILABLE" | "RENDER_FAILED" | "RENDER_TIMEOUT" | "PAGE_PIXEL_LIMIT" | "PASSWORD_PROTECTED" | "INVALID_PAGE" | "INVALID_OUTPUT",
    message: string,
  ) {
    super(message)
    this.name = "PageRenderError"
  }
}

export type RenderedPage = {
  png: Uint8Array
  width: number
  height: number
  dpi: number
  reducedFrom: number | null
  /** pdf_user → raster_px (pdf.js viewport.transform). */
  viewportTransform: Matrix6
  cropBox: [number, number, number, number]
  rotate: 0 | 90 | 180 | 270
  userUnit: number
  displayWidthPt: number
  displayHeightPt: number
  durationMs: number
}

export type PdfRenderHandle = {
  numPages: number
  renderPage(pageNumber: number, opts?: { targetDpi?: number; timeoutMs?: number }): Promise<RenderedPage>
  destroy(): Promise<void>
}

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs")
type NapiCanvas = typeof import("@napi-rs/canvas")
let libs: Promise<{ pdfjs: PdfJs; canvas: NapiCanvas }> | null = null

async function loadLibs() {
  libs ??= Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("@napi-rs/canvas")])
    .then(([pdfjs, canvas]) => ({ pdfjs, canvas }))
    .catch((err) => {
      libs = null
      throw new PageRenderError("RENDER_UNAVAILABLE", `The PDF page renderer is not available: ${err instanceof Error ? err.name : "load error"}.`)
    })
  return libs
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const normRotate = (r: number): 0 | 90 | 180 | 270 => (((((Math.round(r / 90) * 90) % 360) + 360) % 360) as 0 | 90 | 180 | 270)

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        onTimeout()
        reject(new PageRenderError("RENDER_TIMEOUT", "Rendering the page took too long and was stopped."))
      }, ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

export async function openPdfForRender(bytes: Uint8Array): Promise<PdfRenderHandle> {
  const { pdfjs, canvas } = await loadLibs()
  // pdf.js transfers (detaches) the buffer it is given; hand it a copy so the caller's bytes survive.
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    // PDF.js 5.7+ removed isEvalSupported along with its eval-based PostScript compiler.
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    maxImageSize: PAGE_RENDER_LIMITS.maxPixels,
    verbosity: 0,
  })
  let doc: Awaited<typeof task.promise>
  try {
    doc = await task.promise
  } catch (err) {
    await task.destroy().catch(() => undefined)
    if (err instanceof Error && err.name === "PasswordException") throw new PageRenderError("PASSWORD_PROTECTED", "The PDF is password protected.")
    throw new PageRenderError("RENDER_FAILED", "The PDF could not be opened for page rendering.")
  }

  return {
    numPages: doc.numPages,
    async destroy() {
      await doc.destroy().catch(() => undefined)
    },
    async renderPage(pageNumber, opts = {}) {
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.numPages) throw new PageRenderError("INVALID_PAGE", "That page does not exist.")
      const started = Date.now()
      const page = await doc.getPage(pageNumber)
      try {
        const base = page.getViewport({ scale: 1 })
        const plan: RenderPlan = planRender(base.width, base.height, { targetDpi: opts.targetDpi })
        if (!plan.ok) throw new PageRenderError("PAGE_PIXEL_LIMIT", plan.message)
        const viewport = page.getViewport({ scale: plan.scale })
        const width = Math.ceil(viewport.width)
        const height = Math.ceil(viewport.height)
        const surface = canvas.createCanvas(width, height)
        const ctx = surface.getContext("2d")
        // OCR expects dark text on a light page; a transparent background would binarise unpredictably.
        ctx.fillStyle = "#ffffff"
        ctx.fillRect(0, 0, width, height)
        const renderTask = page.render({ canvas: surface as unknown as HTMLCanvasElement, canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport, intent: "print" })
        try {
          await withTimeout(renderTask.promise, opts.timeoutMs ?? PAGE_RENDER_LIMITS.renderTimeoutMs, () => renderTask.cancel())
        } catch (err) {
          if (err instanceof PageRenderError) throw err
          throw new PageRenderError("RENDER_FAILED", "The page could not be rendered.")
        }
        const png = new Uint8Array(await surface.encode("png"))
        if (png.length < 33 || !PNG_SIG.every((b, i) => png[i] === b)) throw new PageRenderError("INVALID_OUTPUT", "The renderer produced an invalid image.")
        const view = page.view as number[]
        return {
          png,
          width,
          height,
          dpi: plan.dpi,
          reducedFrom: plan.reducedFrom,
          viewportTransform: viewport.transform.slice(0, 6) as Matrix6,
          cropBox: [view[0], view[1], view[2], view[3]],
          rotate: normRotate(page.rotate),
          userUnit: Number(page.userUnit) || 1,
          displayWidthPt: base.width,
          displayHeightPt: base.height,
          durationMs: Date.now() - started,
        }
      } finally {
        page.cleanup()
      }
    },
  }
}
