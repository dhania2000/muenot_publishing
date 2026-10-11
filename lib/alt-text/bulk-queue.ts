/**
 * @file lib/alt-text/bulk-queue.ts
 * @module Publishing · Alt Text
 * @kind Client-safe library
 * @summary Phase 2 Task 2 — types and pure helpers for the local Bulk Processing image queue.
 *   Files stay in browser memory only; content validation/hashing (Task 3) and uploads (Task 6) come later.
 */
import { DEFAULT_SETTINGS, SUPPORTED_IMAGE_TYPES, sniffImageType, validateImage, type SupportedImageType } from "./core"

/** Same Phase 1 per-file policy as single uploads; the server remains authoritative. */
export const BULK_MAX_FILE_MB = DEFAULT_SETTINGS.maxFileMb
/** Guards browser memory for the whole local selection. */
export const BULK_MAX_TOTAL_MB = 2048
const MB = 1024 * 1024
const EXTENSION_TYPES: Record<string, SupportedImageType> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" }
export const BULK_ACCEPT = [...SUPPORTED_IMAGE_TYPES, ".jpg", ".jpeg", ".png", ".webp"].join(",")

export type BulkImageStatus = "pending" | "validating" | "valid" | "invalid" | "duplicate"

export interface BulkImageItem {
  id: string
  file: File
  name: string
  /** Declared type, set once the extension/MIME check passes. */
  type: SupportedImageType | null
  size: number
  lastModified: number
  previewUrl: string
  status: BulkImageStatus
  width?: number
  height?: number
  /** SHA-256 hex of the file bytes; null when Web Crypto is unavailable. */
  hash?: string | null
  error?: string
}

/** Fast-path metadata match for the same file picked twice; content identity is decided by SHA-256. */
export function duplicateKey(file: File): string {
  return [file.name, file.size, file.lastModified, file.type].join("|")
}

const extensionOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "")

/** Cheap checks that need no file reads: extension, MIME, empty and size. */
export function checkBulkFile(file: File): { ok: true; type: SupportedImageType } | { ok: false; reason: string } {
  const ext = extensionOf(file.name)
  const extType = EXTENSION_TYPES[ext]
  if (!extType) return { ok: false, reason: `Unsupported file type (${ext ? `.${ext}` : "no extension"}) — JPG, PNG or WEBP only` }
  if (file.type && !(SUPPORTED_IMAGE_TYPES as readonly string[]).includes(file.type)) return { ok: false, reason: `Unsupported MIME type ${file.type}` }
  if (file.size <= 0) return { ok: false, reason: "File is empty" }
  if (file.size > BULK_MAX_FILE_MB * MB) return { ok: false, reason: `File is ${formatBytes(file.size)} — limit is ${BULK_MAX_FILE_MB} MB` }
  return { ok: true, type: (file.type as SupportedImageType) || extType }
}

export function exceedsBatchLimit(acceptedBytes: number, nextBytes: number): boolean {
  return acceptedBytes + nextBytes > BULK_MAX_TOTAL_MB * MB
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle
  if (typeof subtle?.digest !== "function") return null
  const digest = await subtle.digest("SHA-256", buffer)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
}

/** Decodes into a tiny bitmap to prove the pixels are readable without keeping a full-resolution copy. */
export async function decodeImage(blob: Blob): Promise<boolean> {
  if (typeof createImageBitmap !== "function") return true
  try {
    const bitmap = await createImageBitmap(blob, { resizeWidth: 32, resizeHeight: 32, resizeQuality: "low" })
    bitmap.close()
    return true
  } catch {
    return false
  }
}

export type ContentValidation =
  | { ok: true; type: SupportedImageType; width: number; height: number; hash: string | null }
  | { ok: false; reason: string }

/** Signature, header dimensions, decode and SHA-256 for one file. Reads only this file into memory. */
export async function validateBulkImageContent(file: File, declared: SupportedImageType, decode: (blob: Blob) => Promise<boolean> = decodeImage): Promise<ContentValidation> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const sniffed = sniffImageType(bytes)
  if (!sniffed) return { ok: false, reason: "Not a real JPG, PNG or WEBP image (file signature mismatch)" }
  if (sniffed !== declared) return { ok: false, reason: `Content is ${formatLabel(sniffed)} but the file is labelled ${formatLabel(declared)}` }
  const check = validateImage({ type: declared, size: file.size, name: file.name }, bytes, BULK_MAX_FILE_MB)
  if (!check.ok) return { ok: false, reason: check.error }
  if (!(await decode(file))) return { ok: false, reason: "Image could not be decoded — the file may be corrupt or truncated" }
  const hash = await sha256Hex(buffer)
  return { ok: true, type: sniffed, width: check.dimensions.width, height: check.dimensions.height, hash }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB"]
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`
}

export function formatLabel(type: SupportedImageType): string {
  return type === "image/jpeg" ? "JPG" : type.slice(6).toUpperCase()
}
