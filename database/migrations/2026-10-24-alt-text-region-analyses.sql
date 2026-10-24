-- Phase 3 Task 4 — image region detection: append-only, versioned region analyses.
-- Additive only. Mirrors ALT_TEXT_REGION_ANALYSES_DDL in lib/alt-text/store.ts, which
-- ensureAltTextSchema() applies idempotently at runtime.
--
--   occurrence_key  0 = asset-level analysis; otherwise the alt_text_document_images.id it targets.
--                   Lets (tenant, asset, occurrence, version) be unique without NULL semantics.
--   version         monotonically increasing per (tenant, asset, occurrence_key); rows are never updated.
--   request_id      server-bound idempotency key ("alttext:rg<asset>_<occ>_<client id>"); a retry replays.
--   analysis_json   the full RegionAnalysis (normalized boxes, source frame, relationships, warnings).
--                   Re-validated on read; original image bytes are never stored or modified here.
CREATE TABLE IF NOT EXISTS alt_text_region_analyses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  asset_id INT NOT NULL,
  occurrence_id INT NULL,
  occurrence_key INT NOT NULL DEFAULT 0,
  version INT NOT NULL,
  analysis_id VARCHAR(40) NOT NULL,
  request_id VARCHAR(80) NULL,
  status VARCHAR(20) NOT NULL,
  analysis_json JSON NOT NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_alt_regions_version (tenant_id, asset_id, occurrence_key, version),
  UNIQUE KEY uq_alt_regions_request (tenant_id, request_id),
  INDEX idx_alt_regions_latest (tenant_id, asset_id, occurrence_key, version)
);
