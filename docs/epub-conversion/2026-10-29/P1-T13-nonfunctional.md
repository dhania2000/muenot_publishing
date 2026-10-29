# P1-T13 Performance security availability and scale

Version 1.0 · documentation only · 29 October 2026. No EPUB engine exists, so EPUB conversion throughput/latency are unmeasured. The existing Publishing regression run measured 177 tests in 5.12 seconds on this workstation; this is not a conversion benchmark. All targets below are PROPOSED until measured in staging.

| ID | Proposed initial requirement | Measurement and existing service mapping |
| --- | --- | --- |
| NFR-01 | Workload classes: small 1 MiB/20 chapters/100 images; medium 10 MiB/100 chapters/500 images; large 25 MiB/500 chapters/2,000 resources | Rights-cleared generated corpus; record source size, expanded size, page/node/resource counts and tool versions; adapters from P1-T07 |
| NFR-02 | Intake 25 MiB/file, 100 MiB/selection; 5,000 archive entries, 250 MiB expanded, XML part 4 MiB, ratio 200 ceiling | Negative boundary fixtures; reference existing `lib/alt-text/document-upload-contract.ts`, do not silently change global settings |
| NFR-03 | Interactive local draft feedback <100 ms; metadata API p95 <500 ms under 10 concurrent writers | Browser marks and load tests, excluding upload/tool work; existing SWR patterns and database pool |
| NFR-04 | Small structured book build p95 <60 s, medium <300 s; large jobs use bounded resumable stages | Measure end-to-end and each adapter/validator peak memory; not guaranteed until tool/host benchmarks pass |
| NFR-05 | Initially one heavy conversion per tenant, two per worker host; load/queue age visible | Existing `lib/background-jobs.ts` concurrency keys and `lib/observability/job-limits.ts`; test fairness, cancel and lease recovery |
| NFR-06 | No archive traversal, entity expansion, remote fetch, imported scripts or TeX shell execution | Hostile archive/XML/URL corpus, process policy and network-denial tests; existing `document-validation.ts` is a reuse pattern |
| NFR-07 | Every publication reference tenant-bound and action-scoped | Foreign-tenant/unassigned-role tests across API, jobs, preview and downloads; `lib/tenant-scope.ts` and proposed EPUB gate |
| NFR-08 | TLS/private bytes at rest verified in deployment; no source text/secrets in operational logs | Inspect hosting/DB encryption evidence; `file-metadata.ts` projected encryption label is insufficient proof |
| NFR-09 | 99.5% monthly authenticated metadata/API availability target | Synthetic authenticated probe, 30-day 216-minute error budget; distinguish planned maintenance/provider dependency outages |
| NFR-10 | Proposed RPO 24 h, RTO 4 h | Real backup/restore drill for DB blobs and metadata; no backup availability inferred from standalone build |
| NFR-11 | Recovery and idempotency | Crash mid-stage, duplicate enqueue, expired lease and cancellation tests; original source/released artifact survive and no duplicate release |
| NFR-12 | Bounded logs, storage growth and retention | Tenant quota measurements and retention/legal-hold purge tests; existing storage quota/metadata functions need actual enforcement verification |

Threat review: malicious uploader targets parser/resources and preview origin; compromised user targets cross-project files and approvals; stale worker targets active revisions; tool/provider outage targets availability and costs. Mitigations are deny-by-default intake, process isolation, immutable receipts, least privilege, stage budgets and recorded manual holds. Preserve forensic evidence without leaking publication contents.

Acceptance met for specification: every metric is explicitly proposed or measured with a measurement method. Actual capacity limits, scheduler availability on Hostinger, encryption/backup evidence and large-book benchmarks are pending deployment gates. No performance claims or production settings changed. Change log: workload classes, threat model and measurable nonfunctional targets added.
