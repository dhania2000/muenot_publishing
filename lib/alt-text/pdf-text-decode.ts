/**
 * @file lib/alt-text/pdf-text-decode.ts
 * @module Publishing · Alt Text
 * @kind Pure server-side decoding helpers
 * @summary Phase 3 Task 9 — turn PDF string bytes into Unicode for context analysis. Uses the
 *   font's /ToUnicode CMap when present (the only reliable source for Type0/Indic/math fonts) and
 *   WinAnsi for simple Latin fonts. Fonts that cannot be decoded return null so callers can mark
 *   text as unreadable instead of guessing.
 */

export type FontDecoder = (bytes: Uint8Array) => string

const MAX_CMAP_ENTRIES = 65_536
const MAX_CMAP_CHARS = 2 * 1024 * 1024

const hexOnly = (h: string) => h.replace(/[^0-9a-fA-F]/g, "")

function utf16(h: string): string {
  const s = hexOnly(h)
  if (s.length <= 2) return s ? String.fromCharCode(parseInt(s, 16)) : ""
  let out = ""
  for (let i = 0; i + 3 < s.length; i += 4) out += String.fromCharCode(parseInt(s.slice(i, i + 4), 16))
  return out
}

/** Parse a ToUnicode CMap (bfchar / bfrange / codespacerange). Returns null when nothing maps. */
export function parseToUnicode(source: string): FontDecoder | null {
  const src = source.length > MAX_CMAP_CHARS ? source.slice(0, MAX_CMAP_CHARS) : source
  const map = new Map<string, string>()
  const lens = new Set<number>()

  for (const block of src.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F\s]+)>\s*<([0-9a-fA-F\s]+)>/g)) {
      const len = Math.ceil(hexOnly(m[1]).length / 2)
      if (len >= 1 && len <= 4) lens.add(len)
    }
  }
  const set = (codeHex: string, value: string) => {
    if (map.size >= MAX_CMAP_ENTRIES) return
    const h = hexOnly(codeHex)
    const len = Math.ceil(h.length / 2)
    if (len < 1 || len > 4) return
    lens.add(len)
    map.set(`${len}:${parseInt(h, 16)}`, value)
  }
  for (const block of src.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F\s]+)>\s*<([0-9a-fA-F\s]*)>/g)) set(m[1], utf16(m[2]))
  }
  for (const block of src.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F\s]+)>\s*<([0-9a-fA-F\s]+)>\s*(<[0-9a-fA-F\s]*>|\[[^\]]*\])/g)) {
      const loH = hexOnly(m[1])
      const lo = parseInt(loH, 16)
      const hi = parseInt(hexOnly(m[2]), 16)
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo || hi - lo > MAX_CMAP_ENTRIES) continue
      const width = loH.length
      const code = (c: number) => c.toString(16).padStart(width, "0")
      if (m[3].startsWith("[")) {
        const dsts = [...m[3].matchAll(/<([0-9a-fA-F\s]*)>/g)].map((d) => utf16(d[1]))
        dsts.forEach((d, i) => lo + i <= hi && set(code(lo + i), d))
      } else {
        const base = utf16(m[3])
        if (!base) continue
        const head = base.slice(0, -1)
        const last = base.charCodeAt(base.length - 1)
        for (let c = lo; c <= hi && map.size < MAX_CMAP_ENTRIES; c++) set(code(c), head + String.fromCharCode(last + (c - lo)))
      }
    }
  }
  if (map.size === 0) return null
  const sorted = [...lens].sort((a, b) => a - b)
  return (bytes) => {
    let out = ""
    for (let i = 0; i < bytes.length; ) {
      let hit = false
      for (const L of sorted) {
        if (i + L > bytes.length) break
        let c = 0
        for (let k = 0; k < L; k++) c = c * 256 + bytes[i + k]
        const v = map.get(`${L}:${c}`)
        if (v !== undefined) {
          out += v
          i += L
          hit = true
          break
        }
      }
      if (!hit) i += sorted[0]
    }
    return out
  }
}

// WinAnsiEncoding 0x80–0x9F (the rest of the byte range matches Latin-1).
const WIN_ANSI_HIGH = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ"

/** Simple (single-byte) Latin font without ToUnicode. */
export const winAnsiDecoder: FontDecoder = (bytes) => {
  let out = ""
  for (const b of bytes) out += b >= 0x80 && b <= 0x9f ? WIN_ANSI_HIGH[b - 0x80] : String.fromCharCode(b)
  return out
}

/** Join decoded TJ parts; large negative kerning (> 0.2 em) is treated as an inter-word gap. */
export function joinTextParts(parts: (Uint8Array | number)[], decode: FontDecoder): { text: string; glyphs: number } {
  let text = ""
  let glyphs = 0
  for (const p of parts) {
    if (typeof p === "number") {
      if (p < -200 && text && !text.endsWith(" ")) text += " "
      continue
    }
    const s = decode(p)
    glyphs += [...s].length
    text += s
  }
  return { text, glyphs }
}
