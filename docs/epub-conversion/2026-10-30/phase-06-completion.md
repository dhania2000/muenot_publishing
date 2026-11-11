# Phase 6 — source preflight, content analysis and correction review

Date: 2026-10-30. Original global tasks 76–90. Fifteen bounded capabilities implemented. An extracted/corrected source model is not a converted, validated or production-ready EPUB.

| Task | Evidence | Checkpoint |
| --- | --- | --- |
| P6-T01 | [technical-source-readiness](P6-T01-technical-source-readiness.md) | Bounded implementation complete |
| P6-T02 | [corruption-and-dependency-diagnostics](P6-T02-corruption-and-dependency-diagnostics.md) | Bounded implementation complete |
| P6-T03 | [page-text-and-scan-routing](P6-T03-page-text-and-scan-routing.md) | Bounded implementation complete |
| P6-T04 | [multilingual-ocr-and-exceptions](P6-T04-multilingual-ocr-and-exceptions.md) | Bounded implementation complete |
| P6-T05 | [page-zones-and-audit-overlay](P6-T05-page-zones-and-audit-overlay.md) | Bounded implementation complete |
| P6-T06 | [reading-order-candidates-and-review](P6-T06-reading-order-candidates-and-review.md) | Bounded implementation complete |
| P6-T07 | [heading-tree-and-outline](P6-T07-heading-tree-and-outline.md) | Bounded implementation complete |
| P6-T08 | [table-list-and-callout-analysis](P6-T08-table-list-and-callout-analysis.md) | Bounded implementation complete |
| P6-T09 | [figures-and-caption-provenance](P6-T09-figures-and-caption-provenance.md) | Bounded implementation complete |
| P6-T10 | [notes-and-reference-graph](P6-T10-notes-and-reference-graph.md) | Bounded implementation complete |
| P6-T11 | [stem-source-routing](P6-T11-stem-source-routing.md) | Bounded implementation complete |
| P6-T12 | [language-direction-and-font-review](P6-T12-language-direction-and-font-review.md) | Bounded implementation complete |
| P6-T13 | [optional-source-grounded-ai-hints](P6-T13-optional-source-grounded-ai-hints.md) | Bounded implementation complete |
| P6-T14 | [assigned-correction-queue-and-versions](P6-T14-assigned-correction-queue-and-versions.md) | Bounded implementation complete |
| P6-T15 | [client-readable-preflight-and-route](P6-T15-client-readable-preflight-and-route.md) | Bounded implementation complete |

## Reuse map and contracts

The existing Sources panel, private security-cleared source storage, input request/worker, shared project assignments/worklist and project events are extended. There is no second converter, source upload service, dashboard, job queue or generic review pipeline. Existing metadata preflight still truthfully reports the absent EPUB converter and independent client-rule gates. Input worker telemetry remains the extraction stage; its immutable full result now includes versioned `contentAnalysis`. Current source review recomputes recommendations against the saved current plan, rather than approving an obsolete route.

`InputOptions.preflight` is optional/backward compatible: bounded page count, OCR confidence priority, geometry review and <=50 evidence-backed same-project PDF page overrides. Policy defaults never skip OCR human correction. Source adapter schema/source manifest hashes, exact security status and existing safe parsing limits remain unchanged. Preserved source order and suggested geometric order are distinct. Script/heading/caption/footnote/column observations are candidates unless explicitly source-structured or human reviewed; font coverage and language recognition are not inferred from script alone.

The existing `/api/conversion/epub/projects/[projectId]/inputs` route gains mutually exclusive `analysis=<requestId>` and `review=<requestId>` read modes plus authenticated, same-origin, rate-limited PATCH. Correction body includes current project revision, request UUID, source-model SHA, expected review version, one typed correction/assessment and meaningful source comparison evidence. The PATCH body is capped at 96 KiB to accommodate bounded Unicode correction text. Existing inspection POST keeps its 16 KiB options limit. Reviewed-model download is private/no-store/nosniff with a sandbox attachment; original inspection download stays immutable.

One additive `conversion_input_reviews` table persists <=200 append-only versions per original source request, each <=8 MiB. It binds tenant/project/request, original result SHA, parent SHA, current model/action hashes, reviewer and time. Contiguous version/hash chain and latest model/action integrity are checked. History fetches bounded metadata/actions and loads only the latest model, avoiding 200 full snapshots in memory; client history summaries omit repeated correction values. The mirror migration is `database/migrations/2026-10-30-epub-phase06-content-reviews.sql`; no live migration was applied.

Review mutations hold the existing project/request lock and require current project/source/security authority, active actor and owner, held state and compare-and-set version/SHA. A read-only owner can view authorized reports but cannot mutate production review evidence. Corrections preserve original bytes/locators, previous text/order and immutable baseline. Parent searchable aggregates/statistics refresh after leaf corrections, while ordered children stay authoritative. Long leaf previews are labelled and cannot silently replace an unseen >16,000-character block. Content edits invalidate earlier human sign-offs. Missing/corrupt/unsafe bytes and unsuccessful automated schema checks require a supported repair/re-import; a manual observation cannot override those findings. Production readiness/release remains false even when all current source observations are recorded.

