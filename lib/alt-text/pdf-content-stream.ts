/**
 * @file lib/alt-text/pdf-content-stream.ts
 * @module Publishing · Alt Text
 * @kind Pure library (no I/O)
 * @summary Phase 3 Task 7 — bounded PDF content-stream interpreter. Tokenizes operators and
 *   operands, tracks only the state image extraction needs (q/Q, cm, marked content) and reports
 *   `Do` invocations and inline images (BI/ID/EI). It never renders, never executes anything and
 *   ignores every operator it does not understand.
 */

export class PName {
  constructor(readonly v: string) {}
}
export class PStr {
  constructor(readonly bytes: Uint8Array) {}
}
export type PValue = number | boolean | null | PName | PStr | PValue[] | PDict
export type PDict = Map<string, PValue>

/** Row-vector affine matrix [a b c d e f] (PDF convention: p' = p × M). */
export type Matrix = [number, number, number, number, number, number]
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** m1 × m2 — apply m1 first, then m2. */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ]
}

export function toMatrix(v: unknown): Matrix | null {
  if (!Array.isArray(v) || v.length !== 6 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) return null
  return v as Matrix
}

export type MarkedContent = { tag: string; mcid: number | null; alt: string | null; actualText: string | null }

/**
 * Active clipping region in page user space. `rect` is tracked only for single-rectangle clip
 * paths under an axis-aligned CTM; any other clip path is `"complex"` (bounds stay approximate).
 */
export type PdfClip = { rect: [number, number, number, number] } | "complex" | null

export type ContentState = { ctm: Matrix; marked: readonly MarkedContent[]; clip?: PdfClip }

const EPS = 1e-9
export const isAxisAligned = (m: Matrix) => (Math.abs(m[1]) < EPS && Math.abs(m[2]) < EPS) || (Math.abs(m[0]) < EPS && Math.abs(m[3]) < EPS)

/** Axis-aligned bounding box of a (x, y, w, h) rectangle transformed by `m`. */
export function transformRect(m: Matrix, x: number, y: number, w: number, h: number): [number, number, number, number] {
  const pts = [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ].map(([px, py]) => [px * m[0] + py * m[2] + m[4], px * m[1] + py * m[3] + m[5]])
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/** Intersect a clip with an axis-aligned rectangle (or with `"complex"`). */
export function intersectClip(clip: PdfClip, next: PdfClip): PdfClip {
  if (clip === "complex" || next === "complex") return "complex"
  if (!clip) return next
  if (!next) return clip
  const [a, b] = [clip.rect, next.rect]
  return { rect: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])] }
}

export class ContentLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ContentLimitError"
  }
}

export type ContentBudget = { operators: number; maxOperators: number }

export type ContentHandlers = {
  onDo(name: string, state: ContentState): void
  onInlineImage(dict: PDict, data: Uint8Array, state: ContentState): void
  /** Named property list for `/Tag /Name BDC` (from the current /Resources /Properties). */
  resolveProperties?(name: string): PDict | null
  /** Inline image data length when it can be computed exactly (unfiltered images). */
  inlineImageLength?(dict: PDict): number | null
}

export type ContentStats = { pathPaints: number; textShows: number; doCalls: number; inlineImages: number; inlineUnreadable: number }

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20])
const DELIMS = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25])
const isRegular = (c: number) => !WS.has(c) && !DELIMS.has(c)
const PATH_PAINT = new Set(["S", "s", "f", "F", "f*", "B", "B*", "b", "b*", "sh"])
const TEXT_SHOW = new Set(["Tj", "TJ", "'", '"'])
const MAX_NESTING = 64
const MAX_STACK = 4096
const MAX_INLINE_DICT_ENTRIES = 64

/** Decode a PDF text string (UTF-16BE with BOM, UTF-8 with BOM, else PDFDocEncoding ≈ Latin-1). */
export function decodePdfText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = ""
    for (let i = 2; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1])
    return out
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3))
  let out = ""
  for (const b of bytes) out += String.fromCharCode(b)
  return out
}

