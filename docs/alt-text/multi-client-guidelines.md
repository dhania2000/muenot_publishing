# Multiple client guidelines and independent writer selection

Implemented 29 October 2026.

## Writer workflow

1. A settings manager opens Settings → Client Guidelines → Add client, enters the client's name and literal rules, then chooses Save client. Multiple named clients can coexist; search finds saved clients by name.
2. In Generation Settings, a writer opens Search / change client and selects the client for that image, batch or document. Clear client uses standard settings.
3. Expert A can select Client A while Expert B selects Client D. Selections live in their respective work settings; selecting a client never updates the tenant's settings or another writer's selection.
4. The server applies the selected saved version to generation prompts, review warnings and QA. The generated result records the client name, ID, version and rules. Manual edits can also bind a selected client.

Client rules retain the existing bounded format: required literal terms, terms to flag for review, and an optional detailed-description requirement. There are at most 10 rules per client, with literal terms up to 80 characters. Rules do not authorize invented labels, altered notation or factual claims. Source conflicts remain reviewer decisions.

## Persistence and concurrency

- Two additive tables hold tenant-scoped profiles and immutable versions. The SQL migration is `database/migrations/2026-10-29-alt-text-client-guidelines.sql`; first-use application initialization also creates the tables idempotently.
- The library supports up to 500 saved profiles per tenant, 20 search results per page, duplicate-name rejection, archive and restore. Settings managers manage the library; authorized writers can read/select its active clients.
- Each profile update requires its current version and appends a new version. Stale manager edits return a conflict and keep the UI draft. Existing work continues using its saved version until the writer explicitly changes selection.
- The client ID/version pair travels through existing generation, batch and document settings. Per-image batch overrides retain both fields together even when two clients have the same version number.
- Generation resolves the tenant-owned profile/version before a processing claim or provider charge. Foreign, missing or archived selections fail closed. A charged request cannot be replayed under a different client selection.
- Successful active generation and explicit manual edits persist the selection in the asset's existing settings JSON. Regeneration candidates retain their own evidence without changing approved active content or its client binding. Accepting a candidate uses the candidate's client snapshot, even if the editor subsequently changes the settings panel.
- QA reads the saved image selection, including historical versions of archived clients. Older descriptions use their own recorded generation snapshot; they do not inherit another client's current tenant settings.
- Profile creation uses a tenant transaction lock for catalogue limits and duplicate-name checks. Writer selection does not acquire this catalogue write lock.

## Compatibility

The previous single client policy is imported additively into a named profile on library access. Original settings and generated evidence remain intact. The imported policy is not automatically selected for everyone. Cached clients attempting the old tenant-wide policy write receive `CLIENT_GUIDELINE_LIBRARY_REQUIRED` and must reload Settings. Ordinary accessibility settings retain their existing revision checks.

Client library drafts survive switching Settings sections, participate in the outer unsaved-change warning, and use their own Save client / Discard client draft controls. The tenant Save settings button continues to save accessibility preferences independently.

## Validation

- Full default suite: **1,559 passed, 0 failed, 3 skipped** across 149 files. The existing skips require opt-in model/live integration environments.
- TypeScript `--noEmit`: passed.
- Production Next.js webpack build and standalone packaging: passed.
- Added 23 regression cases covering independent profiles and writers, tenant isolation, historical versions, concurrent stale writes, archive/restore, migration, search paging, permission enforcement, bounded requests, generation evidence, replay conflicts, manual edits, batch override pairs and approved candidate preservation.
- Browser verification used actual React library/selector components with clearly labelled synthetic network responses: Client A and Client D selected independently, Client B created, Client A updated to v2 while existing work retained v1, client draft retained across section changes, and 390px mobile layout without horizontal overflow.

The SQL boundary tests use an in-memory transaction model. Live MySQL, production authentication, paid providers and the deployed hosting environment were not exercised. Deployment and a live database smoke test remain operational verification steps; this report does not claim those completed.
