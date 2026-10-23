/**
 * @file lib/alt-text/pdf-image-decode.ts
 * @module Publishing · Alt Text
 * @kind Pure library (no I/O)
 * @summary Phase 3 Task 7 — bounded decoding of PDF image streams into files the existing Alt
 *   Text pipeline accepts. DCT (JPEG) data is preserved byte-for-byte; raw sample data
 *   (Flate/LZW/RunLength/ASCII filters) is converted into a real PNG with transparency from
 *   /SMask or /Mask applied. JPX, CCITT and JBIG2 are reported as unsupported, never guessed.
 *   Every decoder is capped so a compression bomb cannot exhaust memory.
 */
import { constants as zc, deflateSync, inflateSync } from "node:zlib"

export type DeviceSpace = { kind: "gray" | "rgb" | "cmyk"; label: string }
export type PdfColorSpace =
  | DeviceSpace
  | { kind: "indexed"; base: DeviceSpace; hival: number; lookup: Uint8Array; label: string }
  | { kind: "unsupported"; label: string }

export type FilterParams = Record<string, number>

export type PdfImageSpec = {
  width: number
  height: number
  bitsPerComponent: number | null
  colorSpace: PdfColorSpace | null
  filters: string[]
  decodeParms: (FilterParams | null)[]
  imageMask: boolean
  decode: number[] | null
  data: Uint8Array
  softMask: PdfImageSpec | null
  /** /SMask with /Matte (pre-multiplied colour) — not reproducible without loss. */
  softMaskMatte: boolean
  colorKeyMask: number[] | null
  stencilMask: PdfImageSpec | null
}

export type DecodeLimits = { maxDecodedBytes: number; maxDimension: number }

export type DecodedImage = {
  ok: true
  bytes: Uint8Array
  mimeType: "image/jpeg" | "image/png"
  format: "jpeg" | "png"
  width: number
  height: number
  /** True when the embedded bytes were kept unchanged (no re-encoding). */
  preserved: boolean
  notes: string[]
}
export type DecodeProblem = { ok: false; status: "unsupported" | "failed"; code: string; message: string }

export class DecodeLimitError extends Error {
  constructor(message = "The image is too large to decode safely.") {
    super(message)
    this.name = "DecodeLimitError"
  }
}
export class DecodeDataError extends Error {
  constructor(message = "The image data is damaged.") {
    super(message)
    this.name = "DecodeDataError"
  }
}

const unsupported = (code: string, message: string): DecodeProblem => ({ ok: false, status: "unsupported", code, message })
const failed = (code: string, message: string): DecodeProblem => ({ ok: false, status: "failed", code, message })

const FILTER_ALIASES: Record<string, string> = {
  AHx: "ASCIIHexDecode",
  A85: "ASCII85Decode",
  LZW: "LZWDecode",
  Fl: "FlateDecode",
  RL: "RunLengthDecode",
  CCF: "CCITTFaxDecode",
  DCT: "DCTDecode",
}
export const normalizeFilter = (name: string) => FILTER_ALIASES[name] ?? name

/** Filters that yield a complete image codec rather than raw samples. */
const TERMINAL = new Set(["DCTDecode", "JPXDecode", "CCITTFaxDecode", "JBIG2Decode"])

// ---------------------------------------------------------------------------
// Generic stream filters (bounded)
// ---------------------------------------------------------------------------

function inflate(data: Uint8Array, max: number): Uint8Array {
  try {
    return inflateSync(data, { maxOutputLength: max, finishFlush: zc.Z_SYNC_FLUSH })
  } catch (err) {
    if (err instanceof RangeError || (err as { code?: string })?.code === "ERR_BUFFER_TOO_LARGE") throw new DecodeLimitError()
    throw new DecodeDataError()
  }
}

