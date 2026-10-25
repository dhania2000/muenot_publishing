# EPUB Conversion — P1-T03 Requirements Traceability Matrix

| Field | Value |
| --- | --- |
| Roadmap item | Phase 1, Task P1-T03 |
| Verified at commit | `f3c4c84` (`main`) |
| Date | 2026-10-25 |
| Nature | **Specification only.** No code changed. The approved roadmap baseline is **not altered**. |

## Roadmap mapping limitation (blocker B1)

The approved 20-phase / 300-task EPUB roadmap is **not stored in the repository** (recorded in P1-T02 §1.2 A7 and still open). So that no task ID is invented:

- **Phase** column = the provisional workstream from `P1-T02-integration-dependency-plan.md` §1 (WS1–WS10), or a **proposed** extension workstream (WS11–WS13, see §3) for requirements no existing workstream covers.
- **Task** column = `B1` for every row: exact task ID pending reconciliation with the approved roadmap. Reconciliation is a mechanical update of these two columns. Requirement IDs do not change.

Workstreams: WS1 Foundation & scope · WS2 Shared conversion platform · WS3 EPUB UI shell · WS4 EPUB core engine · WS5 Source transformers · WS6 Validation & QA · WS7 Preview & editing · WS8 Client guidelines · WS9 Review, approval, delivery · WS10 Advanced EPUB · *(proposed)* WS11 Distribution profiles · WS12 Production operations · WS13 Extended source adapters.

Column codes: **Pri** Crit / High / Med / Cond · **Status** Planned (covered by a workstream, no code yet) / Existing (reusable infrastructure already satisfies the core of it) / Missing (no workstream covers it; see gap register) / Conditional (integration, draft standard or reader dependent) · **Cls** Step 14 class A–E · Existing-system IDs from `P1-T02-feature-reuse-matrix.md`.

---

## 1. Traceability matrix

### 1.1 Versions (VER)

| ID | Capability | Profile | Source | Output | Pri | Phase | Task | Existing system | Dependencies | Validation | Acceptance | Status | Cls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| VER-01 | EPUB 2.0/2.0.1 import | EPUB 2 | EPUB 2 | Semantic model | High | WS4 | B1 | R22, E12 | C4 | EPUBCheck EPUB 2 corpus | Corpus parses; errors typed | Planned | A |
| VER-02 | EPUB 2.0.1 legacy export | P-LEG2 | P-RF master | EPUB 2.0.1 | Med | WS4 | B1 | — | C5, C11 | EPUBCheck EPUB 2 | Valid + loss report | Planned | C |
| VER-03 | EPUB 3.0 import | EPUB 3.0 | EPUB 3.0 | Model | High | WS4 | B1 | R22 | C4 | Corpus | Parses; diff vs 3.3 reported | Planned | A |
| VER-04 | EPUB 3.0.1 import | EPUB 3.0.1 | EPUB 3.0.1 | Model | High | WS4 | B1 | R22 | C4 | Corpus incl. FXL | FXL props preserved | Planned | A |
| VER-05 | EPUB 3.1 import + normalise | EPUB 3.1 | EPUB 3.1 | 3.3 | Med | WS4 | B1 | — | C4, C5 | 3.3 validation | 3.1 deviations reported | Planned | A |
| VER-06 | EPUB 3.2 import / compat export | EPUB 3.2 | EPUB 3.2 | 3.3 (3.2-compatible) | High | WS4 | B1 | — | C4, C5, C11 | EPUBCheck | No 3.3-only features when flag on | Planned | A |
| VER-07 | EPUB 3.3 default export | P-RF | Any | EPUB 3.3 | Crit | WS4 | B1 | E13 | C4, C5, C8 | EPUBCheck 5.x | 0 errors on golden corpus | Planned | A |
| VER-08 | EPUB 3.4 readiness profile | P-34 | Any | 3.3-valid + CR features | Cond | WS10 | B1 | — | C11, validator support | 3.3 validation + feature report | Opt-in only; CR features listed | Conditional | E |
| VER-09 | Legacy / nonconformant remediation | EPUB 2/3 | Damaged EPUB | EPUB 3.3 | High | WS6 | B1 | E13 | C4, C8 | Before/after EPUBCheck | Error count reduced; log | Planned | A |
| VER-10 | Upgrade / migration to 3.3 | EPUB 3.3 | EPUB 2/3.x | EPUB 3.3 | High | WS4 | B1 | — | C4, C5 | Validation diff | Valid 3.3; metadata preserved | Planned | A |
| VER-11 | Controlled downgrade 3.x → 2.0.1 | P-LEG2 | EPUB 3 | EPUB 2.0.1 | Med | WS4 | B1 | — | C4, C5 | EPUBCheck EPUB 2 | Loss report complete | Planned | C |
| VER-12 | Version detection and reporting | All | EPUB | Preflight report | High | WS4 | B1 | — | C4 | Unit tests per version | Correct version on corpus | Planned | A |

### 1.2 Layouts (LAY)

| ID | Capability | Profile | Source | Output | Pri | Phase | Task | Existing system | Dependencies | Validation | Acceptance | Status | Cls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| LAY-01 | Reflowable | P-RF | Any text | EPUB 3.3 | Crit | WS4 | B1 | I6 | C5, C6 | EPUBCheck + reader check | Valid; reads in reference readers | Planned | A |
| LAY-02 | Fixed layout | P-FXL | IDML, PDF, images | FXL EPUB | High | WS10 | B1 | — | C15 | EPUBCheck + visual QA | Page-accurate in 3 readers | Planned | B |
| LAY-03 | Pre-paginated per document | P-FXL | as LAY-02 | FXL EPUB | Med | WS10 | B1 | — | C15 | EPUBCheck | itemref props valid | Planned | B |
| LAY-04 | Mixed layout | P-RF + FXL | Mixed | Mixed EPUB | Cond | WS10 | B1 | — | C15, ADV-18 | Validation + reader matrix | Reader behaviour documented | Conditional | E |
| LAY-05 | Multiple renditions | Multi | Any | Multi-rendition EPUB | Cond | WS10 | B1 | — | C15 | Validation | First rendition complete | Conditional | E |
| LAY-06 | Responsive styling | P-RF | Any | CSS profile | High | WS4 | B1 | — | C11 | CSS lint + reader check | No fixed widths; readable on small screens | Planned | A |
| LAY-07 | Portrait / landscape FXL | P-FXL | FXL sources | FXL EPUB | Med | WS10 | B1 | — | C15 | EPUBCheck | Orientation matches source | Planned | B |
| LAY-08 | Two-page spreads | P-FXL | FXL sources | FXL EPUB | Med | WS10 | B1 | — | C15 | Visual QA | Correct pairing | Planned | B |
| LAY-09 | RTL page progression | P-FXL-RTL / P-RF-ML | RTL sources | EPUB | High | WS10 | B1 | — | C5 | Reader check | Correct order in 2+ readers | Planned | B |
| LAY-10 | Vertical writing | P-RF-ML | CJK sources | EPUB | Med | WS10 | B1 | — | C11 | Reader check | Renders vertically in reference readers | Planned | B |
| LAY-11 | Roll / continuous scroll | P-FXL | Long images | EPUB + paginated fallback | Cond | WS10 | B1 | — | C15 | Reader matrix | Fallback valid | Conditional | E |
| LAY-12 | Image-based FXL | P-FXL | Scans, images | FXL EPUB | High | WS10 | B1 | I3 | C15 | EPUBCheck + visual | All pages present; a11y limits stated | Planned | B |
| LAY-13 | XHTML/SVG-based FXL | P-FXL | IDML, PDF | FXL EPUB | High | WS10 | B1 | — | C15, C7 | EPUBCheck + visual | Live text selectable | Planned | B |
| LAY-14 | Accessible FXL alternatives | P-FXL | FXL | FXL + a11y | High | WS10 | B1 | I2 | C8 | A11y checks | Reading order + alt text complete | Planned | B |
| LAY-15 | Layout migration / reconstruction | P-RF ↔ P-FXL | EPUB | EPUB | Med | WS10 | B1 | — | C15, C16 | Review + validation | Editorial sign-off | Planned | B |

