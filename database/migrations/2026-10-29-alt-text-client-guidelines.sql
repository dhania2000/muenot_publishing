-- Additive, tenant-scoped client library. Historical versions are append-only.
-- The application also creates these tables idempotently on first use.
CREATE TABLE IF NOT EXISTS alt_text_client_guideline_profiles (
  tenant_id BIGINT UNSIGNED NOT NULL,
  id VARCHAR(48) NOT NULL,
  client_name VARCHAR(100) NOT NULL,
  current_version INT UNSIGNED NOT NULL,
  archived TINYINT(1) NOT NULL DEFAULT 0,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id,id),
  KEY client_profile_search (tenant_id,archived,client_name)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alt_text_client_guideline_versions (
  tenant_id BIGINT UNSIGNED NOT NULL,
  profile_id VARCHAR(48) NOT NULL,
  version INT UNSIGNED NOT NULL,
  client_name VARCHAR(100) NOT NULL,
  policy_json JSON NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id,profile_id,version)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