function applyPredictor(data: Uint8Array, p: FilterParams | null): Uint8Array {
  const predictor = p?.Predictor ?? 1
  if (predictor <= 1) return data
  const colors = p?.Colors ?? 1
  const bpc = p?.BitsPerComponent ?? 8
  const columns = p?.Columns ?? 1
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8))
  const rowLen = Math.ceil((colors * bpc * columns) / 8)
  if (rowLen <= 0 || rowLen > 1 << 26) throw new DecodeDataError()
  if (predictor === 2) {
    if (bpc !== 8) throw new DecodeDataError("Unsupported TIFF predictor depth.")
    const out = Uint8Array.from(data)
    for (let r = 0; r + rowLen <= out.length; r += rowLen) for (let i = bpp; i < rowLen; i++) out[r + i] = (out[r + i] + out[r + i - bpp]) & 0xff
    return out
  }
  if (predictor < 10) throw new DecodeDataError("Unsupported predictor.")
  const rows = Math.floor(data.length / (rowLen + 1))
  const out = new Uint8Array(rows * rowLen)
  let prev = new Uint8Array(rowLen)
  for (let r = 0; r < rows; r++) {
    const type = data[r * (rowLen + 1)]
    const src = data.subarray(r * (rowLen + 1) + 1, (r + 1) * (rowLen + 1))
    const cur = out.subarray(r * rowLen, (r + 1) * rowLen)
    for (let i = 0; i < rowLen; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      let v = src[i]
      if (type === 1) v += a
      else if (type === 2) v += b
      else if (type === 3) v += (a + b) >> 1
      else if (type === 4) {
        const pa = Math.abs(b - c)
        const pb = Math.abs(a - c)
        const pc = Math.abs(a + b - 2 * c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      } else if (type !== 0) throw new DecodeDataError()
      cur[i] = v & 0xff
    }
    prev = cur
  }
  return out
}

function asciiHex(data: Uint8Array, max: number): Uint8Array {
  const out: number[] = []
  let hi = -1
  for (const c of data) {
    if (c === 0x3e) break
    const v = c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x41 && c <= 0x46 ? c - 0x37 : c >= 0x61 && c <= 0x66 ? c - 0x57 : -1
    if (v < 0) continue
    if (hi < 0) hi = v
    else {
      out.push((hi << 4) | v)
      hi = -1
      if (out.length > max) throw new DecodeLimitError()
    }
  }
  if (hi >= 0) out.push(hi << 4)
  return Uint8Array.from(out)
}

function ascii85(data: Uint8Array, max: number): Uint8Array {
  const out: number[] = []
  const group: number[] = []
  let i = 0
  if (data[0] === 0x3c && data[1] === 0x7e) i = 2
  for (; i < data.length; i++) {
    const c = data[i]
    if (c === 0x7e) break
    if (c <= 0x20) continue
    if (c === 0x7a && group.length === 0) {
      out.push(0, 0, 0, 0)
    } else {
      if (c < 0x21 || c > 0x75) throw new DecodeDataError()
      group.push(c - 33)
      if (group.length === 5) {
        let v = 0
        for (const g of group) v = v * 85 + g
        out.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff)
        group.length = 0
      }
    }
    if (out.length > max) throw new DecodeLimitError()
  }
  if (group.length > 1) {
    const n = group.length
    while (group.length < 5) group.push(84)
    let v = 0
    for (const g of group) v = v * 85 + g
    const bytes = [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]
    out.push(...bytes.slice(0, n - 1))
  }
  return Uint8Array.from(out)
}

function runLength(data: Uint8Array, max: number): Uint8Array {
  const out = new Uint8Array(Math.min(max, data.length * 128))
  let o = 0
  for (let i = 0; i < data.length; ) {
    const len = data[i++]
    if (len === 128) break
    if (len < 128) {
      const n = len + 1
      if (o + n > out.length) throw new DecodeLimitError()
      out.set(data.subarray(i, i + n), o)
      o += n
      i += n
    } else {
      const n = 257 - len
      if (o + n > out.length) throw new DecodeLimitError()
      out.fill(data[i++] ?? 0, o, o + n)
      o += n
    }
  }
  return out.subarray(0, o)
}

function lzw(data: Uint8Array, max: number, earlyChange: number): Uint8Array {
  const out: number[] = []
  let dict: number[][] = []
  const reset = () => {
    dict = []
    for (let i = 0; i < 256; i++) dict.push([i])
    dict.push([], [])
  }
  reset()
  let bits = 9
  let buf = 0
  let bufLen = 0
  let prev: number[] | null = null
  for (let i = 0; i < data.length; i++) {
    buf = (buf << 8) | data[i]
    bufLen += 8
    while (bufLen >= bits) {
      const code = (buf >>> (bufLen - bits)) & ((1 << bits) - 1)
      bufLen -= bits
      buf &= (1 << bufLen) - 1
      if (code === 256) {
        reset()
        bits = 9
        prev = null
        continue
      }
      if (code === 257) return Uint8Array.from(out)
      let entry: number[]
      if (code < dict.length) entry = dict[code]
      else if (prev && code === dict.length) entry = [...prev, prev[0]]
      else throw new DecodeDataError()
      for (const b of entry) out.push(b)
      if (out.length > max) throw new DecodeLimitError()
      if (prev && dict.length < 4096) dict.push([...prev, entry[0]])
      prev = entry
      const next = dict.length + earlyChange
      bits = next >= 2048 ? 12 : next >= 1024 ? 11 : next >= 512 ? 10 : 9
    }
  }
  return Uint8Array.from(out)
}