### 1.3 Content categories (CAT)

Category rows inherit dependencies from their profile. Acceptance uses the category's validation column in `P1-T03-publishing-capabilities.md` §1 and a category sample in the reference corpus (G-11).

| ID | Capability | Profile | Source | Output | Pri | Phase | Task | Existing system | Dependencies | Validation | Acceptance | Status | Cls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| CAT-G01 | Fiction / non-fiction | P-RF | DOCX, IDML, PDF, EPUB | EPUB 3.3 | Crit | WS5 | B1 | E11 | C6 | EPUBCheck + a11y | Cat. §1.1 criteria | Planned | A |
| CAT-G02 | Novels / short stories | P-RF | DOCX, TXT | EPUB 3.3 | Crit | WS5 | B1 | E11 | C6 | EPUBCheck | Cat. §1.1 | Planned | A |
| CAT-G03 | Biography / autobiography | P-RF | DOCX, PDF | EPUB 3.3 | High | WS5 | B1 | I2 | C6 | Alt coverage | 100% alt | Planned | A |
| CAT-G04 | General trade | P-RF | DOCX, IDML | EPUB 3.3 | Crit | WS5 | B1 | E11 | C6 | EPUBCheck | Cat. §1.1 | Planned | A |
| CAT-G05 | Poetry / literary | P-RF | DOCX, IDML | EPUB 3.3 | High | WS5 | B1 | — | C6, C11 | Visual 2 readers | Line breaks preserved | Planned | A |
| CAT-G06 | Reference / encyclopedic | P-RF | XML, DOCX | EPUB 3.3 | High | WS5 | B1 | R22 | C6 | Link check | 100% links resolve | Planned | A |
| CAT-A01 | School textbooks | P-RF / P-FXL | IDML, PDF, DOCX | EPUB 3.3 | High | WS5 | B1 | — | C6, C15 | Page-list check | Matches print | Planned | B |
| CAT-A02 | Higher-ed textbooks | P-RF-STEM | DOCX, LaTeX, XML | EPUB 3.3 | High | WS10 | B1 | — | C6, SRC-31 | Cross-ref check | 100% resolved | Planned | B |
| CAT-A03 | Competitive exam books | P-RF | DOCX, PDF | EPUB 3.3 | High | WS5 | B1 | — | C6 | Q↔A link check | All linked | Planned | A |
| CAT-A04 | Question banks / workbooks | P-RF | DOCX, XML | EPUB 3.3 | Med | WS5 | B1 | — | C6, ADV-08 | Fallback test | Fallback per interaction | Planned | A |
| CAT-A05 | Scientific books | P-RF-STEM | LaTeX, DOCX, XML | EPUB 3.3 | High | WS10 | B1 | — | ADV-10/11 | Render 2 readers | No unrendered math | Planned | B |
| CAT-A06 | Medical publications | P-RF-STEM | XML, DOCX, PDF | EPUB 3.3 | High | WS10 | B1 | — | C6 | Table header check | Expert sign-off | Planned | B |
| CAT-A07 | Engineering / technical | P-RF-STEM | DOCX, DITA, DocBook | EPUB 3.3 | High | WS10 | B1 | — | C6, SRC-22/23 | Code block diff | Verbatim | Planned | B |
| CAT-A08 | Research publications | P-RF-STEM | LaTeX, JATS, DOCX | EPUB 3.3 | High | WS10 | B1 | — | C6 | Reference links | Resolve | Planned | B |
| CAT-A09 | Journals / scholarly | P-RF-STEM | JATS, BITS, NLM | EPUB 3.3 | High | WS5 | B1 | R22 | C6 | Mapping coverage | Coverage report clean | Planned | B |
| CAT-A10 | Dictionaries / glossaries | P-RF | XML, DOCX | EPUB 3.3 | Med | WS5 | B1 | R22 | C6 | Entry count | Equals source | Planned | B |
| CAT-A11 | STEM (general) | P-RF-STEM | STEM sources | EPUB 3.3 | High | WS10 | B1 | — | ADV-10/11 | Render check | No unrendered math | Planned | B |
| CAT-V01 | Children's books | P-FXL | IDML, PDF, images | FXL EPUB | High | WS10 | B1 | — | C15 | Visual QA | Spreads + text layering | Planned | B |
| CAT-V02 | Illustrated books | P-RF / P-FXL | IDML, DOCX, PDF | EPUB | High | WS10 | B1 | I2 | C15, CORE-26 | Size budget | Within budget | Planned | B |
| CAT-V03 | Comics | P-FXL | Images, PDF | FXL EPUB | High | WS10 | B1 | — | C15 | Page order | Correct | Planned | B |
| CAT-V04 | Graphic novels | P-FXL | Images, PDF, IDML | FXL EPUB | High | WS10 | B1 | — | C15 | Page order | Correct | Planned | B |
| CAT-V05 | Manga | P-FXL-RTL | Images | FXL RTL EPUB | High | WS10 | B1 | — | C15, LAY-09 | RTL check | 2 readers | Planned | B |
| CAT-V06 | Webtoons | P-FXL + LAY-11 | Long images | EPUB + fallback | Cond | WS10 | B1 | — | LAY-11 | Fallback validity | Paginated fallback valid | Conditional | E |
| CAT-V07 | Art / photography | P-FXL / P-RF | IDML, PDF, TIFF | EPUB | Med | WS10 | B1 | — | SRC-28 | Colour approval | Client approved | Planned | B |
| CAT-V08 | Magazines | P-FXL | IDML, PDF | FXL EPUB | Med | WS10 | B1 | — | C15 | Link + nav check | Valid | Planned | B |
| CAT-V09 | Catalogues | P-FXL / P-RF | IDML, XLSX, PDF | EPUB | Med | WS10 | B1 | R25 | SRC-10 | Data completeness | Equals source | Planned | B |
| CAT-V10 | Technical manuals | P-RF-STEM | DITA, DOCX, IDML | EPUB 3.3 | High | WS10 | B1 | — | C6 | Step order | Correct | Planned | B |
| CAT-D01 | Interactive eBooks | P-ENH | HTML, spec | EPUB 3.3 scripted | Cond | WS10 | B1 | — | ADV-07/08 | Scripting-off test | Fallback complete | Conditional | E |
| CAT-D02 | Enhanced multimedia | P-RF + media | Media + text | EPUB 3.3 | Med | WS10 | B1 | — | ADV-04/05 | Alternative coverage | 100% | Planned | B |
| CAT-D03 | Read-aloud books | P-MO | Text + audio | EPUB 3.3 + SMIL | Med | WS10 | B1 | — | ADV-01/02 | SMIL spot check | Timing within tolerance | Planned | B |
| CAT-D04 | Media Overlay publications | P-MO | Text + audio + timing | EPUB 3.3 + SMIL | Med | WS10 | B1 | — | ADV-01/02 | EPUBCheck overlays | Valid | Planned | B |
| CAT-D05 | Audio-supported learning | P-MO / P-RF | Text + audio | EPUB 3.3 | Med | WS10 | B1 | — | ADV-04/05 | Transcript coverage | 100% | Planned | B |
| CAT-D06 | Bilingual / multilingual | P-RF-ML | DOCX, XML, IDML | EPUB 3.3 | High | WS10 | B1 | I3 | ADV-13 | Lang tags + glyphs | Native reviewer sign-off | Planned | B |
| CAT-D07 | Accessible publications | P-RF | Any | EPUB 3.3 a11y | Crit | WS6 | B1 | I2, E18 | C8 | Auto + manual a11y | Manual evaluation recorded | Planned | B |
| CAT-D08 | Equation-heavy | P-RF-STEM | LaTeX, DOCX, XML | EPUB 3.3 | High | WS10 | B1 | — | ADV-10/11 | Render + alt | Complete | Planned | B |
| CAT-D09 | Chemical / mathematical | P-RF-STEM | LaTeX, DOCX, XML | EPUB 3.3 | Med | WS10 | B1 | — | CORE-18 | Expert review | Sign-off | Planned | B |
| CAT-D10 | Complex tables / figures | P-RF-STEM | DOCX, XML, PDF | EPUB 3.3 | High | WS5 | B1 | — | CORE-10 | Header association | Verified | Planned | B |
| CAT-S01 | Historical / archival | P-FXL / P-RF | Scans, PDF | EPUB | Med | WS10 | B1 | I3 | SRC-12 | Proofread sample | Agreed accuracy | Conditional | D |
| CAT-S02 | Low-quality scans | P-FXL | Scans | FXL EPUB | Med | WS10 | B1 | I3 | LAY-12 | Confidence flags | All flagged pages reviewed | Conditional | D |
| CAT-S03 | Legacy assets | P-RF | EPUB 2, HTML, DOC | EPUB 3.3 | High | WS5 | B1 | — | REV-03 | Validation diff | Valid | Planned | A |
| CAT-S04 | Complex RTL / vertical | P-RF-ML / P-FXL-RTL | DOCX, IDML, XML | EPUB | Med | WS10 | B1 | — | LAY-09/10, ADV-13/14 | Reader check | Native reviewer sign-off | Planned | B |
| CAT-S05 | Large multi-volume | P-RF | XML, DOCX | EPUB(s) | Med | WS4 | B1 | R24 | C5 | Size limits | Within limits; links per policy | Planned | B |
| CAT-S06 | Damaged EPUBs | Repair | EPUB | EPUB 3.3 | High | WS6 | B1 | E13 | REV-14 | Repair log | Unrecoverable listed | Planned | A |