type Token = { k: "v"; v: PValue } | { k: "op"; v: string } | { k: "["; } | { k: "]" } | { k: "<<" } | { k: ">>" }

class Lexer {
  pos = 0
  constructor(readonly b: Uint8Array) {}

  skipWs() {
    const b = this.b
    while (this.pos < b.length) {
      const c = b[this.pos]
      if (WS.has(c)) this.pos++
      else if (c === 0x25) {
        while (this.pos < b.length && b[this.pos] !== 0x0a && b[this.pos] !== 0x0d) this.pos++
      } else break
    }
  }

  next(): Token | null {
    this.skipWs()
    const b = this.b
    if (this.pos >= b.length) return null
    const c = b[this.pos]
    if (c === 0x5b) return this.pos++, { k: "[" }
    if (c === 0x5d) return this.pos++, { k: "]" }
    if (c === 0x3c && b[this.pos + 1] === 0x3c) return (this.pos += 2), { k: "<<" }
    if (c === 0x3e && b[this.pos + 1] === 0x3e) return (this.pos += 2), { k: ">>" }
    if (c === 0x3c) return { k: "v", v: this.hexString() }
    if (c === 0x28) return { k: "v", v: this.literalString() }
    if (c === 0x2f) return { k: "v", v: this.name() }
    if (c === 0x7b || c === 0x7d || c === 0x29 || c === 0x3e) return this.pos++, this.next()
    const start = this.pos
    while (this.pos < b.length && isRegular(b[this.pos])) this.pos++
    const word = latin1(b.subarray(start, this.pos))
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { k: "v", v: Number(word) }
    if (word === "true") return { k: "v", v: true }
    if (word === "false") return { k: "v", v: false }
    if (word === "null") return { k: "v", v: null }
    return { k: "op", v: word }
  }

  private name(): PName {
    const b = this.b
    this.pos++
    let out = ""
    while (this.pos < b.length && isRegular(b[this.pos])) {
      const c = b[this.pos]
      if (c === 0x23 && this.pos + 2 < b.length) {
        const hex = latin1(b.subarray(this.pos + 1, this.pos + 3))
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16))
          this.pos += 3
          continue
        }
      }
      out += String.fromCharCode(c)
      this.pos++
    }
    return new PName(out)
  }

  private hexString(): PStr {
    const b = this.b
    this.pos++
    const digits: number[] = []
    while (this.pos < b.length && b[this.pos] !== 0x3e) {
      const v = hexVal(b[this.pos++])
      if (v >= 0) digits.push(v)
    }
    this.pos++
    if (digits.length % 2) digits.push(0)
    const out = new Uint8Array(digits.length / 2)
    for (let i = 0; i < out.length; i++) out[i] = (digits[2 * i] << 4) | digits[2 * i + 1]
    return new PStr(out)
  }

  private literalString(): PStr {
    const b = this.b
    this.pos++
    const out: number[] = []
    let depth = 1
    while (this.pos < b.length) {
      const c = b[this.pos++]
      if (c === 0x5c) {
        const n = b[this.pos++]
        if (n === undefined) break
        const map: Record<number, number> = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12, 0x28: 0x28, 0x29: 0x29, 0x5c: 0x5c }
        if (map[n] !== undefined) out.push(map[n])
        else if (n >= 0x30 && n <= 0x37) {
          let v = n - 0x30
          for (let i = 0; i < 2 && b[this.pos] >= 0x30 && b[this.pos] <= 0x37; i++) v = v * 8 + (b[this.pos++] - 0x30)
          out.push(v & 0xff)
        } else if (n === 0x0d) {
          if (b[this.pos] === 0x0a) this.pos++
        } else if (n !== 0x0a) out.push(n)
        continue
      }
      if (c === 0x28) depth++
      else if (c === 0x29 && --depth === 0) break
      out.push(c)
    }
    return new PStr(Uint8Array.from(out))
  }
}

