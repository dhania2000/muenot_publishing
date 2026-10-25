# EPUB Conversion — P1-T03 Publishing Capability Catalogue

| Field | Value |
| --- | --- |
| Roadmap item | Phase 1, Task P1-T03 |
| Verified at commit | `f3c4c84` (`main`) |
| Date | 2026-10-25 |
| Nature | **Specification only.** No code changed. |
| Covers | Step 4 (content categories), Step 6 (core capabilities), Step 7 (advanced capabilities), Step 8 (accessibility), Step 9 (client guidelines) |

Profile codes (output profiles, to be formalised in the EPUB settings schema C11; content subject to blocker B4):

| Code | Profile | Base |
| --- | --- | --- |
| **P-RF** | Standard reflowable | EPUB 3.3, LAY-01, EPUB Accessibility 1.1 / WCAG 2.2 AA target |
| **P-RF-STEM** | Reflowable STEM | P-RF + MathML, chemistry, complex tables, image fallbacks |
| **P-RF-ML** | Reflowable multilingual | P-RF + `xml:lang`, bidi, vertical writing, embedded fonts |
| **P-FXL** | Fixed layout | EPUB 3.3, LAY-02/LAY-13 (live text) or LAY-12 (images) |
| **P-FXL-RTL** | Fixed layout RTL/manga | P-FXL + `page-progression-direction="rtl"`, spreads |
| **P-MO** | Media Overlay | P-RF or P-FXL + SMIL overlays (ADV-01/02) |
| **P-ENH** | Enhanced / interactive | P-RF + scripting (opt-in, class E) + fallbacks |
| **P-LEG2** | Legacy EPUB 2.0.1 | Derived from a P-RF master only (VER-02) |
| **P-34** | EPUB 3.4 readiness | Conditional (VER-08) |

Review levels: **L0** automated only · **L1** spot check · **L2** full structural review · **L3** full editorial and subject-expert review.

---

## 1. Step 4 — Publishing content categories

Each row is a separate requirement. Columns: profile · typical inputs · layout · semantic structure · accessibility capabilities · special assets/dependencies · human review · validation and acceptance.

### 1.1 General publishing

| Req | Category | Profile | Inputs | Layout | Semantics | Accessibility | Special assets | Review | Validation / acceptance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CAT-G01 | Fiction / non-fiction | P-RF | DOCX, IDML, PDF, EPUB | LAY-01 | Parts, chapters, front/back matter (`epub:type` + DPUB-ARIA) | Full WCAG AA target | Fonts (licence check) | L1 | EPUBCheck clean; nav complete; a11y report |
| CAT-G02 | Novels / short stories | P-RF | DOCX, TXT, IDML | LAY-01 | Story-level sections, scene breaks as `<hr>` with semantics | Full | Ornaments as decorative images (`alt=""`) | L1 | As G01 |
| CAT-G03 | Biography / autobiography | P-RF | DOCX, PDF | LAY-01 | Chapters, photo inserts, timelines | Full; photo alt text | Photo sections | L2 | As G01 + image alt coverage 100% |
| CAT-G04 | General trade | P-RF | DOCX, IDML, PDF | LAY-01 | Standard book semantics | Full | Retailer metadata | L1 | As G01 + DST checklist |
| CAT-G05 | Poetry / literary collections | P-RF | DOCX, IDML | LAY-01, line-preserving CSS | Line groups, stanzas, hanging indents | Full; line breaks preserved for screen readers | Indent-sensitive CSS | L2 (line breaks) | Visual check of indentation across 2+ readers |
| CAT-G06 | Reference / encyclopedic | P-RF | XML, DOCX | LAY-01 | Entries, cross-refs, index, glossary | Full | Large index linking | L2 | Link check 100%; index entries resolve |

### 1.2 Academic and educational

