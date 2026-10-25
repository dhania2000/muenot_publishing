# EPUB Conversion — P1-T03 Format & Compatibility Matrix

| Field | Value |
| --- | --- |
| Project | Muenot Publishing (`service.muenot.co.in`) |
| Module | Publishing Services › Conversion › ePub |
| Roadmap item | Phase 1, Task P1-T03 — EPUB Conversion Service Scope & Boundaries |
| Verified at commit | `f3c4c84` (`main`) |
| Date | 2026-10-25 |
| Nature | **Specification only.** No code, route, API, schema or dependency was changed. |
| Covers | Step 2 (versions), Step 3 (layouts), Step 5 (source formats), Step 10 (reverse conversion and migration), Step 11 (distribution) |

Companion documents: `P1-T03-service-scope-and-boundaries.md` (index and workflow), `P1-T03-publishing-capabilities.md`, `P1-T03-service-boundaries.md`, `P1-T03-requirements-traceability.md`.

**Implementation baseline (verified, see P1-T01 §E):** the repository contains **no EPUB reader, writer, validator or transformer**. Every "Supported" cell below is a **target** capability. Nothing here is available until its requirement reaches status *Existing* with validation evidence.

Scope class codes used in the tables (defined in `P1-T03-service-boundaries.md`): **A** Core · **B** Advanced · **C** Publisher-specific · **D** Integration-dependent · **E** Conditional/experimental · **F** Out of scope/restricted.

Support codes: **Full** (planned production support) · **Partial** (supported with documented loss) · **Read** (import/validation only) · **Cond.** (conditional on integration, draft status or reader) · **No** (not supported; exception route given).

---

## 1. Standards references

| Spec | Publisher / status (verified 2026-10-25) | Role in this service |
| --- | --- | --- |
| EPUB 2.0.1 (OPS, OPF, OCF 2.0.1) | IDPF Recommendation 2010; superseded | Legacy import; controlled legacy export |
| EPUB 3.0 / 3.0.1 (incl. Fixed-Layout Documents, Media Overlays) | IDPF Recommendations 2011 / 2014; superseded | Import, upgrade source |
| EPUB 3.1 | IDPF Recommendation 2017; its changes were **not** carried into 3.2 | Import as a legacy variant; normalise |
| EPUB 3.2 | W3C EPUB 3 Community Group Final Report 2019 | Import; compatibility export |
| EPUB 3.3, EPUB Reading Systems 3.3, EPUB Accessibility 1.1 | W3C Recommendations (May 2023) | **Default production target** |
| EPUB 3.4 | W3C Publishing Maintenance WG, **Candidate Recommendation Draft** (CR 2026-07-21, latest draft 2026-10-22) | Conditional profile only (§2.4) |
| EPUB Multiple-Rendition Publications 1.0 | IDPF specification; very limited reading-system support | Conditional (LAY-05) |
| EPUB Accessibility Techniques 1.1, WCAG 2.2, DPUB-ARIA 1.1, Schema.org a11y vocabulary | W3C | Accessibility scope (`P1-T03-publishing-capabilities.md` §5) |
| SMIL 3.0 (subset defined by EPUB Media Overlays) | W3C | Media Overlays |
| MathML (Core and MathML 3), SVG 1.1/2 subset per EPUB 3.3 | W3C | STEM, illustrations |
| EPUBCheck (W3C/DAISY reference validator, Java) | Open source | Structural validation (needs Java worker, blocker B5) |
| DAISY Ace (Node-based accessibility checker) | Open source | Automated accessibility checks (subset only) |

Rule: a specification feature is **not** the same as reading-system support. Every profile below records the specification requirement and the reader-support caveat separately.

---

## 2. Step 2 — EPUB version compatibility matrix

### 2.1 Import, export and validation

