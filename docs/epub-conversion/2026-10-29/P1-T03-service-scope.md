# P1-T03 Service scope and boundaries

Version 2.0 · 29 October 2026 · depends on P1-T01/P1-T02 · documentation only.

Current production support in this repository is a navigation placeholder. The following are target service tiers, not available conversion promises. EPUB 3.3 is the proposed production target; older EPUB imports require explicit normalization/loss reports. EPUB 3.4 remains an opt-in compatibility experiment, never a silent default.

## Scope and source mapping

| ID | Target capability and tier | Planned route and evidence to extend | Release boundary and fallback |
| --- | --- | --- | --- |
| SCP-01 | Standard: semantic reflowable books | Existing EPUB workspace/layout/TOC/metadata pages; `lib/conversion-modules.ts` | Begin with structured DOCX/HTML and rights-cleared EPUB; package and semantic review required |
| SCP-02 | Legacy import/repair: EPUB 2.0.1 and 3.0/3.0.1/3.1/3.2 | EPUB validation/history pages; no reader/repair backend yet | Preserve original, identify actual profile, normalize to 3.3; legacy export only with feature-loss report |
| SCP-03 | Designed: fixed layout, spreads, mixed spine | Layout/reader-preview pages; `pdf-preview-components.tsx` supplies UI patterns | Conditional on named reader tests and source rights; offer separate fixed and reflowable outputs if mixed support fails |
| SCP-04 | Multilingual: Unicode, RTL and vertical writing | CSS/metadata/reader-preview pages; `lib/alt-text/scientific-notation.ts` is only a text-preservation pattern | Per-language fonts, script, reading order and device tests; no blanket all-language claim |
| SCP-05 | Enhanced: audio/video/overlays and interaction | Media Manager; no multimedia builder installed | Rights, codecs, timing and accessible alternatives required; static/transcript fallback |
| SCP-06 | Specialist: STEM/medical/tables | Alt Text OCR/math/science evidence via existing authorized services | Source-grounded equations, semantic tables and human review; retain original if recognition uncertain |
| SCP-07 | Accessible publication target | Accessibility Checks plus existing Alt Text review patterns | EPUB Accessibility 1.1 target, automated and human evidence; scan pass does not establish conformance |
| SCP-08 | Multiple rendition and continuous-scroll design | Existing layout page; separate optional profile | “Roll” means a product reading presentation, not a separate EPUB standard; no universal reader guarantee |
| SCP-09 | Reverse conversions/migration | Shared conversion service registry and later Phase 17 | EPUB→HTML/text and other exports are separate adapters with loss analysis, not part of the first builder |
| SCP-10 | Optional client guidelines | `lib/guidelines/guideline-contracts.ts`; versioned Alt Text profile pattern | No guidelines uses defaults; supplied applicable mandatory rules must pass or block delivery, with explicit authorized exceptions only where permitted |

DOCX, PDF, scans, HTML/XHTML, XML dialects, LaTeX, IDML and EPUB all have individual target paths in P1-T07. A source extension is not evidence of an installed adapter. No EPUB conversion is marked available by this scope document.

## Exclusions and constraints

- Encrypted/DRM-protected or rights-unclear sources are held/rejected for authorized replacement. Do not add decryption, circumvent access controls or mutate encrypted originals.
- InDesign/other proprietary production, retailer delivery and codecs depend on lawful tools, entitlement and reproducible tests. They remain conditional until provisioned.
- Pixel-perfect fixed design, user-controlled reflow and screen-reader equivalence are separate acceptance dimensions. Record the selected tradeoff; do not promise all three for arbitrary scans.
- Client/publisher portal roles, paid execution, release claims and service SLAs need their own authorization, evidence and operational gates. Existing admin/employee sessions are not a client portal.

## Standards decisions

[EPUB 3.3](https://www.w3.org/TR/epub-33/) and [Accessibility 1.1](https://www.w3.org/TR/epub-a11y-11/) provide the stable baseline. The current [3.4 publication](https://www.w3.org/TR/epub-34/) and [Accessibility 1.2 publication](https://www.w3.org/TR/epub-a11y-12/) identify themselves as Candidate Recommendation Drafts, verified 29 October 2026. Recheck status before implementing their profiles. This is a scope decision, not a conformance assertion.

## Acceptance and traceability

SCP-01–SCP-10 have explicit present/target boundaries, fallback and existing-page mapping. P1-T05 verifies versions, P1-T06 layouts, P1-T07 source adapters, P1-T08 content categories, P1-T09 architecture and P1-T10 persistence. Functional requirements are satisfied as a specification. Open dependencies are actual engines, fixture corpus, named-reader acceptance and production operations. No runtime change. Change log: replaced provisional scope with the supplied task's explicit service tiers and unsupported cases.
