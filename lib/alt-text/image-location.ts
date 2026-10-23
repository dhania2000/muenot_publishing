/**
 * @file lib/alt-text/image-location.ts
 * @module Publishing · Alt Text
 * @kind Shared library (pure, browser-safe, no I/O)
 * @summary Phase 3 Task 8 — image location & context model. Format-specific geometry rules
 *   (PDF CTM, PPTX xfrm) normalize displayed placement into one documented coordinate system;
 *   DOCX gets structural locations only (pagination is layout-dependent). Stored inside the
 *   existing `image_position_json` column under `location`, so no schema change is needed and
 *   rows extracted before Task 8 stay valid (see `resolveImageLocation`).
 *
 * Coordinate system (`visible_page_top_left` / `slide_top_left`): origin at the top-left corner
 * of the page as displayed (PDF: CropBox after /Rotate) or of the slide, x to the right, y
 * downwards, both divided by the displayed width/height so a fully visible box lies in [0, 1].
 */

export const IMAGE_LOCATION_VERSION = 1

/** exact = read directly from document geometry; derived = computed through supported transforms. */
export type LocationAccuracy = "exact" | "derived" | "approximate" | "unknown"
export type LocationMappingStatus = "mapped" | "partial" | "unavailable"
export type LocationDocumentType = "pdf" | "pptx" | "docx"
export type CoordinateSystem = "visible_page_top_left" | "slide_top_left"

export type NormalizedBounds = { x: number; y: number; width: number; height: number }
export type NormalizedPoint = [number, number]

export type ImageLocationIssue =
  | "ROTATED_BOUNDS"
  | "SKEWED_TRANSFORM"
  | "DEGENERATE_TRANSFORM"
  | "NON_FINITE_GEOMETRY"
  | "PARTIALLY_OUTSIDE"
  | "OUTSIDE_VISIBLE_AREA"
  | "CLIPPED"
  | "CLIPPED_OUT"
  | "COMPLEX_CLIP"
  | "FORM_TRANSFORM"
  | "CROPPED"
  | "PADDED"
  | "INVALID_CROP"
  | "GROUP_TRANSFORM"
  | "NON_UNIFORM_GROUP_ROTATION"
  | "GEOMETRY_MISSING"
  | "PLACEHOLDER_GEOMETRY"
  | "INVALID_PAGE_BOX"
  | "INVALID_SLIDE_SIZE"
  | "LAYOUT_DEPENDENT"
  | "FLOATING_ANCHOR"
  | "LEGACY_RECORD"
  | "INVALID_STORED_LOCATION"

export const ISSUE_TEXT: Record<ImageLocationIssue, string> = {
  ROTATED_BOUNDS: "Rotated image — bounds are the axis-aligned box around the rotated outline.",
  SKEWED_TRANSFORM: "Skewed image — bounds enclose the transformed outline.",
  DEGENERATE_TRANSFORM: "The drawing transform has no area, so no position can be computed.",
  NON_FINITE_GEOMETRY: "The source geometry contains invalid numbers.",
  PARTIALLY_OUTSIDE: "Part of the image lies outside the visible area; bounds show the visible part.",
  OUTSIDE_VISIBLE_AREA: "The image is drawn entirely outside the visible area.",
  CLIPPED: "A clipping rectangle hides part of the image; bounds show the visible part.",
  CLIPPED_OUT: "A clipping path hides the image completely.",
  COMPLEX_CLIP: "A non-rectangular clipping path is active; the visible area may be smaller.",
  FORM_TRANSFORM: "Placed through nested Form XObject transforms.",
  CROPPED: "The picture is cropped inside its frame.",
  PADDED: "The picture is inset inside its frame (negative crop).",
  INVALID_CROP: "The crop values are invalid and were ignored.",
  GROUP_TRANSFORM: "Placed through group transforms.",
  NON_UNIFORM_GROUP_ROTATION: "Rotation inside a non-uniformly scaled group may render differently.",
  GEOMETRY_MISSING: "The document does not record a position for this image.",
  PLACEHOLDER_GEOMETRY: "Position is inherited from a layout placeholder and was not resolved.",
  INVALID_PAGE_BOX: "The page has no valid visible area.",
  INVALID_SLIDE_SIZE: "The presentation does not declare a valid slide size.",
  LAYOUT_DEPENDENT: "Word pagination depends on layout, so no page number or page position is claimed.",
  FLOATING_ANCHOR: "Floating image — offsets are relative to its anchor, not to a rendered page.",
  LEGACY_RECORD: "Extracted before location mapping; derived from stored data.",
  INVALID_STORED_LOCATION: "Stored location data was invalid and was ignored.",
}