| Req | Version | Import | Export | Validation capability | Scope |
| --- | --- | --- | --- | --- | --- |
| VER-01 | EPUB 2.0 / 2.0.1 | Full (parse OPF 2, NCX, `guide`, OPS XHTML 1.1, DTBook) | — (see VER-02) | EPUBCheck in EPUB 2 mode; internal OCF/OPF structural checks | A |
| VER-02 | EPUB 2.0.1 (legacy output) | — | Partial: controlled legacy profile for retailer/device requirements only | EPUBCheck EPUB 2 mode | C |
| VER-03 | EPUB 3.0 | Full | No direct export (output is upgraded to 3.3) | EPUBCheck (3.x rules); differences reported against 3.3 | A |
| VER-04 | EPUB 3.0.1 | Full (incl. FXL properties) | No direct export (output is 3.3; 3.3 output is generally readable by 3.0.1 reading systems) | same | A |
| VER-05 | EPUB 3.1 | Read + normalise (3.1-only constructs flagged) | No | Validated against current 3.3 rules; 3.1 deviations reported | A |
| VER-06 | EPUB 3.2 | Full | Compatibility: 3.3 output avoids 3.3-only features when the "3.2 compatibility" option is on | EPUBCheck | A |
| VER-07 | **EPUB 3.3** | Full | **Full, default** | EPUBCheck 5.x (3.3 rules) + internal checks + accessibility checks | A |
| VER-08 | EPUB 3.4 | Read when declared by source (unknown features are flagged and kept, not dropped silently) | Cond.: opt-in "3.4 readiness" profile; output must remain **3.3-valid**; 3.4-only features must be listed in the report | Validator support for 3.4 must be verified at implementation time; until then "not verified" | E |
| VER-09 | Legacy / nonconformant EPUB | Read with tolerant parser; damage report | Repaired 3.3 package | Before/after EPUBCheck diff | A |
| VER-10 | Upgrade / migration (2.x/3.0/3.0.1/3.1/3.2 → 3.3) | — | Full | Before/after validation, metadata diff, nav/NCX diff | A |
| VER-11 | Controlled downgrade (3.x → 2.0.1) | — | Partial, with a per-feature **loss report** (§5) | EPUBCheck EPUB 2 mode | C |
| VER-12 | Version detection and reporting | Full: detect from `package@version`, `dcterms:modified`, nav vs NCX, content serialisation | — | Report included in every preflight | A |

### 2.2 Required metadata, packaging and layouts

| Version | Required packaging | Required metadata | Layout capabilities |
| --- | --- | --- | --- |
| 2.0.1 | `mimetype` first, uncompressed (`application/epub+zip`); `META-INF/container.xml`; OPF `version="2.0"`; **NCX mandatory** in spine `toc` | `dc:identifier` (matching `unique-identifier`), `dc:title`, `dc:language` | Reflowable only. No standard fixed layout; vendor extensions (e.g. Apple `com.apple.ibooks.display-options.xml`) are proprietary and treated as class C |
| 3.0 | As above, OPF `version="3.0"`; **navigation document (`nav.xhtml`) mandatory**; NCX optional (legacy reader compatibility) | `dc:identifier`, `dc:title`, `dc:language`, `meta property="dcterms:modified"` | Reflowable; fixed layout through the separate 2012 FXL spec; media overlays; scripting |
| 3.0.1 | Same as 3.0 | Same as 3.0 | `rendition:layout`, `rendition:orientation`, `rendition:spread` integrated into the core specification |
| 3.1 | Same container model | Same as 3.0 (3.1 relaxations are not carried into 3.2/3.3) | As 3.0.1 |
| 3.2 | Same as 3.0 | Same as 3.0 | As 3.0.1. Adds WOFF2/SFNT font core media types |
| 3.3 | Same as 3.0 (package `version="3.0"`) | Same as 3.0, plus accessibility metadata per EPUB Accessibility 1.1 when conformance is claimed | Reflowable, pre-paginated, mixed (per-spine overrides), `rendition:flow`, `page-progression-direction`. WebP is a core image type |
| 3.4 | Must be verified against the final text at implementation time | Same | No 3.4-specific layout is in scope until validator and reader evidence exist |

