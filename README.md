# Muenot Publishing — Complete Source Archive

Extracted from the Muenot ERP repository (`dhania2000/muenot_erp`) at commit
`b442e90e7665af1452bdc29b0e02439509cc5f2d` on 2026-10-11T20:38:53.138Z.

**This is a source-code archive for a future standalone migration. It is NOT a
standalone deployable application.** The Publishing code still imports ERP
infrastructure (auth, tenancy, permissions, AI provider + credits, storage,
the durable background-job queue). Reference copies of those shared files are
included under `_erp-shared/` so the integration contract is visible,
but they must be replaced with standalone equivalents (or adapters) before the
Publishing website can run on its own.

## Layout

| Path | Contents | Files |
| --- | --- | --- |
| `app/(workspace)/modules/publishing/` | Publishing dashboard + Alt Text pages | 2 |
| `app/api/alt-text/` | All Alt Text API route handlers | 23 |
| `components/publishing/` | Alt Text workspace, bulk, document and history UI | 23 |
| `lib/alt-text/` | Services: generation, vision, credits, batches, jobs, retry, export, documents, PPTX extraction | 39 |
| `test/alt-text/`, `test/publishing/` | Publishing unit/route tests | 34 |
| `database/migrations/` | Publishing schema migrations (copies; still retained in ERP) | 5 |
| `_erp-shared/` | Reference copies of shared ERP dependencies (pre-removal versions) | 58 |
| `_config-reference/` | ERP configuration references (package.json, tsconfig, vitest, …) | 6 |

Repository-relative paths are preserved: copying the Publishing-only folders
back into an ERP checkout at the same paths restores them exactly.

## Database tables (data remains in the ERP database — nothing was dropped)

Created by the archived migrations: `alt_text_assets`, `alt_text_batches`, `alt_text_document_images`, `alt_text_documents`, `alt_text_exports`, `alt_text_projects`, `alt_text_settings`, `alt_text_versions`.
Additionally altered: none.

Background jobs of type `alt_text.batch_processing` may still exist in
`platform_background_jobs`; the ERP no longer claims them, so they remain
queued/untouched for migration.

## Environment variables

See `.env.example` (names only, no values): `AI_GATEWAY_API_KEY`, `ALT_TEXT_CREDIT_WAIT_SECONDS`, `ALT_TEXT_GLOBAL_MAX_CONCURRENCY`, `ALT_TEXT_MAX_CONFIG_RETRIES`, `ALT_TEXT_MAX_IMAGE_ATTEMPTS`, `ALT_TEXT_RETRY_BASE_SECONDS`, `ALT_TEXT_RETRY_MAX_SECONDS`, `ALT_TEXT_TENANT_MAX_CONCURRENCY`, `OPENAI_API_KEY`.

## npm dependencies used by Publishing

- `ai` 7.0.113 — also used by other ERP modules
- `exceljs` ^4.4.0 — Publishing-only
- `fast-xml-parser` ^5.11.2 — also used by other ERP modules
- `lucide-react` ^1.16.0 — also used by other ERP modules
- `mysql2` 3.24.3 — also used by other ERP modules
- `next` 16.3.8 — also used by other ERP modules
- `react` ^19 — also used by other ERP modules
- `server-only` (framework / transitive) — also used by other ERP modules
- `sonner` ^2.0.8 — also used by other ERP modules
- `swr` ^2.5.1 — also used by other ERP modules
- `vitest` ^5.0.1 — also used by other ERP modules

## Integrity

`publishing-extraction-manifest.json` lists every file with its SHA-256 and
size. Re-verify with:

    node scripts/publishing-extraction/extract-publishing.mjs --verify

See `publishing-dependencies.md` for the decoupling checklist.
