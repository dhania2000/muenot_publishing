# P4-T02 — Guidelines document format ingestion

Date: 2026-10-30. Global task 47. Status: implementation_complete.

## Existing capability → improvement

- `lib/epub/guideline-ingestion.ts`
- `lib/epub/package-inspection.ts`

Reuse the safe ZIP/CRC/path inspector, positioned PDF parser, fast-xml-parser and installed ExcelJS. UTF-8 TXT uses line references; structured rules use JSON pointers; DOCX uses paragraph/table references; XLSX uses sheet/cell references; PDFs use page references. Native text is an unapproved extraction, not automatically a rule. Formula evaluation, external references, macros and nested workbooks are rejected or explicitly held for interpretation.

## Acceptance and evidence

Real synthetic DOCX, XLSX, TXT, JSON and scanned PDF bytes exercise ingestion. Damaged/encrypted/unsupported and bounded/truncated content produce actionable review rather than complete-extraction claims.

The [Phase 4 checkpoint](phase-04-checkpoint.md) records exact regression/build and browser verification. Original prompts/order/source hash are unchanged in `roadmap.json`. All new persistence uses authenticated tenant/project scope. No live database migration, production malware scan, external message, licensed converter, EPUBCheck/Ace result or native screen-reader result is claimed.