### 1.4 Source formats (SRC)

| ID | Capability | Profile | Source | Output | Pri | Phase | Task | Existing system | Dependencies | Validation | Acceptance | Status | Cls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SRC-01 | DOC import | P-RF | DOC | Model | Med | WS13 | B1 | — | Converter licence | Sample corpus | Converts or exception route | Missing | D |
| SRC-02 | DOCX import | P-RF | DOCX | Model | Crit | WS5 | B1 | E11, E12, B6 readers | C6 | Golden DOCX set | Styles mapped; unknowns listed | Planned | A |
| SRC-03 | RTF import | P-RF | RTF | Model | Med | WS13 | B1 | — | Converter | Corpus | Converts or exception | Missing | D |
| SRC-04 | ODT import | P-RF | ODT | Model | Med | WS13 | B1 | R22 | C6 | Corpus | Mapped | Missing | B |
| SRC-05 | TXT import | P-RF | TXT | Model | Med | WS5 | B1 | — | C6 | Encoding tests | Structure review done | Planned | A |
| SRC-06 | Markdown import | P-RF | MD | Model | Med | WS5 | B1 | — | C6 | CommonMark tests | Pass | Planned | A |
| SRC-07 | HTML import | P-RF | HTML | Model | High | WS5 | B1 | E11a | C7 | Sanitiser tests | No active content | Planned | A |
| SRC-08 | XHTML import | P-RF / P-FXL | XHTML | Model | High | WS5 | B1 | R22 | C7 | Validation | Pass | Planned | A |
| SRC-09 | PPTX import | P-FXL / P-RF | PPTX | Model | Med | WS13 | B1 | `pptx-extractor.ts` | C6 | Corpus | Dropped effects reported | Missing | B |
| SRC-10 | XLSX / CSV tables | P-RF | XLSX, CSV | Tables | Med | WS13 | B1 | `exceljs` (R25) | C6 | Table tests | Headers correct | Missing | B |
| SRC-11 | Born-digital PDF | P-RF / P-FXL | PDF | Model | High | WS5 | B1 | `pdf-lib` | PDF extraction engine | Corpus | Reading order reviewed | Conditional | D |
| SRC-12 | Scanned PDF | P-FXL / P-RF | PDF | Model | Med | WS5 | B1 | I3 | OCR + PDF engine | Proofread | Flags reviewed | Conditional | D |
| SRC-13 | Image-only PDF | P-FXL / P-RF | PDF | Model | Med | WS5 | B1 | I3 | OCR + PDF engine | Proofread | Flags reviewed | Conditional | D |
| SRC-14 | Tagged PDF | P-RF | PDF | Model | Med | WS5 | B1 | — | PDF engine | Tag validation | Invalid tags fall back | Conditional | D |
| SRC-15 | Complex / multi-column PDF | P-FXL / P-RF | PDF | Model | Med | WS5 | B1 | — | Layout engine | Mandatory review | Sign-off | Conditional | D |
| SRC-16 | IDML import | P-RF / P-FXL | IDML | Model | High | WS5 | B1 | ZIP reader (E12) | C6 | Corpus | Unsupported features listed | Planned | B |
| SRC-17 | INDD | — | INDD | Via IDML | Cond | WS13 | B1 | — | InDesign Server licence | — | Exception route | Conditional | D |
| SRC-18 | QuarkXPress exports | — | Quark export | Via export | Cond | WS13 | B1 | — | Client export | — | Exception route | Conditional | D |
| SRC-19 | Generic XML | P-RF | XML | Model | High | WS5 | B1 | R22 | Mapping profile | Mapping tests | Sign-off | Planned | C |
| SRC-20 | JATS / BITS / NLM | P-RF-STEM | XML | Model | High | WS5 | B1 | R22 | Mapping, opt. XSLT | Coverage report | Unmapped reported | Planned | B |
| SRC-21 | TEI | P-RF | XML | Model | Med | WS13 | B1 | R22 | XSLT processor | Corpus | Mapped | Missing | D |
| SRC-22 | DITA | P-RF-STEM | XML | Model | Med | WS13 | B1 | — | DITA-OT | Corpus | Mapped | Missing | D |
| SRC-23 | DocBook | P-RF-STEM | XML | Model | Med | WS13 | B1 | R22 | DocBook XSL | Corpus | Mapped | Missing | D |
| SRC-24 | LaTeX | P-RF-STEM | TEX | Model | Med | WS13 | B1 | — | LaTeXML/TeX4ht/Pandoc | Corpus | Failing macros reported | Missing | D |
| SRC-25 | Publisher-defined XML | P-RF | XML | Model | Med | WS5 | B1 | R22 | Mapping spec | Mapping tests | Sign-off | Planned | C |
| SRC-26 | EPUB 2/3 packages | Any | EPUB | Model | Crit | WS4 | B1 | E12 | C4 | Corpus; DRM detection | DRM rejected | Planned | A |
| SRC-27 | JPG/PNG/SVG/GIF/WebP | Any | Images | Assets | Crit | WS4 | B1 | SVG checks, `media-format.ts` | C7 | Sanitiser tests | Unsafe SVG rejected | Planned | A |
| SRC-28 | TIFF | Any | TIFF | PNG/JPEG | Med | WS13 | B1 | — | Image library | Conversion tests | Colour checked | Missing | B |
| SRC-29 | Scanned page images | P-FXL | Images | FXL / model | Med | WS10 | B1 | I3 | OCR | Proofread | Flags reviewed | Planned | B |
| SRC-30 | Audio / video assets | P-MO / media | Media | Assets | Med | WS10 | B1 | — | Transcoder (opt.) | Media checks | Captions present | Planned | B |
| SRC-31 | MathML / equation sources | P-RF-STEM | MathML, OMML, LaTeX, MathType | MathML | High | WS10 | B1 | — | Transform tooling | Render check | Alt text present | Conditional | D |

