# P1-T12 Accessibility and compliance baselines

Version 1.0 · documentation only · 29 October 2026. Extend existing EPUB Accessibility Checks/ePub Validation/Reader Preview pages (`lib/conversion-modules.ts`) and findings UI in `components/publishing/conversion/pdf/pdf-processing-components.tsx`. Alt Text QA (`lib/alt-text/advanced-quality.ts`) checks image descriptions, not whole-book conformance.

| ID | Release gate | Required evidence and limit |
| --- | --- | --- |
| A11Y-01 | Publication target | Immutable EPUB 3.3 profile, source/output hashes and version-aware validator result; no broad format support from a successful ZIP write |
| A11Y-02 | Accessibility target | EPUB Accessibility 1.1 profile, declared WCAG target, evidence for each applicable criterion; project target is proposed WCAG 2.2 AA, not already achieved |
| A11Y-03 | EPUBCheck | Pinned actual tool version, exit/result findings, exact output hash; not-run/unavailable/error differ from passed |
| A11Y-04 | Ace | Pinned tool and structured automated report; automated results are only part of accessibility evaluation |
| A11Y-05 | Manual review | Named reviewer evaluates reading order, navigation, notes, equations, tables, image descriptions, media alternatives and keyboard use; criterion-level outcome |
| A11Y-06 | Assistive/reader tests | Named OS/reader/assistive technology versions, settings, fixture/output hash and findings; a browser screenshot cannot substitute |
| A11Y-07 | Client guidelines | Optional intake; supplied applicable rules mapped to automated/manual checks; unresolved mandatory conflicts block release |
| A11Y-08 | Publisher/retailer profile | Versioned distributor requirements and actual supported outputs; marketplace acceptance separate from standards validation |
| A11Y-09 | Candidate profiles | EPUB 3.4 and Accessibility 1.2 remain separate opt-in candidate profiles; reverify official status/tool support before execution |
| A11Y-10 | Claims | Generate metadata/certification wording only from substantiated exact-version evidence; failed, waived and unsupported checks remain visible |

Primary references verified on this date: [EPUB 3.3](https://www.w3.org/TR/epub-33/), [Accessibility 1.1](https://www.w3.org/TR/epub-a11y-11/), [EPUB 3.4 candidate](https://www.w3.org/TR/epub-34/), [Accessibility 1.2 candidate](https://www.w3.org/TR/epub-a11y-12/), [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [EPUBCheck](https://github.com/w3c/epubcheck), [Ace](https://daisy.github.io/ace/). No tool was installed or conformance run performed.

Acceptance review: release requires automated AND manual evidence and applicable publisher decisions; any changed bytes invalidate prior output-bound claims. Proposed tests include missing alt text, broken note backlink, malformed table headers, incorrect reading order, silent audio, inaccessible math, unsupported scripts and stale report reuse. Specification acceptance met; actual criterion coverage and reviewer/reader execution are release dependencies. No runtime change. Change log: baseline, automated/manual split and claim substantiation rules added.
