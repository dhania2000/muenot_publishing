# Task 24 — Reviewed document output compatibility

Date: 2026-10-29. Branch: `feat/phase3-task08-math-ocr`.

The existing DOCX and PPTX metadata writers, incremental tagged-PDF remediator, document export service, approval store, Output Validation, secure downloads and History remain the implementation paths. No new writer, extractor, tagger or OCR text layer was introduced.

## Changes

- Export preflight and execution capture metadata from the exact approved asset version and document occurrence. View and Export scope are checked against each eligible image. Changed approval IDs, version numbers, source locators or permissions invalidate eligibility. The export's before/after snapshot now includes the bounded evidence fingerprint.
- Stored output reports retain document/occurrence/asset identity, native source locator, approved version ID/number, source hash, generation analysis references/versions, scoped region references and saved advanced-QA metadata. At most 12 references per occurrence and 1,000 per export are retained, with explicit omissions. SQL reads are chunked by 100; exports retain the existing 5,000-occurrence limit. No raw recognition text, MathML, provider response or long description is copied into this metadata.
- Generation provenance must name the same occurrence; reuse of the same binary in another context does not inherit it. Region references are resolved against tenant, asset, occurrence, evidence kind and exact analysis version rather than trusting a claimed region.
- Saved QA is explicitly historical: its freshness is not recomputed during export. Missing/different-version QA and recorded blockers remain visible warnings; they do not masquerade as fresh checks or retrospectively invalidate all legacy approvals. Existing strict/approved-only approval gates still select native insertions.
- Native picture/Figure fields receive only the exact approved Short Alt Text. Detailed descriptions, OCR, mathematical syntax/Presentation MathML, chart values and scientific review corrections remain in ERP. Export does not invent or approve evidence.
- Output Validation now uses the locator saved with the export rather than silently substituting a changed current mapping. It binds the saved version to the saved asset, reports mapping drift and distinguishes incomplete legacy provenance. Rule version is `task24.v1`. Recorded QA/manual evidence checks do not inflate the automated pass rate.
- Existing Export and Document History inspectors expose a collapsed, paginated approved-version/evidence panel through the existing document-owner and Export gates. Responses explicitly project metadata and exclude private storage keys. Reads trigger no analyzer, provider, billing or new QA run.

## Compatibility verification

| Format | Verified locally | Limits |
| --- | --- | --- |
| DOCX | Existing synthetic inline/floating, table, header/footer, Unicode, source-alt preservation and unchanged-media/part regressions continue to pass. ZIP fixtures now contain actual CRC32 values. | Live DOCX extraction/context remains unsupported; this task does not add extraction. Native Microsoft Word rendering was not run. |
| PPTX | New real package fixture reuses one media part in ordinary/grouped pictures. Only the selected occurrence changes; Hindi survives re-reading. Existing descriptions, group mapping, notes/theme bytes and unrelated ZIP entries remain unchanged. Missing targets do not redirect to another picture. | No native PowerPoint visual/animation playback verification. Native charts, SmartArt and master remediation remain outside scope. |
| PDF | New two-page tagged fixture with shared XObject, distinct Figures, MCIDs and ParentTree. Exact approved Figure receives Hindi `/Alt`; output reopens and preserves original bytes as the incremental prefix. ParentTree identity and occurrence locators remain unchanged. Untagged content is refused. | No general tagging, scanned-page-to-Figure conversion, OCR text layer, decorative retagging or PDF/UA certification. Reading order is preserved but not assessed. |

## Tests and operational limits

23 new tests cover metadata privacy/bounds, exact occurrence/version and action scopes, mismatched reference regions, absent/stale QA, rejected-description exclusion, historical locator/version validation, paginated API authorization and native PPTX/PDF compatibility. The complete previous suite plus the first 20 new tests passed: 1,295 passed, 0 failed, 3 skipped; the final three historical-validation tests also passed separately. TypeScript and the final Next.js production webpack build/standalone preparation passed.

SQL behavior is tested at mocked query boundaries; no live MySQL migration/tenant session was available. No paid-provider request, native Office validation, Hostinger build or production deployment was performed. These are operational verification dependencies for Task 25, not successful checks.

Next: the user's explicit Settings capability/status audit, followed by Task 25's final verification and production-readiness assessment.
