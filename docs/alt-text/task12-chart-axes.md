# Task 12: chart axes, labels, legends and scale evidence

Added a local interpreter for saved chart structure and reviewer-verified OCR. It uses Task 11's chart/region/version references, Task 10 correction history, the same evidence table and advanced-analysis queue. It does not call a paid provider, reconstruct numerical series or approve a dataset.

## Source and label provenance

Only the latest review for a source is considered, and only reviewer-verified image OCR is used as label text. Asset, occurrence, original-byte checksum, dimensions and known orientation must match the chart. Labels preserve OCR ID/version, original OCR region ID, review ID/version, source reference, exact text and coordinate basis.

Unchanged reviewed text can reuse actual stored-pixel OCR line/word boxes. Changed block text cannot inherit old token coordinates. A corrected single label can use its existing label-region box as an explicit estimate; otherwise it is unmapped and cannot fit ticks. Whole-image OCR is restricted to actual positioned labels inside the selected chart or its explicitly associated title/caption regions. Other panels/documents are excluded. Input is bounded to the latest 40 compatible review sources, 256 KB per source snapshot, and 1,000 adapted labels.

## Axes and scales

Only existing Task 11 axis references are interpreted. Horizontal/vertical orientation and left/right Y-axis roles use estimated region geometry. Incomplete or absent axes remain unknown; invisible axes and zero baselines are never created. Plot references and candidate centerline intersections are retained in declared coordinate systems. Gridline detection and visual broken-axis-mark recognition are unsupported and reported as unknown.

The bounded scalar interpreter supports signed decimals, explicit scientific notation and superscript powers of ten, percentages, ISO calendar dates, clock times, Devanagari digits and printed units including Hindi combining marks. It preserves raw strings. Ambiguous commas/slash dates, confusable adjacent O/0 or l/1, malformed/overflow/underflow notation and non-finite values stay unknown. Clock labels do not infer a calendar date or midnight rollover. Unit strings are not translated or silently converted.

Three or more reviewed positioned ticks are needed for a numeric model. Ordering, duplicate positions/values, monotonicity, unit consistency and residuals are checked. Linear and base-10 logarithmic candidates are compared; unsupported or ambiguous spacing stays unknown. Date/time and categorical ordering remain distinct. Reversed axes and observed non-zero ranges are preserved. Model bounds stop at the observed ticks.

All fitted models remain candidates: `usableForPixelExtraction` is false. Reviewed text does not establish pixel-verified label anchors or plot calibration. The stored normalized fit residual measures consistency of those input ticks, not OCR accuracy or chart digitization error. Task 13 must not treat these candidates as automatically verified transforms.

## Legends and contextual roles

Reviewed chart-title, caption, axis-title, tick, legend and annotation references remain separate. Subtitle/footnote roles are unclassified, represented as null. Legend text is preserved without guessing color, marker pattern or series association. Similar colors never establish a match. Multiple axes keep their own units; series-to-axis relationships remain uncertain.

## Persistence, settings and inspector

`chart_axes` versions use the existing accessibility evidence table and durable advanced-analysis job. Each version references its exact parent chart evidence/version, source checksum, reviewed-label snapshot, local interpreter version and option flags. Workers recheck active user/record scopes, parent/source identity, current settings and review versions. Changed inputs require a new request. Existing source and manual correction records are never overwritten. The original Task 11 request fingerprint remains compatible.

The local `chart_axes` capability separately gates axis-label, scale, legend and data-label settings, allowing saved evidence to be interpreted even when a paid vision model is unavailable. Deployment's advanced-analysis disable flag still overrides it. Local dispatch bypasses model selection, metering and vision.

`GET/POST /api/alt-text/assets/[id]/charts/[chartId]/axes` enforces existing session/module/history/update scopes, scoped parent lookup, bounded bodies and rate limits. Reads only return saved results. Explicit mutation queues local work through the existing worker.

The existing chart inspector has a contextual expandable section with one selected axis, estimated axis/legend overlays, reviewed-label snippets, a compact tick table, scale details/warnings and version history. Raw fit/source metadata is under a disclosure. No standalone graph page or long settings form was added.

## Verification

- 71 focused tests pass, including existing advanced-job checks and new local dispatch verification. Cases cover numeric/Unicode notation, linear/log/reversed/non-zero scales, percentages, dates/times, Hindi labels/units, contradictory evidence, missing legends/axes, similar-color non-association, source isolation, changed reviews/parents, permissions and read-only routes.
- All 12 renderer-labelled synthetic scale cases meet their declared expectations. Additional figures include dual axes with similar colors, rotated date labels/missing legend, and Hindi axis text. This tests the interpreter against known labels/positions; it is not an OCR or numerical image-extraction accuracy measurement.
- TypeScript and production webpack/standalone build pass. Broad Alt Text tests: 754 pass, 12 unchanged baseline failures, 3 skipped (769 total).
- The real React inspector was browser-checked with explicitly synthetic reviewed labels/API responses. Loading/tab changes issued zero processing POSTs; explicit local processing produced one synthetic POST. The 40–80 non-zero range and disabled pixel extraction were visible. Screenshot: `outputs/task12-axis-inspector.png`.
- Live MySQL queries/migration behavior, authenticated tenant flows and real OCR label quality remain unverified. Automated tests made no paid provider calls.

Unsupported numeric/unit notations, visually broken axes, unknown geometry, edited multi-label blocks without alignment, unreviewed text and ungrounded legend/series mappings remain flagged. Task 13 can use exact visible labels or genuinely linked native chart data, while image estimates require separately validated calibration and mark coordinates.
