# P1-T04 Roles and action permissions

Version 1.0 · 29 October 2026 · depends on P1-T03 · documentation only.

`lib/auth.ts` and `lib/platform-schema.ts` implement only admin/employee identities. `lib/permission-store.ts` grants all view/update scopes and restricts only manage_settings to admins. `lib/api-auth.ts` authenticates a session but does not enforce a publishing plan. Therefore the matrix below is a proposed EPUB authorization contract, not present enforcement. Role assignments must extend the existing identity and permission services rather than add another login system.

## Proposed RBAC matrix

O = own submitted projects, A = explicitly assigned projects, P = publisher-scoped projects within the tenant, T = tenant administrative scope, — = denied. Administrative operational recovery does not imply editorial sign-off.

| Action and requirement ID | Client submitter | Publisher delegate | Operator | Editor | QA reviewer | Lead | Admin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ROL-01 Create project/upload source | O | P | A | — | — | A | T |
| ROL-02 View project/source | O | P | A | A | A | A | T |
| ROL-03 Edit intake/metadata | O before submission | P before approval | A | A | — | A | T with audit |
| ROL-04 Edit content/profile selection | — | request change | A | A | — | A | Only separately granted editorial role |
| ROL-05 Start/retry/cancel execution | — | — | A | — | — | A | T operational recovery |
| ROL-06 Record QA verdict | — | — | — | — | A, not own revision | A, not own revision | Only separately granted QA role |
| ROL-07 Approve editorial release | — | — | — | — | — | A, not own revision | Only separately granted lead role |
| ROL-08 Client acceptance | O designated approver | P designated approver | — | — | — | — | No impersonated acceptance |
| ROL-09 Download proof/deliverable | O authorized proof; released final | P authorized proof; released final | A | A proof | A proof | A | T subject to security gate |
| ROL-10 Archive/delete request | O request | P request | — | — | — | A request | T under retention/legal hold policy |
| ROL-11 Manage client profiles/assignments | — | P if explicitly delegated | — | — | — | A assignment only | T |
| ROL-12 Approve waivable exception | Request only | P business acceptance | Request only | Request only | A evidence | A resolution | T operational exception only |

Non-waivable safety, rights and mandatory standards constraints cannot be overridden through ROL-12. Client acceptance and internal QA approval must be separate records on an exact revision. An admin with additional reviewer permissions remains subject to independent-review constraints.

## Existing service to improvement mapping

| Current evidence | Decision and owner | Required change |
| --- | --- | --- |
| `lib/permission-model.ts`; `permission-store.ts` | EXTEND authorization | Define EPUB resource actions and explicit project/publisher membership grants; deny unknown actions |
| `lib/auth.ts`; `app/(workspace)/layout.tsx` | REUSE identity/session guard | Resolve actor first; no client-supplied role/userId/tenantId |
| `lib/alt-text/route-gate.ts`; `history.ts` | REUSE boundary pattern | EPUB server gate resolves trusted tenant and per-resource actions; UI visibility is not authorization |
| `lib/tenant-scope.ts`; `tenant-context.ts` | EXTEND fail-closed integration | Authenticated session tenant on requests; fixed runForTenant context on workers; reject missing authoritative context |
| `app/(workspace)/admin/users/actions.ts` | REUSE account management | New domain memberships refer to existing users; no new user table |
| `lib/background-jobs.ts` | INTEGRATE | Persist initiating actor and project; recheck assignment/security before execution and delivery |

## Negative authorization acceptance cases

| Test ID | Attempt | Expected result and evidence |
| --- | --- | --- |
| AUTH-01 | Anonymous create/view/download | 401; no query returning publication bytes |
| AUTH-02 | Tenant B supplies Tenant A project/file/version ID | 404; no names, metadata or timing-detail leakage |
| AUTH-03 | Same-tenant unassigned operator updates another publisher's project | 403 or scoped 404; unchanged revision |
| AUTH-04 | Editor approves their own revised output | 403; no approval inserted |
| AUTH-05 | Browser forges admin role, actor ID or tenant header | Reject fields/ignore as authority; authenticated actor retained |
| AUTH-06 | User loses assignment while a job is queued | Hold execution or authorization-sensitive step; audit reason; no new data exposure |
| AUTH-07 | Reviewer signs stale revision after content changes | 409; require current revision and independent review |
| AUTH-08 | Admin impersonates publisher acceptance | Deny; audited support access cannot create consent |
| AUTH-09 | Released output replaced by another version under same link | Immutable version/hash check; deny stale or revoked release |
| AUTH-10 | Delete held project or download quarantined file | Deny despite role; audit operational attempt |

These are specified future tests, not newly executed permission tests. Existing session/tenant tests remain code-level baseline evidence. Role and least-privilege specification acceptance is met; production multi-role enforcement is a launch dependency. No identity, permission, runtime or schema change. Change log: added explicit action ownership, separation of duties and negative cases.
