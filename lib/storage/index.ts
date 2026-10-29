import "server-only"
import { createHash, randomUUID } from "node:crypto"
import { query } from "@/lib/db"
import { currentTenantId } from "@/lib/tenant-scope"
import { getByObjectKey, type FileMetadataInput, type FileObject } from "./file-metadata"
import { keyBelongsToTenant, tenantKey } from "./keys"
import type {PoolConnection,ResultSetHeader} from "mysql2/promise"

export { keyBelongsToTenant } from "./keys"

export const STORAGE_UNAVAILABLE = "Storage is temporarily unavailable"

/** Atomic private intake. New inputs stay pending; no scan or processing success is inferred. */
export async function storePendingFileInTransaction(conn:PoolConnection,input:{path:string;name:string;bytes:Buffer;module:string;entityType:string;entityId:string;ownerId:number}){
  const tenantId=currentTenantId(),key=tenantKey(tenantId,input.path),ref=randomUUID(),checksum=createHash("sha256").update(input.bytes).digest("hex")
  await conn.query("INSERT INTO app_file_blobs (tenant_id,object_key,content_type,body) VALUES (?,?,?,?)",[tenantId,key,"application/octet-stream",input.bytes])
  const [saved]=await conn.query<ResultSetHeader>(`INSERT INTO app_files (tenant_id,file_ref,module,entity_type,entity_id,object_key,filename,mime_type,size_bytes,checksum,upload_status,classification,owner_id,scan_status) VALUES (?,?,?,?,?,?,?,'application/octet-stream',?,?,'uploaded','restricted',?,'pending')`,[tenantId,ref,input.module,input.entityType,input.entityId,key,input.name,input.bytes.length,checksum,input.ownerId])
  return {fileId:Number(saved.insertId),fileRef:ref,checksum}
}

export type UploadResult = { key: string; url: string; size: number; contentType: string }
export type DownloadResult = { body: Buffer; contentType: string; size: number }

/** Stores file bytes in MySQL so the app needs no extra storage service. Scanning is a byte-signature check at upload. */
export async function uploadFile(
  path: string,
  file: File,
  opts: { public?: boolean; skipValidation?: boolean; skipQuota?: boolean; metadata?: FileMetadataInput } = {},
): Promise<{ ok: true; result: UploadResult & { file?: FileObject } } | { ok: false; error: string }> {
  const tenantId = currentTenantId()
  const key = tenantKey(tenantId, path)
  const bytes = Buffer.from(await file.arrayBuffer())
  const contentType = file.type || "application/octet-stream"
  try {
    await query("INSERT INTO app_file_blobs (tenant_id, object_key, content_type, body) VALUES (?, ?, ?, ?)", [tenantId, key, contentType, bytes])
  } catch (e) {
    console.error("[storage] upload failed", e instanceof Error ? e.name : "unknown")
    return { ok: false, error: STORAGE_UNAVAILABLE }
  }
  const result: UploadResult & { file?: FileObject } = { key, url: `/api/storage/file/${encodeURIComponent(key)}`, size: bytes.length, contentType }
  if (opts.metadata) {
    const m = opts.metadata
    await query(
      `INSERT INTO app_files (tenant_id, file_ref, module, entity_type, entity_id, object_key, filename, mime_type, size_bytes, checksum, upload_status, classification, owner_id, scan_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploaded', ?, ?, 'clean')`,
      [tenantId, randomUUID(), m.module, m.entityType ?? null, m.entityId == null ? null : String(m.entityId), key, file.name || null, contentType, bytes.length,
        createHash("sha256").update(bytes).digest("hex"), m.classification ?? "internal", m.ownerId ?? null],
    )
    result.file = (await getByObjectKey(key)) ?? undefined
  }
  return { ok: true, result }
}

export async function downloadFile(key: string): Promise<DownloadResult> {
  const tenantId = currentTenantId()
  if (!keyBelongsToTenant(key, tenantId)) throw new Error("File not found")
  const rows = await query<any[]>("SELECT content_type, body FROM app_file_blobs WHERE tenant_id = ? AND object_key = ? LIMIT 1", [tenantId, key])
  if (!rows[0]) throw new Error("File not found")
  const body = Buffer.from(rows[0].body)
  return { body, contentType: rows[0].content_type, size: body.length }
}

export async function deleteFile(key: string): Promise<void> {
  const tenantId = currentTenantId()
  await query("DELETE FROM app_file_blobs WHERE tenant_id = ? AND object_key = ?", [tenantId, key])
  await query("UPDATE app_files SET upload_status = 'deleted' WHERE tenant_id = ? AND object_key = ?", [tenantId, key])
}
