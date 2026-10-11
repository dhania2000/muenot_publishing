import "server-only"
import { query } from "@/lib/db"

/** Platform tables the shared ERP modules expect (users, sessions, files, AI credits). Idempotent. */
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tenant_id BIGINT UNSIGNED NOT NULL DEFAULT 1,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(160) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin','employee') NOT NULL DEFAULT 'employee',
    status ENUM('pending','active','disabled') NOT NULL DEFAULT 'pending',
    approved_by BIGINT UNSIGNED NULL,
    approved_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_users_email (email),
    KEY idx_users_tenant (tenant_id, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS password_resets (
    token_hash CHAR(64) NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (token_hash),
    KEY idx_password_resets_user (user_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS app_sessions (
    token_hash CHAR(64) NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (token_hash),
    KEY idx_sessions_user (user_id),
    KEY idx_sessions_expiry (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS app_file_blobs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tenant_id BIGINT UNSIGNED NOT NULL,
    object_key VARCHAR(512) NOT NULL,
    content_type VARCHAR(160) NOT NULL,
    body LONGBLOB NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_blob_key (tenant_id, object_key(255))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS app_files (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tenant_id BIGINT UNSIGNED NOT NULL,
    file_ref CHAR(36) NOT NULL,
    module VARCHAR(80) NOT NULL,
    entity_type VARCHAR(80) NULL,
    entity_id VARCHAR(80) NULL,
    object_key VARCHAR(512) NOT NULL,
    filename VARCHAR(255) NULL,
    mime_type VARCHAR(160) NOT NULL,
    size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
    checksum CHAR(64) NULL,
    upload_status ENUM('pending','uploaded','deleted') NOT NULL DEFAULT 'uploaded',
    classification VARCHAR(40) NOT NULL DEFAULT 'internal',
    owner_id BIGINT UNSIGNED NULL,
    scan_status VARCHAR(20) NOT NULL DEFAULT 'clean',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_file_ref (file_ref),
    KEY idx_files_key (tenant_id, object_key(255)),
    KEY idx_files_entity (tenant_id, module, entity_type, entity_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ai_credit_reservations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tenant_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NULL,
    request_id VARCHAR(160) NOT NULL,
    model_id VARCHAR(160) NULL,
    credits INT NOT NULL DEFAULT 0,
    settled_credits INT NULL,
    status ENUM('reserved','settled','released') NOT NULL DEFAULT 'reserved',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_reservation_request (tenant_id, request_id),
    KEY idx_reservation_month (tenant_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ai_credit_ledger (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tenant_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NULL,
    idempotency_key VARCHAR(200) NOT NULL,
    amount INT NOT NULL,
    provider VARCHAR(80) NULL,
    model_id VARCHAR(160) NULL,
    metadata_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_ledger_key (tenant_id, idempotency_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
]

/** Tables created before the approval flow lack the 'pending' status and approval columns. */
async function upgradeUsersForApproval() {
  const columns = await query<any[]>(
    `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME IN ('status','approved_by','approved_at')`,
  )
  const byName = new Map(columns.map((c) => [String(c.name), String(c.type)]))
  if (!byName.get("status")?.includes("'pending'")) {
    await query("ALTER TABLE users MODIFY status ENUM('pending','active','disabled') NOT NULL DEFAULT 'pending'")
  }
  if (!byName.has("approved_by")) await query("ALTER TABLE users ADD COLUMN approved_by BIGINT UNSIGNED NULL AFTER status")
  if (!byName.has("approved_at")) await query("ALTER TABLE users ADD COLUMN approved_at DATETIME NULL AFTER approved_by")
}

let ensured: Promise<void> | null = null

export function ensurePlatformSchema(): Promise<void> {
  ensured ??= (async () => {
    for (const sql of STATEMENTS) await query(sql)
    await upgradeUsersForApproval()
  })().catch((error) => {
    ensured = null
    throw error
  })
  return ensured
}
