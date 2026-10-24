/**
 * @file lib/alt-text/store.ts
 * @module Publishing · Alt Text
 * @kind Server-side data access
 * @summary Idempotent schema + tenant-scoped queries. Every statement filters by tenant_id.
 */
import "server-only"
import { randomUUID } from "node:crypto"
import type { ResultSetHeader, RowDataPacket } from "mysql2"
import { query, withTransaction } from "@/lib/db"
import { currentTenantId } from "@/lib/tenant-scope"
import { BATCH_FIELD_LIMITS, OVERRIDABLE_FIELDS, resolveEffectiveSettings, type ImageOverride } from "./batch-settings"
import { normalizeGenerationSettings, normalizeSettings, type AltTextResult, type AltTextSettings, type ExportRow, type GenerationSettings } from "./core"

let schemaReady: Promise<void> | null = null

/**
 * Phase 3 Task 4. Bytes stay in private storage (file_objects); only the facade's
 * file_ref and file id are stored. Mirrors database/migrations/2026-10-14-alt-text-documents.sql.
 */
export const ALT_TEXT_DOCUMENTS_DDL = `CREATE TABLE IF NOT EXISTS alt_text_documents (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      project_id INT NULL,
      upload_reference_id CHAR(36) NOT NULL,
      file_object_id INT NOT NULL,
      private_storage_reference VARCHAR(64) NOT NULL,
      original_filename VARCHAR(255) NOT NULL,
      document_type VARCHAR(8) NOT NULL,
      mime_type VARCHAR(120) NOT NULL,
      file_size_bytes BIGINT NOT NULL,
      file_checksum CHAR(64) NULL,
      upload_status VARCHAR(20) NOT NULL DEFAULT 'uploaded',
      security_scan_status VARCHAR(20) NOT NULL DEFAULT 'scanning',
      processing_status VARCHAR(20) NOT NULL DEFAULT 'pending',
      document_title VARCHAR(255) NULL,
      source_language VARCHAR(8) NULL,
      description VARCHAR(1000) NULL,
      document_settings_json JSON NULL,
      last_error_code VARCHAR(64) NULL,
      last_error_message VARCHAR(500) NULL,
      processed_at TIMESTAMP NULL,
      uploaded_by INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_alt_documents_upload (tenant_id, upload_reference_id),
      INDEX idx_alt_documents_tenant_created (tenant_id, created_at),
      INDEX idx_alt_documents_project (tenant_id, project_id),
      INDEX idx_alt_documents_uploader (tenant_id, uploaded_by, created_at)
    )`

/**
 * One row per image occurrence: the same media referenced twice gets two rows (distinct
 * source_locator); media_sha256 links duplicates without merging them. The unique
 * (document_id, source_locator) key makes extraction retries idempotent.
 * RESTRICT: removing a document never silently cascades through its mappings.
 */
export const ALT_TEXT_DOCUMENT_IMAGES_DDL = `CREATE TABLE IF NOT EXISTS alt_text_document_images (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      document_id INT NOT NULL,
      alt_text_asset_id INT NULL,
      source_locator VARCHAR(255) NOT NULL,
      occurrence_index INT NOT NULL DEFAULT 0,
      page_number INT NULL,
      slide_number INT NULL,
      image_relationship_id VARCHAR(255) NULL,
      image_position_json JSON NULL,
      is_decorative TINYINT(1) NOT NULL DEFAULT 0,
      media_sha256 CHAR(64) NULL,
      source_metadata_json JSON NULL,
      extraction_status VARCHAR(20) NOT NULL DEFAULT 'pending',
      extraction_error_code VARCHAR(64) NULL,
      extraction_error_message VARCHAR(500) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_alt_doc_images_locator (document_id, source_locator),
      INDEX idx_alt_doc_images_order (tenant_id, document_id, occurrence_index),
      INDEX idx_alt_doc_images_asset (tenant_id, alt_text_asset_id),
      CONSTRAINT fk_alt_doc_images_document FOREIGN KEY (document_id) REFERENCES alt_text_documents (id) ON DELETE RESTRICT
    )`

export function ensureAltTextSchema(): Promise<void> {
  schemaReady ??= (async () => {
    await query(`CREATE TABLE IF NOT EXISTS alt_text_projects (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      name VARCHAR(200) NOT NULL,
      client_name VARCHAR(200) NULL,
      description TEXT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_by INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_alt_projects_tenant (tenant_id)
    )`)
    await query(`CREATE TABLE IF NOT EXISTS alt_text_assets (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      project_id INT NULL,
      batch_id VARCHAR(64) NULL,
      file_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(80) NOT NULL,
      size_bytes INT NOT NULL,
      storage_key VARCHAR(500) NOT NULL,
      storage_url VARCHAR(1000) NOT NULL,
      context_text TEXT NULL,
      language VARCHAR(8) NOT NULL DEFAULT 'en',
      audience VARCHAR(40) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'processing',
      classification VARCHAR(40) NULL,
      short_alt TEXT NULL,
      long_description MEDIUMTEXT NULL,
      extracted_text MEDIUMTEXT NULL,
      warnings JSON NULL,
      treatment VARCHAR(500) NULL,
      model_id VARCHAR(120) NULL,
      credits_used DECIMAL(12,2) NOT NULL DEFAULT 0,
      attempts INT NOT NULL DEFAULT 0,
      error_message VARCHAR(500) NULL,
      reviewer_id INT NULL,
      reviewed_by INT NULL,
      approved_at TIMESTAMP NULL,
      current_version INT NOT NULL DEFAULT 0,
      created_by INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_alt_assets_tenant_status (tenant_id, status),
      INDEX idx_alt_assets_project (tenant_id, project_id)
    )`)
    await query(`CREATE TABLE IF NOT EXISTS alt_text_versions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      asset_id INT NOT NULL,
      version INT NOT NULL,
      action VARCHAR(20) NOT NULL,
      classification VARCHAR(40) NULL,
      short_alt TEXT NULL,
      long_description MEDIUMTEXT NULL,
      extracted_text MEDIUMTEXT NULL,
      note VARCHAR(500) NULL,
      model_id VARCHAR(120) NULL,
      actor_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_alt_versions_asset (tenant_id, asset_id)
    )`)
    await query(`CREATE TABLE IF NOT EXISTS alt_text_exports (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      format VARCHAR(10) NOT NULL,
      scope VARCHAR(20) NOT NULL,
      project_id INT NULL,
      asset_id INT NULL,
      record_count INT NOT NULL,
      created_by INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_alt_exports_tenant (tenant_id)
    )`)
    // Pre-Task-16 tables lack asset_id; MySQL has no ADD COLUMN IF NOT EXISTS.
    await query("ALTER TABLE alt_text_exports ADD COLUMN asset_id INT NULL").catch((e: { code?: string }) => {
      if (e?.code !== "ER_DUP_FIELDNAME") throw e
    })
    // Phase 2 Task 15: bulk exports reference their batch (nullable, additive).
    await query("ALTER TABLE alt_text_exports ADD COLUMN batch_id VARCHAR(64) NULL").catch((e: { code?: string }) => {
      if (e?.code !== "ER_DUP_FIELDNAME") throw e
    })
    await query(`CREATE TABLE IF NOT EXISTS alt_text_settings (
      tenant_id INT PRIMARY KEY,
      settings JSON NOT NULL,
      updated_by INT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`)
    await query(`CREATE TABLE IF NOT EXISTS alt_text_batches (
      id VARCHAR(64) PRIMARY KEY,
      tenant_id INT NOT NULL,
      project_id INT NULL,
      name VARCHAR(150) NOT NULL,
      description VARCHAR(500) NULL,
      settings JSON NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      revision INT NOT NULL DEFAULT 0,
      created_by INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_alt_batches_tenant_status (tenant_id, status, created_at),
      INDEX idx_alt_batches_project (tenant_id, project_id)
    )`)
    await query("ALTER TABLE alt_text_assets ADD COLUMN settings_override JSON NULL").catch((e: { code?: string }) => {
      if (e?.code !== "ER_DUP_FIELDNAME") throw e
    })
    await query("ALTER TABLE alt_text_assets ADD INDEX idx_alt_assets_batch (tenant_id, batch_id, status)").catch((e: { code?: string }) => {
      if (e?.code !== "ER_DUP_KEYNAME") throw e
    })
    for (const ddl of [
      "ALTER TABLE alt_text_batches ADD COLUMN idempotency_key VARCHAR(80) NULL",
      "ALTER TABLE alt_text_batches ADD COLUMN submitted_at TIMESTAMP NULL",
      "ALTER TABLE alt_text_batches ADD COLUMN submitted_by INT NULL",
    ]) {
      await query(ddl).catch((e: { code?: string }) => {
        if (e?.code !== "ER_DUP_FIELDNAME") throw e
      })
    }
    await query("ALTER TABLE alt_text_batches ADD UNIQUE INDEX uq_alt_batches_idem (tenant_id, idempotency_key)").catch((e: { code?: string }) => {
      if (e?.code !== "ER_DUP_KEYNAME") throw e
    })
    await query("ALTER TABLE alt_text_assets ADD COLUMN content_sha256 CHAR(64) NULL").catch((e: { code?: string }) => {
      if (e?.code !== "ER_DUP_FIELDNAME") throw e
    })
    await query("ALTER TABLE alt_text_assets ADD INDEX idx_alt_assets_hash (tenant_id, created_by, content_sha256)").catch((e: { code?: string }) => {
      if (e?.code !== "ER_DUP_KEYNAME") throw e
    })
    // Task 14: machine-readable failure code next to error_message for retry classification.
    await query("ALTER TABLE alt_text_assets ADD COLUMN error_code VARCHAR(64) NULL").catch((e: { code?: string }) => {
      if (e?.code !== "ER_DUP_FIELDNAME") throw e
    })
    // Phase 3 Task 4: document master records + image occurrence mappings.
    await query(ALT_TEXT_DOCUMENTS_DDL)
    await query(ALT_TEXT_DOCUMENT_IMAGES_DDL)
    // Phase 3 Task 5: author-supplied picture metadata (original alt text, title, name) per occurrence.
    await query("ALTER TABLE alt_text_document_images ADD COLUMN source_metadata_json JSON NULL").catch((e: { code?: string }) => {
      if (e?.code !== "ER_DUP_FIELDNAME") throw e
    })
    // Phase 3 Task 9: bounded, untrusted document context per occurrence (one row = one context; no separate table).
    for (const ddl of [
      "ALTER TABLE alt_text_document_images ADD COLUMN context_json JSON NULL",
      "ALTER TABLE alt_text_document_images ADD COLUMN context_status VARCHAR(20) NULL",
      "ALTER TABLE alt_text_document_images ADD COLUMN context_confidence VARCHAR(12) NULL",
      "ALTER TABLE alt_text_document_images ADD COLUMN context_version INT NULL",
      "ALTER TABLE alt_text_document_images ADD COLUMN context_analyzed_at TIMESTAMP NULL",
    ]) {
      await query(ddl).catch((e: { code?: string }) => {
        if (e?.code !== "ER_DUP_FIELDNAME") throw e
      })
    }
  })().catch((e) => {
    schemaReady = null
    throw e
  })
  return schemaReady
}

