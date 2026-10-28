# Existing Alt Text test failures — resolved before Task 18

Date: 2026-10-28. Follows Task 17 commit `3213386` on `feat/phase3-task08-math-ocr`.

## Root causes and changes
- One OCR test expected the old minimal request shape. It now includes the parser's deliberate `languageMode: null` default, preserving the distinction between recognition language and description language.
- Eleven credit tests mocked wallet/platform/usage-meter modules that no longer exist in the standalone application. The active engine issues SQL directly to `ai_credit_reservations` and `ai_credit_ledger`; the old SELECT-only mock never implemented those writes. The tests now execute the real engine and mock the SQL boundary only, with conditional state transitions, tenant/request unique keys, ledger uniqueness and transactional rollback.
- Pricing checks now use the actual standalone catalog tiers and unchanged production tier rates. Monthly budget checks use the real optional `AI_MONTHLY_CREDIT_LIMIT`, rather than a nonexistent wallet balance. Assistant defaults are checked through existing ledger metadata. Released request keys stay unique; retrying a released request requires a new operation ID, matching the existing standalone contract.

## Production issues exposed by the corrected tests
1. Monthly limit rejection used an undefined `budget_exceeded` error code cast through `any`. It now uses the supported `tenant_budget_exceeded` code and returns HTTP 402 with `insufficient_credits` details before the provider runs.
2. Settlement updated the reservation before separately writing its ledger row. A ledger failure followed by retry could therefore skip the ledger permanently while reporting success. Both writes now run through the shared database transaction helper. A failed ledger insert rolls back the reservation transition; one retry can complete once, while two failures leave the reservation held and explicitly pending reconciliation. Existing tier prices are unchanged.

Two new fault-injection regression tests exercise a failed ledger write followed by successful retry and failure of both ledger attempts. Existing checks still cover conservative reservation sizing, provider failure release, missing-usage estimation/reconciliation, settled replay, concurrent duplicate requests, retry before settlement, tenant/user isolation, distinct regeneration IDs and assistant provenance.

## Validation
- Focused credit and OCR files: 32 passed, zero failed.
- Full Alt Text suite: 998 passed, zero failed, 3 skipped (1001 tests in 94 files). The existing exploratory `zz-explore` file remains excluded.
- TypeScript passed. Production webpack build and standalone preparation passed.
- Real MySQL migration/concurrency, an authenticated tenant and paid-provider execution were unavailable. SQL behavior and transaction faults were verified with a boundary fake against the real service; this is not a live database concurrency claim.

Task 18 was not started while these failures were being fixed.