/**
 * Apply every non-codec filter in order. Returns the remaining codec (DCT/JPX/…) if the chain
 * ends in one. A codec that is not last in the chain is rejected.
 */
export function decodeFilters(data: Uint8Array, filters: string[], parms: (FilterParams | null)[], max: number): { data: Uint8Array; codec: string | null } {
  let cur = data
  for (let i = 0; i < filters.length; i++) {
    const f = normalizeFilter(filters[i])
    const p = parms[i] ?? null
    if (TERMINAL.has(f)) {
      if (i !== filters.length - 1) throw new DecodeDataError("Unsupported filter order.")
      return { data: cur, codec: f }
    }
    if (f === "FlateDecode") cur = applyPredictor(inflate(cur, max), p)
    else if (f === "LZWDecode") cur = applyPredictor(lzw(cur, max, p?.EarlyChange ?? 1), p)
    else if (f === "ASCIIHexDecode") cur = asciiHex(cur, max)
    else if (f === "ASCII85Decode") cur = ascii85(cur, max)
    else if (f === "RunLengthDecode") cur = runLength(cur, max)
    else throw new UnsupportedFilterError(f)
    if (cur.length > max) throw new DecodeLimitError()
  }
  return { data: cur, codec: null }
}

export class UnsupportedFilterError extends Error {
  constructor(readonly filter: string) {
    super(`Unsupported filter ${filter}`)
    this.name = "UnsupportedFilterError"
  }
}

// ---------------------------------------------------------------------------
// JPEG header
// ---------------------------------------------------------------------------

export function readJpegHeader(b: Uint8Array): { width: number; height: number; components: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1]
    if (marker === 0xff) {
      i++
      continue
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2
      continue
    }
    const len = (b[i + 2] << 8) | b[i + 3]
    if (len < 2) return null
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8], components: b[i + 9] }
    }
    i += 2 + len
  }
  return null
}

// ---------------------------------------------------------------------------
// PNG encoding
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff
  for (const p of parts) for (const b of p) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  const typeBytes = new TextEncoder().encode(type)
  out.set(typeBytes, 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32([typeBytes, data]))
  return out
}

/** Encode 8-bit samples as PNG. channels: 1 gray, 2 gray+alpha, 3 RGB, 4 RGBA. */
export function encodePng(width: number, height: number, channels: 1 | 2 | 3 | 4, pixels: Uint8Array): Uint8Array {
  const colorType = { 1: 0, 2: 4, 3: 2, 4: 6 }[channels]
  const rowLen = width * channels
  const raw = new Uint8Array((rowLen + 1) * height)
  for (let y = 0; y < height; y++) raw.set(pixels.subarray(y * rowLen, (y + 1) * rowLen), y * (rowLen + 1) + 1)
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, width)
  v.setUint32(4, height)
  ihdr[8] = 8
  ihdr[9] = colorType
  const sig = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 6 })), chunk("IEND", new Uint8Array(0))]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) out.set(p, o), (o += p.length)
  return out
}

// ---------------------------------------------------------------------------
// Sample conversion
// ---------------------------------------------------------------------------

const componentsOf = (cs: PdfColorSpace): number => (cs.kind === "gray" ? 1 : cs.kind === "rgb" ? 3 : cs.kind === "cmyk" ? 4 : cs.kind === "indexed" ? 1 : 0)

/** Reads one row of unpacked samples (high byte for 16-bit). */
function unpackRow(src: Uint8Array, offset: number, count: number, bpc: number, out: Uint16Array) {
  if (bpc === 8) {
    for (let i = 0; i < count; i++) out[i] = src[offset + i]
    return
  }
  if (bpc === 16) {
    for (let i = 0; i < count; i++) out[i] = src[offset + 2 * i]
    return
  }
  const mask = (1 << bpc) - 1
  for (let i = 0; i < count; i++) {
    const bit = i * bpc
    out[i] = (src[offset + (bit >> 3)] >> (8 - bpc - (bit & 7))) & mask
  }
}

