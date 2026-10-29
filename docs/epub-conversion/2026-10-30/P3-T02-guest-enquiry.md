# P3-T02 Guest enquiry and authenticated submission

30 October 2026 · global task 32 · **complete at the bounded intake scope below**.

## Requirements and behavior

Foundation requirement mapping: AUTH-01–03, ROL-01, NFR-07.

The public /epub-enquiry page captures quotation requests separately from authenticated production submissions. Bounded JSON, strict fields, consent, honeypot, same-origin checks, per-instance rate limit and a durable 50/hour installation limit protect capture. Public enquiries target only the server installation default tenant and require a configured organization. New enquiry rows are durable private in-app administrator notifications, shown in the scoped EPUB workbench. No email is sent or private publication content logged.

## Existing service to improvement map

- `app/epub-enquiry/page.tsx`
- `app/(auth)/login/page.tsx`
- `app/api/conversion/epub/enquiries/route.ts`
- `lib/epub/enquiries.ts`
- `components/publishing/conversion/epub/epub-enquiry.tsx`
- `test/publishing/epub-enquiry.test.ts`

Identity, private storage, shared uploader, conversion project writer, UI primitives and the secret-authenticated scheduler are extended rather than copied. No second execution queue, login system or public publication storage is introduced.

## Verification and limitations

Consent/honeypot/authority/body/origin/rate/duplicate/inbox authorization tests passed. Browser mock enquiry receipt and 390px layout passed. Existing sign-in and administrator-approved account onboarding are reused. An enquiry never verifies email ownership, creates an account, identifies a private project or authorizes submission; contact addresses remain explicitly unverified.

See [batch 4 report](batch-04-report.md) for exact full-suite/build results, schema/deployment gates and screenshot evidence. Earlier Task 30 native screen-reader verification remains partial; this task does not close it.