export type ImagePlacement = {
  /** Source-space box: PDF points in unrotated user space (y up) or EMU in slide space (y down). */
  x: number
  y: number
  width: number
  height: number
  unit: "pt" | "emu"
  /** Clockwise degrees as displayed, null when not applicable. */
  rotation: number | null
  flipH?: boolean
  flipV?: boolean
}

export type StructuralStepKind =
  | "page"
  | "slide"
  | "form"
  | "group"
  | "body"
  | "header"
  | "footer"
  | "section"
  | "table"
  | "row"
  | "cell"
  | "paragraph"
  | "run"
  | "inline_image"
  | "floating_image"
  | "grouped_image"
  | "picture"
export type StructuralStep = { kind: StructuralStepKind; index: number | null; id?: string | null }

export type ReadingOrderBasis = "pdf_structure_tree" | "pdf_content_stream" | "pptx_shape_tree" | "docx_document_order" | "docx_header_footer"
/** `verified` is true only when the order comes from accessibility structure (tagged PDF). */
export type ReadingOrderRef = { index: number; basis: ReadingOrderBasis; verified: boolean }

export type CaptionMethod = "pdf_struct_caption_child" | "docx_caption_style_adjacent" | "docx_seq_field_adjacent"
export type CaptionRef = { source: string; text: string | null; method: CaptionMethod; confidence: "structural" | "ambiguous" }

/** Bounded references for Task 9 context analysis — identifiers and short labels, never bulk text. */
export type ImageContextRefs = {
  partName?: string | null
  section?: number | null
  heading?: { ref: string; text: string | null } | null
  paragraph?: { ref: string; paraId?: string | null } | null
  tableCell?: { ref: string } | null
  nearbyText?: { ref: string; position: "before" | "after" }[]
  slideTitle?: string | null
  notesPart?: string | null
  pictureName?: string | null
  pictureTitle?: string | null
  pageLabel?: string | null
  structRef?: string | null
  /** Points at sourceMetadata.originalDescription; the text itself is never copied here. */
  existingAlt: { present: boolean; source: string | null }
  caption: CaptionRef | null
}

export type ImageLocation = {
  version: typeof IMAGE_LOCATION_VERSION
  documentType: LocationDocumentType
  status: LocationMappingStatus
  accuracy: LocationAccuracy
  coordinateSystem: CoordinateSystem | null
  /** Visible part of the image, clamped to [0, 1]; null when not reliably known. */
  bounds: NormalizedBounds | null
  /** Unclipped normalized box when it differs from `bounds` (may exceed [0, 1]). */
  fullBounds: NormalizedBounds | null
  /** Normalized outline corners (image bottom-left, bottom-right, top-right, top-left) when rotated/skewed. */
  quad: NormalizedPoint[] | null
  placement: ImagePlacement | null
  /** Intrinsic pixel size of the image binary — not its displayed size. */
  intrinsicSize: { width: number; height: number } | null
  structural: { part: string | null; label: string; path: StructuralStep[] }
  readingOrder: ReadingOrderRef
  context: ImageContextRefs
  issues: ImageLocationIssue[]
}