type DecodeMode = "default" | "inverted"

function decodeMode(decode: number[] | null, n: number, indexed: boolean, bpc: number): DecodeMode | null {
  if (!decode) return "default"
  if (decode.length !== n * 2) return null
  const hi = indexed ? (1 << bpc) - 1 : 1
  const isDefault = decode.every((v, i) => v === (i % 2 === 0 ? 0 : hi))
  if (isDefault) return "default"
  const isInverted = !indexed && decode.every((v, i) => v === (i % 2 === 0 ? 1 : 0))
  return isInverted ? "inverted" : null
}

type Raster = { width: number; height: number; channels: 1 | 3; pixels: Uint8Array; raw: Uint16Array[] | null; notes: string[] }

/** Decode raw samples into 8-bit gray or RGB. `keepRaw` retains sample rows for colour-key masking. */
function rasterize(spec: PdfImageSpec, data: Uint8Array, limits: DecodeLimits, keepRaw: boolean): Raster | DecodeProblem {
  const cs = spec.colorSpace
  const bpc = spec.bitsPerComponent
  if (!cs) return failed("MISSING_COLOR_SPACE", "The image has no colour space.")
  if (cs.kind === "unsupported") return unsupported("UNSUPPORTED_COLOR_SPACE", `${cs.label} images are not supported yet.`)
  if (bpc == null || ![1, 2, 4, 8, 16].includes(bpc) || (cs.kind === "indexed" && bpc > 8)) return failed("INVALID_BIT_DEPTH", "The image bit depth is invalid.")
  const n = componentsOf(cs)
  const { width: w, height: h } = spec
  const outCh: 1 | 3 = cs.kind === "gray" || (cs.kind === "indexed" && cs.base.kind === "gray") ? 1 : 3
  if (w * h * (outCh + 1) > limits.maxDecodedBytes) return unsupported("IMAGE_TOO_LARGE", "The image is too large to decode safely.")
  const rowBytes = Math.ceil((w * n * bpc) / 8)
  if (data.length < rowBytes * h) return failed("TRUNCATED_IMAGE", "The image data is incomplete.")
  const mode = decodeMode(spec.decode, n, cs.kind === "indexed", bpc)
  if (!mode) return unsupported("UNSUPPORTED_DECODE_ARRAY", "The image uses a custom /Decode mapping that cannot be reproduced exactly.")

  const notes: string[] = []
  if (cs.kind === "cmyk" || (cs.kind === "indexed" && cs.base.kind === "cmyk")) notes.push("cmyk_converted_to_rgb_approximate")
  if (bpc === 16) notes.push("16bit_reduced_to_8bit")
  const maxVal = bpc === 16 ? 255 : (1 << bpc) - 1
  const scale = 255 / maxVal
  const pixels = new Uint8Array(w * h * outCh)
  const row = new Uint16Array(w * n)
  const raw: Uint16Array[] | null = keepRaw ? [] : null
  const baseN = cs.kind === "indexed" ? componentsOf(cs.base) : 0

  const toRgb = (kind: "gray" | "rgb" | "cmyk", c: number[], o: number) => {
    if (kind === "gray") {
      pixels[o] = c[0]
      if (outCh === 3) pixels[o + 1] = pixels[o + 2] = c[0]
    } else if (kind === "rgb") {
      pixels[o] = c[0]
      pixels[o + 1] = c[1]
      pixels[o + 2] = c[2]
    } else {
      const k = 1 - c[3] / 255
      pixels[o] = Math.round(255 * (1 - c[0] / 255) * k)
      pixels[o + 1] = Math.round(255 * (1 - c[1] / 255) * k)
      pixels[o + 2] = Math.round(255 * (1 - c[2] / 255) * k)
    }
  }

  const comps = [0, 0, 0, 0]
  for (let y = 0; y < h; y++) {
    unpackRow(data, y * rowBytes, w * n, bpc, row)
    if (raw) raw.push(Uint16Array.from(row))
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * outCh
      if (cs.kind === "indexed") {
        const idx = Math.min(row[x], cs.hival)
        for (let k = 0; k < baseN; k++) comps[k] = cs.lookup[idx * baseN + k] ?? 0
        toRgb(cs.base.kind, comps, o)
      } else {
        for (let k = 0; k < n; k++) {
          const v = Math.round(row[x * n + k] * scale)
          comps[k] = mode === "inverted" ? 255 - v : v
        }
        toRgb(cs.kind, comps, o)
      }
    }
  }
  return { width: w, height: h, channels: outCh, pixels, raw, notes }
}