| Req | Category | Profile | Inputs | Layout | Semantics | Accessibility | Special assets | Review | Validation / acceptance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CAT-A01 | School textbooks | P-RF or P-FXL | IDML, PDF, DOCX | LAY-01 / LAY-13 | Learning objectives, exercises, sidebars (`aside`), page-list | Full (P-RF); limited (P-FXL, A11Y-19) | Page-list mapped to print | L2 | Page-list matches print; a11y report |
| CAT-A02 | Higher-education textbooks | P-RF-STEM | DOCX, LaTeX, XML, IDML | LAY-01 | Numbered figures, tables, equations, case studies | Full + MathML | Equations, glossary | L3 | Cross-ref/figure numbering 100% resolved |
| CAT-A03 | Competitive exam books | P-RF | DOCX, PDF | LAY-01 | Questions, options, answers, solutions linked | Full | Answer keys linked both ways | L2 | Q↔A links verified |
| CAT-A04 | Question banks / workbooks | P-RF (P-ENH optional) | DOCX, XML | LAY-01 | Question/answer structure | Full; interactive is optional only | Write-in areas need a non-interactive alternative | L2 | Fallback present for every interaction |
| CAT-A05 | Scientific books | P-RF-STEM | LaTeX, DOCX, XML | LAY-01 | Equations, units, notation | MathML + alt text | MathML, SVG | L3 | Equation render check in 2+ readers |
| CAT-A06 | Medical publications | P-RF-STEM | XML, DOCX, PDF | LAY-01 | Drug tables, figures, references | Full; complex tables | Clinical images (sensitive) | L3 (subject expert) | Table header associations verified |
| CAT-A07 | Engineering / technical | P-RF-STEM | DOCX, DITA, DocBook | LAY-01 | Diagrams, code, specifications | Full | SVG diagrams, code blocks | L3 | Code blocks preserved verbatim |
| CAT-A08 | Research publications | P-RF-STEM | LaTeX, JATS, DOCX | LAY-01 | Abstract, sections, references, DOIs | Full | Bibliography | L2 | Reference links resolve |
| CAT-A09 | Journals / scholarly articles | P-RF-STEM | JATS, BITS, NLM | LAY-01 | JATS front/body/back mapping | Full | DOI, ORCID metadata | L2 | JATS→EPUB mapping coverage report |
| CAT-A10 | Dictionaries / glossaries | P-RF | XML, DOCX | LAY-01 | Entries, `dfn`, `epub:type="glossary"`; optional EPUB Dictionaries & Glossaries search keys | Full | Very large spine; lookup indexes | L2 | Entry count matches source |
| CAT-A11 | STEM (general) | P-RF-STEM | All STEM sources | LAY-01 | MathML, chemistry, notation | MathML preferred; image fallback with alt text | Equation tooling (SRC-31) | L3 | No unrendered math in reference readers |

### 1.3 Visual and design-intensive

| Req | Category | Profile | Inputs | Layout | Semantics | Accessibility | Special assets | Review | Validation / acceptance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CAT-V01 | Children's books | P-FXL (P-MO optional) | IDML, PDF, images | LAY-13 / LAY-08 | Live text over art, reading order | Alt text, overlays optional | Fonts, spreads | L2 | Spread pairing + text layering visual QA |
| CAT-V02 | Illustrated books | P-RF or P-FXL | IDML, DOCX, PDF | LAY-01 / LAY-04 | Figures with captions | Full alt text | High-res images (size optimisation) | L2 | Image size budget met |
| CAT-V03 | Comics | P-FXL | Images, PDF | LAY-12 / LAY-08 | Panels; page-list | Limited; text description strongly recommended | Large images | L2 | Page order + spreads |
| CAT-V04 | Graphic novels | P-FXL | Images, PDF, IDML | LAY-12 / LAY-13 | As V03 | As V03 | As V03 | L2 | As V03 |
| CAT-V05 | Manga | P-FXL-RTL | Images | LAY-12 + LAY-09 + LAY-08 | RTL page order | As V03 | — | L2 | RTL progression verified in 2+ readers |
| CAT-V06 | Webtoons | P-FXL + LAY-11 (conditional) | Long images | LAY-11 (E) with paginated fallback | Episode sections | Limited | Image slicing | L2 | Paginated fallback always valid |
| CAT-V07 | Art / photography books | P-FXL or P-RF | IDML, PDF, TIFF | LAY-02 / LAY-01 | Plates with captions | Alt + long descriptions | Colour management (SRC-28) | L2 | Colour check approved by client |
| CAT-V08 | Magazines | P-FXL (P-RF article view optional) | IDML, PDF | LAY-13 / LAY-04 | Articles, departments | Limited (FXL); reflowable article view recommended | Ads (links) | L2 | Links valid; article nav |
| CAT-V09 | Catalogues | P-FXL or P-RF | IDML, XLSX, PDF | LAY-02 / LAY-01 | Products, tables | Tables accessible | Product data from XLSX/CSV | L2 | Data completeness vs source |
| CAT-V10 | Manuals with technical diagrams | P-RF-STEM | DITA, DOCX, IDML | LAY-01 | Procedures (`ol`), warnings, callouts | Full; diagram descriptions | SVG callouts | L2 | Procedure step order verified |