const latin1 = (b: Uint8Array) => {
  let s = ""
  for (const c of b) s += String.fromCharCode(c)
  return s
}

function hexVal(c: number) {
  if (c >= 0x30 && c <= 0x39) return c - 0x30
  if (c >= 0x41 && c <= 0x46) return c - 0x37
  if (c >= 0x61 && c <= 0x66) return c - 0x57
  return -1
}

/** Read one complete operand value (arrays/dicts included) starting from `first`. */
function readValue(lx: Lexer, first: Token, depth = 0): PValue | undefined {
  if (depth > MAX_NESTING) throw new ContentLimitError("Content stream nesting is too deep.")
  if (first.k === "v") return first.v
  if (first.k === "[") {
    const arr: PValue[] = []
    for (;;) {
      const t = lx.next()
      if (!t || t.k === "]") return arr
      if (t.k === "op") continue
      const v = readValue(lx, t, depth + 1)
      if (v !== undefined) arr.push(v)
      if (arr.length > MAX_STACK) throw new ContentLimitError("Content stream array is too large.")
    }
  }
  if (first.k === "<<") {
    const dict: PDict = new Map()
    for (;;) {
      const t = lx.next()
      if (!t || t.k === ">>") return dict
      if (t.k !== "v" || !(t.v instanceof PName)) continue
      const vt = lx.next()
      if (!vt || vt.k === ">>") return dict
      const v = readValue(lx, vt, depth + 1)
      if (v !== undefined) dict.set(t.v.v, v)
      if (dict.size > MAX_STACK) throw new ContentLimitError("Content stream dictionary is too large.")
    }
  }
  return undefined
}

function markedFrom(tag: string, props: PDict | null): MarkedContent {
  const mcid = props?.get("MCID")
  const alt = props?.get("Alt")
  const actual = props?.get("ActualText")
  return {
    tag,
    mcid: typeof mcid === "number" && Number.isInteger(mcid) && mcid >= 0 ? mcid : null,
    alt: alt instanceof PStr ? decodePdfText(alt.bytes) : null,
    actualText: actual instanceof PStr ? decodePdfText(actual.bytes) : null,
  }
}

/** Locate the end of inline image data: whitespace, `EI`, then whitespace/delimiter/EOF. */
function findInlineEnd(b: Uint8Array, start: number): { dataEnd: number; next: number } | null {
  for (let i = start; i + 1 < b.length; i++) {
    if (b[i] !== 0x45 || b[i + 1] !== 0x49) continue
    if (i > start && !WS.has(b[i - 1])) continue
    const after = b[i + 2]
    if (after !== undefined && !WS.has(after) && !DELIMS.has(after)) continue
    return { dataEnd: i > start && WS.has(b[i - 1]) ? i - 1 : i, next: i + 2 }
  }
  return null
}

/**
 * Interpret one content stream. `initial.marked` is inherited from the invoking page so images
 * drawn inside a Form XObject keep the page-level marked-content (MCID) that encloses the `Do`.
 */