export const ACCURACY_LABEL: Record<LocationAccuracy, string> = {
  exact: "Exact",
  derived: "Derived",
  approximate: "Approximate",
  unknown: "Unavailable",
}

const round = (n: number, digits = 6) => {
  const f = 10 ** digits
  const r = Math.round(n * f) / f
  return Object.is(r, -0) ? 0 : r
}
const finite = (...ns: number[]) => ns.every((n) => typeof n === "number" && Number.isFinite(n))
const TOL = 1e-6

type Box = [number, number, number, number]
const boxOf = (pts: NormalizedPoint[]): Box => {
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}
const intersect = (a: Box, b: Box): Box | null => {
  const r: Box = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]
  return r[2] - r[0] > TOL && r[3] - r[1] > TOL ? r : null
}
const toBounds = (b: Box): NormalizedBounds => ({ x: round(b[0]), y: round(b[1]), width: round(b[2] - b[0]), height: round(b[3] - b[1]) })
const sameBox = (a: Box, b: Box) => a.every((v, i) => Math.abs(v - b[i]) < TOL)
const UNIT: Box = [0, 0, 1, 1]

type Geometry = Pick<ImageLocation, "accuracy" | "coordinateSystem" | "bounds" | "fullBounds" | "quad" | "placement" | "issues">

const RANK: Record<LocationAccuracy, number> = { exact: 0, derived: 1, approximate: 2, unknown: 3 }
const worse = (a: LocationAccuracy, b: LocationAccuracy) => (RANK[b] > RANK[a] ? b : a)

/** Clamp an outline to the visible area (optionally a clip box first) and record what was cut. */
function finishGeometry(quad: NormalizedPoint[], clipBox: Box | null, accuracy: LocationAccuracy, issues: ImageLocationIssue[], keepQuad: boolean, placement: ImagePlacement, cs: CoordinateSystem): Geometry {
  const full = boxOf(quad)
  let visible: Box | null = full
  if (clipBox) {
    visible = intersect(full, clipBox)
    if (!visible) issues.push("CLIPPED_OUT")
    else if (!sameBox(visible, full)) {
      issues.push("CLIPPED")
      // A clip box cut through a rotated outline is a box, not the visible shape.
      if (keepQuad) accuracy = worse(accuracy, "approximate")
    }
  }
  if (visible) {
    const onPage = intersect(visible, UNIT)
    if (!onPage) issues.push("OUTSIDE_VISIBLE_AREA")
    else if (!sameBox(onPage, visible)) issues.push("PARTIALLY_OUTSIDE")
    visible = onPage
  }
  return {
    accuracy,
    coordinateSystem: cs,
    bounds: visible ? toBounds(visible) : null,
    fullBounds: visible && sameBox(visible, full) ? null : toBounds(full),
    quad: keepQuad ? quad.map(([x, y]) => [round(x), round(y)] as NormalizedPoint) : null,
    placement,
    issues,
  }
}

const unknownGeometry = (issues: ImageLocationIssue[], placement: ImagePlacement | null = null): Geometry => ({
  accuracy: "unknown",
  coordinateSystem: null,
  bounds: null,
  fullBounds: null,
  quad: null,
  placement,
  issues,
})

// ─── PDF ─────────────────────────────────────────────────────────────────────

export type PdfGeometryInput = {
  /** Image space → page user space (unit square is the image). */
  ctm: readonly number[]
  /** Visible page box (CropBox ∩ MediaBox) in user space: [x0, y0, x1, y1]. */
  pageBox: readonly number[]
  rotate: number
  clip?: { rect: readonly number[] } | "complex" | null
  /** Number of enclosing Form XObjects. */
  formDepth?: number
}

/**
 * Normalize a PDF image occurrence. The image's binary pixel size is irrelevant here: PDF maps
 * every image onto the unit square, so the CTM alone gives its displayed placement.
 */