### 1.4 Advanced digital publishing

| Req | Category | Profile | Inputs | Layout | Semantics | Accessibility | Special assets | Review | Validation / acceptance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CAT-D01 | Interactive eBooks | P-ENH | HTML, client spec | LAY-01 | Scripted sections declared | Non-scripted fallback mandatory (ADV-08) | JS widgets (sandboxed review) | L3 | Fallback test with scripting disabled |
| CAT-D02 | Enhanced multimedia EPUB | P-RF/P-FXL + media | Media + text | LAY-01/02 | `audio`/`video` with controls | Captions/transcripts (ADV-05) | Media transcoding | L2 | Every media item has an alternative |
| CAT-D03 | Read-aloud books | P-MO | Text + narration audio | LAY-01/13 | Overlay-synchronised text fragments | Read-aloud highlighting | Audio, timing data | L2 | SMIL timing spot checks |
| CAT-D04 | Media Overlay publications | P-MO | Text + audio + timing | Any | `media-overlay` attributes, `media:duration` metadata | Overlay a11y | Forced alignment tool (D) | L2 | Overlay validation (EPUBCheck) |
| CAT-D05 | Audio-supported learning | P-MO / P-RF + audio | Text + audio | LAY-01 | Audio per exercise | Transcripts | Audio | L2 | Transcript coverage 100% |
| CAT-D06 | Bilingual / multilingual | P-RF-ML | DOCX, XML, IDML | LAY-01 | Per-element `xml:lang`, parallel text | Language switching for TTS | Fonts per script | L2 (native-language reviewer) | Language tags correct; glyph coverage |
| CAT-D07 | Accessible publications | P-RF | Any | LAY-01 | Full semantics | EPUB Accessibility 1.1 WCAG AA | — | L3 (a11y expert) | Automated + manual a11y evaluation (§5) |
| CAT-D08 | Equation-heavy publications | P-RF-STEM | LaTeX, DOCX, XML | LAY-01 | MathML | MathML + alt text | Equation tooling | L3 | Render + alt text check |
| CAT-D09 | Chemical / mathematical | P-RF-STEM | LaTeX (mhchem), DOCX, XML | LAY-01 | MathML chemistry, structure images | Alt / long descriptions for structures | ChemDraw-type assets via images (D) | L3 | Subject-expert sign-off |
| CAT-D10 | Complex tables and figures | P-RF-STEM | DOCX, XML, PDF | LAY-01 | `th` scope/headers, captions, `figure` | Accessible tables | Large-table strategy (scroll vs split) | L2 | Header associations verified |

### 1.5 Special cases

