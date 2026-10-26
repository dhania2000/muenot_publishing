-- Task 10 reuses versioned accessibility evidence for page and image OCR review.
-- Page reviews retain a document/page/run snapshot in input_json and no image asset.
ALTER TABLE alt_text_accessibility_evidence MODIFY asset_id BIGINT UNSIGNED NULL;
