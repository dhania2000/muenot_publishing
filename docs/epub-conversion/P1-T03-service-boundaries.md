# EPUB Conversion — P1-T03 Service Boundaries & Limitations

| Field | Value |
| --- | --- |
| Roadmap item | Phase 1, Task P1-T03 |
| Verified at commit | `f3c4c84` (`main`) |
| Date | 2026-10-25 |
| Nature | **Specification only.** No code changed. |
| Covers | Step 13 (enterprise non-functional requirements), Step 14 (service boundaries) |

---

## 1. Step 13 — Enterprise non-functional requirements

Rule: **no throughput or SLA figure is guaranteed in this document.** Where a number cannot be justified from evidence, the metric names the **benchmark that must be run** to set it (task "establish baseline", gap G-11). Figures marked *config* already exist in code and are cited.

### 1.1 Security

| Req | Requirement | Acceptance metric / benchmark | Existing basis |
| --- | --- | --- | --- |
| NFR-SEC-01 | Tenant isolation | 100% of conversion queries filter by session tenant; storage keys prefixed `t/<tenantId>/`; cross-tenant access test suite passes (0 leaks) | `lib/tenant-scope.ts`, `lib/tenant-context.ts`, `lib/storage/keys.ts` (`keyBelongsToTenant`) |
| NFR-SEC-02 | Confidential manuscript handling | Sources and outputs are never public; download only through the gated route; no manuscript content in logs (log-scrubbing test) | `lib/storage/file-scanning.ts` (`downloadGatePolicyFor` fails closed) |
| NFR-SEC-03 | Secure file uploads | Allow-listed type + magic-byte check + size limit + rate limit; MZ/ELF rejected; scan status starts `pending` for conversion files (not hard-coded `clean`) | `lib/settings/uploads.ts`, `lib/rate-limit.ts`; gap IR7/E19 |
| NFR-SEC-04 | Archive and XML processing protection | ZIP: entry count, total uncompressed size, compression ratio and path-traversal limits; ZIP64/encrypted rejected unless explicitly supported; XML: DOCTYPE/external entity disabled (OCF profile allow-list only for known public identifiers in EPUB 2) | `lib/alt-text/document-validation.ts`, `DOCUMENT_ARCHIVE_LIMITS` (reuse via E12) |
| NFR-SEC-05 | Active-content restrictions | Scripts, event handlers, `javascript:` URLs, remote resources, forms and iframes removed by default (C7). Scripted profile (ADV-07) is opt-in and reviewed. Preview served sandboxed with strict CSP (C9). 0 script execution in preview penetration test | gap C7, C9 |
| NFR-SEC-06 | Role-based permissions | Distinct grants for create, review, approve, deliver, configure profile; approve/deliver denied without a grant (test) | `lib/permission-model.ts`; store is a stub → E16 |
| NFR-SEC-07 | Encryption | TLS in transit (HSTS already set); at-rest encryption provided by the database/storage provider is documented; secrets only via env | `next.config.mjs` headers; provider evidence required |
| NFR-SEC-08 | Data retention and deletion | Configurable per-tenant retention; deletion removes blobs, metadata and derivatives; deletion audit row written; verification test | gap (no retention policy in code) → G-10 |

### 1.2 Scalability

| Req | Requirement | Acceptance metric / benchmark |
| --- | --- | --- |
| NFR-SCL-01 | High-volume processing | Benchmark: books/hour per worker for P-RF DOCX (300-page reference set) **to be established** |
| NFR-SCL-02 | Large files | Max source size set per format after benchmark; current upload limits are Alt Text-specific (`lib/settings/uploads.ts`) and must not be reused blindly. Files over the limit get a clear rejection, not a timeout |
| NFR-SCL-03 | Bulk jobs | Batch of N books processed with per-item status; one failing item does not fail the batch (test) |
| NFR-SCL-04 | Queue management | Per-tenant and global concurrency caps enforced (`lib/observability/job-limits.ts`); fair scheduling across tenants (test) |
| NFR-SCL-05 | Horizontal worker scaling | Workers stateless; job claiming with row locks is safe for parallel workers (`lib/background-jobs.ts`). Dispatch beyond daily cron is required (blocker B3) |
| NFR-SCL-06 | Controlled resource consumption | Per-job CPU-time, memory and wall-clock caps; jobs exceeding them fail as permanent with a reason. Caps set from benchmark |

