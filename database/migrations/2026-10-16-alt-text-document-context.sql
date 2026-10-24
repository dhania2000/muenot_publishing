-- Phase 3 Task 9 — document context analysis per extracted image occurrence.
-- Additive only. Mirrors ensureAltTextSchema() in lib/alt-text/store.ts, which applies the
-- same change idempotently at runtime (ER_DUP_FIELDNAME is ignored there).
--
-- One mapping row = one context: re-analysis overwrites these columns, so no duplicate context
-- records and no separate Alt Text result table. Original documents, source alt text
-- (source_metadata_json) and AI asset histories are never touched by context analysis.
--   context_json        bounded, provenance-tagged, untrusted document evidence (<= 24 KB)
--   context_status      'analyzed' | 'unavailable' | 'failed'
--   context_confidence  'high' | 'medium' | 'low' | 'unavailable' (heuristic tier, not a probability)
--   context_version     DOCUMENT_CONTEXT_VERSION used to build context_json
--   context_analyzed_at last analysis time

ALTER TABLE alt_text_document_images ADD COLUMN context_json JSON NULL;
ALTER TABLE alt_text_document_images ADD COLUMN context_status VARCHAR(20) NULL;
ALTER TABLE alt_text_document_images ADD COLUMN context_confidence VARCHAR(12) NULL;
ALTER TABLE alt_text_document_images ADD COLUMN context_version INT NULL;
ALTER TABLE alt_text_document_images ADD COLUMN context_analyzed_at TIMESTAMP NULL;
