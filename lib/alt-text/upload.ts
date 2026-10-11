/**
 * @file lib/alt-text/upload.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Single-image intake for Alt Text: validation, private tenant storage, scan enqueue and asset creation.
 * @usedBy app/api/alt-text/upload/route.ts
 */
import "server-only"
import { createHash, randomUUID } from "node:crypto"
import { deleteFile, uploadFile } from "@/lib/storage"
import { checkStorageQuota } from "@/lib/storage/storage-quota"
import { getUploadLimits, validateUploadContent } from "@/lib/settings/uploads"
import { SUPPORTED_IMAGE_TYPES, sniffImageType, validateImage, type AssetStatus, type SupportedImageType } from "./core"
import { createAsset, findReusableUpload, getSettings } from "./store"

/** Feature ceiling; a stricter tenant Alt Text or global storage limit always wins. */
export const ALT_TEXT_UPLOAD_MAX_MB = 10
export const ALT_TEXT_STORAGE_PREFIX = "alt-text"

const MIB = 1024 * 1024
const EXTENSIONS: Record<SupportedImageType, readonly string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
}
const ALLOWED_EXTENSIONS = new Set(Object.values(EXTENSIONS).flat())
/** Message `uploadFile` returns when the provider write itself fails. */
const STORAGE_UNAVAILABLE = "Upload failed. Check the connected storage configuration."

export type UploadFailure = {
  ok: false
  status: 400 | 413 | 415 | 429 | 500 | 503
  code: string
  error: string
}

export type UploadedAsset = {
  id: number
  filename: string
  mimeType: SupportedImageType
  size: number
  width: number
  height: number
  status: AssetStatus
  /** Uploads are scanned asynchronously; AI processing must wait for a clean verdict. */
  scanStatus: "pending"
}

const fail = (status: UploadFailure["status"], code: string, error: string): UploadFailure => ({ ok: false, status, code, error })

export function safeDisplayName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ""
  return base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255) || "image"
}

const extensionOf = (name: string) => {
  const i = name.lastIndexOf(".")
  return i > 0 ? name.slice(i + 1).toLowerCase() : ""
}

/**
 * Cheap end-of-file structure check that rejects truncated or spliced images
 * without decoding pixels: JPEG needs an EOI marker, PNG an IEND chunk, and a
 * WEBP's declared RIFF size must fit inside the bytes received.
 */
export function hasCompleteImageStructure(bytes: Uint8Array, type: SupportedImageType): boolean {
  const tail = bytes.subarray(Math.max(0, bytes.length - 4096))
  if (type === "image/jpeg") {
    for (let i = tail.length - 2; i >= 0; i--) if (tail[i] === 0xff && tail[i + 1] === 0xd9) return true
    return false
  }
  if (type === "image/png") {
    for (let i = tail.length - 8; i >= 0; i--) {
      if (tail[i] === 0x49 && tail[i + 1] === 0x45 && tail[i + 2] === 0x4e && tail[i + 3] === 0x44) return true
    }
    return false
  }
  if (bytes.length < 12) return false
  const riffSize = bytes[4] + bytes[5] * 0x100 + bytes[6] * 0x10000 + bytes[7] * 0x1000000
  return riffSize + 8 >= 30 && riffSize + 8 <= bytes.length
}

/**
 * `reuseExisting` (bulk opt-in) returns the caller's identical, still-unassigned asset instead of
 * storing a second copy. Matching uses a server-computed hash; client hashes are never trusted.
 */
