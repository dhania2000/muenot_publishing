# P4-T01 — Optional client-guidelines upload

Date: 2026-10-30. Global task 46. Status: implementation_complete.

## Existing capability → improvement

- `lib/epub/intake.ts`
- `lib/epub/upload-store.ts`
- `components/publishing/conversion/epub/epub-planner.tsx`

Optional PDF/DOCX/TXT/XLSX/JSON attachments use the existing planner and staged-book finalization. At most three files of 5 MiB each; source and guideline bytes count toward the existing 100 MiB project and tenant quota. Files remain private/pending security. Actual-byte facts and hashes participate in idempotency. Submission, blobs, extraction request, immutable snapshot and receipt share one transaction.

## Acceptance and evidence

Actual optional TXT intake is replayed without duplicate project/files/jobs, and a failed receipt rolls back all guideline/source state. Multipart API tests reject missing rights, unsafe files, excessive JSON and foreign origin. No-file submissions remain valid.

The [Phase 4 checkpoint](phase-04-checkpoint.md) records exact regression/build and browser verification. Original prompts/order/source hash are unchanged in `roadmap.json`. All new persistence uses authenticated tenant/project scope. No live database migration, production malware scan, external message, licensed converter, EPUBCheck/Ace result or native screen-reader result is claimed.