### 1.5 Core capabilities (CORE)

| ID | Capability | Profile | Source | Output | Pri | Phase | Task | Existing system | Dependencies | Validation | Acceptance | Status | Cls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| CORE-01 | Source ingestion | All | Any | Stored files | Crit | WS2 | B1 | E11, E11a, R19, R20 | C1, C2 | Upload tests | Valid accepted, unsafe rejected | Existing | A |
| CORE-02 | Preflight analysis | All | Any | Preflight report | Crit | WS5 | B1 | E12 | C4, C6 | Corpus | Profile recommended; DRM detected | Missing | A |
| CORE-03 | OCR-assisted extraction | P-FXL / P-RF | Scans | Text + confidence | Med | WS5 | B1 | I3 | OCR packs | Accuracy sample | Low confidence flagged | Existing | B |
| CORE-04 | Semantic normalisation | All | Any | Model | Crit | WS5 | B1 | — | C6 | Unit + golden | Model schema valid | Planned | A |
| CORE-05 | Chapter splitting | All | Model | XHTML spine | Crit | WS4 | B1 | — | C5 | Golden | Size limit honoured | Planned | A |
| CORE-06 | Headings / paragraphs | All | Model | XHTML | Crit | WS5 | B1 | — | C6 | Heading-skip check | No skipped levels | Planned | A |
| CORE-07 | Stylesheet generation | All | Profile | CSS | Crit | WS4 | B1 | — | C11 | CSS lint | Profile rules pass | Planned | A |
| CORE-08 | Content formatting | All | Model | XHTML | High | WS5 | B1 | — | C6 | Golden | Matches source | Planned | A |
| CORE-09 | Images / illustrations | All | Images | Assets + figures | Crit | WS5 | B1 | I2, `media-format.ts` | C6 | Alt coverage | 100% alt or decorative | Planned | A |
| CORE-10 | Tables / lists | All | Model | XHTML | Crit | WS5 | B1 | — | C6 | Header check | Headers associated | Planned | A |
| CORE-11 | Table of Contents | All | Model | nav TOC | Crit | WS4 | B1 | — | C5 | Nav check | Depth as configured | Planned | A |
| CORE-12 | Navigation documents | All | Model | nav.xhtml / NCX | Crit | WS4 | B1 | — | C5 | EPUBCheck | Valid | Planned | A |
| CORE-13 | Page lists / landmarks | All | Model | nav | High | WS4 | B1 | — | C5 | Page-list check | Matches print | Planned | A |
| CORE-14 | Footnotes / endnotes | All | Model | XHTML | Crit | WS5 | B1 | — | C6 | Link check | Bidirectional | Planned | A |
| CORE-15 | Hyperlinks | All | Model | XHTML | Crit | WS5 | B1 | — | C5 | Link check | 0 broken internal | Planned | A |
| CORE-16 | Indexes / glossaries | P-RF | Model | XHTML | Med | WS5 | B1 | — | C6 | Link check | Entries resolve | Planned | A |
| CORE-17 | Math formulas | P-RF-STEM | Model | MathML | High | WS10 | B1 | — | SRC-31 | Render | Alt text present | Planned | B |
| CORE-18 | Chemical equations | P-RF-STEM | Model | MathML / image | Med | WS10 | B1 | — | SRC-31 | Expert review | Sign-off | Planned | B |
| CORE-19 | Scientific notation | P-RF-STEM | Model | XHTML | Med | WS10 | B1 | — | C6 | Golden | No image text | Planned | B |
| CORE-20 | Cross-references | All | Model | XHTML | Crit | WS5 | B1 | — | C5, C6 | Link check | 100% resolved | Planned | A |
| CORE-21 | Bibliographies | P-RF | Model | XHTML | Med | WS5 | B1 | — | C6 | Semantics check | Correct `epub:type` | Planned | A |
| CORE-22 | Media assets | Media | Media | Manifest items | Med | WS10 | B1 | — | C5 | EPUBCheck | Valid | Planned | B |
| CORE-23 | EPUB metadata | All | Order + source | OPF metadata | Crit | WS4 | B1 | — | C5 | EPUBCheck + rules | Required fields present | Planned | A |
| CORE-24 | Font embedding / licence check | All | Fonts | Embedded fonts | High | WS4 | B1 | — | C13 approval | Licence record test | No embed without licence | Missing | A |
| CORE-25 | EPUB packaging | All | Built files | .epub | Crit | WS4 | B1 | E13 | C4 | EPUBCheck OCF | `mimetype` first + stored | Planned | A |
| CORE-26 | File-size optimisation | All | Assets | Optimised EPUB | Med | WS4 | B1 | — | Image library | Size report | Reduction reported | Missing | A |
| CORE-27 | Final validation | All | .epub | Reports | Crit | WS6 | B1 | E14, R15 | C8 | EPUBCheck + a11y + guidelines | "Valid" only with evidence | Planned | A |

### 1.6 Advanced capabilities (ADV)

