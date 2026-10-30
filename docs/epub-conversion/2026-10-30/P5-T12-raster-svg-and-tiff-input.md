# P5-T12 — Raster SVG scanned page ingestion

Date: 2026-10-30. Global task 72. Status: implementation complete at the bounded source-import scope.

## Reuse and delivered behavior

- `lib/epub/input-images.ts`
- `lib/epub/input-tiff.ts`
- `lib/alt-text/image-header.ts`

JPEG/PNG/WebP use the existing header reader plus actual bounded independent decode/PNG encode, with verified orientation dimensions. SVG is a safe static allowlisted subset with bounded dimensions, no active/external resources, and source alternatives retained. Classic II/MM TIFF supports stripped unsigned 1/8-bit gray or 8-bit RGB(A), raw/PackBits compression, page order and orientation. It is explicitly a subset, not a complete TIFF reader; tiled/LZW/fax/palette/high-depth/BigTIFF require reviewed PNG exports. Total TIFF <=20 megapixels, <=50 pages, <=4096 strips. ICC/source-resolution fidelity, OCR and alt text remain separate review tasks.

## Acceptance and evidence

Actual PNG/JPEG/WebP pixels, a real EXIF-6 JPEG, static/active SVG, malformed/oversized images, II/MM raw multi-page TIFF and PackBits orientation are tested. TIFF bounds, cycles and unsupported compression fail explicitly without partial publication.

See [Phase 5 completion](phase-05-completion.md) for exact full regression, deployment-package smoke verification, browser coverage and remaining operational gates. Source/normalized-model status is separate from conversion, standards/accessibility conformance and release. No live database migration or malware verdict was fabricated; model/SQL fixtures do not represent a live MySQL deployment.
