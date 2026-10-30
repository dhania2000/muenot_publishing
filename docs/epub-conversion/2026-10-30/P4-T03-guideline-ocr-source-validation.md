# P4-T03 — Guideline OCR and text extraction

Date: 2026-10-30. Global task 48. Status: implementation_complete.

## Existing capability → improvement

- `lib/epub/guideline-ocr.ts`
- `lib/epub/guideline-documents.ts`
- `lib/background-jobs.ts`

The existing local Tesseract engine, language packs and PDF renderer are reused on the shared durable queue. Native text is extracted first; only selected scanned pages or embedded raster parts are eligible for OCR. English, Hindi and eng_hin use the shared identifiers. Source SHA, security verdict, actor/owner access, lease, cancellation and current job are checked before publishing. Low confidence, tables/columns and ambiguity remain human validation.

## Acceptance and evidence

Adapter tests exercise scanned-page selection, confidence 0.42, mixed language, cancellation and no OCR for native/unsafe content. Worker tests use real native TXT extraction and mocked OCR failures to verify redaction, lease loss, supersession and previous-run preservation. Regular shared real-engine/render/pipeline tests pass; no live customer document or live scan was used.

The [Phase 4 checkpoint](phase-04-checkpoint.md) records exact regression/build and browser verification. Original prompts/order/source hash are unchanged in `roadmap.json`. All new persistence uses authenticated tenant/project scope. No live database migration, production malware scan, external message, licensed converter, EPUBCheck/Ace result or native screen-reader result is claimed.
