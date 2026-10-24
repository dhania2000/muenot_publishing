/**
 * @file lib/alt-text/image-header.ts
 * @module Publishing · Alt Text
 * @kind Shared library (no I/O)
 * @summary Phase 3 Task 4 — bounded, decode-free reader for image dimensions and EXIF orientation
 *   (JPEG, PNG, WebP). Only header bytes are inspected; pixels are never decoded.
 */
import type { ExifOrientation } from "./region-analysis"

export type ImageHeaderInfo = {
  width: number
  height: number
  orientation: ExifOrientation
  /** True when the format may carry orientation that this reader cannot resolve. */
  orientationUnknown: boolean
}

const MAX_SCAN = 512 * 1024
const MAX_DIMENSION = 65_535

const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1]
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8)
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]
const u24le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)
const u32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0

const okDims = (w: number, h: number) => Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w <= MAX_DIMENSION && h <= MAX_DIMENSION

function readExifOrientation(b: Uint8Array, start: number, end: number): ExifOrientation | null {
  // "Exif\0\0" then a TIFF header.
  if (end - start < 14 || String.fromCharCode(b[start], b[start + 1], b[start + 2], b[start + 3]) !== "Exif") return null
  const t = start + 6
  const le = b[t] === 0x49 && b[t + 1] === 0x49
  if (!le && !(b[t] === 0x4d && b[t + 1] === 0x4d)) return null
  const r16 = (o: number) => (le ? u16le(b, o) : u16be(b, o))
  const r32 = (o: number) => (le ? u32le(b, o) : u32be(b, o))
  const ifd = t + r32(t + 4)
  if (ifd + 2 > end) return null
  const count = r16(ifd)
  for (let i = 0; i < count && i < 256; i++) {
    const e = ifd + 2 + i * 12
    if (e + 12 > end) return null
    if (r16(e) === 0x0112) {
      const v = r16(e + 8)
      return v >= 1 && v <= 8 ? (v as ExifOrientation) : null
    }
  }
  return 1
}

function readJpeg(b: Uint8Array): ImageHeaderInfo | null {
  let o = 2
  let orientation: ExifOrientation = 1
  let orientationUnknown = false
  const end = Math.min(b.length, MAX_SCAN)
  while (o + 4 <= end) {
    if (b[o] !== 0xff) return null
    const marker = b[o + 1]
    if (marker === 0xff) {
      o++
      continue
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      o += 2
      continue
    }
    const len = u16be(b, o + 2)
    if (len < 2) return null
    const segStart = o + 4
    const segEnd = o + 2 + len
    if (marker === 0xe1) {
      const exif = readExifOrientation(b, segStart, Math.min(segEnd, end))
      if (exif === null && String.fromCharCode(b[segStart], b[segStart + 1], b[segStart + 2], b[segStart + 3]) === "Exif") orientationUnknown = true
      else if (exif !== null) orientation = exif
    }
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      if (segStart + 5 > end) return null
      const height = u16be(b, segStart + 1)
      const width = u16be(b, segStart + 3)
      return okDims(width, height) ? { width, height, orientation, orientationUnknown } : null
    }
    if (marker === 0xda) return null
    o = segEnd
  }
  return null
}

function readPng(b: Uint8Array): ImageHeaderInfo | null {
  if (b.length < 24 || String.fromCharCode(b[12], b[13], b[14], b[15]) !== "IHDR") return null
  const width = u32be(b, 16)
  const height = u32be(b, 20)
  // PNG eXIf chunks are rarely honoured consistently by viewers; treat orientation as identity.
  return okDims(width, height) ? { width, height, orientation: 1, orientationUnknown: false } : null
}

function readWebp(b: Uint8Array): ImageHeaderInfo | null {
  if (b.length < 30) return null
  const chunk = String.fromCharCode(b[12], b[13], b[14], b[15])
  if (chunk === "VP8 ") {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null
    const width = u16le(b, 26) & 0x3fff
    const height = u16le(b, 28) & 0x3fff
    return okDims(width, height) ? { width, height, orientation: 1, orientationUnknown: false } : null
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return null
    const bits = u32le(b, 21)
    const width = (bits & 0x3fff) + 1
    const height = ((bits >> 14) & 0x3fff) + 1
    return okDims(width, height) ? { width, height, orientation: 1, orientationUnknown: false } : null
  }
  if (chunk === "VP8X") {
    const hasExif = (b[20] & 0x08) !== 0
    const width = u24le(b, 24) + 1
    const height = u24le(b, 27) + 1
    return okDims(width, height) ? { width, height, orientation: 1, orientationUnknown: hasExif } : null
  }
  return null
}

/** Returns null when the header is unreadable; callers must then refuse region detection. */
export function readImageHeader(bytes: Uint8Array, mediaType: string): ImageHeaderInfo | null {
  if (!bytes || bytes.length < 12) return null
  if (mediaType === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8) return readJpeg(bytes)
  if (mediaType === "image/png" && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return readPng(bytes)
  if (mediaType === "image/webp" && String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === "RIFF" && String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === "WEBP") return readWebp(bytes)
  return null
}