const tid = () => currentTenantId()

export type AssetRow = {
  id: number
  projectId: number | null
  projectName: string | null
  batchId: string | null
  settingsOverride: ImageOverride | null
  fileName: string
  mimeType: string
  sizeBytes: number
  imageUrl: string
  context: string | null
  language: string
  audience: string
  status: string
  classification: string | null
  shortAlt: string | null
  longDescription: string | null
  extractedText: string | null
  warnings: string[]
  treatment: string | null
  modelId: string | null
  creditsUsed: number
  attempts: number
  errorMessage: string | null
  reviewerId: number | null
  reviewerName: string | null
  approvedAt: string | null
  currentVersion: number
  createdBy: number
  createdAt: string
  updatedAt: string
}

const ASSET_SELECT = `SELECT a.*, p.name AS project_name, u.name AS reviewer_name
  FROM alt_text_assets a
  LEFT JOIN alt_text_projects p ON p.id = a.project_id AND p.tenant_id = a.tenant_id
  LEFT JOIN users u ON u.id = a.reviewer_id`

function parseWarnings(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String)
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }
  return []
}

function mapAsset(r: any): AssetRow {
  return {
    id: r.id,
    projectId: r.project_id,
    projectName: r.project_name ?? null,
    batchId: r.batch_id,
    settingsOverride: pickOverride(parseJson(r.settings_override)),
    fileName: r.file_name,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    imageUrl: `/api/alt-text/assets/${r.id}/image`,
    context: r.context_text,
    language: r.language,
    audience: r.audience,
    status: r.status,
    classification: r.classification,
    shortAlt: r.short_alt,
    longDescription: r.long_description,
    extractedText: r.extracted_text,
    warnings: parseWarnings(r.warnings),
    treatment: r.treatment,
    modelId: r.model_id,
    creditsUsed: Number(r.credits_used ?? 0),
    attempts: r.attempts,
    errorMessage: r.error_message,
    reviewerId: r.reviewer_id,
    reviewerName: r.reviewer_name ?? null,
    approvedAt: r.approved_at ? new Date(r.approved_at).toISOString() : null,
    currentVersion: r.current_version,
    createdBy: r.created_by,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at ?? r.created_at).toISOString(),
  }
}

export async function listAssets(filter: {
  status?: string
  projectId?: number
  search?: string
  batchId?: string
  limit?: number
  offset?: number
  ownerId?: number
  classification?: string
  createdById?: number
  reviewerUserId?: number
  sort?: "newest" | "oldest"
}) {
  await ensureAltTextSchema()
  const where = ["a.tenant_id = ?"]
  const params: any[] = [tid()]
  if (filter.status) (where.push("a.status = ?"), params.push(filter.status))
  if (filter.classification) (where.push("a.classification = ?"), params.push(filter.classification))
  if (filter.createdById) (where.push("a.created_by = ?"), params.push(filter.createdById))
  if (filter.reviewerUserId) (where.push("a.reviewer_id = ?"), params.push(filter.reviewerUserId))
  if (filter.projectId) (where.push("a.project_id = ?"), params.push(filter.projectId))
  if (filter.batchId) (where.push("a.batch_id = ?"), params.push(filter.batchId))
  if (filter.ownerId) (where.push("(a.created_by = ? OR a.reviewer_id = ?)"), params.push(filter.ownerId, filter.ownerId))
  if (filter.search) (where.push("(a.file_name LIKE ? OR a.short_alt LIKE ?)"), params.push(`%${filter.search}%`, `%${filter.search}%`))
  const limit = Math.min(100, Math.max(1, filter.limit ?? 50))
  const offset = Math.max(0, filter.offset ?? 0)
  const [rows, count] = await Promise.all([
    query<any[]>(`${ASSET_SELECT} WHERE ${where.join(" AND ")} ORDER BY ${filter.sort === "oldest" ? "a.created_at ASC, a.id ASC" : "a.created_at DESC, a.id DESC"} LIMIT ${limit} OFFSET ${offset}`, params),
    query<any[]>(`SELECT COUNT(*) AS n FROM alt_text_assets a WHERE ${where.join(" AND ")}`, params),
  ])
  return { items: rows.map(mapAsset), total: Number(count[0]?.n ?? 0) }
}

export async function getAsset(id: number): Promise<(AssetRow & { storageKey: string }) | null> {
  await ensureAltTextSchema()
  const rows = await query<any[]>(`${ASSET_SELECT} WHERE a.tenant_id = ? AND a.id = ? LIMIT 1`, [tid(), id])
  return rows[0] ? { ...mapAsset(rows[0]), storageKey: rows[0].storage_key } : null
}

export async function createAsset(input: {
  projectId: number | null
  batchId: string | null
  fileName: string
  mimeType: string
  sizeBytes: number
  storageKey: string
  storageUrl: string
  context: string
  language: string
  audience: string
  createdBy: number
  /** Server-computed SHA-256 of the stored bytes; enables idempotent bulk retries. */
  contentSha256?: string | null
}): Promise<number> {
  await ensureAltTextSchema()
  if (input.projectId != null && !(await projectExists(input.projectId))) throw new Error("Alt Text project not found for this tenant")
  const res = await query<any>(
    `INSERT INTO alt_text_assets (tenant_id, project_id, batch_id, file_name, mime_type, size_bytes, storage_key, storage_url, context_text, language, audience, status, created_by, content_sha256)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploaded', ?, ?)`,
    [tid(), input.projectId, input.batchId, input.fileName.slice(0, 255), input.mimeType, input.sizeBytes, input.storageKey, input.storageUrl, input.context || null, input.language, input.audience, input.createdBy, input.contentSha256 ?? null],
  )
  return res.insertId
}

/**
 * Finds this user's still-unassigned upload of identical bytes in the current tenant, so a
 * bulk retry after an uncertain network outcome reuses the asset instead of duplicating it.
 */
export async function findReusableUpload(createdBy: number, contentSha256: string): Promise<{ id: number } | null> {
  await ensureAltTextSchema()
  const rows = await query<any[]>(
    `SELECT id FROM alt_text_assets
     WHERE tenant_id = ? AND created_by = ? AND content_sha256 = ? AND batch_id IS NULL AND status = 'uploaded'
     ORDER BY id DESC LIMIT 1`,
    [tid(), createdBy, contentSha256],
  )
  return rows[0] ? { id: Number(rows[0].id) } : null
}

/** A processing claim older than this is treated as abandoned and may be reclaimed. */
export const STALE_CLAIM_MINUTES = 5

/**
 * Atomically claims an asset for generation and returns the claim's attempt
 * number, or null when another live request already holds it. The attempt is
 * read back through LAST_INSERT_ID(expr) on the same statement, so a racing
 * reclaim can never hand two callers the same attempt token.
 */
export async function claimForGeneration(id: number): Promise<number | null> {
  await ensureAltTextSchema()
  const res = await query<ResultSetHeader>(
    `UPDATE alt_text_assets SET status = 'processing', attempts = LAST_INSERT_ID(attempts + 1), error_message = NULL, error_code = NULL
     WHERE tenant_id = ? AND id = ? AND (status <> 'processing' OR attempts = 0 OR updated_at < (NOW() - INTERVAL ${STALE_CLAIM_MINUTES} MINUTE))
       AND (batch_id IS NULL OR NOT EXISTS (
         SELECT 1 FROM alt_text_batches b WHERE b.tenant_id = alt_text_assets.tenant_id AND b.id = alt_text_assets.batch_id
           AND b.status IN ('pause_requested','paused','cancel_requested')))`,
    [tid(), id],
  )
  if (!res.affectedRows) return null
  return Number(res.insertId) || null
}

/**
 * Persists a generation result and its version row in one transaction. The
 * write only lands on a claimed (processing) asset, so it can never overwrite a
 * manual edit or review decision. When `attempt` is given, it must also still
 * own the claim — a superseded (stale-reclaimed) attempt returns false.
 */
