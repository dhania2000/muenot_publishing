# P5-T08 — TEI DITA and custom XML mapping

Date: 2026-10-30. Global task 68. Status: implementation complete at the bounded source-import scope.

## Reuse and delivered behavior

- `lib/epub/input-markup.ts`
- `lib/epub/input-schema.ts`
- `scripts/epub-xsd-worker.mjs`
- `components/publishing/conversion/epub/epub-input-review.tsx`

TEI/DITA and authorized custom tags use validated per-request mappings into known content kinds, with namespaces, section nesting, notes, references and unmapped-source paths retained. Pair an XML source with an uploaded same-project XSD reference. Both security-cleared byte identities are verified and the schema SHA/validator/result recorded. XML <=1 MiB, XSD <=256 KiB. libxml2-wasm@0.7.2 runs in a separate hidden Node process with a five-second deadline, 96 MiB JS heap and 128 MiB WASM cap. XML I/O providers deny all external resources; DTDs/includes/imports/redefines/overrides are rejected. Cancellation/disabled/failure/timeout cannot return a pass.

## Acceptance and evidence

The actual WASM validator accepts valid XML and rejects invalid content; XXE, external schema references, excessive input, cancelled/disabled checks and a foreign-project-name pairing are tested. A real SQL-model source job loads its exact XSD and records proof. The standalone worker is tested from the deployment package, not only source checkout.

See [Phase 5 completion](phase-05-completion.md) for exact full regression, deployment-package smoke verification, browser coverage and remaining operational gates. Source/normalized-model status is separate from conversion, standards/accessibility conformance and release. No live database migration or malware verdict was fabricated; model/SQL fixtures do not represent a live MySQL deployment.