### 1.3 Reliability

| Req | Requirement | Acceptance metric / benchmark | Existing basis |
| --- | --- | --- | --- |
| NFR-REL-01 | Retry strategy | Transient errors retried with backoff; permanent errors not retried; dead-letter after max attempts | `lib/job-retry-policy.ts` |
| NFR-REL-02 | Failure recovery | Worker crash mid-job → job reclaimed after timeout and resumed or restarted from the last completed stage (test) | job timeouts in `lib/background-jobs.ts` |
| NFR-REL-03 | Processing logs | Every stage emits start/finish/error events | `platform_background_job_events` |
| NFR-REL-04 | Job traceability | Every output links to source checksums, profile version, guideline version, tool versions (EPUBCheck, converters) | gap C1 |
| NFR-REL-05 | Idempotent operations | Re-submitting the same request with the same idempotency key creates no duplicate job (test) | idempotency in job queue |
| NFR-REL-06 | Disaster recovery | RPO/RTO **to be agreed** with operations; backups cover DB including file blobs; restore drill documented | gap G-10 |

### 1.4 Performance

| Req | Requirement | Acceptance metric / benchmark |
| --- | --- | --- |
| NFR-PRF-01 | Upload processing | Upload validation completes within a benchmarked bound per MB; UI shows progress |
| NFR-PRF-02 | Conversion throughput | Measured per profile on the reference corpus (to be built, G-11); reported, not guaranteed |
| NFR-PRF-03 | Job latency | Time from submit to start measured; with daily cron dispatch latency is up to 24 h, which is **unacceptable** for interactive use (B3) |
| NFR-PRF-04 | Preview responsiveness | Preview page load of a chapter measured with Web Vitals; target set after the C9 spike |
| NFR-PRF-05 | File-size optimisation | Output size reduction vs unoptimised build reported per job; image quality thresholds configurable |

### 1.5 Maintainability

| Req | Requirement | Acceptance metric |
| --- | --- | --- |
| NFR-MNT-01 | Reusable architecture | No duplicate upload, job, storage, guideline or navigation module (review checklist, P1-T02 reuse matrix §7) |
| NFR-MNT-02 | Modular conversion adapters | Each source format is an adapter implementing one interface → semantic model; adding a format touches no other adapter |
| NFR-MNT-03 | Version-specific EPUB profiles | Profiles are data (C11), versioned; jobs pin profile versions |
| NFR-MNT-04 | Testable processing stages | Each stage is a pure or isolated function with unit tests; golden-file tests for packaging |
| NFR-MNT-05 | Standards upgrade compatibility | Adding a new EPUB version profile (e.g. 3.4 final) needs no change to adapters |
| NFR-MNT-06 | Regression protection | Existing suites (`test/alt-text`, `test/publishing/pdf-*`) stay green; EPUB golden corpus re-validated on every engine change |

---

## 2. Step 14 — Service boundaries

### A. Core supported scope (standard EPUB production)

EPUB 3.3 reflowable production (VER-07, LAY-01, LAY-06); EPUB 2/3.x import, upgrade and repair (VER-01, 03–06, 09, 10, 12; REV-01, 03, 04, 11, 14, 15); core capabilities CORE-01–CORE-27; DOCX, HTML, XHTML, Markdown, TXT, generic/JATS XML and EPUB sources; general-publishing categories (CAT-G01–G06); EPUBCheck validation and accessibility metadata; guideline-free default workflow (GDL-01/02).

### B. Advanced supported scope

Fixed layout and its variants (LAY-02, 03, 07–10, 12–15); STEM (CAT-A02, A05–A11, D08–D10, CORE-17–19, ADV-10/11); multilingual, RTL and vertical (ADV-13/14, CAT-D06, CAT-S04); media overlays and multimedia (ADV-01–06); full accessibility programme (A11Y-01–21); visual categories (CAT-V01–V05, V07–V10); reflowable ↔ fixed reconstruction (REV-05/06); EPUB → HTML/XML/DOCX (REV-07, 08, 10); OCR-assisted sources (SRC-12, 13, 29).

### C. Publisher-specific scope

Client guidelines GDL-03–GDL-12; publisher XML mappings (SRC-19, 25); legacy EPUB 2.0.1 output (VER-02, VER-11, REV-02); distribution profiles (DST-01–07, ADV-17); ONIX metadata; custom CSS profiles; naming and packaging conventions.

