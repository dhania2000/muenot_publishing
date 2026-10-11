/**
 * @file lib/alt-text/document-queue.ts
 * @module Publishing
 * @kind Browser-safe helpers
 * @summary Phase 3 Task 2 — local PDF/PPTX/DOCX selection queue: preliminary
 *   validation, metadata duplicate detection and counters. Client-side checks are
 *   a UX aid only; authoritative validation happens server-side in Task 3.
 */
import { formatBytes } from "./bulk-queue"
import { DOCUMENT_UPLOAD_LIMITS } from "./document-upload-contract"

/** Mirrors the server feature ceiling; the server re-validates every limit. */
export const DOCUMENT_MAX_FILE_MB = DOCUMENT_UPLOAD_LIMITS.maxFileMb
const MB = 1024 * 1024

export type DocumentKind = "pdf" | "pptx" | "docx"
export type DocumentStatus = "validating" | "ready" | "invalid"

export const DOCUMENT_FORMATS: Record<DocumentKind, { mime: string; label: string }> = {
  pdf: { mime: "application/pdf", label: "PDF" },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", label: "PPTX" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "DOCX" },
}

export const DOCUMENT_ACCEPT = [
  ...Object.keys(DOCUMENT_FORMATS).map((k) => `.${k}`),
  ...Object.values(DOCUMENT_FORMATS).map((f) => f.mime),
].join(",")

/** Browsers often report these (or nothing) for valid Office files, so they neither prove nor disprove a type. */
const NEUTRAL_MIME = new Set(["", "application/octet-stream", "application/zip", "application/x-zip-compressed"])

export interface DocumentEntry {
  id: string
  file: File
  name: string
  extension: string
  mimeType: string
  size: number
  lastModified: number
  kind: DocumentKind | null
  status: DocumentStatus
  error?: string
}

export const getExtension = (name: string) => {
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
}

const isKind = (ext: string): ext is DocumentKind => ext in DOCUMENT_FORMATS

/** Metadata fingerprint — preliminary duplicate detection, not proof of identical content. */
export const documentKey = (f: Pick<File, "name" | "size" | "lastModified" | "type">) =>
  `${f.name}|${f.size}|${f.lastModified}|${f.type}`

export function preliminaryCheck(file: File, maxMb = DOCUMENT_MAX_FILE_MB): { kind: DocumentKind | null; error?: string } {
  if (!(file instanceof Blob)) return { kind: null, error: "File could not be read by the browser" }
  const ext = getExtension(file.name)
  if (ext === "doc" || ext === "ppt") return { kind: null, error: `Legacy .${ext} files are not supported — save as .${ext}x` }
  if (!isKind(ext)) return { kind: null, error: "Unsupported format — only PDF, PPTX and DOCX are accepted" }
  const mime = (file.type || "").toLowerCase()
  if (!NEUTRAL_MIME.has(mime) && mime !== DOCUMENT_FORMATS[ext].mime)
    return { kind: ext, error: `File type "${mime}" does not match a .${ext} document` }
  if (file.size === 0) return { kind: ext, error: "File is empty" }
  if (file.size > maxMb * MB) return { kind: ext, error: `File is ${formatBytes(file.size)} — limit is ${maxMb} MB` }
  return { kind: ext }
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] // %PDF-
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] // PK\x03\x04

/**
 * Reads only the first bytes. A ZIP header is necessary but not sufficient for
 * OOXML; package structure is verified server-side in Task 3.
 */
export async function checkSignature(file: File, kind: DocumentKind): Promise<string | null> {
  let head: Uint8Array
  try {
    head = new Uint8Array(await file.slice(0, 5).arrayBuffer())
  } catch {
    return "File could not be read by the browser"
  }
  const magic = kind === "pdf" ? PDF_MAGIC : ZIP_MAGIC
  if (magic.some((b, i) => head[i] !== b))
    return kind === "pdf" ? "File content is not a PDF document" : `File content is not a valid .${kind} package`
  return null
}

export function createDocumentEntry(file: File, id: string, maxMb = DOCUMENT_MAX_FILE_MB): DocumentEntry {
  const { kind, error } = preliminaryCheck(file, maxMb)
  return {
    id,
    file,
    name: file.name,
    extension: getExtension(file.name),
    mimeType: file.type,
    size: file.size,
    lastModified: file.lastModified,
    kind,
    status: error ? "invalid" : "validating",
    error,
  }
}

/** Splits incoming files into new ones and likely duplicates (vs. the queue and within the batch). */
export function partitionNewFiles(existing: readonly DocumentEntry[], files: readonly File[]) {
  const seen = new Set(existing.map((e) => documentKey(e.file)))
  const accepted: File[] = []
  const duplicates: string[] = []
  for (const file of files) {
    const key = documentKey(file)
    if (seen.has(key)) duplicates.push(file.name)
    else {
      seen.add(key)
      accepted.push(file)
    }
  }
  return { accepted, duplicates }
}

export type DocumentSummary = Record<"total" | "pdf" | "pptx" | "docx" | "invalid" | "validating" | "ready" | "totalBytes", number>

export function summarizeDocuments(entries: readonly DocumentEntry[]): DocumentSummary {
  const s: DocumentSummary = { total: entries.length, pdf: 0, pptx: 0, docx: 0, invalid: 0, validating: 0, ready: 0, totalBytes: 0 }
  for (const e of entries) {
    if (e.kind) s[e.kind]++
    s[e.status]++
    s.totalBytes += e.size
  }
  return s
}

export const selectReadyFiles = (entries: readonly DocumentEntry[]) => entries.filter((e) => e.status === "ready").map((e) => e.file)
