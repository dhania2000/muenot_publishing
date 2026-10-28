-- Task 17: provenance belongs to the existing version history. Runtime schema upgrade ignores duplicate columns.
ALTER TABLE alt_text_versions ADD COLUMN generation_evidence_json JSON NULL;
