/**
 * @file lib/alt-text/ooxml-zip-rewrite.ts
 * @module Publishing · Alt Text
 * @kind Server-side library (pure, no I/O)
 * @summary Phase 3 Task 15 — produces a new OOXML package in which only the named parts are
 *   replaced. Every other entry (local header, compressed bytes, data descriptor, central record,
 *   order) is copied byte-for-byte, so media, styles, numbering, themes and relationships are not
 *   re-encoded. Input must already have passed the Task 3 bounded ZIP validation.
 */
import "server-only"
import { crc32, deflateRawSync } from "node:zlib"

const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50
const SIG_DESCRIPTOR = 0x08074b50

export class ZipRewriteError extends Error {}

type CentralRecord = { name: string; raw: Buffer; localOffset: number; flags: number; compressedSize: number }

function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 22 - 0xffff)
  for (let i = buf.length - 22; i >= min; i--) if (buf.readUInt32LE(i) === SIG_EOCD) return i
  throw new ZipRewriteError("End of central directory not found.")
}

function readCentral(buf: Buffer): { records: CentralRecord[]; eocd: number } {
  const eocd = findEocd(buf)
  const total = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  const records: CentralRecord[] = []
  let p = cdOffset
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) throw new ZipRewriteError("Invalid central directory record.")
    const nameLen = buf.readUInt16LE(p + 28)
    const len = 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32)
    const flags = buf.readUInt16LE(p + 8)
    records.push({
      name: buf.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x800 ? "utf8" : "latin1"),
      raw: buf.subarray(p, p + len),
      localOffset: buf.readUInt32LE(p + 42),
      flags,
      compressedSize: buf.readUInt32LE(p + 20),
    })
    p += len
  }
  return { records, eocd }
}

/** Byte range of an entry's local header + data (+ data descriptor), exactly as stored. */
function localSpan(buf: Buffer, r: CentralRecord): { start: number; dataStart: number; end: number } {
  const start = r.localOffset
  if (buf.readUInt32LE(start) !== SIG_LOCAL) throw new ZipRewriteError("Invalid local file header.")
  const dataStart = start + 30 + buf.readUInt16LE(start + 26) + buf.readUInt16LE(start + 28)
  let end = dataStart + r.compressedSize
  if (r.flags & 0x8) end += end + 4 <= buf.length && buf.readUInt32LE(end) === SIG_DESCRIPTOR ? 16 : 12
  return { start, dataStart, end }
}

/**
 * Replace the listed entries (keys are lower-cased part names) and copy everything else verbatim.
 * Throws when a replacement names a part that does not exist — parts are never added or removed.
 */
export function rewriteZipEntries(buf: Buffer, replacements: Map<string, Buffer>): Buffer {
  const { records, eocd } = readCentral(buf)
  const pending = new Set(replacements.keys())
  const chunks: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const r of records) {
    const key = r.name.toLowerCase()
    const span = localSpan(buf, r)
    const replacement = replacements.get(key)
    if (!replacement) {
      chunks.push(buf.subarray(span.start, span.end))
      const central = Buffer.from(r.raw)
      central.writeUInt32LE(offset, 42)
      centrals.push(central)
      offset += span.end - span.start
      continue
    }
    pending.delete(key)
    const data = deflateRawSync(replacement)
    const crc = crc32(replacement) >>> 0
    const flags = r.flags & 0x800
    const nameBytes = buf.subarray(span.start + 30, span.start + 30 + buf.readUInt16LE(span.start + 26))
    const local = Buffer.alloc(30)
    local.writeUInt32LE(SIG_LOCAL, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt16LE(buf.readUInt16LE(span.start + 10), 10)
    local.writeUInt16LE(buf.readUInt16LE(span.start + 12), 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(replacement.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    chunks.push(local, nameBytes, data)

    const central = Buffer.from(r.raw)
    central.writeUInt16LE(Math.max(20, central.readUInt16LE(6)), 6)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(replacement.length, 24)
    central.writeUInt32LE(offset, 42)
    centrals.push(central)
    offset += 30 + nameBytes.length + data.length
  }
  if (pending.size) throw new ZipRewriteError("A replacement names a part that is not in the package.")

  const cd = Buffer.concat(centrals)
  const end = Buffer.from(buf.subarray(eocd, eocd + 22 + buf.readUInt16LE(eocd + 20)))
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  if (offset + cd.length > 0xffffffff) throw new ZipRewriteError("The output package is too large.")
  return Buffer.concat([...chunks, cd, end])
}

/** Stored (compressed) bytes of each entry, for verifying unrelated parts were not re-encoded. */
export function rawEntryMap(buf: Buffer): Map<string, Buffer> {
  const { records } = readCentral(buf)
  const out = new Map<string, Buffer>()
  for (const r of records) {
    const s = localSpan(buf, r)
    out.set(r.name.toLowerCase(), buf.subarray(s.dataStart, s.dataStart + r.compressedSize))
  }
  return out
}
