-- Phase 3 Task 5 — PPTX image extraction.
-- Additive only. Mirrors ensureAltTextSchema() in lib/alt-text/store.ts, which applies the
-- same change idempotently at runtime (ER_DUP_FIELDNAME is ignored there).
--
-- New status values are stored in the existing VARCHAR(20) columns; no enum change is needed:
--   alt_text_documents.processing_status      += 'partially_extracted', 'unsupported'
--   alt_text_document_images.extraction_status += 'unsupported'

ALTER TABLE alt_text_document_images ADD COLUMN source_metadata_json JSON NULL;