### 2.3 Accessibility, restrictions, reader compatibility, fallbacks

| Version | Accessibility considerations | Known feature restrictions | Reader compatibility requirement | Fallback strategy | Conversion / migration limitations |
| --- | --- | --- | --- | --- | --- |
| 2.0.1 | No accessibility metadata model; NCX gives a basic TOC only; no semantic inflection | No audio/video, no MathML guarantee, no scripting, no FXL | Legacy devices only | Provide a 3.3 master; 2.0.1 is generated from it, never the reverse | Downgrade loses nav landmarks, page-list semantics, media overlays, `epub:type`, MathML (rasterised with alt text), audio/video (removed with a text note) |
| 3.0 / 3.0.1 | `epub:type` semantics; no formal a11y conformance spec (EPUB Accessibility 1.0 was published in 2017) | `epub:switch`, `epub:trigger` and bindings are **deprecated**; never generated | Reading systems vary widely for FXL, overlays and scripting | Upgrade to 3.3 on import | Deprecated constructs are converted to standard markup or removed with a finding |
| 3.1 | As 3.0.1 | 3.1-specific relaxations may be invalid under 3.3 | Little 3.1-specific support | Normalise to 3.3 | Invalid constructs repaired or reported |
| 3.2 | EPUB Accessibility 1.0 | As 3.0.1 | Broad modern support | Export 3.3 in 3.2-compatible mode | None material |
| 3.3 | **EPUB Accessibility 1.1** (`dcterms:conformsTo` "EPUB Accessibility 1.1 - WCAG 2.x Level A/AA"), Schema.org `accessMode`, `accessModeSufficient`, `accessibilityFeature`, `accessibilityHazard`, `accessibilitySummary` | Scripted content must be declared (`properties="scripted"`) and needs a non-scripted fallback (ADV-08) | Target Apple Books, Google Play Books, Kobo, Thorium, Adobe Digital Editions (current versions); Kindle via KDP ingestion (§6) | Reader-specific features are always optional enhancements | — |
| 3.4 | Must be re-verified | Unknown until final | Assume no reading-system support unless tested | Output stays 3.3-valid | Features cannot be promised |

### 2.4 EPUB 3.4 readiness rules (VER-08)

1. The 3.4 profile is **off by default** and can only be enabled per job by a production user with `configure` permission.
2. Output must pass 3.3 validation. A 3.4 feature that would make the package 3.3-invalid is blocked.
3. Each 3.4-only feature used is listed in the job report as "Candidate Recommendation feature — reading-system support not verified".
4. When 3.4 becomes a W3C Recommendation, a controlled roadmap change (gap register G-04) promotes it to class B after EPUBCheck support and reader tests are recorded.

---

## 3. Step 3 — Layout support

