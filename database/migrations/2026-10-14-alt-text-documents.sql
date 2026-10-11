-- Publishing · Alt Text: Phase 3 Task 4 — document master records and image occurrence mappings.
-- Additive and repeatable (CREATE TABLE IF NOT EXISTS); no existing table, column or row is changed.
-- Mirrors ALT_TEXT_DOCUMENTS_DDL / ALT_TEXT_DOCUMENT_IMAGES_DDL in lib/alt-text/store.ts. Keep both in sync.
-- Document bytes stay in private storage (file_objects); only the facade's file_ref + file id are stored.
-- AI results, versions, batches and credits remain in alt_text_assets / alt_text_versions / alt_text_batches;
-- an image occurrence links to an existing asset via alt_text_asset_id, and its batch is derived from alt_text_assets.batch_id.

CREATE TABLE IF NOT EXISTS `alt_text_documents` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `tenant_id` INT NOT NULL,
  `project_id` INT NULL,
  `upload_reference_id` CHAR(36) NOT NULL,
  `file_object_id` INT NOT NULL,
  `private_storage_reference` VARCHAR(64) NOT NULL,
  `original_filename` VARCHAR(255) NOT NULL,
  `document_type` VARCHAR(8) NOT NULL,
  `mime_type` VARCHAR(120) NOT NULL,
  `file_size_bytes` BIGINT NOT NULL,
  `file_checksum` CHAR(64) NULL,
  `upload_status` VARCHAR(20) NOT NULL DEFAULT 'uploaded',
  `security_scan_status` VARCHAR(20) NOT NULL DEFAULT 'scanning',
  `processing_status` VARCHAR(20) NOT NULL DEFAULT 'pending',
  `document_title` VARCHAR(255) NULL,
  `source_language` VARCHAR(8) NULL,
  `description` VARCHAR(1000) NULL,
  `document_settings_json` JSON NULL,
  `last_error_code` VARCHAR(64) NULL,
  `last_error_message` VARCHAR(500) NULL,
  `processed_at` TIMESTAMP NULL,
  `uploaded_by` INT NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_alt_documents_upload` (`tenant_id`, `upload_reference_id`),
  INDEX `idx_alt_documents_tenant_created` (`tenant_id`, `created_at`),
  INDEX `idx_alt_documents_project` (`tenant_id`, `project_id`),
  INDEX `idx_alt_documents_uploader` (`tenant_id`, `uploaded_by`, `created_at`)
);

CREATE TABLE IF NOT EXISTS `alt_text_document_images` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `tenant_id` INT NOT NULL,
  `document_id` INT NOT NULL,
  `alt_text_asset_id` INT NULL,
  `source_locator` VARCHAR(255) NOT NULL,
  `occurrence_index` INT NOT NULL DEFAULT 0,
  `page_number` INT NULL,
  `slide_number` INT NULL,
  `image_relationship_id` VARCHAR(255) NULL,
  `image_position_json` JSON NULL,
  `is_decorative` TINYINT(1) NOT NULL DEFAULT 0,
  `media_sha256` CHAR(64) NULL,
  `extraction_status` VARCHAR(20) NOT NULL DEFAULT 'pending',
  `extraction_error_code` VARCHAR(64) NULL,
  `extraction_error_message` VARCHAR(500) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_alt_doc_images_locator` (`document_id`, `source_locator`),
  INDEX `idx_alt_doc_images_order` (`tenant_id`, `document_id`, `occurrence_index`),
  INDEX `idx_alt_doc_images_asset` (`tenant_id`, `alt_text_asset_id`),
  CONSTRAINT `fk_alt_doc_images_document` FOREIGN KEY (`document_id`) REFERENCES `alt_text_documents` (`id`) ON DELETE RESTRICT
);
