/**
 * @file lib/settings/uploads.ts
 * @module Settings
 * @kind Server-side library
 * @summary Settings domain logic (UploadLimits, getUploadLimits, validateUpload, validateUploadMeta, …).
 * @exports UploadLimits, getUploadLimits, validateUpload, validateUploadMeta, validateUploadContent, LargeUploadLimits, getLargeUploadLimits, validateLargeUpload
 * @usedBy app/api/email-attachments/route.ts, app/api/hr/employee-documents/route.ts, app/api/recruit/careers-settings/upload/route.ts, lib/storage/index.ts
 * @see docs/CODEBASE-GUIDE.md for module ownership, conventions and where to add new code.
 */
import "server-only"
import { getNum, getSetting } from "@/lib/settings/server"
import {
  BLOCKED_EXTENSIONS,
  SNIFF_BYTES,
  canSniff,
  extensionOf,
  looksDangerous,
  looksLikeText,
  sniffMatches,
} from "@/lib/security/upload-validation"

// Maps the extensions from the "Allowed File Types" setting to the MIME types a
// browser reports. The extension is the authoritative signal for the allow
// list; the MIME list is what the byte sniff is checked against. `svg` is
// deliberately absent: it is on BLOCKED_EXTENSIONS because it executes script
// when served inline.
const EXT_MIME: Record<string, string[]> = {
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  webp: ["image/webp"],
  gif: ["image/gif"],
  heic: ["image/heic"],
  heif: ["image/heif"],
  ico: ["image/x-icon", "image/vnd.microsoft.icon"],
  pdf: ["application/pdf"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xls: ["application/vnd.ms-excel"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ppt: ["application/vnd.ms-powerpoint"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  csv: ["text/csv", "application/vnd.ms-excel"],
  txt: ["text/plain"],
  log: ["text/plain"],
  md: ["text/plain"],
  json: ["application/json"],
  zip: ["application/zip", "application/x-zip-compressed"],
  mp3: ["audio/mpeg"],
  wav: ["audio/wav", "audio/x-wav"],
  mp4: ["video/mp4"],
  webm: ["video/webm", "audio/webm"],
}

// Extensions that are routinely used for plain-text payloads even when their
// canonical type is binary (e.g. an ERP "xls" export that is really CSV).
// Text is accepted for them as long as it is not markup or an executable.
const TEXT_TOLERANT_EXTENSIONS = new Set(["xls", "csv", "txt", "log", "md", "json"])

const UPLOAD_NAME_RE = /[\\/\0]/

type UploadLike = { name?: string | null; size: number; type?: string | null }

function normalizeType(type: string | null | undefined): string {
  return (type ?? "").toLowerCase().split(";")[0].trim()
}

/**
 * Hard safety floor that does NOT depend on admin settings: file-name sanity,
 * the executable/markup extension deny list, and a magic-byte check of the
 * first `SNIFF_BYTES`. Every byte that reaches storage or the database must
 * pass this, regardless of per-route or per-tenant allow lists.
 *
 * Returns a user-facing error message, or null when the content is acceptable.
 */
export async function validateUploadContent(file: Blob & { name?: string | null }): Promise<string | null> {
  const name = (file.name ?? "").trim()
  if (name.length > 255 || UPLOAD_NAME_RE.test(name)) return "File name is invalid"
  const ext = extensionOf(name)
  if (ext && BLOCKED_EXTENSIONS.includes(ext)) return `.${ext} files are not allowed`
  if (file.size <= 0) return "File is empty"

  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer())
  const declared = normalizeType(file.type)
  const candidates = new Set<string>(EXT_MIME[ext] ?? [])
  if (declared && declared !== "application/octet-stream") candidates.add(declared)
  const sniffable = [...candidates].filter(canSniff)

  if (sniffable.length > 0) {
    if (sniffable.some((t) => sniffMatches(t, head))) return null
    if (TEXT_TOLERANT_EXTENSIONS.has(ext) && looksLikeText(head)) return null
    return "File contents do not match its type"
  }
  // No signature known for this type: still refuse anything a browser or OS
  // would execute if the object were ever served or opened directly.
  if (looksDangerous(head)) return "File contents are not allowed"
  return null
}

export type UploadLimits = {
  maxBytes: number
  maxMb: number
  extensions: string[]
  mimeTypes: Set<string>
}

/** Effective upload limits from the storage settings section. */
export async function getUploadLimits(): Promise<UploadLimits> {
  const maxMb = await getNum("storage.max_upload_mb", 25)
  const raw = await getSetting("storage.allowed_types")
  const extensions = raw
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean)
  const mimeTypes = new Set<string>()
  for (const ext of extensions) for (const m of EXT_MIME[ext] ?? []) mimeTypes.add(m)
  return { maxBytes: Math.max(1, maxMb) * 1024 * 1024, maxMb, extensions, mimeTypes }
}

/**
 * Validates a file against the configured size and type limits AND the
 * byte-level safety floor (`validateUploadContent`).
 * Returns a user-facing error message, or null when the file is allowed.
 */
export async function validateUpload(file: File): Promise<string | null> {
  const metaError = await validateUploadMeta({ name: file.name, size: file.size, type: file.type })
  if (metaError) return metaError
  return validateUploadContent(file)
}

/**
 * Validate an upload from its metadata alone (name/size/type),
 * without needing the bytes in memory. This is what the multipart "create
 * session" step uses: a huge video/ZIP is never buffered server-side, so we
 * must be able to accept or reject it before the first chunk arrives.
 *
 * The extension is authoritative. `File.type` comes from the browser and is
 * attacker-controlled, so it is never allowed to override an extension that
 * is missing from the allow list or present on the deny list.
 */
export async function validateUploadMeta(meta: UploadLike): Promise<string | null> {
  const name = (meta.name ?? "").trim()
  if (!name || name.length > 255 || UPLOAD_NAME_RE.test(name)) return "File name is invalid"
  const ext = extensionOf(name)
  if (ext && BLOCKED_EXTENSIONS.includes(ext)) return `.${ext} files are not allowed`

  const { maxBytes, maxMb, extensions } = await getUploadLimits()
  if (meta.size <= 0) return "File is empty"
  if (meta.size > maxBytes) return `File must be ${maxMb}MB or smaller`
  if (extensions.length > 0 && !extensions.includes(ext)) {
    return `Allowed file types: ${extensions.join(", ")}`
  }
  return null
}

/**
 * Large-file limits for resumable multipart uploads. These files
 * (videos, ZIPs, training/employee bundles) are far bigger than the ordinary
 * single-request cap, so they get their own, higher ceiling and are NOT bound
 * by the `allowed_types` list (which targets small inline documents/images).
 */
export type LargeUploadLimits = {
  maxBytes: number
  maxMb: number
  /** Fixed chunk size the client and server agree on (bytes). */
  partSize: number
  /** Provider floor: every part except the last must be ≥ 5 MiB. */
  minPartSize: number
  maxParts: number
}

const MIB = 1024 * 1024

export async function getLargeUploadLimits(): Promise<LargeUploadLimits> {
  // Default 5 GiB; admins can raise/lower it in Storage Settings.
  const maxMb = await getNum("storage.max_multipart_mb", 5120)
  const partSize = 8 * MIB // 8 MiB chunks — comfortably above the 5 MiB floor.
  return {
    maxBytes: Math.max(1, maxMb) * MIB,
    maxMb,
    partSize,
    minPartSize: 5 * MIB,
    maxParts: 10000,
  }
}

/**
 * Validate a large multipart upload request from its declared metadata. Returns
 * a user-facing error string, or null when the request is acceptable.
 */
export async function validateLargeUpload(meta: {
  name: string
  size: number
}): Promise<string | null> {
  const { maxBytes, maxMb } = await getLargeUploadLimits()
  if (!meta.name?.trim()) return "A file name is required"
  if (!Number.isFinite(meta.size) || meta.size <= 0) return "A valid file size is required"
  if (meta.size > maxBytes) return `File must be ${maxMb}MB or smaller`
  return null
}