| ID | Capability | Profile | Source | Output | Pri | Phase | Task | Existing system | Dependencies | Validation | Acceptance | Status | Cls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ADV-01 | Media Overlays | P-MO | Text + audio | SMIL | Med | WS10 | B1 | — | C15 | EPUBCheck | Valid | Planned | B |
| ADV-02 | SMIL synchronisation | P-MO | Audio + timing | SMIL | Med | WS10 | B1 | — | Alignment tool | Spot check | Within tolerance | Conditional | D |
| ADV-03 | Read-aloud highlighting | P-MO | SMIL | CSS active class | Med | WS10 | B1 | — | ADV-01 | Reader check | Highlights in 2 readers | Planned | B |
| ADV-04 | Audio/video integration | Media | Media | XHTML media | Med | WS10 | B1 | — | CORE-22 | EPUBCheck | Controls, no autoplay | Planned | B |
| ADV-05 | Captions / transcripts | Media | Media | VTT + transcripts | High | WS10 | B1 | — | ADV-04 | Coverage | 100% | Planned | B |
| ADV-06 | Interactive learning (non-scripted) | P-RF | Spec | XHTML | Med | WS10 | B1 | — | C6 | Keyboard test | Operable | Planned | B |
| ADV-07 | Scripted components | P-ENH | Spec | Scripted XHTML | Cond | WS10 | B1 | — | C7, C9 | Security review | Approved; declared scripted | Conditional | E |
| ADV-08 | Non-scripted fallbacks | P-ENH | — | Static content | High | WS10 | B1 | — | ADV-07 | Scripting-off test | Equivalent | Planned | B |
| ADV-09 | SVG / complex illustrations | Any | SVG | SVG | Med | WS10 | B1 | SVG checks | C7 | Sanitiser tests | No script/external refs | Planned | B |
| ADV-10 | Semantic MathML | P-RF-STEM | Math | MathML | High | WS10 | B1 | — | SRC-31 | Render | Alt text | Planned | B |
| ADV-11 | Equation fallbacks | P-RF-STEM | Math | Image + alt | High | WS10 | B1 | — | ADV-10 | Profile check | Per profile | Planned | B |
| ADV-12 | Complex reference linking | P-RF | Model | Links | Med | WS10 | B1 | — | CORE-20 | Link check | Resolve | Planned | B |
| ADV-13 | Multilingual / bidi | P-RF-ML | Model | XHTML | High | WS10 | B1 | — | CORE-24 | Lang check | Correct tags | Planned | B |
| ADV-14 | Vertical writing / ruby | P-RF-ML | Model | XHTML + CSS | Med | WS10 | B1 | — | LAY-10 | Reader check | 2 readers | Planned | B |
| ADV-15 | Advanced navigation | All | Model | nav | Med | WS4 | B1 | — | C5 | Nav check | LOI/LOT present when configured | Planned | B |
| ADV-16 | Multiple renditions | Multi | — | Multi-rendition | Cond | WS10 | B1 | — | LAY-05 | Validation | First rendition complete | Conditional | E |
| ADV-17 | Profile-specific fallbacks | Distribution | — | Profile output | Med | WS11 | B1 | — | DST-* | Profile tests | Applied per profile | Missing | C |
| ADV-18 | Reader limitation register | All | — | Matrix | High | WS6 | B1 | — | Test devices | Dated tests | Updated per release | Missing | B |

### 1.7 Accessibility (A11Y)

| ID | Capability | Profile | Source | Output | Pri | Phase | Task | Existing system | Dependencies | Validation | Acceptance | Status | Cls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A11Y-01 | Production profiles A/AA | P-RF | Any | Profile | Crit | WS6 | B1 | E18 | C11 | Profile tests | AA default | Planned | B |
| A11Y-02 | WCAG assessment | All | — | Report | Crit | WS6 | B1 | — | C8 | Auto + manual | Recorded | Planned | B |
| A11Y-03 | A11y metadata | All | — | OPF metadata | Crit | WS4 | B1 | — | C5 | EPUBCheck + review | Truthful, evidenced | Planned | B |
| A11Y-04 | Semantic XHTML | All | — | XHTML | Crit | WS5 | B1 | — | C6 | Ace | 0 critical | Planned | B |
| A11Y-05 | DPUB-ARIA | All | — | XHTML | High | WS5 | B1 | — | C6 | Ace + review | Valid roles | Planned | B |
| A11Y-06 | Reading order | All | — | Spine / DOM | Crit | WS6 | B1 | — | Review | Manual | Sign-off | Planned | B |
| A11Y-07 | Heading hierarchy | All | — | XHTML | Crit | WS5 | B1 | — | CORE-06 | Auto | No skips | Planned | B |
| A11Y-08 | Alt text | All | Images | alt | Crit | WS6 | B1 | I2 | C6 | Auto + manual | 100% reviewed | Existing | B |
| A11Y-09 | Long descriptions | All | Complex images | details | High | WS6 | B1 | I2 | C6 | Manual | Present where needed | Planned | B |
| A11Y-10 | Accessible tables | All | Tables | XHTML | Crit | WS5 | B1 | — | CORE-10 | Auto + manual | Headers associated | Planned | B |
| A11Y-11 | Accessible maths | P-RF-STEM | Math | MathML | High | WS10 | B1 | — | ADV-10 | Both | Alt text complete | Planned | B |
| A11Y-12 | Keyboard accessibility | P-ENH | — | XHTML | High | WS10 | B1 | — | ADV-06/07 | Manual | Operable | Planned | B |
| A11Y-13 | AT compatibility | All | — | Test record | High | WS6 | B1 | — | Test devices | Manual matrix | 3 combos tested | Missing | B |
| A11Y-14 | Screen-reader testing | All | — | Test record | High | WS6 | B1 | — | A11Y-13 | Manual | Sample/full per level | Missing | B |
| A11Y-15 | Text resizing | P-RF | — | CSS | High | WS4 | B1 | — | C11 | Manual + CSS lint | No fixed sizes | Planned | B |
| A11Y-16 | Colour contrast | All | — | CSS | High | WS6 | B1 | — | C8 | Auto + manual | AA ratios | Planned | B |
| A11Y-17 | Multimedia alternatives | Media | — | Alternatives | High | WS10 | B1 | — | ADV-05 | Manual | 100% | Planned | B |
| A11Y-18 | Accessible page navigation | All | Print source | page-list | High | WS4 | B1 | — | CORE-13 | Auto | Present + `dc:source` | Planned | B |
| A11Y-19 | FXL a11y limitations | P-FXL | — | Report | High | WS10 | B1 | — | LAY-14 | Manual | Limits disclosed | Planned | B |
| A11Y-20 | Remediation | All | EPUB | Remediated EPUB | High | WS6 | B1 | I2 | C8 | Before/after | Issues reduced | Planned | B |
| A11Y-21 | Automated + manual validation | All | — | A11y report | Crit | WS6 | B1 | — | C8, reviewer | Ace + manual record | No claim without manual record | Planned | A |

### 1.8 Client guidelines (GDL)

