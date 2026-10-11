-- Publishing · Alt Text: the five tenant-scoped tables.
-- Additive and repeatable (CREATE TABLE IF NOT EXISTS); existing data is untouched.
-- Mirrors ensureAltTextSchema() in lib/alt-text/store.ts exactly, so
-- migration-based deploys (where the runtime DB user may lack CREATE
-- privileges) and runtime bootstrap produce the same schema. Keep both in sync.

CREATE TABLE IF NOT EXISTS `alt_text_projects` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `tenant_id` INT NOT NULL,
  `name` VARCHAR(200) NOT NULL,
  `client_name` VARCHAR(200) NULL,
  `description` TEXT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'active',
  `created_by` INT NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_alt_projects_tenant` (`tenant_id`)
);

CREATE TABLE IF NOT EXISTS `alt_text_assets` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `tenant_id` INT NOT NULL,
  `project_id` INT NULL,
  `batch_id` VARCHAR(64) NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(80) NOT NULL,
  `size_bytes` INT NOT NULL,
  `storage_key` VARCHAR(500) NOT NULL,
  `storage_url` VARCHAR(1000) NOT NULL,
  `context_text` TEXT NULL,
  `language` VARCHAR(8) NOT NULL DEFAULT 'en',
  `audience` VARCHAR(40) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'processing',
  `classification` VARCHAR(40) NULL,
  `short_alt` TEXT NULL,
  `long_description` MEDIUMTEXT NULL,
  `extracted_text` MEDIUMTEXT NULL,
  `warnings` JSON NULL,
  `treatment` VARCHAR(500) NULL,
  `model_id` VARCHAR(120) NULL,
  `credits_used` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `attempts` INT NOT NULL DEFAULT 0,
  `error_message` VARCHAR(500) NULL,
  `reviewer_id` INT NULL,
  `reviewed_by` INT NULL,
  `approved_at` TIMESTAMP NULL,
  `current_version` INT NOT NULL DEFAULT 0,
  `created_by` INT NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_alt_assets_tenant_status` (`tenant_id`, `status`),
  INDEX `idx_alt_assets_project` (`tenant_id`, `project_id`)
);

CREATE TABLE IF NOT EXISTS `alt_text_versions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `tenant_id` INT NOT NULL,
  `asset_id` INT NOT NULL,
  `version` INT NOT NULL,
  `action` VARCHAR(20) NOT NULL,
  `classification` VARCHAR(40) NULL,
  `short_alt` TEXT NULL,
  `long_description` MEDIUMTEXT NULL,
  `extracted_text` MEDIUMTEXT NULL,
  `note` VARCHAR(500) NULL,
  `model_id` VARCHAR(120) NULL,
  `actor_id` INT NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_alt_versions_asset` (`tenant_id`, `asset_id`)
);

CREATE TABLE IF NOT EXISTS `alt_text_exports` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `tenant_id` INT NOT NULL,
  `format` VARCHAR(10) NOT NULL,
  `scope` VARCHAR(20) NOT NULL,
  `project_id` INT NULL,
  `asset_id` INT NULL,
  `record_count` INT NOT NULL,
  `created_by` INT NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_alt_exports_tenant` (`tenant_id`)
);

CREATE TABLE IF NOT EXISTS `alt_text_settings` (
  `tenant_id` INT PRIMARY KEY,
  `settings` JSON NOT NULL,
  `updated_by` INT NOT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
