/**
 * @file lib/alt-text/preview.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Resolve a tenant-scoped Alt Text asset into a streamable, scan-cleared private image.
 * @usedBy app/api/alt-text/assets/[id]/image/route.ts
 */
import "server-only"
import { downloadFile, keyBelongsToTenant } from "@/lib/storage"
import { getByObjectKey } from "@/lib/storage/file-metadata"
import { canDownload, downloadGatePolicyFor, getScanForFile } from "@/lib/storage/file-scanning"
import type { PermissionScope } from "@/lib/permission-model"
import { SUPPORTED_IMAGE_TYPES, type SupportedImageType } from "./core"
import { getAsset } from "./store"
import { safeDisplayName } from "./upload"

export type PreviewFailure = {
  ok: false
  status: 404 | 409 | 415 | 503
  code: string
  error: string
}

export type PreviewImage = {
  ok: true
  body: ReadableStream<Uint8Array> | Uint8Array
  contentType: SupportedImageType
  size: number | null
  filename: string
}

export type PreviewActor = { userId: number; tenantId: number; scope: PermissionScope }

const fail = (status: PreviewFailure["status"], code: string, error: string): PreviewFailure => ({ ok: false, status, code, error })
const NOT_FOUND = () => fail(404, "NOT_FOUND", "Image not found.")

function isMissingObject(err: unknown): boolean {
  const e = err as { name?: string; code?: string; message?: string; $metadata?: { httpStatusCode?: number } } | null
  return (
    e?.name === "NoSuchKey" ||
    e?.name === "NotFound" ||
    e?.code === "ENOENT" ||
    e?.$metadata?.httpStatusCode === 404 ||
    e?.message === "Object not found"
  )
}

function withinRecordScope(scope: PermissionScope, userId: number, asset: { createdBy: number; reviewerId: number | null }) {
  if (scope === "all") return true
  const added = asset.createdBy === userId
  const owned = asset.reviewerId === userId
  if (scope === "added") return added
  if (scope === "owned") return owned
  if (scope === "both") return added || owned
  return false
}

/** Filename safe for a quoted `Content-Disposition` value: printable ASCII only, no quotes or separators. */
export function headerSafeFilename(name: string): string {
  const cleaned = safeDisplayName(name).replace(/[^\x20-\x7e]/g, "_").replace(/["\\;]/g, "_").trim()
  return cleaned || "image"
}

export async function openAltTextImage(id: number, actor: PreviewActor): Promise<PreviewImage | PreviewFailure> {
  const asset = await getAsset(id)
  if (!asset || !withinRecordScope(actor.scope, actor.userId, asset)) return NOT_FOUND()
  if (!asset.storageKey || !keyBelongsToTenant(asset.storageKey, actor.tenantId)) return NOT_FOUND()

  if (!(SUPPORTED_IMAGE_TYPES as readonly string[]).includes(asset.mimeType)) {
    return fail(415, "UNSUPPORTED_TYPE", "This file type cannot be previewed.")
  }

  const file = await getByObjectKey(asset.storageKey)
  if (!file || file.uploadStatus === "deleted") return NOT_FOUND()
  const scan = await getScanForFile(file.id)
  if (!scan) return fail(409, "SCAN_PENDING", "The image is awaiting a security scan.")
  if (scan.scanStatus === "infected") return NOT_FOUND()
  const decision = canDownload({ scanStatus: scan.scanStatus, approved: scan.approved }, downloadGatePolicyFor(file))
  if (!decision.allowed) return fail(409, "SCAN_PENDING", "The image is temporarily unavailable while it is security checked.")
  if (scan.quarantineStatus === "quarantined" && !scan.approved && scan.scanStatus !== "clean") {
    return fail(409, "SCAN_PENDING", "The image is temporarily unavailable while it is security checked.")
  }

  let object: Awaited<ReturnType<typeof downloadFile>>
  try {
    object = await downloadFile(asset.storageKey)
  } catch (err) {
    if (isMissingObject(err)) return NOT_FOUND()
    console.error("[alt-text/preview] storage read failed", err instanceof Error ? err.name : "unknown")
    return fail(503, "STORAGE_UNAVAILABLE", "Image storage is temporarily unavailable. Please try again.")
  }
  if (!object?.body) return NOT_FOUND()

  return {
    ok: true,
    body: object.body instanceof ReadableStream ? object.body : new Uint8Array(object.body),
    contentType: asset.mimeType as SupportedImageType,
    size: typeof object.size === "number" ? object.size : null,
    filename: headerSafeFilename(asset.fileName),
  }
}