| ID | Capability | Profile | Source | Output | Pri | Phase | Task | Existing system | Dependencies | Validation | Acceptance | Status | Cls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GDL-01 | Optional upload, never blocks | All | Guidelines | — | Crit | WS8 | B1 | R15, E6 | C12 | Scenario A test | Job runs without guidelines | Existing | A |
| GDL-02 | Default profile when absent | P-RF | — | Settings | Crit | WS8 | B1 | R15 | C11, B4 | Scenario A test | "Not applicable" verdict | Existing | A |
| GDL-03 | Requirement extraction | All | PDF/DOCX/XLSX/TXT | Rules + citations | High | WS8 | B1 | I4 | C12 | Extraction tests | Every rule cited | Planned | C |
| GDL-04 | Structured rules | All | Rules | Rule records | High | WS8 | B1 | R15 | C12 | Schema tests | Valid | Planned | C |
| GDL-05 | Stage mapping | All | Rules | Mappings | High | WS8 | B1 | R15 | C11 | Mapping tests | Every rule mapped or unsupported | Planned | C |
| GDL-06 | Conflict / unsupported detection | All | Rules | Findings | High | WS8 | B1 | R12, R15 | C12 | Conflict tests | None silently dropped | Planned | C |
| GDL-07 | Apply rules | All | Rules | Job settings | High | WS8 | B1 | — | C11 | Resolver tests | Applied rules recorded | Planned | C |
| GDL-08 | Validate against rules | All | Output | Results | High | WS8 | B1 | R15 (`isVerifiedPass`) | C8 | Evidence check | Pass only with evidence | Planned | C |
| GDL-09 | Compliance report | All | Results | Report / XLSX | High | WS8 | B1 | R12, R25 | GDL-08 | Report test | Rule-by-rule | Planned | C |
| GDL-10 | Exceptions / approvals / versions | All | — | Approvals | High | WS9 | B1 | R15 types | C13 | Approval tests | Approver recorded | Planned | C |
| GDL-11 | Category coverage (13) | All | — | Categories | Med | WS8 | B1 | E9 | C12 | Category tests | All 13 present | Planned | C |
| GDL-12 | Non-overridable constraints | All | — | Constraints | Crit | WS8 | B1 | R15 | C12 | Override tests | Validity/security not overridable | Existing | A |
| GDL-13 | Reuse guideline infrastructure | All | — | — | High | WS8 | B1 | R12, R15, E6, E9 | — | Code review | No EPUB-only service | Planned | A |

### 1.9 Reverse conversion and migration (REV)

| ID | Capability | Profile | Source | Output | Pri | Phase | Task | Existing system | Dependencies | Validation | Acceptance | Status | Cls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| REV-01 | EPUB 2 → 3.3 | EPUB 3.3 | EPUB 2 | EPUB 3.3 | High | WS4 | B1 | — | C4, C5 | Before/after | Valid 3.3 | Planned | A |
| REV-02 | EPUB 3 → 2.0.1 | P-LEG2 | EPUB 3 | EPUB 2.0.1 | Med | WS4 | B1 | — | C4, C5 | EPUBCheck EPUB 2 | Loss report | Planned | C |
| REV-03 | Legacy modernisation | EPUB 3.3 | EPUB | EPUB 3.3 | High | WS6 | B1 | — | C4–C8 | Validation + a11y | Valid | Planned | A |
| REV-04 | Version upgrade | EPUB 3.3 | EPUB 3.x | EPUB 3.3 | High | WS4 | B1 | — | C4, C5 | Diff | Valid | Planned | A |
| REV-05 | Reflowable → FXL | P-FXL | EPUB | FXL EPUB | Med | WS10 | B1 | — | C15 | Visual + validation | Sign-off | Planned | B |
| REV-06 | FXL → reflowable | P-RF | FXL EPUB | EPUB | Med | WS10 | B1 | I3 | C15 | Review | Sign-off | Planned | B |
| REV-07 | EPUB → HTML/XHTML | — | EPUB | HTML | Med | WS10 | B1 | — | C16 | HTML validation | Links valid | Planned | B |
| REV-08 | EPUB → XML | — | EPUB | XML | Med | WS10 | B1 | R22 | C16, mapping | Schema validation | Valid | Missing | B |
| REV-09 | EPUB → PDF | — | EPUB | PDF | Med | WS10 | B1 | — | Rendering engine | PDF checks | No PDF/UA claim without evidence | Conditional | D |
| REV-10 | EPUB → DOCX | — | EPUB | DOCX | Med | WS10 | B1 | E14 (OOXML validation) | C16 | OOXML validation | Opens; structure kept | Planned | B |
| REV-11 | EPUB → TXT | — | EPUB | TXT | Med | WS10 | B1 | — | C4 | Completeness | All text present | Missing | A |
| REV-12 | EPUB → accessible interchange | — | EPUB | DAISY etc. | Cond | WS10 | B1 | — | Accessible Formats module | Format validator | Valid | Conditional | D |
| REV-13 | Kindle-compatible workflow | KDP profile | EPUB | KDP-ready EPUB | High | WS11 | B1 | — | Kindle Previewer (manual) | Checklist + Previewer | Checklist passed | Conditional | D |
| REV-14 | Repair / remediation | EPUB 3.3 | Damaged EPUB | EPUB 3.3 | High | WS6 | B1 | E13 | C4 | Before/after | Repair log | Planned | A |
| REV-15 | Metadata / a11y upgrade | EPUB 3.3 | EPUB | EPUB 3.3 | High | WS6 | B1 | — | C5, C8 | Validation + a11y | Evidenced claims only | Planned | A |

### 1.10 Distribution (DST)

| ID | Capability | Profile | Source | Output | Pri | Phase | Task | Existing system | Dependencies | Validation | Acceptance | Status | Cls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| DST-01 | Apple Books profile | Apple | EPUB 3.3 | Profiled EPUB | High | WS11 | B1 | — | ADV-17 | Checklist | Checklist passed | Missing | C |
| DST-02 | Kindle / KDP profile | KDP | EPUB 3.3 | KDP-ready EPUB | High | WS11 | B1 | — | REV-13 | Checklist + Previewer | Passed | Conditional | D |
| DST-03 | Google Play Books profile | Google | EPUB 3.3 | Profiled EPUB | High | WS11 | B1 | — | ADV-17 | Checklist | Passed | Missing | C |
| DST-04 | Kobo profile | Kobo | EPUB 3.3 | Profiled EPUB | Med | WS11 | B1 | — | ADV-17 | Checklist | Passed | Missing | C |
| DST-05 | Other readers / Thorium baseline | Standard | EPUB 3.3 | EPUB 3.3 | High | WS6 | B1 | — | ADV-18 | Reader check | Opens + navigates | Planned | A |
| DST-06 | Academic / institutional | Standard + ONIX | EPUB 3.3 | EPUB + metadata | Med | WS11 | B1 | — | CORE-23 | Metadata check | Feed valid | Missing | C |
| DST-07 | Publisher delivery specs | Custom | EPUB | Delivery package | Med | WS11 | B1 | R15 | GDL-* | Compliance report | Spec met | Missing | C |
| DST-08 | Packaging vs submission separation | All | — | Output records | High | WS9 | B1 | — | C1 | Data review | Channel recorded per output | Planned | A |
| DST-09 | No acceptance guarantee + checklist | All | — | Delivery report | High | WS9 | B1 | — | DST-01–07 | Report review | Disclaimer present | Planned | A |