| Req | Category | Profile | Inputs | Layout | Semantics | Accessibility | Special assets | Review | Validation / acceptance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CAT-S01 | Historical / archival books | P-FXL (images + OCR) or P-RF | Scans, PDF | LAY-12 / LAY-01 | Original pagination preserved (page-list) | OCR text layer; limitations disclosed | Historical typefaces, long s, ligatures | L3 | Proofread sample accuracy agreed with client |
| CAT-S02 | Low-quality scans | P-FXL (images) | Scans | LAY-12 | Page-level | Limited | Image enhancement | L3 | Pages below OCR confidence threshold flagged |
| CAT-S03 | Legacy publishing assets | P-RF | EPUB 2, old HTML, DOC | LAY-01 | Rebuilt semantics | Upgraded | Converters (D) | L2 | Validation diff |
| CAT-S04 | Complex RTL / vertical-script books | P-RF-ML / P-FXL-RTL | DOCX, IDML, XML | LAY-09 / LAY-10 | `dir`, `writing-mode`, ruby | Language and direction tagging | Script fonts; shaping test set | L3 (native reviewer) | Rendering check in 2+ readers |
| CAT-S05 | Large multi-volume publications | P-RF | XML, DOCX | LAY-01 | Per-volume packages, or one package with volume nav | Full | Size and spine scaling | L2 | Package size limits; cross-volume link policy |
| CAT-S06 | Damaged / partially recoverable EPUBs | — (repair) | EPUB | as source | Recovered structure | Upgraded if possible | — | L2 | Repair log; unrecoverable items listed (REV-14) |

---

## 2. Step 6 — Core conversion capabilities

**M** = mandatory for every job · **O** = optional / profile-driven · **PS** = publisher-specific.

| Req | Capability | M/O/PS | Functional requirement | Reuse |
| --- | --- | --- | --- | --- |
| CORE-01 | Source file ingestion | M | Authenticated, tenant-scoped upload of sources, assets and optional guidelines; per-module allow-list; checksum; dedupe; quota | E11, E11a, R19, R20 |
| CORE-02 | Preflight analysis | M | Detect format and version, encoding, fonts, images, DRM, structure signals, page count; recommend profile and layout; estimate effort | E12, new preflight |
| CORE-03 | OCR-assisted extraction | O | OCR scanned pages with per-word confidence; low-confidence flags | I3 (`lib/alt-text/ocr-*`) |
| CORE-04 | Semantic document normalisation | M | Convert every source into one internal semantic model (sections, blocks, inlines, assets) | C6 |
| CORE-05 | Chapter splitting | M | Split into spine documents by heading level or explicit breaks; configurable size limit per XHTML file | C6, C11 |
| CORE-06 | Headings and paragraph structuring | M | Correct `h1`–`h6` hierarchy without skipped levels; paragraphs, block quotes, epigraphs | C6 |
| CORE-07 | Stylesheet generation | M | Profile CSS (reset, typography, spacing) + publisher overrides; no reader-hostile CSS (fixed widths, `!important` on font size) | C11 |
| CORE-08 | Content formatting | M | Emphasis, small caps, super/subscript, drop caps (progressive), alignment | C6 |
| CORE-09 | Images and illustrations | M | Extract, convert to core media types, size-optimise, `figure`/`figcaption`, alt text required or `alt=""` for decorative images | I2, R22 |
| CORE-10 | Tables and lists | M | Semantic tables (`caption`, `th`, `scope`/`headers`), nested lists, definition lists | C6 |
| CORE-11 | Table of Contents | M | Generated from headings; configurable depth; HTML TOC page optional | C5 |
| CORE-12 | Navigation documents | M | `nav.xhtml` (`toc`, optional `landmarks`, `page-list`); NCX for legacy compatibility when profile requires | C5 |
| CORE-13 | Page lists and landmarks | M (landmarks) / O (page-list when a print source exists) | `page-list` with `epub:type="pagebreak"` markers; `dc:source` for the print edition | C5 |
| CORE-14 | Footnotes and endnotes | M | `epub:type="noteref"`/`footnote`/`endnote` with `role` (DPUB-ARIA); back-links; endnote collection | C6 |
| CORE-15 | Internal and external hyperlinks | M | Resolve internal targets after splitting; external links validated (format only; no automatic crawling) | C5, C6 |
| CORE-16 | Indexes and glossaries | O | Linked index entries (to the paragraph target, not the page); glossary with `dfn`; EPUB Indexes markup optional | C6 |
| CORE-17 | Mathematical formulas | O (M for STEM profiles) | MathML with `alttext`; fallback image with alt text when required (ADV-11) | C6, SRC-31 |
| CORE-18 | Chemical equations | O | MathML or images with alt text / long descriptions | C6 |
| CORE-19 | Scientific notation | O | Units, super/subscripts, Unicode symbols, no image text | C6 |
| CORE-20 | Cross-references | M | Figure/table/section references resolved and validated post-split | C6 |
| CORE-21 | Bibliographies | O | `epub:type="bibliography"` / `biblioentry`; DOI links | C6 |
| CORE-22 | Media assets | O | Manifest audio/video with media types, fallbacks, captions | C5, ADV-04 |
| CORE-23 | EPUB metadata | M | Dublin Core (title, creator with roles, language, identifier, publisher, date, subject), `dcterms:modified`, series/collection, a11y metadata; ONIX mapping (PS) | C5 |
| CORE-24 | Font embedding and licensing checks | M (check) | Detect embedded fonts; require recorded licence confirmation before embedding; subset or obfuscate only when the licence allows | new + C13 approval |
| CORE-25 | EPUB packaging | M | OCF: `mimetype` first and STORED; `container.xml`; deterministic ZIP; manifest/spine integrity | C4, E13 |
| CORE-26 | File-size optimisation | M | Image recompression within quality thresholds; remove unused resources; font subsetting where licensed | new |
| CORE-27 | Final validation | M | Internal structural checks + EPUBCheck + accessibility checks + guideline compliance; "valid" only with evidence | C8, E14, R15 |

