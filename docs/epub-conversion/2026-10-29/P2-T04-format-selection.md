# P2-T04 Source and output selectors

29 October 2026. Existing EPUB workspace → `components/publishing/conversion/epub/epub-planner.tsx`; pure format/draft contract → `lib/epub/intake-plan.ts`. Reuses the existing PDF file selector and native labeled-select pattern.

Source type is suggested from the filename, explicitly not a byte/content validation verdict. Output selectors cover source, version, layout, rendition and optional profile. Legacy EPUB 2 only allows a single standard reflowable plan; undefined roll/multiple and roll/enhanced combinations are disabled with visible reasons and a standard 3.3 alternative. Saved drafts are strictly revalidated before restoration, including bounded metadata, known enum values and compatible combinations.

Acceptance: pure tests exercise type detection, invalid combinations, oversized/corrupted/spoofed drafts and round-trip settings; browser verifies legacy choices disable fixed/mixed/roll and restores the selected target after reload. No invalid or valid plan can silently submit a job because submission is explicitly unavailable. Backend validation must be added at real intake; frontend validation alone is not a security boundary.