export function interpretContentStream(
  bytes: Uint8Array,
  initial: ContentState,
  handlers: ContentHandlers,
  budget: ContentBudget,
  stats: ContentStats,
  limits: { maxInlineImageBytes: number },
): void {
  const lx = new Lexer(bytes)
  const operands: PValue[] = []
  const gsStack: { ctm: Matrix; clip: PdfClip }[] = []
  let ctm = initial.ctm
  let clip: PdfClip = initial.clip ?? null
  let pathRect: PdfClip = null
  let pathSegments = 0
  let pendingClip = false
  const marked: MarkedContent[] = [...initial.marked]
  const inheritedDepth = initial.marked.length
  const state = (): ContentState => ({ ctm, marked: [...marked], clip })
  const endPath = () => {
    if (pendingClip) clip = intersectClip(clip, pathSegments === 1 && pathRect ? pathRect : "complex")
    pathRect = null
    pathSegments = 0
    pendingClip = false
  }

  for (;;) {
    const t = lx.next()
    if (!t) break
    if (t.k !== "op") {
      const v = readValue(lx, t)
      if (v !== undefined) operands.push(v)
      if (operands.length > MAX_STACK) operands.splice(0, operands.length - MAX_STACK)
      continue
    }
    if (++budget.operators > budget.maxOperators) throw new ContentLimitError("The document has too many drawing operations.")
    const op = t.v
    switch (op) {
      case "q":
        if (gsStack.length < 512) gsStack.push({ ctm, clip })
        break
      case "Q": {
        const saved = gsStack.pop()
        if (saved) ({ ctm, clip } = saved)
        break
      }
      case "re": {
        const nums = operands.slice(-4)
        pathSegments++
        pathRect =
          operands.length >= 4 && nums.every((v) => typeof v === "number" && Number.isFinite(v)) && isAxisAligned(ctm)
            ? { rect: transformRect(ctm, ...(nums as [number, number, number, number])) }
            : "complex"
        break
      }
      case "m":
      case "l":
      case "c":
      case "v":
      case "y":
        pathSegments += 2
        break
      case "W":
      case "W*":
        pendingClip = true
        break
      case "n":
        endPath()
        break
      case "cm": {
        const m = toMatrix(operands.slice(-6))
        if (m && operands.length >= 6) ctm = multiply(m, ctm)
        break
      }
      case "BMC": {
        const tag = operands[operands.length - 1]
        marked.push(markedFrom(tag instanceof PName ? tag.v : "", null))
        break
      }
      case "BDC": {
        const tag = operands[operands.length - 2]
        const raw = operands[operands.length - 1]
        const props = raw instanceof Map ? raw : raw instanceof PName ? (handlers.resolveProperties?.(raw.v) ?? null) : null
        marked.push(markedFrom(tag instanceof PName ? tag.v : "", props))
        break
      }
      case "EMC":
        if (marked.length > inheritedDepth) marked.pop()
        break
      case "Do": {
        const name = operands[operands.length - 1]
        stats.doCalls++
        if (name instanceof PName) handlers.onDo(name.v, state())
        break
      }
      case "BI": {
        const dict: PDict = new Map()
        let ok = false
        for (let i = 0; i < MAX_INLINE_DICT_ENTRIES * 2 + 1; i++) {
          const kt = lx.next()
          if (!kt) break
          if (kt.k === "op" && kt.v === "ID") {
            ok = true
            break
          }
          if (kt.k !== "v" || !(kt.v instanceof PName)) continue
          const vt = lx.next()
          if (!vt) break
          const v = readValue(lx, vt)
          if (v !== undefined) dict.set(kt.v.v, v)
        }
        stats.inlineImages++
        if (!ok) {
          stats.inlineUnreadable++
          break
        }
        const start = lx.pos + (WS.has(bytes[lx.pos]) ? 1 : 0)
        const exact = handlers.inlineImageLength?.(dict) ?? null
        let dataEnd: number
        let next: number
        if (exact != null && start + exact <= bytes.length) {
          dataEnd = start + exact
          const end = findInlineEnd(bytes, dataEnd)
          next = end ? end.next : dataEnd
        } else {
          const end = findInlineEnd(bytes, start)
          if (!end) {
            stats.inlineUnreadable++
            lx.pos = bytes.length
            break
          }
          dataEnd = end.dataEnd
          next = end.next
        }
        lx.pos = next
        if (dataEnd - start > limits.maxInlineImageBytes) {
          stats.inlineUnreadable++
          break
        }
        handlers.onInlineImage(dict, bytes.subarray(start, dataEnd), state())
        break
      }
      default:
        if (PATH_PAINT.has(op)) {
          stats.pathPaints++
          if (op !== "sh") endPath()
        } else if (TEXT_SHOW.has(op)) stats.textShows++
    }
    operands.length = 0
  }
}