/** Alpha plane at the parent image's resolution (nearest-neighbour when sizes differ). */
function resampleAlpha(src: Uint8Array, sw: number, sh: number, w: number, h: number): Uint8Array {
  if (sw === w && sh === h) return src
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / h))
    for (let x = 0; x < w; x++) out[y * w + x] = src[sy * sw + Math.min(sw - 1, Math.floor((x * sw) / w))]
  }
  return out
}

function decodeMaskPlane(mask: PdfImageSpec, limits: DecodeLimits, stencil: boolean): { alpha: Uint8Array; width: number; height: number } | DecodeProblem {
  const decoded = decodeRawData(mask, limits)
  if (!decoded.ok) return decoded.problem
  if (stencil) {
    const bpc = mask.bitsPerComponent ?? 1
    if (bpc !== 1) return unsupported("UNSUPPORTED_MASK", "The image mask has an unsupported bit depth.")
    const inverted = mask.decode?.[0] === 1
    const rowBytes = Math.ceil(mask.width / 8)
    if (decoded.data.length < rowBytes * mask.height) return failed("TRUNCATED_MASK", "The image mask data is incomplete.")
    const alpha = new Uint8Array(mask.width * mask.height)
    for (let y = 0; y < mask.height; y++) {
      for (let x = 0; x < mask.width; x++) {
        const bit = (decoded.data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1
        // Explicit masking: sample 1 marks the masked-out (transparent) area unless /Decode [1 0].
        alpha[y * mask.width + x] = (bit === 1) !== inverted ? 0 : 255
      }
    }
    return { alpha, width: mask.width, height: mask.height }
  }
  if (mask.colorSpace?.kind !== "gray") return unsupported("UNSUPPORTED_SOFT_MASK", "The soft mask uses an unsupported colour space.")
  const r = rasterize(mask, decoded.data, limits, false)
  if (!("pixels" in r)) return r
  return { alpha: r.pixels, width: mask.width, height: mask.height }
}

function decodeRawData(spec: PdfImageSpec, limits: DecodeLimits): { ok: true; data: Uint8Array } | { ok: false; problem: DecodeProblem } {
  try {
    const r = decodeFilters(spec.data, spec.filters, spec.decodeParms, limits.maxDecodedBytes)
    if (r.codec) return { ok: false, problem: unsupported("UNSUPPORTED_MASK_ENCODING", `Masks encoded with ${r.codec} are not supported yet.`) }
    return { ok: true, data: r.data }
  } catch (err) {
    return { ok: false, problem: filterProblem(err) }
  }
}

function filterProblem(err: unknown): DecodeProblem {
  if (err instanceof DecodeLimitError) return unsupported("IMAGE_TOO_LARGE", "The image is too large to decode safely.")
  if (err instanceof UnsupportedFilterError) return unsupported("UNSUPPORTED_COMPRESSION", `${err.filter} compression is not supported.`)
  return failed("INVALID_IMAGE", "The embedded image data is damaged.")
}

const CODEC_LABEL: Record<string, string> = {
  JPXDecode: "JPEG 2000 (JPXDecode)",
  CCITTFaxDecode: "CCITT fax (CCITTFaxDecode)",
  JBIG2Decode: "JBIG2 (JBIG2Decode)",
}

/** Decode one image into an Alt Text pipeline format, or explain precisely why it cannot be. */
export function decodePdfImage(spec: PdfImageSpec, limits: DecodeLimits): DecodedImage | DecodeProblem {
  const { width: w, height: h } = spec
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) return failed("INVALID_DIMENSIONS", "The image dimensions are invalid.")
  if (w > limits.maxDimension || h > limits.maxDimension) return unsupported("IMAGE_TOO_LARGE", `Images larger than ${limits.maxDimension} pixels per side are not supported.`)
  if (spec.imageMask) return unsupported("STENCIL_MASK", "This is a stencil mask (a shape painted with the current colour), not a standalone picture.")

  let decoded: { data: Uint8Array; codec: string | null }
  try {
    decoded = decodeFilters(spec.data, spec.filters, spec.decodeParms, limits.maxDecodedBytes)
  } catch (err) {
    return filterProblem(err)
  }

  if (decoded.codec === "DCTDecode") {
    const head = readJpegHeader(decoded.data)
    if (!head) return failed("INVALID_IMAGE", "The embedded JPEG is damaged.")
    if (head.components === 4) return unsupported("CMYK_JPEG", "CMYK JPEG images cannot be preserved without colour conversion and are not supported yet.")
    if (spec.softMask || spec.colorKeyMask || spec.stencilMask) {
      return unsupported("JPEG_TRANSPARENCY_UNSUPPORTED", "This JPEG has a transparency mask that cannot be applied without re-encoding the photo.")
    }
    const n = head.components
    if (decodeMode(spec.decode, n, false, 8) !== "default") return unsupported("UNSUPPORTED_DECODE_ARRAY", "The JPEG uses a custom /Decode mapping that cannot be reproduced exactly.")
    return { ok: true, bytes: decoded.data, mimeType: "image/jpeg", format: "jpeg", width: head.width || w, height: head.height || h, preserved: true, notes: [] }
  }
  if (decoded.codec) return unsupported("UNSUPPORTED_COMPRESSION", `${CODEC_LABEL[decoded.codec] ?? decoded.codec} images are not supported yet.`)

  if (spec.softMaskMatte) return unsupported("UNSUPPORTED_SOFT_MASK", "Pre-multiplied (/Matte) soft masks are not supported yet.")
  const raster = rasterize(spec, decoded.data, limits, spec.colorKeyMask != null)
  if (!("pixels" in raster)) return raster

  let alpha: Uint8Array | null = null
  const notes = [...raster.notes]
  if (spec.softMask) {
    const m = decodeMaskPlane(spec.softMask, limits, false)
    if ("ok" in m) return m
    alpha = resampleAlpha(m.alpha, m.width, m.height, w, h)
    notes.push("soft_mask_applied")
  } else if (spec.stencilMask) {
    const m = decodeMaskPlane(spec.stencilMask, limits, true)
    if ("ok" in m) return m
    alpha = resampleAlpha(m.alpha, m.width, m.height, w, h)
    notes.push("explicit_mask_applied")
  } else if (spec.colorKeyMask && raster.raw) {
    const n = componentsOf(spec.colorKeyMask && spec.colorSpace ? spec.colorSpace : { kind: "gray", label: "" })
    const key = spec.colorKeyMask
    if (key.length !== n * 2) return unsupported("UNSUPPORTED_MASK", "The colour-key mask is malformed.")
    alpha = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) {
      const row = raster.raw[y]
      for (let x = 0; x < w; x++) {
        let inside = true
        for (let k = 0; k < n && inside; k++) {
          const s = row[x * n + k]
          inside = s >= key[2 * k] && s <= key[2 * k + 1]
        }
        alpha[y * w + x] = inside ? 0 : 255
      }
    }
    notes.push("color_key_mask_applied")
  }

  let channels: 1 | 2 | 3 | 4 = raster.channels
  let pixels = raster.pixels
  if (alpha) {
    channels = raster.channels === 1 ? 2 : 4
    const out = new Uint8Array(w * h * channels)
    for (let i = 0; i < w * h; i++) {
      for (let k = 0; k < raster.channels; k++) out[i * channels + k] = pixels[i * raster.channels + k]
      out[i * channels + raster.channels] = alpha[i]
    }
    pixels = out
  }
  return { ok: true, bytes: encodePng(w, h, channels, pixels), mimeType: "image/png", format: "png", width: w, height: h, preserved: false, notes }
}

/** Static description of how an image is encoded (for occurrence metadata; no decoding). */
export function describeImageSpec(spec: PdfImageSpec) {
  return {
    filters: spec.filters.map(normalizeFilter),
    colorSpace: spec.colorSpace?.label ?? null,
    bitsPerComponent: spec.bitsPerComponent,
    pixelWidth: spec.width,
    pixelHeight: spec.height,
    softMask: spec.softMask != null,
    mask: (spec.stencilMask ? "explicit" : spec.colorKeyMask ? "color_key" : null) as "explicit" | "color_key" | null,
    imageMask: spec.imageMask,
  }
}