| Req | Layout | Spec mechanism | Selection criteria | Reader support caveat | Expected fidelity | Scope |
| --- | --- | --- | --- | --- | --- | --- |
| LAY-01 | Reflowable | `rendition:layout="reflowable"` (default) | Text-dominant content, accessibility priority, any category that can be expressed semantically | Universal | Content and structure preserved; visual page fidelity **not** preserved by design | A |
| LAY-02 | Fixed layout | `rendition:layout="pre-paginated"` globally + `viewport` meta (XHTML) or `viewBox` (SVG) | Design-led pages where position carries meaning (picture books, comics, magazines) | Strong in Apple Books, Kobo, Google Play Books, Thorium; Kindle needs its own FXL workflow (§6) | Page-accurate within reader rendering limits | B |
| LAY-03 | Pre-paginated per document | `rendition:layout` on individual `itemref` | Same as LAY-02 where only some documents are fixed | As LAY-02 | As LAY-02 | B |
| LAY-04 | Mixed layout | Per-`itemref` reflowable/pre-paginated overrides | Reflowable book with fixed plates/maps/spreads | **Inconsistent**: some readers apply only the global value | Validated; behaviour varies by reader and is documented in the delivery report | E |
| LAY-05 | Multiple renditions | EPUB Multiple-Rendition Publications 1.0 (`container.xml` with multiple `rootfile`s, rendition selection) | Publisher requires one package carrying, e.g., fixed and reflowable versions | **Very limited support**; most readers open only the first rendition | First rendition must be complete on its own. Default alternative: two separate EPUBs | E |
| LAY-06 | Responsive / adaptive styling | CSS media queries, relative units, `max-width` images | All reflowable output | CSS support differs (e.g. limited flex/grid in some readers) | Progressive enhancement; core reading must not depend on advanced CSS | A |
| LAY-07 | Portrait / landscape FXL | `rendition:orientation` (`auto`/`portrait`/`landscape`) | Source page aspect ratio | Some readers ignore orientation locking | Matches source aspect | B |
| LAY-08 | Two-page spreads | `rendition:spread` (`none`/`landscape`/`both`/`auto`; `portrait` value deprecated), `page-spread-left/right`, `rendition:page-spread-center` | Spread-designed books and comics | Spread behaviour depends on device width and orientation | Correct pairing in conforming readers | B |
| LAY-09 | Right-to-left progression | `spine@page-progression-direction="rtl"` + `dir`/`xml:lang` | Arabic, Hebrew, Urdu, manga | Broad support | Correct page order | B |
| LAY-10 | Vertical writing | CSS `writing-mode: vertical-rl`, `text-orientation`, `text-combine-upright` | Japanese, Chinese, Korean vertical texts | Good in Apple Books, Kobo, Thorium; weaker elsewhere | Reader-dependent; horizontal fallback documented | B |
| LAY-11 | Roll / continuous scroll | Not a named EPUB layout. Mapped to `rendition:flow="scrolled-continuous"` (or `scrolled-doc`) | Webtoons, vertical-scroll comics, where the client specifies it | **Reader-dependent; often ignored** | Not guaranteed; paginated fallback always provided | E |
| LAY-12 | Image-based FXL | One page image per XHTML page | Scans and artwork where text extraction is not viable | As LAY-02 | Visual fidelity high; text is not reflowable or searchable unless OCR text is supplied | B |
| LAY-13 | XHTML/SVG-based FXL | Positioned live text over background art, or SVG pages | Children's books and magazines needing selectable text | As LAY-02; font embedding required | High, with selectable/searchable text | B |
| LAY-14 | Accessible fixed-layout alternatives | Logical reading order, alt text, nav, page-list, overlays; optional companion reflowable edition | Any FXL output where accessibility is required | FXL accessibility is inherently limited (text resizing) | Report documents residual WCAG limits (A11Y-19) | B |
| LAY-15 | Layout migration / reconstruction | Reflowable ↔ fixed rebuild (REV-05, REV-06) | Client request | — | Reconstruction, not lossless conversion; requires editorial review | B |

Layout selection algorithm (preflight proposal, human-confirmed):

1. Client guideline or profile specifies a layout → use it (subject to non-overridable constraints).
2. Else, if text is extractable and positional design is not meaningful → LAY-01.
3. Else, if page design carries meaning → LAY-02/LAY-13; if text cannot be extracted reliably → LAY-12 with an OCR text layer and a recorded accessibility limitation.
4. Mixed, roll and multiple-rendition layouts are **never auto-selected** (class E).

---

## 4. Step 5 — Source-to-EPUB capability matrix

Columns: **Native** = planned in-house parser · **Integration** = third-party/licensed dependency · **OCR** · **Extraction** · **Normalisation** · **Reflow** / **FXL** eligibility · **Limits** · **Review** · **Unsupported-case handling**. Existing reusable code is cited where it exists.

### 4.1 Office and text formats

