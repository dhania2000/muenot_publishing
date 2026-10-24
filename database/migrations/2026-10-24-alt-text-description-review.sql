-- Phase 3 Task 14 — human review & approval of document image descriptions.
-- Additive only. Mirrors ensureAltTextSchema() in lib/alt-text/store.ts, which applies the same
-- change idempotently at runtime (ER_DUP_FIELDNAME / ER_DUP_KEYNAME are ignored there).
--
-- Stored on the existing occurrence mapping row (no new review, version or audit table):
--   alt_review_status        'not_reviewed' | 'in_review' | 'changes_requested' | 'approved' | 'rejected'
--   alt_review_version       asset current_version the decision applies to. A later version never
--                            inherits it (effective status falls back to in_review / not_reviewed).
--   alt_review_comment/category, alt_reviewed_by/at   last decision metadata
--   approved_version_id      id of the immutable alt_text_versions row that was approved
--   approved_version         that row's version number (must equal current_version for insertion)
--   approved_by/at           approver and time
--   approved_decorative      1 = reviewer explicitly confirmed decorative treatment (alt="")
--   decorative_justification required reviewer justification for decorative approval
--
-- Every decision is also appended to alt_text_versions (actions review_started, approved,
-- decorative_approved, changes_requested, rejected, approval_superseded) as the audit trail.
-- Source-document author alt text is never modified.

ALTER TABLE alt_text_document_images ADD COLUMN alt_review_status VARCHAR(20) NOT NULL DEFAULT 'not_reviewed';
ALTER TABLE alt_text_document_images ADD COLUMN alt_review_version INT NULL;
ALTER TABLE alt_text_document_images ADD COLUMN alt_review_comment VARCHAR(500) NULL;
ALTER TABLE alt_text_document_images ADD COLUMN alt_review_category VARCHAR(40) NULL;
ALTER TABLE alt_text_document_images ADD COLUMN alt_reviewed_by INT NULL;
ALTER TABLE alt_text_document_images ADD COLUMN alt_reviewed_at TIMESTAMP NULL;
ALTER TABLE alt_text_document_images ADD COLUMN approved_version_id BIGINT UNSIGNED NULL;
ALTER TABLE alt_text_document_images ADD COLUMN approved_version INT NULL;
ALTER TABLE alt_text_document_images ADD COLUMN approved_by INT NULL;
ALTER TABLE alt_text_document_images ADD COLUMN approved_at TIMESTAMP NULL;
ALTER TABLE alt_text_document_images ADD COLUMN approved_decorative TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE alt_text_document_images ADD COLUMN decorative_justification VARCHAR(500) NULL;
ALTER TABLE alt_text_document_images ADD INDEX idx_alt_doc_images_alt_review (tenant_id, document_id, alt_review_status);
