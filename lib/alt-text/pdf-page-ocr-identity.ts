import "server-only"
import { createHash } from "node:crypto"
import { PAGE_OCR_SCHEMA_VERSION, PAGE_RENDER_POLICY_VERSION } from "./pdf-page-ocr-contract"
import type { OcrLanguageMode } from "./ocr-contract"
export function pageOcrIdentity(input: {
  documentId: number
  sourceSha256: string
  pageIndex: number
  languageMode: OcrLanguageMode
  engineVersion: string
  modelSha256s: readonly string[]
  dpi: number
  segmentation: string
}): string {
  const canonical = JSON.stringify([
    PAGE_OCR_SCHEMA_VERSION,
    PAGE_RENDER_POLICY_VERSION,
    input.documentId,
    input.sourceSha256,
    input.pageIndex,
    input.languageMode,
    input.engineVersion,
    [...input.modelSha256s].sort(),
    input.dpi,
    input.segmentation,
  ])
  return createHash("sha256").update(canonical).digest("hex")
}