### 1.11 Enterprise workflow (WF)

| ID | Capability | Profile | Source | Output | Pri | Phase | Task | Existing system | Dependencies | Validation | Acceptance | Status | Cls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| WF-01 | Client submission | All | Any | Job | Crit | WS2 | B1 | E11, R19 | C1, C2 | E2E test | Job created; rights confirmed | Planned | A |
| WF-02 | Preflight | All | Files | Report | Crit | WS5 | B1 | E12 | CORE-02 | E2E | Report stored | Missing | A |
| WF-03 | Source analysis | All | Files | Analysis | High | WS5 | B1 | — | CORE-02 | Review | Accepted | Missing | A |
| WF-04 | Profile selection | All | — | Pinned profile | Crit | WS1 | B1 | E10 | C11 | Unit | Version pinned | Planned | A |
| WF-05 | Conversion | All | Model | XHTML | Crit | WS5 | B1 | E15, I1 | C6 | E2E | Typed success/failure | Planned | A |
| WF-06 | Content review | All | — | Sign-off | High | WS9 | B1 | E22 | C13 | Workflow test | Sign-off recorded | Planned | A |
| WF-07 | EPUB generation | All | — | .epub | Crit | WS4 | B1 | E13 | C4 | E2E | Package built | Planned | A |
| WF-08 | Validation | All | .epub | Reports | Crit | WS6 | B1 | E14 | C8 | E2E | Failures block QA | Planned | A |
| WF-09 | QA | All | — | QA record | High | WS6 | B1 | R13 | ADV-18 | Workflow test | Recorded | Planned | A |
| WF-10 | Client review | All | Draft | Feedback | High | WS7 | B1 | R14 | C9 | E2E | Sandboxed preview works | Planned | A |
| WF-11 | Revision | All | Feedback | Revision job | High | WS9 | B1 | — | C1 | Workflow test | Linked to parent | Planned | A |
| WF-12 | Approval | All | — | Approval | Crit | WS9 | B1 | E16 | C13 | Permission test | Grant required | Planned | A |
| WF-13 | Delivery | All | Output | Download / email | Crit | WS9 | B1 | R21, I5 | C3 | E2E | Gated download | Planned | A |
| WF-14 | Single and bulk | All | Many | Jobs | High | WS9 | B1 | E20, E15 | C14 | Batch test | Item isolation | Planned | A |
| WF-15 | Multi-book projects | All | — | Project | Med | WS2 | B1 | — | C1 | Data test | Grouping works | Planned | A |
| WF-16 | Multiple output profiles | All | Model | N outputs | Med | WS4 | B1 | — | C11 | E2E | One model, N outputs | Planned | A |
| WF-17 | Progress monitoring | All | — | Status | High | WS2 | B1 | B14 job events, R11 | C2 | UI test | Live status | Existing | A |
| WF-18 | Failed-job retry | All | — | Retry | High | WS2 | B1 | R23 | C2 | Retry test | Classified retries | Existing | A |
| WF-19 | Workflow approvals | All | — | Approvals | High | WS9 | B1 | E16 | C13 | Permission test | Enforced | Planned | A |
| WF-20 | Version control | All | — | Revisions | High | WS2 | B1 | — | C1 | Data test | Versions pinned | Planned | A |
| WF-21 | Internal review | All | — | Review queue | Med | WS9 | B1 | E22 | C13 | Workflow test | Queue works | Planned | A |
| WF-22 | Audit logs | All | — | Audit rows | Crit | WS9 | B1 | — | C13 | Audit test | Every decision logged | Planned | A |
| WF-23 | Notifications | All | — | Email (in-app gap) | Med | WS9 | B1 | I5 | Outbound guard | Mail test | Sent on approval/delivery | Planned | A |
| WF-24 | SLA handling | All | — | Due dates, flags | Med | WS12 | B1 | — | C1 | Workflow test | At-risk flagged | Missing | C |
| WF-25 | Revision requests | All | — | Feedback | High | WS9 | B1 | — | C1, C9 | Workflow test | Linked to location | Planned | A |
| WF-26 | Final deliverables | All | — | Bundle | Crit | WS9 | B1 | R25 | C3, C8 | E2E | EPUB + reports + checksums | Planned | A |
| WF-27 | Production reporting | All | — | Reports | Med | WS12 | B1 | R25 | C1 | Report test | Metrics exported | Missing | A |

### 1.12 Non-functional (NFR)

