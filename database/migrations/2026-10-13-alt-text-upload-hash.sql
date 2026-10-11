-- Phase 2 Task 6: server-computed content hash enabling idempotent bulk upload retries.
-- Mirrors ensureAltTextSchema() in lib/alt-text/store.ts (which applies it idempotently at runtime).
ALTER TABLE alt_text_assets ADD COLUMN content_sha256 CHAR(64) NULL;
ALTER TABLE alt_text_assets ADD INDEX idx_alt_assets_hash (tenant_id, created_by, content_sha256);