---

## 3. Step 7 — Advanced capabilities

| Req | Capability | Requirement | Platform limitations | Security implications | Scope |
| --- | --- | --- | --- | --- | --- |
| ADV-01 | Media Overlays | SMIL documents per content document; `media:duration` total and per item; `media:active-class` | Strong in Apple Books and Thorium; weak or absent elsewhere | Audio files are scanned and size-limited | B |
| ADV-02 | SMIL audio synchronisation | `par`/`text`/`audio` with clip times from narration timing or a forced-alignment integration | Alignment accuracy depends on audio quality | External alignment tools run sandboxed | B / D |
| ADV-03 | Read-aloud highlighting | Active class CSS; word or phrase granularity | Reader-dependent | — | B |
| ADV-04 | Audio/video integration | `audio`/`video` elements with controls, no autoplay by default | Video support varies; some readers block media | Media isolated; no remote streaming by default | B |
| ADV-05 | Captions and transcripts | WebVTT `track` for video; linked transcripts for all audio/video | `track` support varies → transcript is mandatory | — | B |
| ADV-06 | Interactive learning elements | Quizzes and reveal answers via `details`/`summary` (non-scripted first) | Scripted variants are reader-dependent | — | B |
| ADV-07 | Scripted EPUB components | Opt-in only; `properties="scripted"`; spine-level or container-constrained scripts; no network access | Many readers disable scripting | **High**: script review, CSP in preview (C9), sanitiser allow-list (C7) | E |
| ADV-08 | Non-scripted accessible fallbacks | Every scripted feature has equivalent static content | — | — | B (mandatory with ADV-07) |
| ADV-09 | SVG and complex illustrations | Inline or referenced SVG; `title`/`desc`; no script or external references | Some readers render SVG text poorly | SVG sanitisation | B |
| ADV-10 | Semantic MathML | Presentation MathML with `alttext`; Content MathML only as annotation | Native MathML support varies (better since MathML Core landed in browsers) | MathML sanitised | B |
| ADV-11 | Equation rendering fallbacks | SVG/PNG fallback image + alt text, or `epub:switch`-free approaches (switch is deprecated) | Fallback strategy chosen per distribution profile | — | B |
| ADV-12 | Complex reference linking | Bidirectional note links, citation ↔ bibliography, cross-volume links (policy) | Cross-package links are not portable | — | B |
| ADV-13 | Multilingual and bidirectional content | `xml:lang`/`lang`, `dir`, `dc:language` list, bidi isolation (`bdi`) | Shaping depends on the reader font engine; fonts must be embedded | Font licensing (CORE-24) | B |
| ADV-14 | Vertical writing and ruby | `writing-mode`, `ruby`/`rt`/`rp` | Reader-dependent (LAY-10) | — | B |
| ADV-15 | Advanced navigation | Multi-level TOC, landmarks, page-list, lists of figures/tables (`epub:type="loi"`/`lot`) | Readers expose different nav types | — | B |
| ADV-16 | Multiple renditions / compatibility | LAY-05 rules; default alternative is separate packages | Very limited support | — | E |
| ADV-17 | Profile-specific fallbacks | Each distribution profile declares which features to downgrade (e.g. MathML → image for KDP) | — | — | C |
| ADV-18 | Reading-system feature limitations register | Maintained matrix of feature × reader with test date; drives warnings in reports | Must be retested periodically | — | B |

