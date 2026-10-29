# P1-T14 Dependencies limitations and technical risks

Version 1.0 · documentation only · 29 October 2026. Likelihood/impact use high/medium/low engineering estimates. Each gate must be evidenced before declaring the corresponding roadmap capability ready.

| ID | Dependency and reproducible evidence | Likelihood / impact | Owner, mitigation and roadmap gate |
| --- | --- | --- | --- |
| RISK-01 | No EPUB engine/validator/reader in package.json or API inventory | High / high | EPUB engine/QA; implement package core and provision pinned tools; Phases 9 and 18; unavailable state until real fixture pass |
| RISK-02 | permission-store.ts grants all scopes; no client role identity | High / high | Authorization; explicit resource grants/memberships and negative tests before external workflow; Phases 3, 7 and 19 |
| RISK-03 | storage/index.ts writes scan_status clean without antivirus | High / high | Security; bounded preflight plus configured scan strategy; hold unverified inputs; Phases 3, 6 and 19 |
| RISK-04 | Untrusted ZIP/XML/HTML/TeX requires new adapters | High / high | Ingestion/security; hostile corpus, no remote entities/scripts, process/time budgets; Phases 5–6 |
| RISK-05 | OCR packs/model readiness and accuracy vary; math-engine.ts gates provisioning | High / high | Content lead; source-grounded review, low-confidence holds and manual correction; Phases 6 and 13; never certify recognition from installation |
| RISK-06 | IDML/proprietary exports/codecs/fonts need entitled tools and license review | Medium / high | Operations/rights owner; dependency SBOM and recorded entitlement; alternative lawful structured source; Phases 5, 12, 16 and 17 |
| RISK-07 | Readers disagree on mixed, multiple, scripted, RTL/vertical layouts | High / high | Reader QA; named-reader corpus and static/separate-edition fallbacks; Phases 11, 12, 15 and 18 |
| RISK-08 | Hostinger worker/process limits and cron scheduling unverified | Medium / high | Operations; real staged build/job/lease/cancel tests and scheduler receipt; Phases 19–20; manual processing hold on missing capacity |
| RISK-09 | Duplicate guideline contracts; Alt Text rules are not EPUB policy | High / medium | Guidelines owner; canonical adapter, optional intake, immutable selection and conflict evidence; Phase 4 |
| RISK-10 | Database blob growth, default retention and backup assumptions | Medium / high | Storage/operations; quota, durable holds and restore benchmarks; Phases 19–20 |
| RISK-11 | Candidate standards change after specification date | Medium / medium | Standards/QA; pin profile snapshot and reverify official status; Phases 9, 14 and 18 |
| RISK-12 | AI suggestions incur cost and can invent content | Medium / high | AI/content owner; explicit paid-stage authorization, source provenance and human review; Phases 6, 13 and 19 |

Primary evidence paths: `lib/background-jobs.ts`, `lib/permission-store.ts`, `lib/storage/index.ts`, `lib/alt-text/math-engine.ts`, `lib/guidelines/contract.ts`, `lib/guidelines/guideline-contracts.ts`, `package.json`, `next.config.mjs`. Current hosted tool versions, backup contracts, rights and license approvals were not inspected or assumed. No new software downloaded.

Dependency decision records must include version/hash, license/redistribution assessment, installation owner, health check, invocation limits, supported profile list, fixture receipts and fallback. Proprietary capability remains unavailable while any entitlement gate is unresolved.

Specification acceptance met: risks are ranked, reproducible and owned, with phased gates and contingencies. These mitigations remain implementation work. No runtime or policy change. Change log: current-code risk register and dependency evidence contract added.
