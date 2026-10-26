-- Phase 3 Task 7: tenant-owned page evidence attached to existing documents.
CREATE TABLE IF NOT EXISTS alt_text_document_page_ocr (
  tenant_id BIGINT UNSIGNED NOT NULL, document_id BIGINT UNSIGNED NOT NULL, page_index INT UNSIGNED NOT NULL,
  source_sha256 CHAR(64) NOT NULL, page_class VARCHAR(32) NOT NULL, status VARCHAR(32) NOT NULL,
  evidence_json JSON NOT NULL, result_json JSON NULL, job_id BIGINT UNSIGNED NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0, run_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  error_code VARCHAR(80) NULL, next_attempt_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, document_id, page_index), KEY page_ocr_work (tenant_id, job_id, status, page_index)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