### D. Integration-dependent scope

| Item | Dependency | Lawful alternative until available |
| --- | --- | --- |
| DOC, RTF (SRC-01, 03) | Licensed or sandboxed office converter | Client exports DOCX |
| INDD (SRC-17) | Licensed Adobe InDesign Server | Client exports IDML or EPUB |
| QuarkXPress (SRC-18) | Client export | Client exports a supported format |
| PDF sources (SRC-11–15) | PDF text/layout extraction engine (none exists) | FXL page images + OCR; manual restructuring |
| LaTeX (SRC-24), DITA (SRC-22) | LaTeXML/TeX4ht/Pandoc; DITA-OT (sandboxed) | Client supplies DOCX/XML/PDF |
| Complex XSLT mappings (SRC-20–23) | XSLT 2/3 processor (licence review) | Native mapping for supported subset |
| MathType / OMML (SRC-31) | Vendor or transform tooling | Images + alt text |
| EPUBCheck (CORE-27) | Java runtime / worker (B5) | Report "EPUBCheck: not verified"; internal checks only; no "valid" claim |
| Malware scanning | Scanning provider (B6) | Signature checks + fail-closed download gate |
| Forced audio alignment (ADV-02) | Alignment tool | Client supplies timing data |
| EPUB → PDF (REV-09) | Rendering engine | Client-side print from reader; out-of-band typesetting |
| Accessible formats (REV-12) | Planned Accessible Formats module | Deliver accessible EPUB 3.3 |
| Kindle (REV-13, DST-02) | Amazon tools for proprietary formats and QA | KDP-ready EPUB; manual Kindle Previewer QA by operator |
| Retailer or distributor submission (DST-08) | Distributor APIs | Manual upload by client |
| Additional OCR languages | Tesseract language packs (integrity-checked like eng/hin) | Manual keying |

### E. Conditional / experimental scope

| Item | Condition | Limitation / route |
| --- | --- | --- |
| EPUB 3.4 (VER-08) | Candidate Recommendation Draft; validator and reader support unverified | Opt-in, 3.3-valid output only, report lists CR features |
| Mixed layout (LAY-04) | Inconsistent reader support | Separate packages, or a fully reflowable version with FXL plates as images |
| Multiple renditions (LAY-05, ADV-16) | Very limited support | Two separate EPUBs |
| Roll / continuous scroll (LAY-11) | `rendition:flow` often ignored | Paginated fallback always delivered |
| Scripted EPUB (ADV-07) | Reader-dependent, security review | Non-scripted fallback mandatory (ADV-08) |
| AI-assisted extraction and alt text | Model quality, credit availability | Human review mandatory; AI output never auto-approved |

### F. Out-of-scope or restricted scope

| Item | Reason | Lawful alternative / route |
| --- | --- | --- |
| DRM removal or circumvention | Legal (anti-circumvention law) | Client supplies the DRM-free master file |
| Reverse engineering unsupported proprietary formats | Legal and licensing | Licensed integration (class D) or client export |
| Copyright-infringing source acquisition | Legal | Client warrants rights at submission (checkbox + audit) |
| Identical rendering across all reading systems | Technically impossible | Tested-reader list in the delivery report (ADV-18) |
| Store-acceptance guarantee | Retailer discretion | Pre-submission checklist (DST-09) |
| Unrelated ERP functionality (finance, HR, inventory) | Outside module scope | — |
| Full replacement of PDF/XML services | Duplication (P1-T02 reuse matrix §7) | EPUB consumes shared services; PDF engine built by the PDF workstream |
| Generating proprietary retailer formats (KPF, KFX, AZW3, KEPUB) | Proprietary | EPUB delivered; retailer converts |
| Legal accessibility certification | Requires an accredited certifier | Evidence report; `a11y:certifiedBy` only when a certifier is named by the client |
| Math OCR from equation images | Not supported by current OCR stack | Manual re-keying into MathML or LaTeX |

### Exception route (applies to every class D/E/F item and any failed check)

1. Preflight or processing raises a typed finding: `unsupported`, `integration-required`, `conditional` or `restricted`.
2. The job pauses at **Review** (never silently continues with loss).
3. The production user chooses: alternative route (as listed), client clarification request, approved exception (C13, with reason and approver), or rejection.
4. The decision is written to the audit log and appears in the client compliance/delivery report.
