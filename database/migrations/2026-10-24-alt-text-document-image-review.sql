-- Phase 3 Task 10 — extracted image review workspace: persisted selection + source review state.
-- Additive only. Mirrors ensureAltTextSchema() in lib/alt-text/store.ts, which applies the same
-- change idempotently at runtime (ER_DUP_FIELDNAME / ER_DUP_KEYNAME are ignored there).
--
-- Stored on the existing occurrence mapping row (no new image/asset table):
--   selected_for_processing  1 = the occurrence is selected for future AI generation (Tasks 11–12).
--                            Writes only succeed for eligible occurrences (enforced in the UPDATE).
--   selection_updated_at/by  last selection change (audit; does not bump updated_at)
--   review_status            'not_reviewed' | 'reviewed' | 'needs_attention' — a user inspected the
--                            source image/context. NOT final alt text approval (Task 14).
--   reviewed_at/by           last review change

ALTER TABLE alt_text_document_images ADD COLUMN selected_for_processing TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE alt_text_document_images ADD COLUMN selection_updated_at TIMESTAMP NULL;
ALTER TABLE alt_text_document_images ADD COLUMN selection_updated_by INT NULL;
ALTER TABLE alt_text_document_images ADD COLUMN review_status VARCHAR(20) NOT NULL DEFAULT 'not_reviewed';
ALTER TABLE alt_text_document_images ADD COLUMN reviewed_at TIMESTAMP NULL;
ALTER TABLE alt_text_document_images ADD COLUMN reviewed_by INT NULL;
ALTER TABLE alt_text_document_images ADD INDEX idx_alt_doc_images_selected (tenant_id, document_id, selected_for_processing);
ALTER TABLE alt_text_document_images ADD INDEX idx_alt_doc_images_hash (tenant_id, document_id, media_sha256);
