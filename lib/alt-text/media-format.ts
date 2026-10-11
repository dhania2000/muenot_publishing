/**
 * @file lib/alt-text/media-format.ts
 * @module Publishing · Alt Text
 * @kind Pure library
 * @summary Phase 3 Task 5 — binary signature detection for embedded document media and the
 *   decision whether an image can enter the existing Alt Text asset pipeline (JPEG/PNG/WEBP).
 *   The file extension inside the package is never trusted.
 */
import type { SupportedImageType } from "./core"

export type MediaFormat = "png" | "jpeg" | "webp" | "gif" | "bmp" | "tiff" | "svg" | "wmf" | "emf" | "compressed_metafile" | "unknown"

const PIPELINE_TYPES: Partial<Record<MediaFormat, SupportedImageType>> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" }

const at = (b: Uint8Array, offset: number, ...bytes: number[]) => b.length >= offset + bytes.length && bytes.every((v, i) => b[offset + i] === v)
const ascii = (b: Uint8Array, offset: number, text: string) => at(b, offset, ...[...text].map((c) => c.charCodeAt(0)))

export function detectMediaFormat(bytes: Uint8Array): MediaFormat {
  if (at(bytes, 0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png"
  if (at(bytes, 0, 0xff, 0xd8, 0xff)) return "jpeg"
  if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) return "webp"
  if (ascii(bytes, 0, "GIF87a") || ascii(bytes, 0, "GIF89a")) return "gif"
  if (ascii(bytes, 0, "BM") && bytes.length >= 26) return "bmp"
  if (at(bytes, 0, 0x49, 0x49, 0x2a, 0x00) || at(bytes, 0, 0x4d, 0x4d, 0x00, 0x2a)) return "tiff"
  if (at(bytes, 0, 0x01, 0x00, 0x00, 0x00) && ascii(bytes, 40, " EMF")) return "emf"
  if (at(bytes, 0, 0xd7, 0xcd, 0xc6, 0x9a) || at(bytes, 0, 0x01, 0x00, 0x09, 0x00) || at(bytes, 0, 0x02, 0x00, 0x09, 0x00)) return "wmf"
  if (at(bytes, 0, 0x1f, 0x8b)) return "compressed_metafile"
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 1024)).replace(/^\uFEFF/, "").trimStart()
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head)) return "svg"
  return "unknown"
}

export const pipelineTypeFor = (format: MediaFormat): SupportedImageType | null => PIPELINE_TYPES[format] ?? null

/** Active content or external references in an SVG — never stored, rendered or forwarded. */
export function isUnsafeSvg(text: string): boolean {
  return (
    /<script[\s>]/i.test(text) ||
    /<foreignObject[\s>]/i.test(text) ||
    /<!(DOCTYPE|ENTITY)/i.test(text) ||
    /\son[a-z]+\s*=/i.test(text) ||
    /javascript\s*:/i.test(text) ||
    /(?:xlink:)?href\s*=\s*["']\s*(?!#)/i.test(text) ||
    /url\(\s*["']?\s*(?!#)/i.test(text) ||
    /@import/i.test(text)
  )
}

export type MediaDecision =
  | { ok: true; format: MediaFormat; mimeType: SupportedImageType }
  | { ok: false; format: MediaFormat; status: "unsupported"; code: string; message: string }

const LABEL: Partial<Record<MediaFormat, string>> = {
  gif: "GIF",
  bmp: "BMP",
  tiff: "TIFF",
  wmf: "WMF",
  emf: "EMF",
  compressed_metafile: "Compressed metafile (EMZ/WMZ)",
}

/** Decide whether embedded media can become an Alt Text asset; no conversion is attempted. */
export function classifyMedia(bytes: Uint8Array): MediaDecision {
  const format = detectMediaFormat(bytes)
  const mimeType = pipelineTypeFor(format)
  if (mimeType) return { ok: true, format, mimeType }
  if (format === "svg") {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes)
    if (isUnsafeSvg(text)) return { ok: false, format, status: "unsupported", code: "UNSAFE_SVG", message: "The SVG contains scripts or external references and was blocked." }
    return { ok: false, format, status: "unsupported", code: "UNSUPPORTED_FORMAT", message: "SVG images are not supported by the alt text pipeline yet." }
  }
  if (format === "unknown") return { ok: false, format, status: "unsupported", code: "UNKNOWN_FORMAT", message: "The embedded file is not a recognized image." }
  return { ok: false, format, status: "unsupported", code: "UNSUPPORTED_FORMAT", message: `${LABEL[format] ?? format.toUpperCase()} images are not supported yet. Supported: JPG, PNG, WEBP.` }
}
