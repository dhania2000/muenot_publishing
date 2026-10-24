-- Phase 3 Task 5 — OCR text recognition: append-only, versioned OCR attempts.
-- Additive only. Mirrors ALT_TEXT_OCR_RESULTS_DDL in lib/alt-text/store.ts, which
-- ensureAltTextSchema() applies idempotently at runtime.
--
-- Why a new table instead of alt_text_region_analyses: region versions are keyed per
-- (asset, occurrence) and "latest version" means "latest region analysis". OCR results are keyed
-- per (asset, occurrence, scope) where scope is the full image or one region, so mixing them would
-- break the region read model.
--
--   occurrence_key  0 = asset-level; otherwise the alt_text_document_images.id it targets.
--   scope_key       'full' or a region id (rgn_…).
--   version         monotonically increasing per (tenant, asset, occurrence_key, scope_key).
--   status          completed | completed_with_warnings | no_text_detected | failed | unsupported.
--                   A failed attempt is stored but never replaces an earlier successful one.
--   cache_key       sha256(input bytes digest + engine/model/mode/crop fingerprint); identical
--                   requests reuse the saved result unless reprocessing is requested.
--   result_json     the full OcrResult (raw + normalized text, layout, confidence, warnings).
--                   Original image bytes are never stored or modified here.
CREATE TABLE IF NOT EXISTS alt_text_ocr_results (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  asset_id INT NOT NULL,
  occurrence_id INT NULL,
  occurrence_key INT NOT NULL DEFAULT 0,
  scope_key VARCHAR(48) NOT NULL,
  version INT NOT NULL,
  result_id VARCHAR(40) NOT NULL,
  request_id VARCHAR(96) NULL,
  status VARCHAR(32) NOT NULL,
  cache_key CHAR(64) NOT NULL,
  result_json JSON NOT NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_alt_ocr_version (tenant_id, asset_id, occurrence_key, scope_key, version),
  UNIQUE KEY uq_alt_ocr_request (tenant_id, request_id),
  INDEX idx_alt_ocr_cache (tenant_id, asset_id, occurrence_key, scope_key, cache_key)
);