export function normalizePdfImageBounds(input: PdfGeometryInput): Geometry {
  const [a, b, c, d, e, f] = input.ctm
  const [x0, y0, x1, y1] = input.pageBox
  if (input.ctm.length !== 6 || !finite(a, b, c, d, e, f)) return unknownGeometry(["NON_FINITE_GEOMETRY"])
  if (input.pageBox.length !== 4 || !finite(x0, y0, x1, y1) || x1 - x0 <= 0 || y1 - y0 <= 0) return unknownGeometry(["INVALID_PAGE_BOX"])

  const corners: NormalizedPoint[] = [
    [e, f],
    [a + e, b + f],
    [a + c + e, b + d + f],
    [c + e, d + f],
  ]
  const ux = corners.map((p) => p[0])
  const uy = corners.map((p) => p[1])
  const placement: ImagePlacement = {
    x: round(Math.min(...ux), 3),
    y: round(Math.min(...uy), 3),
    width: round(Math.max(...ux) - Math.min(...ux), 3),
    height: round(Math.max(...uy) - Math.min(...uy), 3),
    unit: "pt",
    rotation: round((((-Math.atan2(b, a) * 180) / Math.PI + (input.rotate || 0)) % 360 + 360) % 360, 2),
  }
  const scale = Math.max(Math.hypot(a, b), Math.hypot(c, d), 1e-12)
  if (Math.abs(a * d - b * c) < 1e-9 * scale * scale) return unknownGeometry(["DEGENERATE_TRANSFORM"], placement)

  const W = x1 - x0
  const H = y1 - y0
  const rot = (((Math.round((input.rotate || 0) / 90) * 90) % 360) + 360) % 360
  const toPage = ([x, y]: NormalizedPoint): NormalizedPoint => {
    switch (rot) {
      case 90:
        return [(y - y0) / H, (x - x0) / W]
      case 180:
        return [(x1 - x) / W, (y - y0) / H]
      case 270:
        return [(y1 - y) / H, (x1 - x) / W]
      default:
        return [(x - x0) / W, (y1 - y) / H]
    }
  }

  const issues: ImageLocationIssue[] = []
  let accuracy: LocationAccuracy = "exact"
  const axisAligned = (Math.abs(b) < TOL && Math.abs(c) < TOL) || (Math.abs(a) < TOL && Math.abs(d) < TOL)
  if (!axisAligned) {
    accuracy = "derived"
    issues.push(Math.abs(a * c + b * d) < 1e-6 * scale * scale ? "ROTATED_BOUNDS" : "SKEWED_TRANSFORM")
  }
  if ((input.formDepth ?? 0) > 0) {
    accuracy = worse(accuracy, "derived")
    issues.push("FORM_TRANSFORM")
  }
  let clipBox: Box | null = null
  if (input.clip === "complex") {
    accuracy = worse(accuracy, "approximate")
    issues.push("COMPLEX_CLIP")
  } else if (input.clip?.rect && input.clip.rect.length === 4 && finite(...input.clip.rect)) {
    const [cx0, cy0, cx1, cy1] = input.clip.rect
    clipBox = boxOf([toPage([cx0, cy0]), toPage([cx1, cy1])])
  }
  const g = finishGeometry(corners.map(toPage), clipBox, accuracy, issues, !axisAligned, placement, "visible_page_top_left")
  if (g.issues.includes("CLIPPED") && g.accuracy === "exact") g.accuracy = "derived"
  return g
}

// ─── PPTX ────────────────────────────────────────────────────────────────────

export type OoxmlXfrm = { x: number; y: number; cx: number; cy: number; rot: number; flipH: boolean; flipV: boolean }
export type OoxmlGroupXfrm = OoxmlXfrm & { chX: number; chY: number; chCx: number; chCy: number }
/** `a:srcRect` as fractions of the source image (1 = 100 %). */
export type OoxmlSrcRect = { l: number; t: number; r: number; b: number }

