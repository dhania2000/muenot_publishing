-- Publishing · Alt Text: bulk processing batches (Phase 2 Task 5).
-- Additive and idempotent; no existing table, column or row is dropped or rewritten.
-- Mirrors ensureAltTextSchema() in lib/alt-text/store.ts. Keep both in sync.
-- alt_text_assets.batch_id (VARCHAR(64), nullable) already exists; single-image
-- assets keep batch_id = NULL and settings_override = NULL.

CREATE TABLE IF NOT EXISTS `alt_text_batches` (
  `id` VARCHAR(64) PRIMARY KEY,
  `tenant_id` INT NOT NULL,
  `project_id` INT NULL,
  `name` VARCHAR(150) NOT NULL,
  `description` VARCHAR(500) NULL,
  `settings` JSON NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
  `revision` INT NOT NULL DEFAULT 0,
  `created_by` INT NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_alt_batches_tenant_status` (`tenant_id`, `status`, `created_at`),
  INDEX `idx_alt_batches_project` (`tenant_id`, `project_id`)
);

SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'alt_text_assets' AND column_name = 'settings_override');
SET @sql := IF(@has = 0, 'ALTER TABLE alt_text_assets ADD COLUMN settings_override JSON NULL', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Phase 2 Task 7: tenant-scoped create idempotency + durable submission markers for Task 8.
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'alt_text_batches' AND column_name = 'idempotency_key');
SET @sql := IF(@has = 0, 'ALTER TABLE alt_text_batches ADD COLUMN idempotency_key VARCHAR(80) NULL, ADD COLUMN submitted_at TIMESTAMP NULL, ADD COLUMN submitted_by INT NULL', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'alt_text_batches' AND index_name = 'uq_alt_batches_idem');
SET @sql := IF(@has = 0, 'ALTER TABLE alt_text_batches ADD UNIQUE INDEX uq_alt_batches_idem (tenant_id, idempotency_key)', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'alt_text_assets' AND index_name = 'idx_alt_assets_batch');
SET @sql := IF(@has = 0, 'ALTER TABLE alt_text_assets ADD INDEX idx_alt_assets_batch (tenant_id, batch_id, status)', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
