# Task 11: graph and chart structure

Implemented explicit chart-crop analysis in the existing image/document inspectors. It reuses the tenant's authorized vision provider, image regions, private image access, OCR/corrections, existing credit metering and durable jobs. No chart dataset, numerical point values, axis calibration, statistical conclusions or description generation are implemented in this task.

## Taxonomy and evidence

The strict schema supports line, horizontal bar, column, grouped/stacked/100%-stacked bar, pie, doughnut, scatter, bubble, area, histogram, box-and-whisker, heatmap, waterfall, time series, multi-axis and combination charts, plus unknown. This is an accepted recognition taxonomy, not a measured accuracy guarantee for every family. Unknown is retained for ambiguous or unsupported evidence. Meaningful horizontal/vertical/inset subtype hints remain unverified.

Results contain the original asset/occurrence, chart/parent/region-analysis IDs, source crop and checksum, chart family, existing plot/title/axis/legend/label region references, approximate visible-series count and controlled line/marker/bar/grouping/appearance/uncertainty-bar hints. Complexity retains Task 3/4's existing level and separate visual complexity hints. The method is `governed_vision_crop`; actual catalog model/provider references are stored. Every result requires review, declares no verified source match, and declares no numerical extraction.

The parser rejects unknown fields, numeric datasets, invented labels/conclusions, arbitrary confidence, invalid region references and unbounded series hints. References must have the correct existing region type. It does not prove that a model-selected chart family or series hint is visually correct.

## Existing services reused

- Task 4's existing `graph_region` is required; a whole slide, photograph or scientific-diagram region is not silently promoted to a graph.
- Source dimensions/orientation, current analysis and normalized bounds must match private stored bytes. The independent white PNG crop is bounded to 4 megapixels/5 MB; original bytes remain unchanged. This bounded crop helper is also reused by math OCR.
- Each chart is processed individually. Nested graph identity is retained while a nested graph's internal plot is excluded from its parent's references. Associated captions/titles can be supplied as explicit outside-crop references; they remain uncertain associations.
- Only OCR for the same occurrence and associated chart regions is supplied. Full-image OCR and sibling charts' text are excluded. Reviewer corrections carry their review state and their own source/version IDs. Supporting text is bounded to 12,000 characters without rewriting stored OCR.
- The existing vision transport was factored into `analyzeVisionEvidence`; region detection still uses the same transport and parser. Tenant governance selects the model. No new provider, account, paid SDK or classifier module was introduced.

## Jobs, credits and persistence

The existing `platform_background_jobs` queue gains `alt_text.advanced_analysis`, initially supporting chart structure. It shares the heavy-work cap with PDF/math OCR. The same accessibility evidence table gains `chart_structure` versions; there are no per-chart-family tables or duplicate image assets. The queue payload is an evidence ID, with the source/region/OCR/model snapshot in private evidence storage.

Submission checks update scope, occurrence ownership, chart settings and governed model availability. Execution rechecks active tenant user, current view/update scopes, settings/model, source checksum/frame and OCR/review snapshot before any provider call. Changed evidence requires a fresh submission. Request identity conflicts fail; compatible active work coalesces; completed evidence can be reused unless explicitly reprocessed. Writes require the current unexpired worker lease. Cancellation, retry and terminal lease recovery reuse the existing queue.

Chart requests use the existing reserve/call/settle credit path with operation `chart<evidenceId>`. A received provider result is checkpointed before final assembly, so interrupted assembly can resume without a second provider call. If the ledger reports a billed delivery but no result receipt was persisted, the row becomes `needs_reconciliation`; it never automatically contacts the provider again for that delivery. The small gap between the existing metering wrapper's settlement and receipt persistence still needs administrator reconciliation on failure. Existing metering's 11 baseline test failures remain unchanged; a real tenant billing flow was not available for validation.

## Inspector and settings

The existing asset drawer and document image details show one selected chart, an estimated crop and referenced plot overlay, chart type, series/complexity hints, structural IDs, model reference and warnings. Loading saved evidence never runs vision. An explicit confirmation explains that the authorized provider may use AI credits. Graph detection and chart-type detection settings must both be enabled. `ALT_TEXT_ADVANCED_DISABLED=1` overrides chart availability.

`GET/POST /api/alt-text/assets/[id]/charts` uses existing module/session/history gates, update scope, body/rate limits and private responses. No standalone graph page or settings form was added.

## Verification and limitations

- 51 focused checks pass, including six existing math crop/job regression checks. New checks cover strict taxonomy/data exclusion, actual synthetic image decoding/cropping, original-byte preservation, nested/sibling region separation, OCR isolation, tenant/scope checks, stale sources/leases, metering replay/reconciliation, cancellation, persistence and route read-only behavior.
- 24 labelled synthetic image fixtures cover the taxonomy, multi-panel/mixed contexts, a scientific-diagram negative, incomplete axes and low resolution. Model responses are controlled in automated tests; no paid AI request ran. Recognition accuracy is unmeasured and is not inferred from parser tests.
- Photograph/scientific-region denial is covered at the existing region eligibility boundary. A public-domain photograph fixture download from the US Fish and Wildlife Service was attempted but the image server returned access denied; a photographic pixel-classification benchmark is therefore not claimed.
- TypeScript and production webpack/standalone build pass. Broad Alt Text tests: 690 pass, 12 unchanged baseline failures, 3 skipped (705 total).
- The actual React inspector was browser-checked with a labelled synthetic API fixture: mount performed zero POSTs, explicit confirmation produced one synthetic POST, and the chart/warnings rendered. This verifies UI behavior, not an authenticated tenant/database/provider flow. Screenshot: `outputs/task11-chart-inspector.png`.
- Live MySQL transaction execution/races, authenticated end-to-end authorization, actual provider quality/latency and deployment-host limits remain unverified.

Task 12 should consume these exact chart/region/version references and separately identified OCR evidence to interpret axes, labels, legends and scales. It must preserve unknown scales and avoid fabricating missing units or calibrated data.