export async function saveGeneration(
  id: number,
  result: AltTextResult,
  modelId: string,
  credits: number,
  actorId: number,
  requireReview: boolean,
  attempt?: number,
): Promise<boolean> {
  const tenantId = tid()
  return withTransaction(async (conn) => {
    const claimGuard = attempt === undefined ? " AND status = 'processing'" : " AND status = 'processing' AND attempts = ?"
    const [res] = await conn.query<ResultSetHeader>(
      `UPDATE alt_text_assets SET status = ?, classification = ?, short_alt = ?, long_description = ?, extracted_text = ?, warnings = ?, treatment = ?,
         model_id = ?, credits_used = credits_used + ?, current_version = current_version + 1, approved_at = ?, reviewed_by = NULL, error_message = NULL, error_code = NULL
       WHERE tenant_id = ? AND id = ?${claimGuard}`,
      [
        requireReview ? "in_review" : "approved",
        result.classification,
        result.shortAlt,
        result.longDescription,
        result.extractedText,
        JSON.stringify(result.warnings),
        result.treatment.slice(0, 500),
        modelId,
        credits,
        requireReview ? null : new Date(),
        tenantId,
        id,
        ...(attempt === undefined ? [] : [attempt]),
      ],
    )
    if (!res.affectedRows) return false
    const [rows] = await conn.query<RowDataPacket[]>("SELECT current_version FROM alt_text_assets WHERE tenant_id = ? AND id = ?", [tenantId, id])
    const version = Number(rows[0]?.current_version ?? 1)
    await conn.query(
      `INSERT INTO alt_text_versions (tenant_id, asset_id, version, action, classification, short_alt, long_description, extracted_text, note, model_id, actor_id)
       VALUES (?, ?, ?, 'generated', ?, ?, ?, ?, NULL, ?, ?)`,
      [tenantId, id, version, result.classification, result.shortAlt, result.longDescription, result.extractedText, modelId, actorId],
    )
    return true
  })
}

/**
 * Marks a generation attempt failed. Only a processing asset can fail (a
 * reviewed or edited asset is never downgraded); with `attempt`, only the
 * request that still holds the claim may do so. A previously generated result
 * is kept: the asset returns to its reviewable state instead of losing work.
 */
export async function markFailed(id: number, message: string, attempt?: number, code: string | null = null) {
  const claimGuard = attempt === undefined ? " AND status = 'processing'" : " AND status = 'processing' AND attempts = ?"
  await query(
    `UPDATE alt_text_assets SET status = CASE WHEN current_version > 0 THEN 'in_review' ELSE 'failed' END, error_message = ?, error_code = ?
     WHERE tenant_id = ? AND id = ?${claimGuard}`,
    [message.slice(0, 500), code ? code.slice(0, 64) : null, tid(), id, ...(attempt === undefined ? [] : [attempt])],
  )
}

/**
 * Saves a manual edit as a new version. Edits are refused while a generation
 * is in flight (returns "busy") so a regeneration cannot silently overwrite
 * them. Pass `expectedVersion` (the version the editor loaded) to refuse a
 * stale edit with "conflict" instead of silently overwriting a newer save.
 * Version increment and history row commit together.
 */
export async function editAsset(
  id: number,
  edit: { classification: string; shortAlt: string; longDescription: string; extractedText: string },
  actorId: number,
  expectedVersion?: number,
): Promise<AssetRow | null | "busy" | "conflict"> {
  const current = await getAsset(id)
  if (!current) return null
  if (current.status === "processing") return "busy"
  if (expectedVersion !== undefined && current.currentVersion !== expectedVersion) return "conflict"
  const tenantId = tid()
  const versionGuard = expectedVersion === undefined ? "" : " AND current_version = ?"
  const saved = await withTransaction(async (conn) => {
    const [res] = await conn.query<ResultSetHeader>(
      `UPDATE alt_text_assets SET classification = ?, short_alt = ?, long_description = ?, extracted_text = ?, current_version = current_version + 1,
         status = CASE WHEN status IN ('approved','rejected','failed','uploaded') THEN 'in_review' ELSE status END, approved_at = NULL, reviewed_by = NULL
       WHERE tenant_id = ? AND id = ? AND status <> 'processing'${versionGuard}`,
      [edit.classification, edit.shortAlt, edit.longDescription, edit.extractedText, tenantId, id, ...(expectedVersion === undefined ? [] : [expectedVersion])],
    )
    if (!res.affectedRows) return false
    const [rows] = await conn.query<RowDataPacket[]>("SELECT current_version FROM alt_text_assets WHERE tenant_id = ? AND id = ?", [tenantId, id])
    await conn.query(
      `INSERT INTO alt_text_versions (tenant_id, asset_id, version, action, classification, short_alt, long_description, extracted_text, note, model_id, actor_id)
       VALUES (?, ?, ?, 'edited', ?, ?, ?, ?, NULL, NULL, ?)`,
      [tenantId, id, Number(rows[0]?.current_version ?? 1), edit.classification, edit.shortAlt, edit.longDescription, edit.extractedText, actorId],
    )
    return true
  })
  if (!saved) return expectedVersion === undefined ? "busy" : "conflict"
  return getAsset(id)
}

/**
 * Records a review decision against the version the reviewer saw. The status
 * guard and version guard make the decision atomic: an asset claimed for
 * generation or edited in the meantime is not approved by accident.
 */