| Req | Format | Native | Integration | OCR | Extraction / normalisation | Reflow | FXL | Limits | Review | Unsupported handling |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SRC-01 | DOC (binary Word 97–2003) | No | **Required**: licensed converter or sandboxed LibreOffice headless → DOCX | No | Via DOCX path | Yes | No | Fields, OLE objects and equations may degrade | Standard | Reject with "convert to DOCX" guidance until integration is approved (D) |
| SRC-02 | DOCX | Yes. Reuse bounded ZIP/XML readers (`lib/alt-text/document-validation.ts`, `docx-context.ts`) | Optional: OMML→MathML transform | Embedded images only | Styles → semantic headings, lists, tables, notes, images; tracked changes must be accepted first | Yes | Partial (rebuild only) | Floating text boxes and complex anchoring lose position | Structure check | Unknown styles mapped to body text and listed in preflight |
| SRC-03 | RTF | No | Required (converter) | No | Via DOCX | Yes | No | Formatting loss | Standard | Exception route as SRC-01 |
| SRC-04 | ODT | Feasible (ZIP + XML) | Optional | No | ODF styles → semantic model | Yes | No | Lower priority than DOCX | Standard | Phase-deferred; route via converter |
| SRC-05 | TXT | Yes | — | No | Heuristic chapter detection (encoding detection required) | Yes | No | No inherent structure | **Mandatory** structure review | — |
| SRC-06 | Markdown | Yes (CommonMark/GFM) | — | No | Direct to semantic HTML | Yes | No | Extensions vary by dialect | Light | Unknown extensions rendered as text |
| SRC-07 | HTML | Yes, after sanitiser (C7) | — | No | Tidy → XHTML, strip active content, resolve local assets | Yes | No | Remote resources not fetched by default (security) | Standard | Remote assets listed; client supplies them |
| SRC-08 | XHTML | Yes | — | No | Validate, sanitise, map semantics | Yes | Yes (when pages are defined) | — | Light | — |
| SRC-09 | PPTX | Partial. Reuse `lib/alt-text/pptx-extractor.ts` | — | Slide images optional | Slides → sections or FXL pages | Partial | Yes (slide = page) | Animations and transitions are dropped | Standard | Report dropped effects |
| SRC-10 | XLSX / CSV | Yes for tabular embedding (`exceljs` already installed) | — | No | Sheets → accessible `<table>` with headers | Table content only | No | Formulas become values; charts need images | Table header review | Large sheets split or rejected over a size limit |

### 4.2 PDF

PDF→EPUB depends on a PDF text and structure extraction engine **that does not exist** (P1-T01 §D, P1-T02 B9).

| Req | Format | Native | Integration | OCR | Extraction / normalisation | Reflow | FXL | Limits | Review | Unsupported handling |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SRC-11 | Born-digital PDF | Partial (`pdf-lib` can read structure but not layout text) | **Required**: PDF text/layout extraction engine (to be selected, licence review) | No | Reading order, de-hyphenation, header/footer removal, heading inference | Yes (reconstruction) | Yes (page images or SVG/XHTML) | Reading-order errors in complex layouts | **Mandatory** | Fall back to FXL page images with an a11y limitation |
| SRC-12 | Scanned PDF | No | OCR (existing `tesseract.js` eng/hin; more languages need packs) | **Yes** | OCR text + confidence → structure | Yes, with review | Yes (LAY-12) | OCR accuracy depends on scan quality; scripts beyond eng/hin need packs | **Mandatory** proofreading | Low-confidence pages flagged; manual keying route |
| SRC-13 | Image-only PDF | No | OCR | Yes | As SRC-12 | Yes, with review | Yes | As SRC-12 | Mandatory | As SRC-12 |
| SRC-14 | Tagged PDF | Partial | Extraction engine that reads the structure tree | No | Tags guide headings, lists, tables and alt text; tags are validated, not trusted blindly | Yes | Yes | Bad tagging propagates errors | Standard | Ignore tags and use layout inference when invalid |
| SRC-15 | Complex / multi-column PDF | No | Layout analysis engine | Optional | Column and float detection | Partial | Yes | Highest risk of reading-order errors | Mandatory | FXL fallback; manual restructuring |

