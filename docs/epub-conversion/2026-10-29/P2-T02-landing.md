# P2-T02 EPUB landing page

29 October 2026. Existing page → improvement: `app/(workspace)/modules/publishing/conversion-name/[submodule]/page.tsx` now renders `components/publishing/conversion/epub/epub-overview.tsx` only for EPUB. PDF and all other module branches remain unchanged.

The overview provides source/target guidance, layout/profile cards, optional guidelines policy, a five-step planning workflow, Plan a publication and Prepare an enterprise inquiry actions. Both lead to the existing workspace; inquiry preparation does not send a message or claim a contact service exists. Capability text explicitly distinguishes planned from conditional and states that conversion is unavailable.

Acceptance: responsive actual-component preview, keyboard button activation, registered-link tests and current Publishing regressions passed. The enterprise action prepares a plan for later organizational handling; no unrequested email was sent. Production deployment is not verified. Dependencies: secure submission and real adapters in later phases. No conversion backend/API added.