Statement of limitation: **interactive and multimedia behaviour is not guaranteed across all EPUB reading systems.** Delivery reports list the reading systems actually tested.

---

## 4. Step 8 — Accessibility scope

Legend for verification: **Auto** = verifiable automatically · **Manual** = requires expert manual evaluation · **Both**.

| Req | Requirement | Standard reference | Verification | Notes |
| --- | --- | --- | --- | --- |
| A11Y-01 | EPUB Accessibility production profiles (A, AA target; AA default) | EPUB Accessibility 1.1 | Both | Profile selected per job; claims only with evidence |
| A11Y-02 | WCAG-based assessment | WCAG 2.2 (2.1/2.0 accepted when the client requires) | Both | Automated checks cover only a subset of success criteria |
| A11Y-03 | Accessibility metadata | Schema.org `accessMode`, `accessModeSufficient`, `accessibilityFeature`, `accessibilityHazard`, `accessibilitySummary`; `dcterms:conformsTo`; `a11y:certifiedBy` | Auto (presence) / Manual (truthfulness) | Never auto-claim conformance |
| A11Y-04 | Semantic XHTML | HTML sectioning, lists, tables, `figure` | Auto (partly) | — |
| A11Y-05 | DPUB-ARIA semantics | DPUB-ARIA 1.1 roles alongside `epub:type` | Auto (validity) / Manual (appropriateness) | No redundant or contradictory roles |
| A11Y-06 | Logical reading order | WCAG 1.3.2 | Manual (Auto for spine order only) | Critical for FXL and multi-column sources |
| A11Y-07 | Heading hierarchy | WCAG 1.3.1, 2.4.6 | Auto (skips) / Manual (meaning) | — |
| A11Y-08 | Alt text | WCAG 1.1.1 | Auto (presence) / Manual (quality) | Reuse Alt Text generation + review (I2); AI output requires human review |
| A11Y-09 | Long descriptions | WCAG 1.1.1; Accessibility Techniques | Manual | `details` or linked description |
| A11Y-10 | Accessible tables | WCAG 1.3.1 | Auto (header presence) / Manual | Avoid layout tables |
| A11Y-11 | Accessible mathematics | MathML + `alttext` | Both | Image-only math fails unless alt text is complete |
| A11Y-12 | Keyboard accessibility | WCAG 2.1.1 (interactive content) | Manual | Applies to ADV-06/07 |
| A11Y-13 | Assistive-technology compatibility | Reading System 3.3 + AT | Manual | Test matrix: Thorium + NVDA, Apple Books + VoiceOver, plus one Android reader + TalkBack |
| A11Y-14 | Screen-reader testing | — | Manual | Sample-based for L1/L2; full for CAT-D07 |
| A11Y-15 | Text resizing | WCAG 1.4.4 | Manual (FXL fails by nature) | No fixed font sizes in reflowable CSS |
| A11Y-16 | Colour contrast | WCAG 1.4.3 / 1.4.11 | Auto (CSS text) / Manual (images) | — |
| A11Y-17 | Multimedia alternatives | WCAG 1.2.x | Manual | Captions/transcripts (ADV-05) |
| A11Y-18 | Accessible page navigation | `page-list`, `pagebreak` with labels, `dc:source` | Auto | Required when a print equivalent exists |
| A11Y-19 | Fixed-layout accessibility limitations | Accessibility Techniques (FXL) | Manual | Report states residual limitations; offer a reflowable alternative |
| A11Y-20 | Accessibility remediation | — | Both | Fix the source semantics; never hide failures |
| A11Y-21 | Automated + manual validation | DAISY Ace (automated), manual checklist | Both | **Automated pass ≠ conformance.** A conformance claim requires a recorded manual evaluation by a qualified reviewer |