### 4.3 Publishing and structured formats

| Req | Format | Native | Integration | OCR | Extraction / normalisation | Reflow | FXL | Limits | Review | Unsupported handling |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SRC-16 | IDML | Feasible (ZIP + XML; reuse bounded ZIP reader) | Optional | No | Stories → reading order; paragraph/character styles → CSS; spreads → FXL | Yes | Yes | Threaded frames and anchored objects need review | Standard | Unsupported features listed per spread |
| SRC-17 | INDD (native InDesign) | **No** (proprietary) | **Required**: licensed Adobe InDesign Server, or client exports IDML/EPUB | No | Via IDML | Yes | Yes | Licensing | — | Request IDML export (D) |
| SRC-18 | QuarkXPress | **No** | Client export to a supported format (e.g. HTML, PDF, XML, or Quark's own EPUB/digital export) | No | Via the exported format | Per export | Per export | Depends on export | Standard | Request export (D) |
| SRC-19 | Generic XML | Yes (`fast-xml-parser`, DOCTYPE/entity protection) | XSLT processor for complex mappings | No | Requires a mapping profile | Yes | No | Unknown vocabularies cannot be auto-mapped | Mapping sign-off | Mapping project (C) |
| SRC-20 | JATS / BITS / NLM | Yes (mapping profile) | Optional XSLT 2/3 processor (licence review) | No | Front/body/back, refs, `mml:math`, figures, tables | Yes | No | Publisher-specific tagging variants | Standard | Unmapped elements reported |
| SRC-21 | TEI | Partial (profile-based) | XSLT processor | No | Divisions, notes, apparatus | Yes | No | Critical apparatus is complex | Editorial | Customisation project |
| SRC-22 | DITA | Partial | DITA-OT (Java) or XSLT | No | Map resolution, keyrefs, conrefs | Yes | No | Requires map resolution | Standard | Integration route (D) |
| SRC-23 | DocBook | Partial | DocBook XSL (XSLT 1.0/2.0) | No | Sections, admonitions, xrefs | Yes | No | — | Standard | — |
| SRC-24 | LaTeX | **No** | **Required**: e.g. LaTeXML, TeX4ht or Pandoc (sandboxed; no shell-escape) | No | → XHTML + MathML | Yes | No | Custom macros, packages and TikZ may fail | **Mandatory** | Failing macros reported; client supplies PDF figures |
| SRC-25 | Publisher-defined XML | Yes, with a per-publisher mapping profile | Optional XSLT | No | Profile-driven | Yes | Optional | Needs a mapping specification | Mapping sign-off | Class C project |
| SRC-26 | EPUB 2 / EPUB 3 packages | Yes (C4 OCF reader, planned) | — | No | Parse, validate, upgrade or repair | Yes | Yes | DRM-protected packages cannot be processed | Light | **DRM: reject** (F); client supplies the DRM-free master |

### 4.4 Visual and multimedia sources

| Req | Format | Native | Integration | OCR | Handling | Reflow | FXL | Limits | Review | Unsupported handling |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SRC-27 | JPG, PNG, SVG (and GIF, WebP) | Yes (core media types). SVG sanitised (scripts and external refs removed); existing SVG DOCTYPE/ENTITY rejection reused | — | Optional text-in-image OCR | Optimise and manifest; alt text through I2 | Yes | Yes | SVG scripting is not allowed in default profiles | Alt text review | Unsafe SVG rejected with a finding |
| SRC-28 | TIFF | Not a core media type | Image conversion library (to PNG/JPEG) | Optional | Convert, keep colour profile where possible | Yes | Yes | CMYK → sRGB colour shift | Visual check | — |
| SRC-29 | Scanned page images | Yes | OCR | Yes | FXL page images or OCR-to-reflow | Yes (with review) | Yes | As SRC-12 | Mandatory | — |
| SRC-30 | Audio / video assets | Yes for EPUB core audio (MP3, AAC/MP4 audio, Opus in OGG). Video carried as foreign resources (e.g. MP4/H.264, WebM) | Transcoding service if formats differ | No | Manifest, captions/transcripts (ADV-05) | Yes | Yes | Video playback is reader-dependent | Captions required | Unsupported codecs transcoded or rejected |
| SRC-31 | MathML and equation sources (MathML, OMML, LaTeX math, MathType) | MathML: Yes | OMML→MathML transform; MathType OLE needs a vendor tool; LaTeX math via SRC-24 tooling | Equation images: math OCR is **not** in scope | Semantic MathML + alt text / image fallback (ADV-10/11) | Yes | Yes | Rendering varies by reader | STEM review | Image + alt text fallback |

Rule: **no proprietary binary format is decoded without an approved, licensed integration** (DOC, RTF, INDD, Quark, MathType OLE). Until then the documented exception route applies.

---

## 5. Step 10 — Reverse conversion and migration

| Req | Direction | Input requirements | Expected output | Preservation limits | Dependency | Platform restrictions | Validation | Scope |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| REV-01 | EPUB 2 → EPUB 3.3 | DRM-free, parseable EPUB 2 | EPUB 3.3 with `nav.xhtml` (NCX retained if required), `dcterms:modified`, landmarks, page-list when page data exists | `guide` mapped to landmarks; vendor display options reviewed | C4, C5 | — | EPUBCheck before/after + diff report | A |
| REV-02 | EPUB 3 → EPUB 2.0.1 | Valid EPUB 3 | EPUB 2.0.1 | **Loss report required**: nav semantics, `epub:type`, overlays, audio/video, scripting, MathML (rasterised), FXL (not standard in EPUB 2) | C4, C5 | Legacy devices | EPUBCheck (EPUB 2 mode) | C |
| REV-03 | Legacy EPUB modernisation | Any EPUB | 3.3 package + modern CSS + a11y metadata | Visual redesign is not automatic | C4–C8 | — | Validation + accessibility check | A |
| REV-04 | EPUB version upgrade (3.0/3.0.1/3.1/3.2 → 3.3) | Valid or repairable EPUB 3 | EPUB 3.3 | Deprecated constructs replaced or removed with findings | C4, C5 | — | Validation diff | A |
| REV-05 | Reflowable → fixed layout | Reflowable EPUB + target page size/design | Pre-paginated EPUB | **Reconstruction**: requires pagination and design decisions | Layout engine (C15) | FXL reader caveats | Visual QA + validation | B |
| REV-06 | Fixed layout → reflowable | FXL EPUB with live text (image-only needs OCR) | Reflowable EPUB | Positioning lost; reading order must be confirmed | C15, I3 | — | Structure review + validation | B |
| REV-07 | EPUB → HTML/XHTML | Valid EPUB | Static website bundle or single XHTML | Pagination, overlays and FXL not preserved | C4, C16 | Output is sanitised | HTML validation, link check | B |
| REV-08 | EPUB → XML | Valid EPUB | Generic XML / JATS / DocBook per mapping | Presentation styling not preserved | C16 + mapping profile | — | Schema validation | B |
| REV-09 | EPUB → PDF | Valid EPUB | Print or accessible PDF | Reflow-to-page pagination; overlays and scripts dropped | **Rendering engine** (headless browser or typesetting engine; licence review) | Heavy compute | PDF checks; PDF/UA only with evidence | D |
| REV-10 | EPUB → DOCX | Valid EPUB | Editable DOCX | CSS fidelity approximate; FXL not preserved | C16 (DOCX writer) | — | OOXML validation (reuse `output-validation*.ts`) | B |
| REV-11 | EPUB → TXT | Valid EPUB | Plain text (UTF-8) | All formatting lost | C4 | — | Encoding and completeness check | A |
| REV-12 | EPUB → accessible interchange formats | Valid EPUB | DAISY 2.02/3 or other agreed accessible formats (shared with the planned "Accessible Formats" module) | Format-specific | Accessible Formats module (not built) | — | Format validator | D |
| REV-13 | EPUB → Kindle-compatible workflow | Valid EPUB 3.3 | **KDP-ready EPUB** (Amazon converts on ingestion). KPF/KFX/AZW3 generation is **not** in scope without Amazon tooling | Amazon-specific rendering differences | Kindle Previewer (Amazon desktop tool) for manual QA | Proprietary formats | EPUBCheck + KDP guideline checklist + manual Previewer QA | D |
| REV-14 | EPUB repair and remediation | Damaged or nonconformant EPUB (not DRM-protected) | Repaired EPUB 3.3 + repair log | Unrecoverable resources reported, never fabricated | C4, E13 (ZIP rewriter: `mimetype` first + stored) | — | Before/after EPUBCheck | A |
| REV-15 | Metadata and accessibility upgrade | Valid EPUB | Same content, upgraded OPF metadata and a11y metadata | Accessibility claims require evidence (A11Y-21) | C5, C8 | — | Validation + accessibility report | A |

**DRM:** DRM-protected input is detected (`META-INF/encryption.xml` with non-font-obfuscation algorithms, `rights.xml`) and rejected. DRM circumvention is **out of scope (F)**. Font obfuscation (IDPF/Adobe algorithms) is a packaging feature, not DRM, and is preserved.

---

## 6. Step 11 — Publisher distribution scope

Distinctions used throughout:

- **EPUB production**: a standards-valid EPUB. This is the service's core deliverable.
- **Store-specific packaging**: profile adjustments such as metadata, cover rules or vendor display options, inside a still-valid EPUB.
- **Store submission**: uploading to the retailer portal. **Manual, by the client**, unless a distributor integration is approved (D).
- **Proprietary export**: retailer-specific formats such as KPF or KFX. **Not produced** (D/F).

| Req | Channel | EPUB versions / layouts accepted (verify current retailer guidelines at implementation) | Store-specific packaging | Integration needed? | Acceptance risk notes |
| --- | --- | --- | --- | --- | --- |
| DST-01 | Apple Books | EPUB 3 (reflowable and FXL) | Optional `ibooks:` metadata, embedded-font flag, cover and asset rules | No: client uploads via Apple's tools, or through an aggregator | Apple's own asset review applies |
| DST-02 | Amazon Kindle / KDP | EPUB accepted for reflowable titles; Amazon converts internally. Complex FXL generally needs Amazon tools (Kindle Create / Kindle Comic Creator) | KDP-oriented profile (REV-13): avoid unsupported CSS, check cover and TOC | No for EPUB upload; proprietary formats out of scope | Rendering must be checked in Kindle Previewer; MathML, overlays and scripting support is limited |
| DST-03 | Google Play Books | EPUB 2 and 3, reflowable and FXL | Metadata and cover rules | No (Partner Center upload) | Content review by Google |
| DST-04 | Kobo | EPUB 2/3, FXL. Kobo may convert to its KEPUB variant on ingestion | Optional Kobo checks | No | Kobo-side conversion is outside our control |
| DST-05 | Other EPUB reading systems (Thorium Reader, Adobe Digital Editions, others) | EPUB 3.3 | None (standards baseline). Thorium is the reference for accessibility testing | No | — |
| DST-06 | Academic / institutional (library aggregators, institutional repositories) | EPUB 3.3 with a11y metadata; often ONIX metadata | ONIX feed or MARC metadata may be required | Aggregator-specific | Accessibility conformance often contractual |
| DST-07 | Publisher-defined delivery specifications | Per specification | Naming, packaging, checksums, folder structure (GDL rules) | Possibly SFTP/API delivery (D) | Governed by client guideline compliance report |
| DST-08 | Store packaging vs submission separation | — | Each output records target channel and profile | Distributor APIs are out of initial scope | — |
| DST-09 | No store-acceptance guarantee | — | Pre-submission checklist per channel | — | **Passing EPUBCheck does not guarantee store acceptance.** Stated on every delivery report |