export type PptxGeometryInput = {
  slideSize: { cx: number; cy: number } | null
  xfrm: OoxmlXfrm | null
  /** Enclosing groups, outermost first. */
  groups: OoxmlGroupXfrm[]
  srcRect: OoxmlSrcRect | null
  placeholder?: boolean
}

type Affine = [number, number, number, number, number, number]
const apply = (m: Affine, [x, y]: NormalizedPoint): NormalizedPoint => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
const compose = (inner: Affine, outer: Affine): Affine => [
  inner[0] * outer[0] + inner[1] * outer[2],
  inner[0] * outer[1] + inner[1] * outer[3],
  inner[2] * outer[0] + inner[3] * outer[2],
  inner[2] * outer[1] + inner[3] * outer[3],
  inner[4] * outer[0] + inner[5] * outer[2] + outer[4],
  inner[4] * outer[1] + inner[5] * outer[3] + outer[5],
]

/** Flip then rotate (clockwise, y down) about the centre of `x`. */
function orient(x: OoxmlXfrm): Affine {
  const cx = x.x + x.cx / 2
  const cy = x.y + x.cy / 2
  const t = (x.rot * Math.PI) / 180
  const cos = Math.cos(t)
  const sin = Math.sin(t)
  const fx = x.flipH ? -1 : 1
  const fy = x.flipV ? -1 : 1
  const lin: Affine = [cos * fx, sin * fx, -sin * fy, cos * fy, 0, 0]
  return [lin[0], lin[1], lin[2], lin[3], cx - (lin[0] * cx + lin[2] * cy), cy - (lin[1] * cx + lin[3] * cy)]
}

const validXfrm = (x: OoxmlXfrm) => finite(x.x, x.y, x.cx, x.cy, x.rot) && x.cx >= 0 && x.cy >= 0

/**
 * Normalize a PPTX picture: own xfrm (with flips/rotation about its centre and any negative
 * `srcRect` inset), then each enclosing group's child-space mapping, innermost first.
 */