export async function decideAsset(id: number, decision: "approved" | "rejected", actorId: number, note: string | null) {
  const current = await getAsset(id)
  if (!current || current.status === "processing" || current.status === "failed") return null
  const tenantId = tid()
  const decided = await withTransaction(async (conn) => {
    const [res] = await conn.query<ResultSetHeader>(
      `UPDATE alt_text_assets SET status = ?, reviewed_by = ?, approved_at = ?
       WHERE tenant_id = ? AND id = ? AND status NOT IN ('processing','failed') AND current_version = ?`,
      [decision, actorId, decision === "approved" ? new Date() : null, tenantId, id, current.currentVersion],
    )
    if (!res.affectedRows) return false
    await conn.query(
      `INSERT INTO alt_text_versions (tenant_id, asset_id, version, action, classification, short_alt, long_description, extracted_text, note, model_id, actor_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      [tenantId, id, current.currentVersion, decision, current.classification, current.shortAlt ?? "", current.longDescription ?? "", current.extractedText ?? "", note, actorId],
    )
    return true
  })
  return decided ? getAsset(id) : null
}

/** Only a user of the current tenant can be assigned; returns null otherwise. */
export async function assignReviewer(id: number, reviewerId: number | null) {
  const res = await query<ResultSetHeader>(
    `UPDATE alt_text_assets SET reviewer_id = ?
     WHERE tenant_id = ? AND id = ? AND (? IS NULL OR EXISTS (SELECT 1 FROM users WHERE id = ? AND tenant_id = ?))`,
    [reviewerId, tid(), id, reviewerId, reviewerId, tid()],
  )
  if (!res.affectedRows) return null
  return getAsset(id)
}

export async function deleteAsset(id: number) {
  const tenantId = tid()
  await withTransaction(async (conn) => {
    await conn.query("DELETE FROM alt_text_versions WHERE tenant_id = ? AND asset_id = ?", [tenantId, id])
    await conn.query("DELETE FROM alt_text_assets WHERE tenant_id = ? AND id = ?", [tenantId, id])
  })
}

export async function listVersions(assetId: number) {
  await ensureAltTextSchema()
  const rows = await query<any[]>(
    `SELECT v.*, u.name AS actor_name FROM alt_text_versions v LEFT JOIN users u ON u.id = v.actor_id
     WHERE v.tenant_id = ? AND v.asset_id = ? ORDER BY v.id DESC LIMIT 50`,
    [tid(), assetId],
  )
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    action: r.action,
    classification: r.classification,
    shortAlt: r.short_alt,
    longDescription: r.long_description,
    note: r.note,
    modelId: r.model_id,
    actorId: r.actor_id as number,
    actorName: r.actor_name ?? "Unknown",
    createdAt: new Date(r.created_at).toISOString(),
  }))
}

export async function listProjects() {
  await ensureAltTextSchema()
  const rows = await query<any[]>(
    `SELECT p.*, COUNT(a.id) AS asset_count,
       SUM(a.status = 'approved') AS approved_count, SUM(a.status = 'in_review') AS review_count, SUM(a.status = 'failed') AS failed_count
     FROM alt_text_projects p LEFT JOIN alt_text_assets a ON a.project_id = p.id AND a.tenant_id = p.tenant_id
     WHERE p.tenant_id = ? GROUP BY p.id ORDER BY p.id DESC`,
    [tid()],
  )
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    clientName: r.client_name,
    description: r.description,
    status: r.status,
    assetCount: Number(r.asset_count ?? 0),
    approvedCount: Number(r.approved_count ?? 0),
    reviewCount: Number(r.review_count ?? 0),
    failedCount: Number(r.failed_count ?? 0),
    createdAt: new Date(r.created_at).toISOString(),
  }))
}

export async function projectExists(id: number) {
  await ensureAltTextSchema()
  const rows = await query<any[]>("SELECT id FROM alt_text_projects WHERE tenant_id = ? AND id = ?", [tid(), id])
  return rows.length > 0
}

export async function createProject(input: { name: string; clientName: string | null; description: string | null }, actorId: number) {
  await ensureAltTextSchema()
  const res = await query<any>("INSERT INTO alt_text_projects (tenant_id, name, client_name, description, created_by) VALUES (?, ?, ?, ?, ?)", [
    tid(),
    input.name,
    input.clientName,
    input.description,
    actorId,
  ])
  return res.insertId as number
}

export async function updateProject(id: number, input: { status?: string; name?: string; clientName?: string | null; description?: string | null }) {
  await query(
    `UPDATE alt_text_projects SET name = COALESCE(?, name), client_name = COALESCE(?, client_name), description = COALESCE(?, description), status = COALESCE(?, status)
     WHERE tenant_id = ? AND id = ?`,
    [input.name ?? null, input.clientName ?? null, input.description ?? null, input.status ?? null, tid(), id],
  )
}

export async function exportRows(filter: { scope: "approved" | "completed" | "all"; projectId?: number }): Promise<ExportRow[]> {
  await ensureAltTextSchema()
  const where = ["a.tenant_id = ?"]
  const params: any[] = [tid()]
  if (filter.scope === "approved") where.push("a.status = 'approved'")
  else if (filter.scope === "completed") where.push("a.status IN ('approved','in_review')")
  if (filter.projectId) (where.push("a.project_id = ?"), params.push(filter.projectId))
  const rows = await query<any[]>(`${ASSET_SELECT} WHERE ${where.join(" AND ")} ORDER BY a.id ASC LIMIT 5000`, params)
  return rows.map((r) => ({
    id: r.id,
    fileName: r.file_name,
    project: r.project_name ?? null,
    language: r.language,
    classification: r.classification,
    shortAlt: r.short_alt,
    longDescription: r.long_description,
    extractedText: r.extracted_text,
    status: r.status,
    approvedAt: r.approved_at ? new Date(r.approved_at).toISOString() : null,
  }))
}

export async function recordExport(
  format: string,
  scope: string,
  projectId: number | null,
  count: number,
  actorId: number,
  assetId: number | null = null,
  batchId: string | null = null,
) {
  await ensureAltTextSchema()
  await query("INSERT INTO alt_text_exports (tenant_id, format, scope, project_id, asset_id, batch_id, record_count, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
    tid(),
    format,
    scope,
    projectId,
    assetId,
    batchId,
    count,
    actorId,
  ])
}

export async function getStats() {
  await ensureAltTextSchema()
  const [totals, exports] = await Promise.all([
    query<any[]>(
      `SELECT COUNT(*) AS total, SUM(status = 'in_review') AS in_review, SUM(status = 'approved') AS approved,
         SUM(status = 'failed') AS failed, SUM(status = 'processing') AS processing, COALESCE(SUM(credits_used), 0) AS credits
       FROM alt_text_assets WHERE tenant_id = ?`,
      [tid()],
    ),
    query<any[]>(
      `SELECT e.id, e.format, e.scope, e.record_count, e.created_at, u.name AS actor_name
       FROM alt_text_exports e LEFT JOIN users u ON u.id = e.created_by WHERE e.tenant_id = ? ORDER BY e.id DESC LIMIT 10`,
      [tid()],
    ),
  ])
  const t = totals[0] ?? {}
  return {
    total: Number(t.total ?? 0),
    inReview: Number(t.in_review ?? 0),
    approved: Number(t.approved ?? 0),
    failed: Number(t.failed ?? 0),
    processing: Number(t.processing ?? 0),
    creditsUsed: Number(t.credits ?? 0),
    exports: exports.map((e) => ({ id: e.id, format: e.format, scope: e.scope, count: e.record_count, actorName: e.actor_name ?? "Unknown", createdAt: new Date(e.created_at).toISOString() })),
  }
}

export async function getSettings(): Promise<AltTextSettings> {
  await ensureAltTextSchema()
  const rows = await query<any[]>("SELECT settings FROM alt_text_settings WHERE tenant_id = ?", [tid()])
  const raw = rows[0]?.settings
  return normalizeSettings(typeof raw === "string" ? JSON.parse(raw) : raw)
}

export async function saveSettings(settings: AltTextSettings, actorId: number) {
  await ensureAltTextSchema()
  await query(
    "INSERT INTO alt_text_settings (tenant_id, settings, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE settings = VALUES(settings), updated_by = VALUES(updated_by)",
    [tid(), JSON.stringify(settings), actorId],
  )
}

// ── Bulk processing batches ────────���───────────────────────────────────────
// Counts are always derived from alt_text_assets (never stored) so they cannot
// drift from the per-asset generation status.

export const BATCH_STATUSES = ["draft", "queued", "processing", "pause_requested", "paused", "cancel_requested", "completed", "partially_completed", "failed", "cancelled"] as const
/** Persisted control states: workers must not claim new images while a batch is in one. */
export const BATCH_HOLD_STATUSES = ["pause_requested", "paused", "cancel_requested"] as const
export type BatchStatus = (typeof BATCH_STATUSES)[number]
export const BATCH_MAX_ASSETS_PER_CALL = 500
export type BatchStats = { total: number; pending: number; processing: number; completed: number; failed: number }
export type BatchRow = {
  id: string
  projectId: number | null
  projectName: string | null
  name: string
  description: string | null
  settings: GenerationSettings
  status: BatchStatus
  revision: number
  createdBy: number
  submittedBy: number | null
  createdAt: string
  updatedAt: string
  stats: BatchStats
}
export type BatchAssetInput = { assetId: number; override?: unknown }

export class BatchError extends Error {}

function parseJson(v: unknown): unknown {
  if (typeof v !== "string") return v ?? null
  try {
    return JSON.parse(v)
  } catch {
    return null
  }
}

function pickOverride(raw: unknown): ImageOverride | null {
  if (!raw || typeof raw !== "object") return null
  const src = raw as Record<string, unknown>
  const picked = Object.fromEntries(OVERRIDABLE_FIELDS.filter((k) => src[k] !== undefined).map((k) => [k, src[k]]))
  return Object.keys(picked).length ? (picked as ImageOverride) : null
}

/** Keeps only the fields the user explicitly overrode, with values normalized; unspecified fields keep inheriting batch defaults. */
export function normalizeOverride(defaults: GenerationSettings, raw: unknown): ImageOverride | null {
  const picked = pickOverride(raw)
  if (!picked) return null
  const resolved = normalizeGenerationSettings({ ...defaults, ...picked })
  return Object.fromEntries(Object.keys(picked).map((k) => [k, resolved[k as keyof GenerationSettings]])) as ImageOverride
}

const isBatchStatus = (s: unknown): s is BatchStatus => typeof s === "string" && (BATCH_STATUSES as readonly string[]).includes(s)

function batchSelect(single: boolean) {
  return `SELECT b.*, p.name AS project_name, s.total, s.pending, s.processing, s.completed, s.failed
    FROM alt_text_batches b
    LEFT JOIN alt_text_projects p ON p.id = b.project_id AND p.tenant_id = b.tenant_id
    LEFT JOIN (
      SELECT batch_id, COUNT(*) AS total, SUM(status = 'uploaded') AS pending, SUM(status = 'processing') AS processing,
        SUM(status IN ('in_review','approved','rejected')) AS completed, SUM(status = 'failed') AS failed
      FROM alt_text_assets WHERE tenant_id = ? AND ${single ? "batch_id = ?" : "batch_id IS NOT NULL"} GROUP BY batch_id
    ) s ON s.batch_id = b.id`
}

function mapBatch(r: any): BatchRow {
  return {
    id: r.id,
    projectId: r.project_id,
    projectName: r.project_name ?? null,
    name: r.name,
    description: r.description,
    settings: normalizeGenerationSettings(parseJson(r.settings)),
    status: isBatchStatus(r.status) ? r.status : "draft",
    revision: Number(r.revision ?? 0),
    createdBy: r.created_by,
    submittedBy: r.submitted_by ?? null,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at ?? r.created_at).toISOString(),
    stats: {
      total: Number(r.total ?? 0),
      pending: Number(r.pending ?? 0),
      processing: Number(r.processing ?? 0),
      completed: Number(r.completed ?? 0),
      failed: Number(r.failed ?? 0),
    },
  }
}

type Conn = { query: <T = any>(sql: string, params?: any[]) => Promise<[T, unknown]> }

/** Locks the batch and assets, then attaches. Throws (rolling back the transaction) on any foreign, missing, busy or already-batched asset. */
async function attachAssets(conn: Conn, tenantId: number, batchId: string, defaults: GenerationSettings, assets: BatchAssetInput[]) {
  const byId = new Map<number, BatchAssetInput>()
  for (const a of assets) {
    if (!Number.isInteger(a.assetId) || a.assetId <= 0) throw new BatchError("Invalid asset id")
    byId.set(a.assetId, a)
  }
  if (!byId.size) return 0
  if (byId.size > BATCH_MAX_ASSETS_PER_CALL) throw new BatchError(`At most ${BATCH_MAX_ASSETS_PER_CALL} assets per request`)
  const ids = [...byId.keys()]
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT id, batch_id, status FROM alt_text_assets WHERE tenant_id = ? AND id IN (${ids.map(() => "?").join(",")}) FOR UPDATE`,
    [tenantId, ...ids],
  )
  if (rows.length !== ids.length) throw new BatchError("One or more assets were not found")
  for (const r of rows) {
    if (r.batch_id != null && r.batch_id !== batchId) throw new BatchError(`Asset ${r.id} already belongs to another batch`)
    if (r.status === "processing") throw new BatchError(`Asset ${r.id} is being processed`)
  }
  for (const id of ids) {
    const override = normalizeOverride(defaults, byId.get(id)!.override)
    await conn.query("UPDATE alt_text_assets SET batch_id = ?, settings_override = ? WHERE tenant_id = ? AND id = ?", [
      batchId,
      override ? JSON.stringify(override) : null,
      tenantId,
      id,
    ])
  }
  return ids.length
}

function validateBatchFields(name: string | undefined, description: string | null | undefined) {
  if (name !== undefined && (!name.trim() || name.trim().length > BATCH_FIELD_LIMITS.name)) throw new BatchError("Batch name is required (max 150 characters)")
  if (description != null && description.length > BATCH_FIELD_LIMITS.description) throw new BatchError("Batch description is too long")
}

/**
 * Creates a draft batch (and optionally attaches assets) atomically. Returns the unguessable batch id.
 * With `idempotencyKey`, the (tenant_id, idempotency_key) unique index makes concurrent retries
 * converge on one batch: the losing insert rolls back and the existing id is returned.
 */
export async function createBatch(
  input: { name: string; description?: string | null; projectId?: number | null; settings: unknown; assets?: BatchAssetInput[]; idempotencyKey?: string | null },
  actorId: number,
): Promise<string> {
  await ensureAltTextSchema()
  validateBatchFields(input.name, input.description)
  const tenantId = tid()
  const id = randomUUID()
  const settings = normalizeGenerationSettings(input.settings)
  const idempotencyKey = input.idempotencyKey ?? null
  try {
    await withTransaction(async (conn: Conn) => {
      if (input.projectId != null) {
        const [p] = await conn.query<RowDataPacket[]>("SELECT id FROM alt_text_projects WHERE tenant_id = ? AND id = ? LOCK IN SHARE MODE", [tenantId, input.projectId])
        if (!p.length) throw new BatchError("Alt Text project not found for this tenant")
      }
      await conn.query(
        "INSERT INTO alt_text_batches (id, tenant_id, project_id, name, description, settings, status, created_by, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)",
        [id, tenantId, input.projectId ?? null, input.name.trim(), input.description?.trim() || null, JSON.stringify(settings), actorId, idempotencyKey],
      )
      if (input.assets?.length) await attachAssets(conn, tenantId, id, settings, input.assets)
    })
  } catch (e) {
    if (idempotencyKey && (e as { code?: string })?.code === "ER_DUP_ENTRY") {
      const existing = await findBatchIdByIdempotencyKey(idempotencyKey)
      if (existing) return existing
    }
    throw e
  }
  return id
}

export async function findBatchIdByIdempotencyKey(key: string): Promise<string | null> {
  await ensureAltTextSchema()
  const rows = await query<any[]>("SELECT id FROM alt_text_batches WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1", [tid(), key])
  return rows[0]?.id ?? null
}

export type AssetRef = { id: number; status: string; batchId: string | null; storageKey: string; createdBy: number; reviewerId: number | null }

/** Server-only lightweight asset lookup (by ids or batch) for ownership, scope and scan checks. Never returned to clients. */
export async function getAssetRefs(filter: { ids: number[] } | { batchId: string }): Promise<AssetRef[]> {
  await ensureAltTextSchema()
  const byIds = "ids" in filter
  if (byIds && !filter.ids.length) return []
  const rows = await query<any[]>(
    `SELECT id, status, batch_id, storage_key, created_by, reviewer_id FROM alt_text_assets WHERE tenant_id = ? AND ${
      byIds ? `id IN (${filter.ids.map(() => "?").join(",")})` : "batch_id = ?"
    } ORDER BY id ASC`,
    [tid(), ...(byIds ? filter.ids : [filter.batchId])],
  )
  return rows.map((r) => ({ id: Number(r.id), status: r.status, batchId: r.batch_id, storageKey: r.storage_key, createdBy: r.created_by, reviewerId: r.reviewer_id }))
}

export type SubmitOutcome =
  | { state: "not_found" }
  | { state: "submitted"; acceptedCount: number }
  | { state: "already_submitted"; status: BatchStatus; acceptedCount: number }
  | { state: "assets_changed" }

/**
 * Atomically moves a draft batch to `queued` for the Task 8 job queue. The batch row lock
 * serializes concurrent submits (one wins, the rest see `already_submitted`), and the
 * asset set is re-checked under lock so it must match exactly what the caller validated.
 */
export async function submitBatch(
  batchId: string,
  actorId: number,
  validatedAssetIds: number[],
  /** Runs on the same transaction after draft → queued; throwing rolls the submit back. */
  onQueued?: (conn: Conn, ctx: { tenantId: number; batchId: string }) => Promise<void>,
): Promise<SubmitOutcome> {
  await ensureAltTextSchema()
  const tenantId = tid()
  return withTransaction(async (conn: Conn) => {
    const [b] = await conn.query<RowDataPacket[]>("SELECT status FROM alt_text_batches WHERE tenant_id = ? AND id = ? FOR UPDATE", [tenantId, batchId])
    if (!b.length) return { state: "not_found" } as const
    const [assets] = await conn.query<RowDataPacket[]>("SELECT id, status FROM alt_text_assets WHERE tenant_id = ? AND batch_id = ? FOR UPDATE", [tenantId, batchId])
    const status = isBatchStatus(b[0].status) ? b[0].status : "draft"
    if (status !== "draft") return { state: "already_submitted", status, acceptedCount: assets.length } as const
    const expected = new Set(validatedAssetIds)
    if (assets.length !== expected.size || assets.some((a) => !expected.has(Number(a.id)) || a.status === "processing")) return { state: "assets_changed" } as const
    const [res] = await conn.query<ResultSetHeader>(
      "UPDATE alt_text_batches SET status = 'queued', submitted_at = NOW(), submitted_by = ?, revision = revision + 1 WHERE tenant_id = ? AND id = ? AND status = 'draft'",
      [actorId, tenantId, batchId],
    )
    if (!res.affectedRows) return { state: "already_submitted", status: "queued", acceptedCount: assets.length } as const
    if (onQueued) await onQueued(conn, { tenantId, batchId })
    return { state: "submitted", acceptedCount: assets.length } as const
  })
}

/** Worker-side: queued → processing once a real processor takes the batch. Tenant-scoped. */
export async function markBatchProcessing(batchId: string): Promise<boolean> {
  await ensureAltTextSchema()
  const res = await query<ResultSetHeader>(
    "UPDATE alt_text_batches SET status = 'processing', revision = revision + 1 WHERE tenant_id = ? AND id = ? AND status IN ('queued','processing')",
    [tid(), batchId],
  )
  return Number(res?.affectedRows ?? 0) > 0
}

/** Mirrors a terminal job failure/cancellation onto an unfinished (or paused, now unresumable) batch. Never touches image rows. */
export async function settleBatchFromJob(batchId: string, status: "failed" | "cancelled"): Promise<boolean> {
  await ensureAltTextSchema()
  const res = await query<ResultSetHeader>(
    "UPDATE alt_text_batches SET status = ?, revision = revision + 1 WHERE tenant_id = ? AND id = ? AND status IN ('queued','processing','pause_requested','paused')",
    [status, tid(), batchId],
  )
  return Number(res?.affectedRows ?? 0) > 0
}

/**
 * Puts a never-generated asset back in the queue after a retryable/global AI failure
 * (rate limit, credits, governance) so it is not reported as a permanent image failure.
 */
export async function requeueAsset(id: number, batchId: string, reason: string): Promise<boolean> {
  const res = await query<ResultSetHeader>(
    "UPDATE alt_text_assets SET status = 'uploaded', error_message = ? WHERE tenant_id = ? AND id = ? AND batch_id = ? AND status = 'failed' AND current_version = 0",
    [reason.slice(0, 500), tid(), id, batchId],
  )
  return Number(res?.affectedRows ?? 0) > 0
}

export type RetryCandidate = { id: number; status: string; currentVersion: number; errorCode: string | null; attempts: number; storageKey: string | null }

export type RetryFailedResult =
  | { state: "not_found" }
  | { state: "job_unavailable" }
  | { state: "not_eligible"; status: BatchStatus }
  | { state: "done"; status: BatchStatus; accepted: number[]; skipped: { id: number; reason: string }[] }

/**
 * Task 14 — atomically returns retry-eligible failed images to `uploaded` and schedules them on the
 * batch's EXISTING durable job (same idempotency key; never a second job). Locks job → batch → assets,
 * the same order as resumeBatch, so double clicks / concurrent users cannot double-claim an image.
 * Attempts and error history are kept (the next claim increments attempts → new idempotency identity).
 * Paused batches keep their hold; cancelled batches are never restarted.
 */
export async function retryFailedBatchAssets(
  batchId: string,
  job: { type: string; idempotencyKey: string },
  opts: { assetIds?: number[]; allowedStatuses: ReadonlySet<string>; blocker: (a: RetryCandidate) => string | null },
): Promise<RetryFailedResult> {
  await ensureAltTextSchema()
  const tenantId = tid()
  return withTransaction(async (conn: Conn) => {
    const [jobRows] = await conn.query<RowDataPacket[]>(
      "SELECT id, status FROM platform_background_jobs WHERE job_type = ? AND tenant_id = ? AND idempotency_key = ? LIMIT 1 FOR UPDATE",
      [job.type, tenantId, job.idempotencyKey],
    )
    const [rows] = await conn.query<RowDataPacket[]>("SELECT status FROM alt_text_batches WHERE tenant_id = ? AND id = ? FOR UPDATE", [tenantId, batchId])
    if (!rows[0]) return { state: "not_found" as const }
    const status = (isBatchStatus(rows[0].status) ? rows[0].status : "draft") as BatchStatus
    if (!opts.allowedStatuses.has(status)) return { state: "not_eligible" as const, status }
    const jobRow = jobRows[0]
    if (!jobRow) return { state: "job_unavailable" as const }

    const filter = opts.assetIds ? ` AND id IN (${opts.assetIds.map(() => "?").join(",") || "NULL"})` : " AND status = 'failed'"
    const [assetRows] = await conn.query<RowDataPacket[]>(
      `SELECT id, status, current_version, error_code, attempts, storage_key FROM alt_text_assets WHERE tenant_id = ? AND batch_id = ?${filter} ORDER BY id FOR UPDATE`,
      [tenantId, batchId, ...(opts.assetIds ?? [])],
    )
    const accepted: number[] = []
    const skipped: { id: number; reason: string }[] = []
    for (const r of assetRows) {
      const candidate: RetryCandidate = {
        id: Number(r.id),
        status: String(r.status),
        currentVersion: Number(r.current_version ?? 0),
        errorCode: r.error_code ?? null,
        attempts: Number(r.attempts ?? 0),
        storageKey: r.storage_key ?? null,
      }
      const reason = opts.blocker(candidate)
      if (reason) skipped.push({ id: candidate.id, reason })
      else accepted.push(candidate.id)
    }
    if (!accepted.length) return { state: "done" as const, status, accepted, skipped }

    // error_message/error_code stay until the next claim settles (last failure reason remains visible).
    await conn.query(
      `UPDATE alt_text_assets SET status = 'uploaded' WHERE tenant_id = ? AND batch_id = ? AND status = 'failed' AND current_version = 0 AND id IN (${accepted.map(() => "?").join(",")})`,
      [tenantId, batchId, ...accepted],
    )
    let next = status
    if (status === "completed" || status === "partially_completed" || status === "failed") {
      next = "queued"
      await conn.query("UPDATE alt_text_batches SET status = 'queued', revision = revision + 1 WHERE tenant_id = ? AND id = ?", [tenantId, batchId])
    } else {
      await conn.query("UPDATE alt_text_batches SET revision = revision + 1 WHERE tenant_id = ? AND id = ?", [tenantId, batchId])
    }
    const jobStatus = String(jobRow.status)
    const isHold = status === "paused" || status === "pause_requested"
    if (jobStatus === "queued" && !isHold) {
      await conn.query("UPDATE platform_background_jobs SET available_at = NOW() WHERE id = ? AND status = 'queued'", [jobRow.id])
    } else if (jobStatus !== "queued" && jobStatus !== "running" && !isHold) {
      // Reactivate the same job row: history and attempts are kept; one extra execution is granted.
      await conn.query(
        `UPDATE platform_background_jobs SET status = 'queued', available_at = NOW(), max_attempts = GREATEST(max_attempts, attempts + 1),
         locked_at = NULL, lease_expires_at = NULL, worker_id = NULL, completed_at = NULL, error_message = NULL, cancel_requested = 0 WHERE id = ?`,
        [jobRow.id],
      )
      await conn.query("INSERT INTO platform_background_job_events (job_id, event_type, detail) VALUES (?,?,?)", [
        jobRow.id,
        "manual_retry",
        JSON.stringify({ previousStatus: jobStatus, assets: accepted.length }),
      ])
    }
    return { state: "done" as const, status: next, accepted, skipped }
  })
}

/** Pure: batch status from per-image records. Null while work remains or nothing was processed. */
export function deriveBatchStatus(stats: BatchStats): "completed" | "partially_completed" | "failed" | null {
  if (stats.total === 0 || stats.pending > 0 || stats.processing > 0) return null
  if (stats.completed > 0) return stats.failed > 0 ? "partially_completed" : "completed"
  return stats.failed > 0 ? "failed" : null
}

/** Worker-side: settles an unfinished batch from its persisted image records (safe to re-run). */
export async function finalizeBatchFromAssets(batchId: string): Promise<{ status: BatchStatus; stats: BatchStats } | null> {
  const batch = await getBatch(batchId)
  if (!batch) return null
  const target = deriveBatchStatus(batch.stats)
  if (!target || (batch.status !== "queued" && batch.status !== "processing")) return { status: batch.status, stats: batch.stats }
  const res = await query<ResultSetHeader>(
    "UPDATE alt_text_batches SET status = ?, revision = revision + 1 WHERE tenant_id = ? AND id = ? AND status IN ('queued','processing')",
    [target, tid(), batchId],
  )
  return { status: Number(res?.affectedRows ?? 0) > 0 ? target : batch.status, stats: batch.stats }
}

export type BatchControlAction = "pause" | "cancel"
export type BatchControlResult =
  | { state: "not_found" }
  | { state: "changed" | "unchanged" | "not_eligible"; status: BatchStatus; previous: BatchStatus }

const CONTROL_SOURCES: Record<BatchControlAction, readonly BatchStatus[]> = {
  pause: ["queued", "processing"],
  // Cancellation takes priority over a pending or completed pause.
  cancel: ["queued", "processing", "pause_requested", "paused"],
}
const CONTROL_TARGET: Record<BatchControlAction, BatchStatus> = { pause: "pause_requested", cancel: "cancel_requested" }
const CONTROL_SETTLED: Record<BatchControlAction, readonly BatchStatus[]> = {
  pause: ["pause_requested", "paused"],
  cancel: ["cancel_requested", "cancelled"],
}

/** Atomically persists a pause/cancel request under a row lock. Re-requests are idempotent no-ops. */
export async function requestBatchControl(batchId: string, action: BatchControlAction): Promise<BatchControlResult> {
  await ensureAltTextSchema()
  const tenantId = tid()
  return withTransaction(async (conn: Conn) => {
    const [rows] = await conn.query<RowDataPacket[]>("SELECT status FROM alt_text_batches WHERE tenant_id = ? AND id = ? FOR UPDATE", [tenantId, batchId])
    if (!rows[0]) return { state: "not_found" as const }
    const previous = (isBatchStatus(rows[0].status) ? rows[0].status : "draft") as BatchStatus
    if (CONTROL_SETTLED[action].includes(previous)) return { state: "unchanged" as const, status: previous, previous }
    if (!CONTROL_SOURCES[action].includes(previous)) return { state: "not_eligible" as const, status: previous, previous }
    const target = CONTROL_TARGET[action]
    await conn.query("UPDATE alt_text_batches SET status = ?, revision = revision + 1 WHERE tenant_id = ? AND id = ?", [target, tenantId, batchId])
    return { state: "changed" as const, status: target, previous }
  })
}

export type BatchResumeResult =
  | { state: "not_found" }
  | { state: "job_unavailable" }
  | { state: "changed" | "unchanged" | "not_eligible"; status: BatchStatus }

/**
 * Clears a pause and wakes the batch's existing durable job (never enqueues a second one).
 * Locks job row then batch row; the job must still be live (queued/running) to carry the work.
 */
export async function resumeBatch(batchId: string, job: { type: string; idempotencyKey: string }): Promise<BatchResumeResult> {
  await ensureAltTextSchema()
  const tenantId = tid()
  return withTransaction(async (conn: Conn) => {
    const [jobRows] = await conn.query<RowDataPacket[]>(
      "SELECT id, status FROM platform_background_jobs WHERE job_type = ? AND tenant_id = ? AND idempotency_key = ? LIMIT 1 FOR UPDATE",
      [job.type, tenantId, job.idempotencyKey],
    )
    const [rows] = await conn.query<RowDataPacket[]>("SELECT status FROM alt_text_batches WHERE tenant_id = ? AND id = ? FOR UPDATE", [tenantId, batchId])
    if (!rows[0]) return { state: "not_found" as const }
    const status = (isBatchStatus(rows[0].status) ? rows[0].status : "draft") as BatchStatus
    if (status === "queued" || status === "processing") return { state: "unchanged" as const, status }
    if (status !== "paused" && status !== "pause_requested") return { state: "not_eligible" as const, status }
    const jobRow = jobRows[0]
    if (!jobRow || !["queued", "running"].includes(String(jobRow.status))) return { state: "job_unavailable" as const }
    // A pause the worker has not yet reached is simply withdrawn; a settled pause re-queues.
    const target: BatchStatus = status === "pause_requested" ? "processing" : "queued"
    await conn.query("UPDATE alt_text_batches SET status = ?, revision = revision + 1 WHERE tenant_id = ? AND id = ?", [target, tenantId, batchId])
    if (String(jobRow.status) === "queued") {
      await conn.query("UPDATE platform_background_jobs SET available_at = NOW() WHERE id = ? AND status = 'queued'", [jobRow.id])
    }
    return { state: "changed" as const, status: target }
  })
}

/**
 * Converges a requested pause/cancel once no fresh claim is in flight (a live claim may be a
 * billable provider request that must settle first). Stale claims (crashed worker) do not block.
 * Cancel finalizes never-started images as `cancelled` and keeps every generated version.
 * Safe to re-run from any worker or the API; only acts on control states.
 */
export async function settleBatchControl(batchId: string): Promise<{ status: BatchStatus; settled: boolean } | null> {
  await ensureAltTextSchema()
  const tenantId = tid()
  return withTransaction(async (conn: Conn) => {
    const [rows] = await conn.query<RowDataPacket[]>("SELECT status FROM alt_text_batches WHERE tenant_id = ? AND id = ? FOR UPDATE", [tenantId, batchId])
    if (!rows[0]) return null
    const status = (isBatchStatus(rows[0].status) ? rows[0].status : "draft") as BatchStatus
    if (status !== "pause_requested" && status !== "cancel_requested") return { status, settled: status === "paused" || status === "cancelled" }
    const [counts] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total, COALESCE(SUM(status = 'uploaded'), 0) AS pending,
         COALESCE(SUM(status = 'processing'), 0) AS processing,
         COALESCE(SUM(status = 'processing' AND updated_at >= (NOW() - INTERVAL ${STALE_CLAIM_MINUTES} MINUTE)), 0) AS live,
         COALESCE(SUM(status IN ('in_review','approved','rejected')), 0) AS completed,
         COALESCE(SUM(status = 'failed'), 0) AS failed
       FROM alt_text_assets WHERE tenant_id = ? AND batch_id = ?`,
      [tenantId, batchId],
    )
    const c = counts[0] ?? {}
    if (Number(c.live ?? 0) > 0) return { status, settled: false }
    let target: BatchStatus
    if (status === "cancel_requested") {
      await conn.query(
        `UPDATE alt_text_assets SET status = IF(current_version > 0, 'in_review', 'cancelled'),
           error_message = IF(current_version > 0, error_message, 'Cancelled before processing.')
         WHERE tenant_id = ? AND batch_id = ? AND (status = 'uploaded'
           OR (status = 'processing' AND updated_at < (NOW() - INTERVAL ${STALE_CLAIM_MINUTES} MINUTE)))`,
        [tenantId, batchId],
      )
      target = "cancelled"
    } else {
      const stats: BatchStats = { total: Number(c.total ?? 0), pending: Number(c.pending ?? 0), processing: Number(c.processing ?? 0), completed: Number(c.completed ?? 0), failed: Number(c.failed ?? 0) }
      target = deriveBatchStatus(stats) ?? "paused"
    }
    await conn.query("UPDATE alt_text_batches SET status = ?, revision = revision + 1 WHERE tenant_id = ? AND id = ? AND status = ?", [target, tenantId, batchId, status])
    return { status: target, settled: true }
  })
}

/** Cheap per-image boundary read of the persisted control state. */
export async function getBatchStatus(batchId: string): Promise<BatchStatus | null> {
  const rows = await query<any[]>("SELECT status FROM alt_text_batches WHERE tenant_id = ? AND id = ? LIMIT 1", [tid(), batchId])
  return rows[0] ? ((isBatchStatus(rows[0].status) ? rows[0].status : "draft") as BatchStatus) : null
}

/** Returns null both for unknown ids and for another tenant's batches. */
export async function getBatch(id: string): Promise<BatchRow | null> {
  await ensureAltTextSchema()
  const tenantId = tid()
  const rows = await query<any[]>(`${batchSelect(true)} WHERE b.tenant_id = ? AND b.id = ? LIMIT 1`, [tenantId, id, tenantId, id])
  return rows[0] ? mapBatch(rows[0]) : null
}

export async function getBatchStats(id: string): Promise<BatchStats | null> {
  return (await getBatch(id))?.stats ?? null
}

export type BatchListSort = "newest" | "oldest" | "updated"
const BATCH_LIST_ORDER: Record<BatchListSort, string> = {
  newest: "b.created_at DESC, b.id DESC",
  oldest: "b.created_at ASC, b.id ASC",
  updated: "b.updated_at DESC, b.id DESC",
}

export async function listBatches(
  filter: {
    status?: BatchStatus
    projectId?: number
    /** Restricts to batches the user created or submitted (non-"all" view scopes). */
    ownerId?: number
    search?: string
    batchId?: string
    createdFrom?: Date
    createdTo?: Date
    sort?: BatchListSort
    limit?: number
    offset?: number
  } = {},
) {
  await ensureAltTextSchema()
  const tenantId = tid()
  const where = ["b.tenant_id = ?"]
  const params: any[] = [tenantId]
  if (filter.status) (where.push("b.status = ?"), params.push(filter.status))
  if (filter.projectId) (where.push("b.project_id = ?"), params.push(filter.projectId))
  if (filter.ownerId) (where.push("(b.created_by = ? OR b.submitted_by = ?)"), params.push(filter.ownerId, filter.ownerId))
  if (filter.batchId) (where.push("b.id = ?"), params.push(filter.batchId))
  if (filter.search) (where.push("b.name LIKE ?"), params.push(`%${filter.search}%`))
  if (filter.createdFrom) (where.push("b.created_at >= ?"), params.push(filter.createdFrom))
  if (filter.createdTo) (where.push("b.created_at < ?"), params.push(filter.createdTo))
  const limit = Math.min(100, Math.max(1, Math.trunc(filter.limit ?? 25)))
  const offset = Math.max(0, Math.trunc(filter.offset ?? 0))
  const order = BATCH_LIST_ORDER[filter.sort ?? "newest"] ?? BATCH_LIST_ORDER.newest
  const [rows, count] = await Promise.all([
    query<any[]>(`${batchSelect(false)} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, [tenantId, ...params]),
    query<any[]>(`SELECT COUNT(*) AS n FROM alt_text_batches b WHERE ${where.join(" AND ")}`, params),
  ])
  return { items: rows.map(mapBatch), total: Number(count[0]?.n ?? 0) }
}

/**
 * Tenant-scoped update. Pass `expectedRevision` for optimistic concurrency:
 * a stale write returns "conflict" instead of overwriting. Default settings can
 * only change while the batch is a draft.
 */
export async function updateBatch(
  id: string,
  patch: { name?: string; description?: string | null; status?: BatchStatus; settings?: unknown; expectedRevision?: number },
): Promise<BatchRow | null | "conflict"> {
  await ensureAltTextSchema()
  validateBatchFields(patch.name, patch.description)
  if (patch.status !== undefined && !isBatchStatus(patch.status)) throw new BatchError("Invalid batch status")
  const settings = patch.settings === undefined ? null : JSON.stringify(normalizeGenerationSettings(patch.settings))
  const hasDescription = patch.description !== undefined
  const revisionGuard = patch.expectedRevision === undefined ? "" : " AND revision = ?"
  const res = await query<ResultSetHeader>(
    `UPDATE alt_text_batches SET name = COALESCE(?, name), description = IF(?, ?, description), status = COALESCE(?, status),
       settings = COALESCE(?, settings), revision = revision + 1
     WHERE tenant_id = ? AND id = ? AND (? IS NULL OR status = 'draft')${revisionGuard}`,
    [
      patch.name?.trim() ?? null,
      hasDescription,
      hasDescription ? patch.description?.trim() || null : null,
      patch.status ?? null,
      settings,
      settings,
      tid(),
      id,
      ...(patch.expectedRevision === undefined ? [] : [patch.expectedRevision]),
    ],
  )
  const current = await getBatch(id)
  if (!current) return null
  return res.affectedRows ? current : "conflict"
}

/** Attaches tenant-owned assets (with optional per-image overrides) to a draft batch in one transaction. */
export async function addAssetsToBatch(batchId: string, assets: BatchAssetInput[]): Promise<number | null> {
  await ensureAltTextSchema()
  const tenantId = tid()
  return withTransaction(async (conn: Conn) => {
    const [b] = await conn.query<RowDataPacket[]>("SELECT settings, status FROM alt_text_batches WHERE tenant_id = ? AND id = ? FOR UPDATE", [tenantId, batchId])
    if (!b.length) return null
    if (b[0].status !== "draft") throw new BatchError("Assets can only be added to a draft batch")
    const added = await attachAssets(conn, tenantId, batchId, normalizeGenerationSettings(parseJson(b[0].settings)), assets)
    await conn.query("UPDATE alt_text_batches SET revision = revision + 1 WHERE tenant_id = ? AND id = ?", [tenantId, batchId])
    return added
  })
}

/** Paginated batch assets with their effective (defaults + override) settings. Null when the batch is not visible to this tenant. */
export async function listBatchAssets(batchId: string, page: { limit?: number; offset?: number; status?: string } = {}) {
  const batch = await getBatch(batchId)
  if (!batch) return null
  const { items, total } = await listAssets({ batchId, status: page.status, limit: page.limit, offset: page.offset, sort: "oldest" })
  return {
    items: items.map((a) => ({ ...a, effectiveSettings: resolveEffectiveSettings(batch.settings, a.settingsOverride ?? undefined) })),
    total,
  }
}

const COMPLETED_ASSET_STATUSES = ["in_review", "approved", "rejected"] as const
const toIso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)

