# P2-T03 EPUB types and capabilities

29 October 2026. Existing EPUB overview/layout/accessibility/media/validation pages → `lib/epub/intake-plan.ts`, `epub-overview.tsx` and `epub-requirements.tsx` in `components/publishing/conversion/epub/`.

Eight profiles cover reflowable, fixed, mixed, continuous/roll, accessible, enhanced/media, STEM and legacy EPUB. Each includes suitable source types, description, limitation, planned/conditional status and a registered requirements-page action. Requirements pages show actual profile guidance and a return to the planner, rather than an empty destination. No capability is marked available, and DRM bypass is explicitly unsupported.

Acceptance: all profile names and destinations are covered by rendering/registry tests; desktop/mobile preview verifies scannability and no fabricated metrics or success state. Dependencies: actual reader, validator, adapter and rights evidence. No separate route tree or duplicated design system added.