Regulatory note: accessibility requirements may be contractual or legal (e.g. the European Accessibility Act applies to e-books placed on the EU market from 28 June 2025). The service supplies evidence and reports; **legal compliance determination remains with the publisher.**

---

## 5. Step 9 — Client guidelines functionality

Reuses `lib/guidelines/guideline-contracts.ts` (R15): `GuidelineServiceScope { area: "conversion", service: "epub" }`, priority levels (job › company › preset › standard), non-overridable constraints, `assessGuidelineCompliance()` (no guidelines ⇒ "Not applicable"). Storage, parsing and enforcement are **missing** and are built once as the shared guideline service (C12). No EPUB-only guideline service.

| Req | Requirement | Behaviour |
| --- | --- | --- |
| GDL-01 | Guidelines optional | Upload is optional at submission and **never blocks** a job |
| GDL-02 | Default profile when absent | Approved default profile (P-RF, subject to B4) + mandatory technical and accessibility standards; compliance verdict "Not applicable" |
| GDL-03 | Requirement extraction | Parse PDF/DOCX/XLSX/TXT/MD guideline documents; each extracted rule keeps a citation (document, page, excerpt). AI-assisted extraction is metered (I4) and human-confirmed |
| GDL-04 | Structured production rules | Rules normalised to the contract `Rule` type with category, scope, priority, version |
| GDL-05 | Stage mapping | Each rule mapped to a pipeline stage (preflight, normalisation, styling, metadata, packaging, validation, delivery) and an EPUB settings key |
| GDL-06 | Conflict and unsupported detection | Conflicts between rules, or with non-overridable constraints (EPUB validity, security, accessibility minimums), are flagged. Unsupported rules are reported, never silently dropped |
| GDL-07 | Apply approved rules | Resolver produces job settings; every applied rule is recorded |
| GDL-08 | Validate output against rules | Each rule requires evidence (validator finding, check result or reviewer attestation) for "pass" |
| GDL-09 | Compliance report | Requirement-by-requirement report (applied / passed / failed / conflict / unsupported / exception-approved); XLSX export (R25) |
| GDL-10 | Exceptions, approvals, versions | Exceptions need an approval record (C13); guideline documents and rule sets are versioned; jobs pin a version |
| GDL-11 | Guideline category coverage | Fonts/typography, heading styles, images, layout, tables, navigation, metadata, accessibility, language, page numbering, output naming, packaging, reader compatibility |
| GDL-12 | Non-overridable constraints | Client rules cannot disable EPUB validity, security sanitisation, DRM policy or legal accessibility minimums |
| GDL-13 | Reuse existing infrastructure | Contracts (R15), guidelines UI (R12), guideline dropzone (E6), EPUB guideline categories (E9) |