export type BatchProgressRecord = {
  id: string
  name: string
  status: BatchStatus
  createdBy: number
  submittedBy: number | null
  createdAt: string
  submittedAt: string | null
  updatedAt: string
  assetsUpdatedAt: string | null
  counts: BatchStats & { blocked: number; staleProcessing: number; cancelled: number }
  job: { status: string; deferred: boolean; leaseExpired: boolean; startedAt: string | null; completedAt: string | null; updatedAt: string | null } | null
}

/**
 * One aggregate query over the (tenant_id, batch_id, status) index plus one job-row lookup by its
 * unique idempotency key. Read-only: polling never enqueues, claims or touches AI. Null when the
 * batch is unknown or belongs to another tenant.
 */
export async function getBatchProgressRecord(batchId: string, job: { type: string; idempotencyKey: string }): Promise<BatchProgressRecord | null> {
  await ensureAltTextSchema()
  const tenantId = tid()
  const [rows, jobRows] = await Promise.all([
    query<any[]>(
      `SELECT b.id, b.name, b.status, b.created_by, b.submitted_by, b.created_at, b.submitted_at, b.updated_at,
         COUNT(a.id) AS total,
         COALESCE(SUM(a.status = 'uploaded'), 0) AS pending,
         COALESCE(SUM(a.status = 'uploaded' AND a.error_message IS NOT NULL), 0) AS blocked,
         COALESCE(SUM(a.status = 'processing'), 0) AS processing,
         COALESCE(SUM(a.status = 'processing' AND a.updated_at < (NOW() - INTERVAL ${STALE_CLAIM_MINUTES} MINUTE)), 0) AS stale_processing,
         COALESCE(SUM(a.status IN ('in_review','approved','rejected')), 0) AS completed,
         COALESCE(SUM(a.status = 'failed'), 0) AS failed,
         COALESCE(SUM(a.status = 'cancelled'), 0) AS cancelled,
         MAX(a.updated_at) AS assets_updated_at
       FROM alt_text_batches b
       LEFT JOIN alt_text_assets a ON a.tenant_id = b.tenant_id AND a.batch_id = b.id
       WHERE b.tenant_id = ? AND b.id = ?
       GROUP BY b.id`,
      [tenantId, batchId],
    ),
    query<any[]>(
      `SELECT status, started_at, completed_at, updated_at, (available_at > NOW()) AS deferred,
         (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < NOW()) AS lease_expired
       FROM platform_background_jobs WHERE job_type = ? AND tenant_id = ? AND idempotency_key = ? LIMIT 1`,
      [job.type, tenantId, job.idempotencyKey],
    ).catch((e: { code?: string }) => {
      // Draft-only tenants may never have created the queue table yet.
      if (e?.code === "ER_NO_SUCH_TABLE") return []
      throw e
    }),
  ])
  const r = rows[0]
  if (!r) return null
  const j = jobRows[0]
  return {
    id: r.id,
    name: r.name,
    status: isBatchStatus(r.status) ? r.status : "draft",
    createdBy: Number(r.created_by),
    submittedBy: r.submitted_by == null ? null : Number(r.submitted_by),
    createdAt: new Date(r.created_at).toISOString(),
    submittedAt: toIso(r.submitted_at),
    updatedAt: new Date(r.updated_at ?? r.created_at).toISOString(),
    assetsUpdatedAt: toIso(r.assets_updated_at),
    counts: {
      total: Number(r.total ?? 0),
      pending: Number(r.pending ?? 0),
      blocked: Number(r.blocked ?? 0),
      processing: Number(r.processing ?? 0),
      staleProcessing: Number(r.stale_processing ?? 0),
      completed: Number(r.completed ?? 0),
      failed: Number(r.failed ?? 0),
      cancelled: Number(r.cancelled ?? 0),
    },
    job: j
      ? {
          status: String(j.status),
          deferred: Boolean(Number(j.deferred)),
          leaseExpired: Boolean(Number(j.lease_expired)),
          startedAt: toIso(j.started_at),
          completedAt: toIso(j.completed_at),
          updatedAt: toIso(j.updated_at),
        }
      : null,
  }
}