export function normalizePptxImageBounds(input: PptxGeometryInput): Geometry {
  if (!input.xfrm) return unknownGeometry([input.placeholder ? "PLACEHOLDER_GEOMETRY" : "GEOMETRY_MISSING"])
  const x = input.xfrm
  if (!validXfrm(x)) return unknownGeometry(["NON_FINITE_GEOMETRY"])
  const placement: ImagePlacement = { x: x.x, y: x.y, width: x.cx, height: x.cy, unit: "emu", rotation: round(((x.rot % 360) + 360) % 360, 2), flipH: x.flipH, flipV: x.flipV }

  const issues: ImageLocationIssue[] = []
  let accuracy: LocationAccuracy = "exact"

  let frame: Box = [x.x, x.y, x.x + x.cx, x.y + x.cy]
  if (input.srcRect) {
    const { l, t, r, b } = input.srcRect
    const sw = 1 - l - r
    const sh = 1 - t - b
    if (!finite(l, t, r, b) || sw <= 0 || sh <= 0) issues.push("INVALID_CROP")
    else {
      if (l > 0 || t > 0 || r > 0 || b > 0) issues.push("CROPPED")
      if (l < 0 || t < 0 || r < 0 || b < 0) {
        issues.push("PADDED")
        accuracy = "derived"
        const clamp = (v: number) => Math.min(1, Math.max(0, v))
        frame = [
          x.x + clamp(-l / sw) * x.cx,
          x.y + clamp(-t / sh) * x.cy,
          x.x + clamp((1 - l) / sw) * x.cx,
          x.y + clamp((1 - t) / sh) * x.cy,
        ]
      }
    }
  }
  if (x.cx === 0 || x.cy === 0) return unknownGeometry([...issues, "DEGENERATE_TRANSFORM"], placement)

  let m = orient(x)
  if (input.groups.length > 0) {
    accuracy = worse(accuracy, "derived")
    issues.push("GROUP_TRANSFORM")
  }
  let anyRotation = Math.abs(x.rot % 360) > TOL
  for (let i = input.groups.length - 1; i >= 0; i--) {
    const g = input.groups[i]
    if (!validXfrm(g) || !finite(g.chX, g.chY, g.chCx, g.chCy)) return unknownGeometry([...issues, "NON_FINITE_GEOMETRY"], placement)
    if (g.chCx <= 0 || g.chCy <= 0) return unknownGeometry([...issues, "GEOMETRY_MISSING"], placement)
    const sx = g.cx / g.chCx
    const sy = g.cy / g.chCy
    if (anyRotation && Math.abs(sx - sy) > 1e-6 * Math.max(sx, sy)) {
      accuracy = worse(accuracy, "approximate")
      if (!issues.includes("NON_UNIFORM_GROUP_ROTATION")) issues.push("NON_UNIFORM_GROUP_ROTATION")
    }
    const scaleMap: Affine = [sx, 0, 0, sy, g.x - g.chX * sx, g.y - g.chY * sy]
    m = compose(compose(m, scaleMap), orient(g))
    if (Math.abs(g.rot % 360) > TOL || g.flipH || g.flipV) anyRotation = true
  }

  const quad: NormalizedPoint[] = [
    [frame[0], frame[3]],
    [frame[2], frame[3]],
    [frame[2], frame[1]],
    [frame[0], frame[1]],
  ].map((p) => apply(m, p as NormalizedPoint))
  const axisAligned = Math.abs(m[1]) < 1e-9 * Math.abs(m[0] || 1) && Math.abs(m[2]) < 1e-9 * Math.abs(m[3] || 1)
  const swapped = Math.abs(m[0]) < 1e-9 && Math.abs(m[3]) < 1e-9
  const keepQuad = !(axisAligned || swapped)
  if (keepQuad) {
    accuracy = worse(accuracy, "derived")
    issues.push("ROTATED_BOUNDS")
  } else if (anyRotation) accuracy = worse(accuracy, "derived")

  const size = input.slideSize
  if (!size || !finite(size.cx, size.cy) || size.cx <= 0 || size.cy <= 0) return unknownGeometry([...issues, "INVALID_SLIDE_SIZE"], placement)
  return finishGeometry(
    quad.map(([px, py]) => [px / size.cx, py / size.cy]),
    null,
    accuracy,
    issues,
    keepQuad,
    placement,
    "slide_top_left",
  )
}

// ─── Assembly, validation, legacy rows ───────────────────────────────────────

export type BuildLocationInput = {
  documentType: LocationDocumentType
  geometry: Geometry | null
  intrinsicSize?: { width: number; height: number } | null
  structural: { part: string | null; path: StructuralStep[] }
  readingOrder: ReadingOrderRef
  context: ImageContextRefs
  extraIssues?: ImageLocationIssue[]
}

export function buildImageLocation(input: BuildLocationInput): ImageLocation {
  const g = input.geometry ?? unknownGeometry([])
  const issues = [...new Set([...g.issues, ...(input.extraIssues ?? [])])]
  const hasStructure = input.structural.path.length > 0
  let status: LocationMappingStatus
  if (g.bounds) status = g.accuracy === "approximate" ? "partial" : "mapped"
  else if (input.documentType === "docx" && hasStructure) status = "mapped"
  else status = hasStructure || g.placement ? "partial" : "unavailable"
  return {
    version: IMAGE_LOCATION_VERSION,
    documentType: input.documentType,
    status,
    accuracy: input.documentType === "docx" ? (hasStructure ? "exact" : "unknown") : g.accuracy,
    coordinateSystem: g.coordinateSystem,
    bounds: g.bounds,
    fullBounds: g.fullBounds,
    quad: g.quad,
    placement: g.placement,
    intrinsicSize: input.intrinsicSize ?? null,
    structural: { part: input.structural.part, label: structuralLabel(input.structural.path), path: input.structural.path },
    readingOrder: input.readingOrder,
    context: input.context,
    issues,
  }
}