export async function processAltTextUpload(
  file: File,
  actor: { userId: number; reuseExisting?: boolean },
): Promise<{ ok: true; asset: UploadedAsset; reused?: boolean } | UploadFailure> {
  const [settings, limits] = await Promise.all([getSettings(), getUploadLimits()])
  const maxBytes = Math.min(settings.maxFileMb * MIB, ALT_TEXT_UPLOAD_MAX_MB * MIB, limits.maxBytes)
  const maxMb = Math.floor((maxBytes / MIB) * 10) / 10
  const filename = safeDisplayName(file.name)
  const ext = extensionOf(filename)

  if (file.size <= 0) return fail(400, "EMPTY_FILE", "The file is empty.")
  if (file.size > maxBytes) return fail(413, "FILE_TOO_LARGE", `Images must be ${maxMb} MB or smaller.`)
  if (!ALLOWED_EXTENSIONS.has(ext) || !(SUPPORTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return fail(415, "UNSUPPORTED_TYPE", "Only JPG, PNG and WEBP images are supported.")
  }
  if (limits.extensions.length > 0 && !limits.extensions.includes(ext)) {
    return fail(415, "UNSUPPORTED_TYPE", `.${ext} uploads are not allowed by your storage settings.`)
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const sniffed = sniffImageType(bytes)
  if (!sniffed || sniffed !== file.type || !EXTENSIONS[sniffed].includes(ext)) {
    return fail(415, "CONTENT_MISMATCH", "The file content does not match its image type.")
  }
  const validation = validateImage({ type: file.type, size: bytes.length, name: filename }, bytes, maxBytes / MIB)
  if (!validation.ok) return fail(400, "INVALID_IMAGE", validation.error)
  if (!hasCompleteImageStructure(bytes, validation.type)) {
    return fail(400, "INVALID_IMAGE", "The image is incomplete or corrupt.")
  }

  const stored = new File([bytes], filename, { type: validation.type })
  const contentError = await validateUploadContent(stored)
  if (contentError) return fail(415, "UNSUPPORTED_TYPE", contentError)

  const contentSha256 = createHash("sha256").update(bytes).digest("hex")
  const asAsset = (id: number): UploadedAsset => ({
    id,
    filename,
    mimeType: validation.type,
    size: bytes.length,
    width: validation.dimensions.width,
    height: validation.dimensions.height,
    status: "uploaded",
    scanStatus: "pending",
  })
  if (actor.reuseExisting) {
    const existing = await findReusableUpload(actor.userId, contentSha256)
    if (existing) return { ok: true, asset: asAsset(existing.id), reused: true }
  }

  const quota = await checkStorageQuota(bytes.length)
  if (!quota.allowed) return fail(413, "STORAGE_QUOTA_EXCEEDED", quota.reason)

  const path = `${ALT_TEXT_STORAGE_PREFIX}/${actor.userId}/${randomUUID()}.${ext}`
  const up = await uploadFile(path, stored, {
    skipValidation: true,
    metadata: { module: "publishing", entityType: "alt_text_asset", ownerId: actor.userId, classification: "confidential" },
  })
  if (!up.ok) {
    return up.error === STORAGE_UNAVAILABLE
      ? fail(503, "STORAGE_UNAVAILABLE", "Image storage is temporarily unavailable. Please try again.")
      : fail(429, "UPLOAD_LIMIT", up.error)
  }

  const key = up.result.key
  if (!up.result.file) {
    await deleteFile(key).catch((err) => console.error("[alt-text/upload] cleanup failed", err instanceof Error ? err.name : "unknown"))
    return fail(503, "SCAN_UNAVAILABLE", "The security scan could not be scheduled. Please try again.")
  }

  let id: number
  try {
    id = await createAsset({
      projectId: null,
      batchId: null,
      fileName: filename,
      mimeType: validation.type,
      sizeBytes: bytes.length,
      storageKey: key,
      storageUrl: key,
      context: "",
      language: settings.defaultLanguage,
      audience: settings.defaultAudience,
      createdBy: actor.userId,
      contentSha256,
    })
  } catch (err) {
    console.error("[alt-text/upload] asset creation failed", err instanceof Error ? err.name : "unknown")
    await deleteFile(key).catch((e) => console.error("[alt-text/upload] cleanup failed", e instanceof Error ? e.name : "unknown"))
    return fail(500, "UPLOAD_FAILED", "The image could not be saved. Please try again.")
  }

  return { ok: true, asset: asAsset(id) }
}
