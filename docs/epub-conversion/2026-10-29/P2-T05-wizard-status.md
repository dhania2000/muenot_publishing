# P2-T05 Guided project wizard status

29 October 2026 · **frontend partial; end-to-end task acceptance pending**.

Existing EPUB workspace now composes a five-step planner: sources, book profile, output settings, optional client notes and review. It reuses `PdfUploadDropzone`, existing input/button/label/textarea primitives and the tested EPUB planning contract. Required source/title feedback, back/next, keyboard focus, Save plan, Clear plan and explicit storage errors work.

Draft metadata is stored only in browser-tab sessionStorage under the authenticated tenant/user scope passed by the server route. The component is keyed by that scope. Files/bytes/handles are not persisted or uploaded; restoration explains that files must be selected again before future upload. This is not server project persistence or a verified client-guideline rule store. Client notes remain optional, bounded and unreviewed.

Browser checks passed: empty-source error, actual fixture selection, title entry, keyboard progression, compatible target selection, blank-guideline review, save/reload restoration and visible disabled submission. The real component renders a coherent review summary; it does not claim a created project, job, charge or upload.

## Unmet prerequisite

The inspected repository has no secure generic conversion project/source-upload/submission API, no EPUB source validator/adapter and no EPUB execution handler. These are planned in subsequent intake/workflow/engine phases. The prompt requires the wizard to submit one coherent project without duplicate jobs; a local draft does not satisfy that requirement. Therefore Submit project is disabled with a reason and **P2-T05 is not marked complete**. Reusing Alt Text's unrelated asset/document endpoints would misrepresent the domain and bypass the proposed authorization/format gates.

Resume this task when server-side intake can accept exact source/profile/guideline refs, authenticated ownership, revision and idempotency fingerprint. Add streamed upload/security checks and stale/duplicate/foreign-tenant submission tests. A future integration must replace the unavailable state only after those checks pass. No user confirmation or deployment permission is being requested by this dependency report.
