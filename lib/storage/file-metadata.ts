import "server-only"
import { query } from "@/lib/db"
import { currentTenantId } from "@/lib/tenant-scope"

export type FileClassification = "public" | "internal" | "confidential" | "restricted"
/** ERP vocabulary. The standalone `app_files.upload_status` column stores `uploaded` for `completed`. */
export type FileUploadStatus = "pending" | "uploading" | "completed" | "failed" | "deleted"

const fromDbStatus = (value: string): FileUploadStatus =>
  value === "uploaded" ? "completed" : value === "pending" || value === "deleted" ? value : "failed"
const toDbStatus = (status: FileUploadStatus) => (status === "completed" ? "uploaded" : status)
export type FileEncryptionState = "none" | "provider_managed"

export type FileObject = {
  id: number
  fileRef: string
  module: string
  entityType: string | null
  entityId: string | null
  objectKey: string
  provider: string
  filename: string | null
  mimeType: string | null
  size: number
  checksum: string | null
  encryptionState: FileEncryptionState
  uploadStatus: FileUploadStatus
  version: number
  isCurrent: boolean
  classification: FileClassification
  retentionPolicy: string
  retentionExpiresAt: string | null
  legalHold: boolean
  ownerId: number | null
  createdAt: string | null
  updatedAt: string | null
}

export type FileMetadataInput = {
  module: string
  entityType?: string | null
  entityId?: string | number | null
  ownerId?: number | null
  classification?: FileClassification
}

export type ListFilesFilter = {
  module?: string
  entityType?: string
  entityId?: string | number
  status?: FileUploadStatus
  currentOnly?: boolean
  includeDeleted?: boolean
  limit?: number
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))

function toFile(r: any): FileObject {
  return {
    id: Number(r.id),
    fileRef: r.file_ref,
    module: r.module,
    entityType: r.entity_type ?? null,
    entityId: r.entity_id ?? null,
    objectKey: r.object_key,
    provider: "database",
    filename: r.filename ?? null,
    mimeType: r.mime_type ?? null,
    size: Number(r.size_bytes),
    checksum: r.checksum ?? null,
    encryptionState: "provider_managed",
    uploadStatus: fromDbStatus(String(r.upload_status)),
    version: 1,
    isCurrent: true,
    classification: r.classification,
    retentionPolicy: "default",
    retentionExpiresAt: null,
    legalHold: false,
    ownerId: r.owner_id == null ? null : Number(r.owner_id),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  }
}

const COLUMNS = "id, file_ref, module, entity_type, entity_id, object_key, filename, mime_type, size_bytes, checksum, upload_status, classification, owner_id, created_at, updated_at"

export async function getFileById(id: number): Promise<FileObject | null> {
  const rows = await query<any[]>(`SELECT ${COLUMNS} FROM app_files WHERE tenant_id = ? AND id = ? LIMIT 1`, [currentTenantId(), id])
  return rows[0] ? toFile(rows[0]) : null
}

export async function getByObjectKey(objectKey: string): Promise<FileObject | null> {
  const rows = await query<any[]>(`SELECT ${COLUMNS} FROM app_files WHERE tenant_id = ? AND object_key = ? LIMIT 1`, [currentTenantId(), objectKey])
  return rows[0] ? toFile(rows[0]) : null
}

export async function listFileMetadata(filter: ListFilesFilter = {}): Promise<FileObject[]> {
  const where = ["tenant_id = ?"]
  const params: unknown[] = [currentTenantId()]
  if (filter.module) (where.push("module = ?"), params.push(filter.module))
  if (filter.entityType) (where.push("entity_type = ?"), params.push(filter.entityType))
  if (filter.entityId != null) (where.push("entity_id = ?"), params.push(String(filter.entityId)))
  if (filter.status) (where.push("upload_status = ?"), params.push(toDbStatus(filter.status)))
  else if (!filter.includeDeleted) where.push("upload_status <> 'deleted'")
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 1000)
  const rows = await query<any[]>(`SELECT ${COLUMNS} FROM app_files WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ${limit}`, params)
  return rows.map(toFile)
}
