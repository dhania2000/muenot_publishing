# Task 9: LaTeX and presentation MathML

Added deterministic validation of an existing Task 8 candidate, with safe presentation MathML and a contextual source/preview inspector. Recognition and validation remain distinct versioned evidence. No mathematical source-match proof, solving, native document insertion or automatic approval is performed.

## Parser and rendering

No math parser was installed. KaTeX 0.19.1 (MIT) is now pinned. Both npm and existing pnpm dependency locks include the dependency. This integration uses its real parser and MathML renderer, not an OCR replacement. The [official options](https://katex.org/docs/options) and [security guidance](https://katex.org/docs/security) informed the limits: trust is false, errors throw, macro expansion is bounded to 500, maximum size is 10, and each expression gets a fresh empty macro dictionary. Persistent macros and user macro definitions are forbidden. HTML, URL/image, input/output and package-loading commands are rejected before parsing. Unrecognized macros return unsupported status. Parser errors are stored as plain text, with original source positions where available.

The shared validator bounds input to 4,000 characters, group depth to 32 and commands to 700. It rejects broken Unicode/control characters, unmatched groups/environments, simple inconsistent matrix columns, empty fraction/root operands and detectable trailing operators. The real parser checks remaining supported syntax, super/subscripts, matrices and alignment. Simple delimiter mismatch, confusable characters and Unicode font coverage are review warnings. These checks do not establish mathematical correctness or semantic equivalence.

Matching outer math delimiters are explicitly identified and removed only for parser input; the original/selected candidate is preserved exactly. No malformed formula is silently repaired.

The renderer produces presentation MathML. Its markup is parsed with the existing fast-xml-parser and rebuilt using an explicit MathML element/attribute allowlist, escaped text, node/size/depth limits, and no HTML/SVG/URL/style/event attributes. DTDs and processing instructions are rejected. Conversion can fail independently of successful syntax parsing. Native browser MathML is shown in a sandboxed document with a `default-src 'none'` policy. Raw OCR and parser error strings never enter that markup document.

## Status and persistence

Every validation records original candidate, selected LaTeX, parser input/delimiter handling, separate syntax/render/MathML outcomes, generated presentation MathML, parser version/policy, timestamp, warnings, source evidence ID and review reference. Human verification and source-match verification remain false. Content MathML is not generated.

The same `alt_text_accessibility_evidence` table gains the `math_validation` evidence kind. No new version table or queue is created. The input snapshot references the original recognition analysis, asset/occurrence and region/source coordinates. The source is checked again under the existing asset transaction lock. An identical candidate/parser/policy reuses its saved validation. New parser/policy results append versions; OCR evidence is never updated or deleted.

`POST /api/alt-text/assets/[id]/math/validation` only accepts an authorized saved evidence ID and occurrence ID. It refuses client-supplied replacement LaTeX, foreign evidence, incomplete recognition and image update-scope failures. Validation is local and independent of whether the recognition runtime is currently provisioned. GET math evidence includes its corresponding saved validation. These representations can serve as explicitly unverified evidence in Task 17.

The existing image drawer and document image inspector show source crop and contextual Source / Preview / MathML / Warnings views. Copy actions use persisted source/MathML. The crop preview now uses original pixel aspect ratio. The output capability registry exposes LaTeX and MathML representations; automatic formula verification remains unavailable.

## Verification and limitations

- 47 focused tests pass: real parsing/conversion, nested fractions, roots, matrices, integrals, sums, multiline alignment, Greek, super/subscripts, English/Hindi text, malformed input, unsupported/unsafe commands, Unicode and markup boundaries, permissions and version preservation.
- TypeScript passes. Production webpack build and standalone preparation pass.
- Broad Alt Text suite: 619 pass, 12 pre-existing failures, 3 skipped (634 total). The skipped checks include environment-dependent runtime/database checks. No new broad failures appeared.
- Existing pnpm lock updated with pnpm 10.34.9; KaTeX and its commander dependency are the only new dependency entries there.
- No live tenant MySQL or authenticated end-to-end environment was available, so actual database concurrency and complete browser authorization remain unverified. A local synthetic browser preview could not be reached; visual verification is not claimed.

KaTeX supports a bounded TeX subset. Unsupported packages/macros, deep/oversized expressions and output outside the MathML allowlist fail explicitly. Hindi text is preserved with font-coverage warnings; this is not Hindi mathematical speech generation. Matrix/alignment parsing and presentation layout do not prove a correct transcription. Task 8's low measured recognition quality remains unchanged.

Task 10 must preserve raw recognition and validation versions, store reviewer corrections separately with optimistic concurrency, revalidate corrected equations, and keep evidence review separate from final Alt Text approval.
