# P2-T01 Existing design system and component reuse

29 October 2026 · frontend inventory and implementation mapping.

| Existing source | EPUB decision | Verification |
| --- | --- | --- |
| `app/globals.css` | Reuse background/card/muted/primary/border/focus tokens and breakpoints; no second stylesheet/theme | Desktop and 390px mobile preview |
| `components/ui/button.tsx`; `input.tsx`; `label.tsx`; `textarea.tsx`; `badge.tsx` | Reuse exact primitives and explicit field labels | Keyboard progression and visible status/error text |
| `components/ui/select.tsx`; `table.tsx`; `sheet.tsx`; `alert-dialog.tsx` | Available shared primitives; no duplicate dialog/table library added | Inventory review; not all needed in this batch |
| `components/publishing/conversion/conversion-nav.tsx` | Existing breadcrumb/tab/service route tree retained | All capability links resolve to registered EPUB slugs |
| `components/publishing/conversion/pdf/pdf-file-components.tsx` | Reuse PdfUploadDropzone without modifying PDF behavior | Actual local file chooser; explicit planning-only hint |
| `components/publishing/conversion/pdf/pdf-format-matrix.tsx` | Reuse native labeled select/filter pattern; no separate control kit | Disabled incompatible options and explanatory alternatives |
| `components/publishing/conversion/pdf/pdf-content.tsx`; `pdf-preview-components.tsx` | Reuse layout/status concepts; do not import PDF-specific fake metrics | Honest empty/unavailable states |

New components under `components/publishing/conversion/epub/` are service composition, not a new design system. Existing PDF files are untouched. Visual checklist: tokens consistent, no color-only status, fields labeled, next-step heading receives focus, mobile cards stack, no horizontal document overflow, and unavailable processing is explicit. Inventory and visual checks passed. No backend capability is inferred from frontend readiness.