const STEP_LABEL: Record<StructuralStepKind, string> = {
  page: "Page",
  slide: "Slide",
  form: "Form",
  group: "Group",
  body: "Body",
  header: "Header",
  footer: "Footer",
  section: "Section",
  table: "Table",
  row: "Row",
  cell: "Cell",
  paragraph: "Paragraph",
  run: "Run",
  inline_image: "Inline Image",
  floating_image: "Floating Image",
  grouped_image: "Grouped Image",
  picture: "Picture",
}

/** Human-readable path such as `Body → Table 2 → Row 3 → Cell 1 → Paragraph 1 → Inline Image 1`. */
export function structuralLabel(path: StructuralStep[]): string {
  return path
    .map((s) => {
      const base = STEP_LABEL[s.kind]
      if ((s.kind === "header" || s.kind === "footer") && s.id) return `${base} (${s.id})`
      return s.index != null ? `${base} ${s.index}` : base
    })
    .join(" → ")
}

const inUnit = (v: number) => v >= -TOL && v <= 1 + TOL
const validBounds = (b: NormalizedBounds | null, unit: boolean) =>
  b == null || (finite(b.x, b.y, b.width, b.height) && b.width >= 0 && b.height >= 0 && (!unit || (inUnit(b.x) && inUnit(b.y) && inUnit(b.x + b.width) && inUnit(b.y + b.height))))

export type LocationValidation = { ok: true } | { ok: false; errors: string[] }

/** Structural validity of a location record, optionally against the document's page/slide count. */
export function validateImageLocation(loc: unknown, refs: { pageNumber?: number | null; slideNumber?: number | null; pageCount?: number | null; slideCount?: number | null } = {}): LocationValidation {
  const errors: string[] = []
  if (!loc || typeof loc !== "object") return { ok: false, errors: ["Location must be an object."] }
  const l = loc as Partial<ImageLocation>
  if (l.version !== IMAGE_LOCATION_VERSION) errors.push("Unsupported location version.")
  if (l.documentType !== "pdf" && l.documentType !== "pptx" && l.documentType !== "docx") errors.push("Invalid document type.")
  if (!l.accuracy || !(l.accuracy in RANK)) errors.push("Invalid accuracy.")
  if (!validBounds(l.bounds ?? null, true)) errors.push("Bounds must be finite and lie within [0, 1].")
  if (!validBounds(l.fullBounds ?? null, false)) errors.push("Full bounds must be finite and non-negative.")
  if (l.bounds && !l.coordinateSystem) errors.push("Bounds require a coordinate system.")
  if (l.quad != null && (!Array.isArray(l.quad) || l.quad.length !== 4 || !l.quad.every((p) => Array.isArray(p) && p.length === 2 && finite(p[0], p[1])))) errors.push("Invalid outline.")
  const p = l.placement
  if (p && (!finite(p.x, p.y, p.width, p.height) || p.width < 0 || p.height < 0 || (p.rotation != null && !finite(p.rotation)))) errors.push("Placement must be finite with non-negative size.")
  const s = l.intrinsicSize
  if (s && (!finite(s.width, s.height) || s.width < 0 || s.height < 0)) errors.push("Invalid image dimensions.")
  const ro = l.readingOrder
  if (!ro || !Number.isInteger(ro.index) || ro.index < 0) errors.push("Invalid reading-order reference.")
  if (l.documentType === "docx" && l.bounds) errors.push("DOCX locations must not claim page coordinates.")
  if (refs.pageCount != null && refs.pageNumber != null && (refs.pageNumber < 1 || refs.pageNumber > refs.pageCount)) errors.push("Page is outside the document.")
  if (refs.slideCount != null && refs.slideNumber != null && (refs.slideNumber < 1 || refs.slideNumber > refs.slideCount)) errors.push("Slide is outside the document.")
  return errors.length ? { ok: false, errors } : { ok: true }
}

