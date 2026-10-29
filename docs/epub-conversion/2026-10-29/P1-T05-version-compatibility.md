# P1-T05 EPUB version compatibility matrix

Version 1.0 · 29 October 2026 · depends on P1-T03/P1-T04 · documentation only.

No listed version is currently importable/exportable through an EPUB engine in this repository. This matrix defines proposed release profiles and fixture gates. `package.json` has no EPUBCheck, Ace or EPUB builder dependency. `lib/conversion-modules.ts` and the two dynamic conversion pages provide the future validation/metadata/workspace UI locations.

## Version profiles

| Requirement | Version and primary reference | Proposed import/repair/export policy | Package/navigation/media focus | Pass/fail fixture |
| --- | --- | --- | --- | --- |
| VER-01 | [EPUB 2.0.1 OPF](https://idpf.org/epub/20/spec/OPF_2.0.1_draft.htm) | Import/repair conditional; export only explicit legacy profile | OPF 2 package and NCX; do not carry unsupported EPUB 3 enhancements silently | V2: valid NCX hierarchy, broken spine target negative, Unicode titles; normalize to 3.3 with loss report |
| VER-02 | [EPUB 3.0](https://idpf.org/epub/30/spec/epub30-publications.html) | Import/repair conditional; prefer 3.3 output | EPUB navigation document and package 3 vocabulary; inventory media/overlays/scripts | V30: navigation/spine consistency, media fallback, invalid href negative |
| VER-03 | [EPUB 3.0.1](https://idpf.org/epub/301/spec/epub-publications.html) | Preserve source profile when inspecting; normalize to baseline for new output | Rendition properties and feature provenance | V301: fixed-layout metadata preserved, conflicting rendition metadata rejected |
| VER-04 | [EPUB 3.1](https://www.w3.org/submissions/epub31/) | Inspect legacy differences explicitly; do not infer profile from package version alone | Identify source conventions before transforming | V31: retain source files, record normalization changes; reject unsupported references |
| VER-05 | [EPUB 3.2](https://www.w3.org/publishing/epub32/epub-packages.html) | Conditional import/repair; compatibility output requires selected profile | Package/navigation and reader-dependent features recorded | V32: round-trip identifiers/navigation; report every removed feature |
| VER-06 | [EPUB 3.3](https://www.w3.org/TR/epub-33/) | Production target, still unimplemented | Required package metadata, manifest/spine/navigation, valid XHTML/resources and OCF packaging | V33: valid book, missing resource, duplicate identifier and malformed XML negatives; zero validator errors for release |
| VER-07 | [EPUB 3.4](https://www.w3.org/TR/epub-34/) | Opt-in experimental profile; never default or claimed universally stable | Snapshot exact candidate specification and supported validator capability | V34: isolated feature fixtures; unsupported validator profile is “not verified”, not passed |

The 3.4 document currently identifies a Candidate Recommendation Draft dated 28 October 2026. Verify again when building this profile. Older source labels/OPF version attributes cannot by themselves distinguish every EPUB 3 revision; preserve detection evidence and ambiguous cases for review. [EPUB Reading Systems 3.3](https://www.w3.org/TR/epub-rs-33/) is a separate compatibility reference, not proof of a particular reader implementation.

## Validation and feature loss contract

VER-08: retain the original source hash, detected conventions, selected target profile, profile revision, validator tool/version, invocation result and full structured findings. Pin the validator before running corpus tests; the [official EPUBCheck project](https://github.com/w3c/epubcheck) is the provisioning authority. Do not claim it validates an experimental profile unless that pinned tool explicitly supports it.

VER-09: a downgrade must inventory navigation, fixed layout, scripting, media overlays, audio/video, SVG/MathML and accessibility metadata. Every loss has source locator, output locator, severity, alternative and reviewer decision. A successful ZIP write is insufficient. Unexpected content loss blocks release.

VER-10: for all fixture IDs above, require archive limits, `mimetype` packaging checks, reachable manifest resources, spine order and internal-link resolution. Deliberately corrupt copies must fail with a typed location-bearing error. Re-running the same fixture must preserve normalized semantic content and avoid duplicate resources. Reader tests remain separate from validator results.

## Mapping, verification and gaps

Extend `lib/alt-text/document-validation.ts` only through shared bounded archive/XML helpers; its OOXML assumptions do not validate EPUB. Reuse findings UI from `components/publishing/conversion/pdf/pdf-processing-components.tsx`; create a version-aware EPUB adapter and package validator in later phases. Use existing Metadata, ePub Validation and Reader Preview pages.

Version specification acceptance is met: every requested version has policy and pass/fail criteria. Fixtures are designed here, not generated or passed. Tool provisioning, corpus creation and device verification remain pending. No runtime/dependency change. Change log: introduced explicit legacy, baseline and candidate profiles with feature-loss gates.