export type BatchAssetStatusRow = {
  id: number
  fileName: string
  classification: string | null
  status: string
  shortAltPreview: string | null
  errorMessage: string | null
  errorCode: string | null
  attempts: number
  currentVersion: number
  createdBy: number
  reviewerId: number | null
  updatedAt: string
}

/** Lean, paginated per-image status for a batch. No storage keys, bytes or long text leave the DB layer. */
export async function listBatchAssetStatuses(
  batchId: string,
  page: { statuses?: readonly string[]; limit: number; offset: number; owner?: { userId: number; match: "added" | "owned" | "both" } },
): Promise<{ items: BatchAssetStatusRow[]; total: number }> {
  await ensureAltTextSchema()
  const where = ["a.tenant_id = ?", "a.batch_id = ?"]
  const params: any[] = [tid(), batchId]
  if (page.statuses?.length) (where.push(`a.status IN (${page.statuses.map(() => "?").join(",")})`), params.push(...page.statuses))
  if (page.owner) {
    const { userId, match } = page.owner
    if (match === "added") (where.push("a.created_by = ?"), params.push(userId))
    else if (match === "owned") (where.push("a.reviewer_id = ?"), params.push(userId))
    else (where.push("(a.created_by = ? OR a.reviewer_id = ?)"), params.push(userId, userId))
  }
  const limit = Math.min(100, Math.max(1, Math.trunc(page.limit)))
  const offset = Math.max(0, Math.trunc(page.offset))
  const sql = where.join(" AND ")
  const [rows, count] = await Promise.all([
    query<any[]>(
      `SELECT a.id, a.file_name, a.classification, a.status, LEFT(a.short_alt, 200) AS short_alt_preview, a.error_message, a.error_code, a.attempts, a.current_version, a.created_by, a.reviewer_id, a.updated_at, a.created_at
       FROM alt_text_assets a WHERE ${sql} ORDER BY a.id ASC LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
    query<any[]>(`SELECT COUNT(*) AS n FROM alt_text_assets a WHERE ${sql}`, params),
  ])
  return {
    items: rows.map((r) => ({
      id: Number(r.id),
      fileName: r.file_name,
      classification: r.classification ?? null,
      status: r.status,
      shortAltPreview: r.short_alt_preview ?? null,
      errorMessage: r.error_message ?? null,
      errorCode: r.error_code ?? null,
      attempts: Number(r.attempts ?? 0),
      currentVersion: Number(r.current_version ?? 0),
      createdBy: Number(r.created_by),
      reviewerId: r.reviewer_id == null ? null : Number(r.reviewer_id),
      updatedAt: new Date(r.updated_at ?? r.created_at).toISOString(),
    })),
    total: Number(count[0]?.n ?? 0),
  }
}

export const BATCH_COMPLETED_ASSET_STATUSES: readonly string[] = COMPLETED_ASSET_STATUSES

export type BatchExportOwner = { userId: number; match: "added" | "owned" | "both" }
export type BatchExportAssetRow = {
  id: number
  fileName: string
  status: string
  language: string
  classification: string | null
  shortAlt: string | null
  longDescription: string | null
  extractedText: string | null
  warnings: string[]
  modelId: string | null
  currentVersion: number
  settingsOverride: ImageOverride | null
  updatedAt: string
}

function batchExportWhere(batchId: string, owner?: BatchExportOwner) {
  const where = ["a.tenant_id = ?", "a.batch_id = ?", `a.status IN (${COMPLETED_ASSET_STATUSES.map(() => "?").join(",")})`]
  const params: any[] = [tid(), batchId, ...COMPLETED_ASSET_STATUSES]
  if (owner) {
    if (owner.match === "added") (where.push("a.created_by = ?"), params.push(owner.userId))
    else if (owner.match === "owned") (where.push("a.reviewer_id = ?"), params.push(owner.userId))
    else (where.push("(a.created_by = ? OR a.reviewer_id = ?)"), params.push(owner.userId, owner.userId))
  }
  return { sql: where.join(" AND "), params }
}

export type BatchWorkbookAssetRow = BatchExportAssetRow & { mimeType: string; sizeBytes: number; attempts: number; errorMessage: string | null }

function batchAllWhere(batchId: string, owner?: BatchExportOwner) {
  const where = ["a.tenant_id = ?", "a.batch_id = ?"]
  const params: any[] = [tid(), batchId]
  if (owner) {
    if (owner.match === "added") (where.push("a.created_by = ?"), params.push(owner.userId))
    else if (owner.match === "owned") (where.push("a.reviewer_id = ?"), params.push(owner.userId))
    else (where.push("(a.created_by = ? OR a.reviewer_id = ?)"), params.push(owner.userId, owner.userId))
  }
  return { sql: where.join(" AND "), params }
}

/** All statuses in the batch (XLSX workbook); same owner scoping as the CSV export. */
export async function countBatchWorkbookRows(batchId: string, owner?: BatchExportOwner): Promise<number> {
  await ensureAltTextSchema()
  const { sql, params } = batchAllWhere(batchId, owner)
  const rows = await query<any[]>(`SELECT COUNT(*) AS n FROM alt_text_assets a WHERE ${sql}`, params)
  return Number(rows[0]?.n ?? 0)
}

/** Keyset page of every batch image's persisted metadata and saved text — no storage keys, URLs, bytes or credits. */
export async function listBatchWorkbookRows(batchId: string, page: { afterId: number; limit: number; owner?: BatchExportOwner }): Promise<BatchWorkbookAssetRow[]> {
  await ensureAltTextSchema()
  const { sql, params } = batchAllWhere(batchId, page.owner)
  const limit = Math.min(500, Math.max(1, Math.trunc(page.limit)))
  const rows = await query<any[]>(
    `SELECT a.id, a.file_name, a.mime_type, a.size_bytes, a.status, a.language, a.classification, a.short_alt, a.long_description, a.extracted_text,
       a.warnings, a.model_id, a.current_version, a.attempts, a.error_message, a.settings_override, a.updated_at, a.created_at
     FROM alt_text_assets a WHERE ${sql} AND a.id > ? ORDER BY a.id ASC LIMIT ${limit}`,
    [...params, Math.max(0, Math.trunc(page.afterId))],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    fileName: r.file_name,
    mimeType: r.mime_type,
    sizeBytes: Number(r.size_bytes ?? 0),
    status: r.status,
    language: r.language,
    classification: r.classification ?? null,
    shortAlt: r.short_alt ?? null,
    longDescription: r.long_description ?? null,
    extractedText: r.extracted_text ?? null,
    warnings: parseWarnings(r.warnings),
    modelId: r.model_id ?? null,
    currentVersion: Number(r.current_version ?? 0),
    attempts: Number(r.attempts ?? 0),
    errorMessage: r.error_message ?? null,
    settingsOverride: pickOverride(parseJson(r.settings_override)),
    updatedAt: new Date(r.updated_at ?? r.created_at).toISOString(),
  }))
}

/** Saved-result candidates for a batch export; uses the (tenant_id, batch_id, status) index. */
export async function countBatchExportRows(batchId: string, owner?: BatchExportOwner): Promise<number> {
  await ensureAltTextSchema()
  const { sql, params } = batchExportWhere(batchId, owner)
  const rows = await query<any[]>(`SELECT COUNT(*) AS n FROM alt_text_assets a WHERE ${sql}`, params)
  return Number(rows[0]?.n ?? 0)
}

/**
 * Keyset page (id > afterId, ascending) of saved text fields only — never storage keys, URLs,
 * image bytes or credit data. Deterministic order and no duplicates across pages.
 */
export async function listBatchExportRows(batchId: string, page: { afterId: number; limit: number; owner?: BatchExportOwner }): Promise<BatchExportAssetRow[]> {
  await ensureAltTextSchema()
  const { sql, params } = batchExportWhere(batchId, page.owner)
  const limit = Math.min(500, Math.max(1, Math.trunc(page.limit)))
  const rows = await query<any[]>(
    `SELECT a.id, a.file_name, a.status, a.language, a.classification, a.short_alt, a.long_description, a.extracted_text, a.warnings,
       a.model_id, a.current_version, a.settings_override, a.updated_at, a.created_at
     FROM alt_text_assets a WHERE ${sql} AND a.id > ? ORDER BY a.id ASC LIMIT ${limit}`,
    [...params, Math.max(0, Math.trunc(page.afterId))],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    fileName: r.file_name,
    status: r.status,
    language: r.language,
    classification: r.classification ?? null,
    shortAlt: r.short_alt ?? null,
    longDescription: r.long_description ?? null,
    extractedText: r.extracted_text ?? null,
    warnings: parseWarnings(r.warnings),
    modelId: r.model_id ?? null,
    currentVersion: Number(r.current_version ?? 0),
    settingsOverride: pickOverride(parseJson(r.settings_override)),
    updatedAt: new Date(r.updated_at ?? r.created_at).toISOString(),
  }))
}

/** Tenant-scoped: never lists users from another organisation. */
export async function listReviewers() {
  const rows = await query<any[]>("SELECT id, name FROM users WHERE tenant_id = ? AND status = 'active' ORDER BY name LIMIT 200", [tid()]).catch(() =>
    query<any[]>("SELECT id, name FROM users WHERE tenant_id = ? ORDER BY name LIMIT 200", [tid()]),
  )
  return rows.map((r) => ({ id: r.id as number, name: String(r.name) }))
}