/** Minimal record shape needed to resolve a location (avoids a dependency on server types). */
export type LocatableImage = {
  occurrenceIndex: number
  pageNumber: number | null
  slideNumber: number | null
  imagePosition: Record<string, unknown> | null
  sourceMetadata: { name?: string | null; title?: string | null; originalDescription?: string | null; groupPath?: string[]; pdf?: { pageLabel?: string | null; parentForms?: unknown[]; structure?: { structRef?: string | null; association?: string } } } | null
}

/**
 * The location for an image record: the stored Task 8 location when valid, otherwise one derived
 * from data recorded before Task 8 (PDF CTM rows) or an explicit "unavailable" record.
 */
export function resolveImageLocation(img: LocatableImage, documentType?: LocationDocumentType): ImageLocation {
  const pos = img.imagePosition
  const stored = pos && typeof pos === "object" ? (pos as { location?: unknown }).location : undefined
  const invalid = stored != null && !validateImageLocation(stored).ok
  if (stored && !invalid) return stored as ImageLocation

  const type: LocationDocumentType =
    documentType ?? (pos?.kind === "pdf_ctm" || img.sourceMetadata?.pdf ? "pdf" : img.slideNumber != null ? "pptx" : img.pageNumber != null ? "pdf" : "docx")
  const md = img.sourceMetadata
  const extra: ImageLocationIssue[] = [invalid ? "INVALID_STORED_LOCATION" : "LEGACY_RECORD"]
  const path: StructuralStep[] = []
  if (img.pageNumber != null) path.push({ kind: "page", index: img.pageNumber })
  if (img.slideNumber != null) path.push({ kind: "slide", index: img.slideNumber })
  for (const id of md?.groupPath ?? []) path.push({ kind: "group", index: null, id })
  let geometry: Geometry | null = null
  if (type === "pdf" && pos?.kind === "pdf_ctm" && Array.isArray(pos.ctm) && Array.isArray(pos.pageBox)) {
    geometry = normalizePdfImageBounds({
      ctm: pos.ctm as number[],
      pageBox: pos.pageBox as number[],
      rotate: typeof pos.rotate === "number" ? pos.rotate : 0,
      clip: (pos.clip as PdfGeometryInput["clip"]) ?? null,
      formDepth: md?.pdf?.parentForms?.length ?? 0,
    })
    // Rows from before Task 8 never recorded the clip, so their bounds cannot be exact.
    if (!("clip" in pos) && geometry.accuracy === "exact") geometry.accuracy = "derived"
  }
  return buildImageLocation({
    documentType: type,
    geometry,
    structural: { part: null, path: type === "docx" ? [] : path },
    readingOrder: { index: img.occurrenceIndex, basis: type === "pdf" ? "pdf_content_stream" : type === "pptx" ? "pptx_shape_tree" : "docx_document_order", verified: false },
    context: {
      pictureName: md?.name ?? null,
      pictureTitle: md?.title ?? null,
      pageLabel: md?.pdf?.pageLabel ?? null,
      structRef: md?.pdf?.structure?.structRef ?? null,
      existingAlt: { present: !!md?.originalDescription, source: md?.originalDescription ? "sourceMetadata.originalDescription" : null },
      caption: null,
    },
    extraIssues: extra,
  })
}

/** Short display string for normalized bounds, e.g. `x 12% · y 40% · 30% × 18%`. */
export function formatBounds(b: NormalizedBounds): string {
  const pct = (v: number) => `${Math.round(v * 1000) / 10}%`
  return `x ${pct(b.x)} · y ${pct(b.y)} · ${pct(b.width)} × ${pct(b.height)}`
}
