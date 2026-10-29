# P1-T07 Source to output conversion matrix

Version 1.0 · 29 October 2026 · depends on P1-T06 · documentation only.

Every route below is a proposed adapter. No source currently produces an EPUB in this repository. Existing Alt Text extraction supplies image/context evidence, not a complete manuscript transformer. Reflowable 3.3 is the preferred target; fixed layout and reverse outputs require their own gates.

| Requirement | Input | Existing evidence and reuse | Proposed adapter/engine and output | OCR, fidelity, dependency and fallback |
| --- | --- | --- | --- | --- |
| SRC-01 | DOCX | `lib/alt-text/docx-context.ts`; `docx-locator.ts`; `ooxml-zip-rewrite.ts` | New full WordprocessingML structure/style/notes adapter → semantic model → reflowable EPUB | OCR only embedded scans; exact pagination not promised. Preserve relationships, OMML and tracked-change decisions; unresolved constructs require editor review. Existing DOCX image extraction is unsupported |
| SRC-02 | Text PDF | `lib/alt-text/pdf-extractor.ts`; `pdf-context.ts`; `pdf-page-renderer.ts`; pdfjs-dist/pdf-lib in package.json | New full text/order/font/figure adapter → reviewed model or fixed pages | Layout heuristics are lossy; detect columns, headers, notes and tables. Reviewer approves order; offer manual structuring or fixed companion |
| SRC-03 | Scanned PDF/images | `pdf-page-ocr-pipeline.ts`; `ocr-engine.ts`; `ocr-review-store.ts` | OCR evidence → corrected text and page/region mapping → model | OCR required; English/Hindi packs exist. Other languages require provisioned packs and fixtures. Low-confidence text/math held; retain source images and manual transcription fallback |
| SRC-04 | HTML/XHTML | fast-xml-parser dependency; `document-validation.ts` has bounded XML patterns | New inert, allowlisted HTML/XHTML parser and sanitizer → reflowable model | No script/network execution; reject unsafe URLs. Preserve headings, anchors, language, tables; report CSS/layout loss. Global upload helper currently blocks HTML |
| SRC-05 | XML/JATS/BITS/TEI/DITA/DocBook | `lib/conversion-modules.ts` registers XML only; no transformation engine | Per-dialect schema/catalogue and reviewed transform → normalized model | No external entities or remote schema fetch. Map notes, figures, citations and tables explicitly. Missing dialect/profile holds source; no universal XML promise |
| SRC-06 | LaTeX | `lib/alt-text/math-validation.ts`; katex dependency are limited equation helpers | New sandboxed document parser/approved TeX toolchain → model and accessible math | Untrusted TeX must not get shell escape/network. Full document engine and font/tool licensing pending; manual structured-source replacement fallback |
| SRC-07 | IDML | No IDML parser/Adobe runtime in package.json | New bounded IDML archive/story/style adapter → fixed or reflowable model | Proprietary application rendering requires authorized installation/entitlement. Text order and overset text reviewed; request lawful PDF/structured export if unavailable |
| SRC-08 | EPUB 2/3 | Existing ZIP/XML safety patterns only | New OCF reader → inventory, inspect/repair/normalize → profile-aware EPUB | No OCR for live text; preserve original and detect encrypted content. No DRM bypass; request unlocked authorized source |
| SRC-09 | Audio/video/SMIL, images, fonts | `lib/storage/index.ts`; `document-upload-contract.ts`; image MIME helpers | New media inventory/transcode-if-supported adapter and synchronized overlay builder | Codec/font redistribution rights, transcripts, captions and timing review required. Unsupported media becomes explicit static/transcript alternative or blocks contracted output |

The underlying storage facade is reused; each adapter needs its own format-specific validation before storage/processing. `lib/settings/uploads.ts` must not be weakened globally to admit active source content. Enforce expanded-byte, XML, resource-count and time budgets inside the adapter.

## Reverse output and repair boundaries

| ID | Proposed route | Technical path | Loss and acceptance gate |
| --- | --- | --- | --- |
| SRC-10 | EPUB → HTML/XHTML/text | EPUB reader → semantic model → separate serializers | Retain navigation/anchor mapping; identify omitted media and layout; reject unsafe active content |
| SRC-11 | EPUB → DOCX/PDF | Model → explicitly provisioned document renderer | No existing Alt Text inserter is a whole-book renderer. Page/style/notes/math comparison and licensed tool checks required |
| SRC-12 | EPUB → retailer/proprietary ebook | Authorized converter and selected distributor profile | Unavailable until entitlement, toolchain and test delivery exist; deliver ordinary EPUB or hold |
| SRC-13 | EPUB repair/migration | Original inventory → explicit repair operations → immutable output | No silent deletion to obtain a validator pass; retain source/output diff, issue references and reviewed losses |

## Verification and dependency record

For every adapter, design one minimal valid source, one rich semantic source, one malformed/archive-abuse source and one unsupported-feature case. Assert exact source-node provenance, preserved text/notation, bounded failure, typed losses and no external fetch. Test expected output with version/layout fixtures from P1-T05/P1-T06. These fixtures are acceptance requirements, not completed engine tests.

The matrix provides technical paths, tool/rights conditions and alternatives for all requested inputs and reverse outputs. Specification acceptance is met. Implementation depends on Phases 3–6 intake/ingestion, Phase 9 packaging and Phase 17 reverse conversion, followed by Phase 18 QA. No dependency was installed and no runtime changed. Change log: separated actual parsing helpers from future whole-publication adapters.