## Optional AI and privacy

No hint runs automatically. Required deployment switches are `EPUB_PREFLIGHT_AI_ENABLED=true`, `EPUB_PREFLIGHT_AI_PRIVACY_APPROVED=true` and `AI_ALLOW_SENSITIVE_DATA=true`, with ordinary AI enablement, file-analysis/content policy, model access, provider and credit availability also required. All default off for this source-transmission path. The global standalone AI settings now expose the explicit source-data policy switch; they do not silently allow sensitive data.

The reviewer sees and consents to the selected file name and first 800 source characters; source selection is fixed while consent/draft is active. Server resolves the selected non-editorial leaf under current authority. At most five excerpts/4,000 characters are supported by the contract; the current UI selects one. Obvious email/phone contact strings are removed before transmission. No complete source file, original blob or editorial comment is attached. Existing approved catalog/provider/outbound guard and reservation/ledger are reused, with a 30-second bound, 1,000 output tokens, no retries/fallback, one in-process hint at a time and a stable reservation request key. A completed generation is metered even if its JSON is rejected; failed pre-generation execution releases its reservation. Actual remote usage/settlement is an operational dependency, not a test result here.

Provider output must be a bounded strict typed classification of an existing selected source/node and contain a literal observed quote. Grounding is checked against both the redacted transmitted excerpt and original selected text. Stored proposals contain source references/evidence hashes, reported uncalibrated confidence, model/provider, consent and prompt version/hash; no full prompt or source quote is copied to AI history. Model text cannot overwrite source or approve itself. The proposal publish step rechecks project/model/security context after the external call; stale/revoked/cancelled work cannot publish. Persistence is within the existing private publication record, with provider privacy approval required separately; no provider retention guarantee is fabricated.

## Executed verification

- Full regression: **1,812 passed, 0 failed, 4 opt-in skipped; 184 passing test files and 4 skipped files (188 total)**.
- New analyzer/review fixtures cover headings/outline, table headers/merges/list/callout relationships, figures/captions, scoped internal/note/cross-source targets, STEM source notation, mixed Hindi/English/RTL codepoints, inherited direction and Unicode exceptions, source-order overlays, exact full-order permutations, original-text preservation and sign-off invalidation.
- A real mixed native/scanned PDF is generated and run through the actual local parser/renderer/Tesseract path. Native page is not OCRed, scanned page yields real text with source page/profile/confidence. Existing English/Hindi/bilingual OCR pipeline regression also runs; opt-in live MySQL suites remain skipped.
- SQL-model fixtures execute actual versioned correction and proposal state functions, source/security/revision/actor/owner gates, concurrent version conflict, immutable original result, hash-chain/model tamper detection, audit rollback, private exports and source change during a mocked AI call. The model is a controlled fixture, not a live MySQL deployment.
- Mocked-provider fixtures verify no transmission/reservation without consent/privacy/policy, bounded scope/contact redaction, allowed model enforcement, fabricated quote rejection, human-only low-confidence hints, failed-provider reservation release and actual-computation settlement path. No real provider request, customer data transmission or charge was made.
- A component-callback harness verifies the actual save request resolves duplicate source identities to the correct source/node and retains its base version/SHA; this is not a browser DOM interaction. The form submission token issue discovered by that check was corrected before push. Actual React component server rendering verifies escaped untrusted source labels, staff versus read-only controls and no retained source display after failed authorization/security refresh. This verifies rendering boundaries, not browser events, keyboard operation, screen readers or pixel layout.
- TypeScript, webpack production build and standalone preparation pass on local Node 24.22.1. Hosting Node 22 was not exercised locally. Reused standalone XSD worker smoke verifies real passed/failed supplied-schema results from the deployment package.

Interactive browser verification remained unavailable because an earlier temporary preview diagnostic popup blocked browser control. No new interactive/native-AT/overlay pixel-alignment pass is claimed. Page-zone graphics are labelled schematics with equivalent textual lists. The existing Phase 2 native-AT/UI-state partial checkpoint remains open. No preview server or live service deployment was started in this phase.

## Scope and next work

Native proprietary DTP/Office tools, advanced layout/handwriting recognition, RTL OCR packs, actual font glyph coverage, reader shaping/rendering, standards/AT output checks and EPUB conversion remain explicit unavailable/manual/downstream work. These are not converted into successful findings by a checkbox or AI classification. Client guidelines remain optional; if supplied, approved current guideline rules/output checks stay independent and mandatory constraints are not waived by source review.

Roadmap total: **88 complete (15 specification, 73 implementation), 2 verification partial, 210 pending**. P2-T15 native AT/remaining UI-state verification and P4-T15 real no-guideline conversion acceptance remain partial. All original 300 IDs/titles/prompts/order and source document hash are unchanged. Continue automatically to Phase 7 under the user's phase delivery instruction.