| ID | Capability | Profile | Source | Output | Pri | Phase | Task | Existing system | Dependencies | Validation | Acceptance | Status | Cls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| NFR-SEC-01 | Tenant isolation | All | — | — | Crit | WS2 | B1 | R17, R19 | C1 | Cross-tenant tests | 0 leaks | Existing | A |
| NFR-SEC-02 | Confidential handling | All | — | — | Crit | WS2 | B1 | R21 | C3 | Log scrub test | No content in logs | Existing | A |
| NFR-SEC-03 | Secure uploads | All | — | — | Crit | WS2 | B1 | E11a, R27, E19 | B6 | Upload tests | `pending` initial scan status | Planned | A |
| NFR-SEC-04 | Archive / XML protection | All | — | — | Crit | WS2 | B1 | E12 | — | Bomb / XXE tests | All rejected | Existing | A |
| NFR-SEC-05 | Active-content restrictions | All | — | — | Crit | WS4 | B1 | — | C7, C9 | Pen test | 0 script execution | Planned | A |
| NFR-SEC-06 | Role-based permissions | All | — | — | Crit | WS9 | B1 | E16 | — | Permission tests | Denied without grant | Planned | A |
| NFR-SEC-07 | Encryption | All | — | — | High | WS12 | B1 | HSTS (`next.config.mjs`) | Provider evidence | Config review | Documented | Existing | A |
| NFR-SEC-08 | Retention / deletion | All | — | — | High | WS12 | B1 | — | C1 | Deletion test | Blobs removed + audited | Missing | A |
| NFR-SCL-01 | High-volume processing | All | — | — | High | WS12 | B1 | R24 | Corpus | Benchmark | Baseline recorded | Missing | A |
| NFR-SCL-02 | Large files | All | — | — | High | WS12 | B1 | — | Benchmark | Limit tests | Clear rejection over limit | Missing | A |
| NFR-SCL-03 | Bulk jobs | All | — | — | High | WS9 | B1 | E20 | C14 | Batch test | Item isolation | Planned | A |
| NFR-SCL-04 | Queue management | All | — | — | High | WS2 | B1 | R24 | E15 | Concurrency test | Caps enforced | Existing | A |
| NFR-SCL-05 | Horizontal scaling | All | — | — | High | WS2 | B1 | job claiming | B3 | Parallel worker test | No double-claim | Conditional | D |
| NFR-SCL-06 | Resource caps | All | — | — | High | WS12 | B1 | — | Benchmark | Cap tests | Permanent failure with reason | Missing | A |
| NFR-REL-01 | Retry strategy | All | — | — | High | WS2 | B1 | R23 | — | Retry tests | Classified | Existing | A |
| NFR-REL-02 | Failure recovery | All | — | — | High | WS2 | B1 | job timeouts | — | Crash test | Reclaimed | Existing | A |
| NFR-REL-03 | Processing logs | All | — | — | High | WS2 | B1 | job events | — | Event test | Every stage logged | Existing | A |
| NFR-REL-04 | Job traceability | All | — | — | High | WS2 | B1 | — | C1 | Data test | Inputs + versions recorded | Planned | A |
| NFR-REL-05 | Idempotency | All | — | — | High | WS2 | B1 | queue idempotency | C2 | Duplicate submit test | No duplicate | Existing | A |
| NFR-REL-06 | Disaster recovery | All | — | — | High | WS12 | B1 | — | Ops agreement | Restore drill | RPO/RTO agreed | Missing | A |
| NFR-PRF-01 | Upload processing | All | — | — | Med | WS12 | B1 | — | Benchmark | Benchmark | Bound set | Missing | A |
| NFR-PRF-02 | Conversion throughput | All | — | — | Med | WS12 | B1 | — | Corpus | Benchmark | Reported per profile | Missing | A |
| NFR-PRF-03 | Job latency | All | — | — | Crit | WS2 | B1 | I1 | B3 | Latency measurement | Interactive dispatch | Conditional | D |
| NFR-PRF-04 | Preview responsiveness | All | — | — | Med | WS7 | B1 | — | C9 | Web Vitals | Target set after spike | Planned | A |
| NFR-PRF-05 | File-size optimisation | All | — | — | Med | WS4 | B1 | — | CORE-26 | Size report | Reported | Missing | A |
| NFR-MNT-01 | Reusable architecture | All | — | — | Crit | WS1 | B1 | Reuse matrix §7 | — | Review checklist | No duplicates | Planned | A |
| NFR-MNT-02 | Modular adapters | All | — | — | High | WS5 | B1 | — | C6 | Architecture review | One interface | Planned | A |
| NFR-MNT-03 | Versioned EPUB profiles | All | — | — | High | WS4 | B1 | E10 | C11 | Unit | Pinned | Planned | A |
| NFR-MNT-04 | Testable stages | All | — | — | High | WS4 | B1 | Vitest | — | Coverage | Golden tests per stage | Planned | A |
| NFR-MNT-05 | Standards upgrade compatibility | All | — | — | Med | WS4 | B1 | — | C11 | Add-profile test | No adapter change | Planned | A |
| NFR-MNT-06 | Regression protection | All | — | — | Crit | WS1 | B1 | `test/alt-text`, `test/publishing` | — | CI | Suites green | Existing | A |

---

## 2. Gap register

Requirements with status **Missing** (no existing workstream covers them), plus structural gaps. Every gap has a proposed **controlled roadmap extension**. None is applied to the approved 300-task baseline without product approval.

| Gap | Description | Requirements | Proposed extension |
| --- | --- | --- | --- |
| G-00 | Approved roadmap not in repository | All (Task column) | Provide roadmap file; reconcile WS → task IDs (blocker B1) |
| G-01 | Extended source adapters not in WS5 scope (WS5 names DOCX, HTML, XML, later PDF, IDML, OCR) | SRC-01, 03, 04, 09, 10, 17, 18, 21–24, 28 | **WS13 Extended source adapters**: legacy office (via converter), ODT, PPTX, XLSX/CSV, TEI, DITA, DocBook, LaTeX, TIFF; integration decisions per adapter |
| G-02 | Reverse conversions beyond DOCX/HTML/PDF (C16) | REV-08, REV-11 (REV-12, REV-13 conditional) | Extend WS10/C16 with EPUB→XML and EPUB→TXT; accessible interchange shared with the Accessible Formats module |
| G-03 | No distribution/retailer profile workstream | DST-01, 03, 04, 06, 07, ADV-17 (DST-02 conditional) | **WS11 Distribution profiles**: per-channel profiles, pre-submission checklists, ONIX metadata |
| G-04 | EPUB 3.4 promotion | VER-08 | Controlled change when 3.4 becomes a W3C Recommendation and EPUBCheck supports it |
| G-05 | Font licensing checks | CORE-24 | Extend WS4 (embedding) + WS9 (licence approval record) |
| G-06 | File-size optimisation | CORE-26, NFR-PRF-05 | Extend WS4 with an asset optimisation stage |
| G-07 | Reader / AT test matrix and manual a11y evaluation records | ADV-18, A11Y-13, A11Y-14 | Extend WS6 with a dated test-device matrix and manual evaluation workflow |
| G-08 | In-app notifications (email planned via I5) | WF-23 (partial) | Defer; recorded out of initial scope in P1-T02 |
| G-09 | SLA handling and production reporting | WF-24, WF-27 | **WS12 Production operations** |
| G-10 | Retention/deletion and disaster recovery | NFR-SEC-08, NFR-REL-06 | WS12 |
| G-11 | Benchmark / reference corpus and performance baselines | NFR-SCL-01, 02, 06, NFR-PRF-01, 02; category acceptance samples | WS12: build golden corpus per category and profile; record baselines before setting targets |
| G-12 | Preflight analysis and source analysis stage | CORE-02, WF-02, WF-03 | Extend WS5 with a preflight module (format/version/DRM/structure/profile recommendation) |

Blockers carried from P1-T02 (unchanged): B1 roadmap, B2 production deployment confirmation, B3 job dispatch latency, B4 default profile content, B5 EPUBCheck/Java hosting, B6 malware scanning provider, B7 sample client guidelines.

---

## 3. Proposed roadmap extensions (for product approval)

| Proposed WS | Scope | Requirements | Rationale |
| --- | --- | --- | --- |
| WS11 Distribution profiles | Channel profiles, checklists, ONIX, Kindle-ready workflow | DST-01–04, 06, 07, ADV-17, REV-13 | Required by Step 11; not covered by WS1–WS10 |
| WS12 Production operations | SLA, reporting, retention, DR, benchmarks, encryption evidence | WF-24, WF-27, NFR-SEC-07/08, NFR-SCL-01/02/06, NFR-REL-06, NFR-PRF-01/02 | Required by Steps 12–13; enterprise operations are not an engine concern |
| WS13 Extended source adapters | Formats in G-01 | SRC-01, 03, 04, 09, 10, 17, 18, 21–24, 28 | Step 5 coverage beyond the WS5 initial set |

Extensions are additive. They do not change any approved task, and must be inserted into the 300-task baseline only through a documented change request.

---

## 4. Summary counts

| Group | Count |
| --- | --- |
| VER | 12 |
| LAY | 15 |
| CAT | 43 |
| SRC | 31 |
| CORE | 27 |
| ADV | 18 |
| A11Y | 21 |
| GDL | 13 |
| REV | 15 |
| DST | 9 |
| WF | 27 |
| NFR | 31 |
| **Total** | **262** |

Status and class totals are computed from the tables above (see `P1-T03-service-scope-and-boundaries.md` §2.2).
