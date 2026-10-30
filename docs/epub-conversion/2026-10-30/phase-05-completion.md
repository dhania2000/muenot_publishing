# Phase 5 — source adapters and normalized content

Date: 2026-10-30. Original global tasks 61–75. All fifteen bounded import deliverables are implemented; this is not completion of the later EPUB conversion engine.

| Task | Evidence | Checkpoint |
| --- | --- | --- |
| P5-T01 | [office-document-adapters](P5-T01-office-document-adapters.md) | Bounded implementation complete |
| P5-T02 | [born-digital-pdf-input](P5-T02-born-digital-pdf-input.md) | Bounded implementation complete |
| P5-T03 | [scanned-pdf-local-ocr](P5-T03-scanned-pdf-local-ocr.md) | Bounded implementation complete |
| P5-T04 | [idml-stories-assets-and-styles](P5-T04-idml-stories-assets-and-styles.md) | Bounded implementation complete |
| P5-T05 | [proprietary-dtp-export-contract](P5-T05-proprietary-dtp-export-contract.md) | Bounded implementation complete |
| P5-T06 | [html-xhtml-css-normalization](P5-T06-html-xhtml-css-normalization.md) | Bounded implementation complete |
| P5-T07 | [scholarly-xml-adapters](P5-T07-scholarly-xml-adapters.md) | Bounded implementation complete |
| P5-T08 | [tei-dita-custom-xml-schema](P5-T08-tei-dita-custom-xml-schema.md) | Bounded implementation complete |
| P5-T09 | [tex-markdown-text-content](P5-T09-tex-markdown-text-content.md) | Bounded implementation complete |
| P5-T10 | [powerpoint-source-import](P5-T10-powerpoint-source-import.md) | Bounded implementation complete |
| P5-T11 | [selected-spreadsheet-and-csv-tables](P5-T11-selected-spreadsheet-and-csv-tables.md) | Bounded implementation complete |
| P5-T12 | [raster-svg-and-tiff-input](P5-T12-raster-svg-and-tiff-input.md) | Bounded implementation complete |
| P5-T13 | [existing-epub-safe-ingestion](P5-T13-existing-epub-safe-ingestion.md) | Bounded implementation complete |
| P5-T14 | [media-and-synchronization-assets](P5-T14-media-and-synchronization-assets.md) | Bounded implementation complete |
| P5-T15 | [unified-input-model-and-reports](P5-T15-unified-input-model-and-reports.md) | Bounded implementation complete |

## Runtime integration

The existing EPUB planner and project workspace gain supported source classifications and a Sources panel. Original source storage, quota/resumable intake, project ACL/revisions/events and durable background jobs are reused. `epub.input_normalization` carries only `{requestId}`; immutable options/source identities are resolved from one additive domain table, `conversion_input_requests`. Its DDL and `database/migrations/2026-10-30-epub-phase05-inputs.sql` match. No live migration was applied.

The queue request is atomic/idempotent, revision-bound and tenant scoped. Input workers require the exact current security-cleared source/checksum/body, active requester and owner, project authority and current lease. They recheck before publishing; revised projects produce historical superseded evidence. Current timeline/dashboard jobs resolve domain references without adding payload source bytes or another job engine. Parsing runs outside SQL transactions; final evidence/audit writes are atomic. Full model JSON is private/hash checked and bounded to 8 MiB; normal views expose bounded summaries. No project is automatically released, converted or charged.

Adapters retain observed semantics/source locators and report uncertainty/loss rather than inventing perfect recovery. Selected spreadsheet cells, reviewer-only comments/notes, missing graphics/fonts, unknown XML, complex TeX macros, source reading order, unsupported codecs and unsupported native formats have explicit outcomes. Same-project supplied assets can resolve a missing relative dependency without retaining a false missing gate. Source XSD files are reference-only content, never publication chapters. XML schema success applies only to the exact supplied schema bytes and cannot establish its publisher/version authority or EPUB conformance.

## Executed verification

- Complete regression: **1,775 passed, 0 failed, 4 opt-in skipped; 180 passing test files, 4 skipped files**. Includes actual shared PDF/OCR regression and the new real scanned-PDF OCR path. New source-adapter, layout, SQL-model, schema, TIFF and media fixtures exercise both successful imports and bounded actionable failures.
- TypeScript, Next.js webpack production build and standalone preparation pass. Standalone local XSD worker smoke verifies one real pass and one real failure from `.next/standalone`. Explicit tracing includes the worker, package metadata and WASM/runtime files; the missing package metadata discovered during packaging verification was corrected before delivery.
- `libxml2-wasm` is the single new dependency, pinned to 0.7.2. Installation audit reported zero vulnerabilities. No native XML addon or external schema service is required. The worker has a fresh minimal environment, bounded stdin/stdout/stderr, hidden process, deadline, heap/WASM limits and denied XML I/O. Worker-thread termination triggered a local V8 fault during development; validation was moved to a separately killable process so a validator failure cannot abort the web server. Real success/failure tests and deployment-package smoke use that final process implementation.
- Browser verification used actual components with explicitly synthetic server/queue responses: default import options, table addition/range editing, security rejection retaining A1:B3 and a successful queued retry were observed. A test-only diagnostic popup then blocked browser control, so report expansion, concurrent-edit UI interaction and the final added XSD/TIFF UI were **not** claimed as interactive browser passes. Source/report APIs, stale revision behavior and schema/TIFF data are covered by executed domain tests and the production build. Temporary preview server was stopped; native screen-reader/mobile/live persistence checks remain unperformed. The retained initial form screenshot is `outputs/epub-phase05-source-form.png` outside Git; it predates the final XSD/TIFF UI additions and is not current-feature certification. Temporary browser tab cleanup was limited by that preview popup.

One numeric cached-formula assertion initially inspected complete model JSON, where a source-dependent node hash could contain the same digits. It now checks cell text, preserving the intended no-cached-value disclosure assertion without a hash-dependent false failure.

## Boundaries and source references

Source import models, immutable receipts, EPUB outputs, installed validators and reader/accessibility verification remain distinct. Source files still need an actual scan verdict; this phase does not install a malware service or mark pending files clean. Licensed native Office/DTP conversion, complex macros, unsupported TIFF/media variants, source typography/color/rendering fidelity and official source schema authority remain explicit supported-export/manual-review requirements. No real email, conversion result, financial charge or customer upload was generated during verification.

The supplied-schema integration follows the maintainer's [validation/disposal guidance](https://jameslan.github.io/libxml2-wasm/dev/documents/Working_with_XmlDocument.html), verified against installed 0.7.2 code and actual results; external providers and schema includes/imports are denied. The TIFF subset uses the field/strip/PackBits structure in Adobe's [TIFF 6.0 specification](https://www.itu.int/itudoc/itu-t/com16/tiff-fx/docs/tiff6.pdf); support is deliberately limited to the tested subset and does not claim complete baseline TIFF conformance.

Overall roadmap: **73 complete (15 specification, 58 implementation), 2 verification partial, 225 pending**. P2-T15 still needs native AT/remaining UI-state verification; P4-T15 still needs the later real no-guideline conversion acceptance. Original 300 IDs/titles/prompts/order and source document hash are unchanged. Continue automatically to Phase 6 preflight and content analysis under the user's phase delivery instruction.
