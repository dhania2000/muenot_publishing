/**
 * @file lib/alt-text/document-validation.ts
 * @module Publishing · Alt Text
 * @kind Server-side library (pure)
 * @summary Phase 3 Task 3 — structural validation of uploaded PDF / PPTX / DOCX bytes.
 *   Inspects without executing anything: the ZIP central directory is read with
 *   entry-count, size, ratio and overlap limits; only `[Content_Types].xml` and
 *   `.rels` parts are inflated (bounded) to confirm a genuine OOXML package and
 *   reject macros, ActiveX, remote templates and path traversal.
 */
import "server-only"
import { inflateRawSync } from "node:zlib"
import { DOCUMENT_ARCHIVE_LIMITS as LIMITS } from "./document-upload-contract"
import type { DocumentKind } from "./document-queue"

export type DocumentValidationCode =
  | "INVALID_DOCUMENT"
  | "CONTENT_MISMATCH"
  | "ENCRYPTED_DOCUMENT"
  | "MACROS_NOT_ALLOWED"
  | "ACTIVE_CONTENT"
  | "UNSAFE_ARCHIVE"
  | "ARCHIVE_TOO_LARGE"

export type DocumentValidationResult = { ok: true } | { ok: false; code: DocumentValidationCode; message: string }

class Rejection extends Error {
  constructor(
    readonly code: DocumentValidationCode,
    message: string,
  ) {
    super(message)
  }
}

const reject = (code: DocumentValidationCode, message: string): never => {
  throw new Rejection(code, message)
}

// ---------------------------------------------------------------------------
// ZIP central directory
// ---------------------------------------------------------------------------

const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

export type ZipEntry = {
  name: string
  flags: number
  method: number
  compressedSize: number
  size: number
  localOffset: number
  dataStart: number
  dataEnd: number
}

const DAMAGED = "The document package is damaged or incomplete."

function findEndOfCentralDirectory(buf: Buffer): number {
  const min = Math.max(0, buf.length - 22 - 0xffff)
  for (let i = buf.length - 22; i >= min; i--) if (buf.readUInt32LE(i) === SIG_EOCD) return i
  return -1
}

export function readZipDirectory(buf: Buffer): ZipEntry[] {
  if (buf.length < 22) reject("INVALID_DOCUMENT", DAMAGED)
  const eocd = findEndOfCentralDirectory(buf)
  if (eocd < 0) reject("INVALID_DOCUMENT", DAMAGED)

  const disk = buf.readUInt16LE(eocd + 4)
  const cdDisk = buf.readUInt16LE(eocd + 6)
  const onDisk = buf.readUInt16LE(eocd + 8)
  const total = buf.readUInt16LE(eocd + 10)
  const cdSize = buf.readUInt32LE(eocd + 12)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff)
    reject("UNSAFE_ARCHIVE", "The document uses an unsupported ZIP64 package layout.")
  if (disk !== 0 || cdDisk !== 0 || onDisk !== total) reject("INVALID_DOCUMENT", DAMAGED)
  if (total > LIMITS.maxEntries) reject("UNSAFE_ARCHIVE", "The document package contains too many parts.")
  const cdEnd = cdOffset + cdSize
  if (cdEnd > eocd) reject("INVALID_DOCUMENT", DAMAGED)

  const entries: ZipEntry[] = []
  let p = cdOffset
  for (let i = 0; i < total; i++) {
    if (p + 46 > cdEnd || buf.readUInt32LE(p) !== SIG_CENTRAL) reject("INVALID_DOCUMENT", DAMAGED)
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const compressedSize = buf.readUInt32LE(p + 20)
    const size = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const next = p + 46 + nameLen + extraLen + commentLen
    if (next > cdEnd) reject("INVALID_DOCUMENT", DAMAGED)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x800 ? "utf8" : "latin1")

    if (localOffset + 30 > cdOffset || buf.readUInt32LE(localOffset) !== SIG_LOCAL) reject("INVALID_DOCUMENT", DAMAGED)
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28)
    const dataEnd = dataStart + compressedSize
    if (dataEnd > cdOffset) reject("INVALID_DOCUMENT", DAMAGED)

    entries.push({ name, flags, method, compressedSize, size, localOffset, dataStart, dataEnd })
    p = next
  }
  return entries
}

export function isUnsafeEntryName(name: string): boolean {
  if (!name || name.includes("\\") || name.includes("\0") || name.startsWith("/") || /^[a-z]:/i.test(name)) return true
  return name.split("/").some((seg) => seg === "..")
}

export function assertSafeEntries(entries: ZipEntry[]): void {
  const seen = new Set<string>()
  let totalSize = 0
  for (const e of entries) {
    if (isUnsafeEntryName(e.name)) reject("UNSAFE_ARCHIVE", "The document package contains an unsafe file path.")
    const key = e.name.toLowerCase()
    if (seen.has(key)) reject("UNSAFE_ARCHIVE", "The document package contains duplicate parts.")
    seen.add(key)
    if (e.flags & 0x1) reject("ENCRYPTED_DOCUMENT", "Password-protected documents cannot be inspected safely.")
    if (e.method !== 0 && e.method !== 8) reject("INVALID_DOCUMENT", "The document package uses unsupported compression.")
    if (e.method === 0 && e.size !== e.compressedSize) reject("INVALID_DOCUMENT", DAMAGED)
    if (e.size > 0 && e.compressedSize === 0) reject("UNSAFE_ARCHIVE", "The document package has an invalid compressed part.")
    if (e.size > 1024 * 1024 && e.size / e.compressedSize > LIMITS.maxEntryRatio)
      reject("UNSAFE_ARCHIVE", "The document package has a suspicious compression ratio.")
    totalSize += e.size
    if (totalSize > LIMITS.maxUncompressedBytes) reject("ARCHIVE_TOO_LARGE", "The document expands beyond the allowed size.")
  }
  const ordered = [...entries].sort((a, b) => a.localOffset - b.localOffset)
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].localOffset < ordered[i - 1].dataEnd) reject("UNSAFE_ARCHIVE", "The document package has overlapping parts.")
  }
}

/**
 * Inflate one entry with a hard output cap; the declared size must match exactly.
 * Throws a validation rejection (never returns partial data).
 */
export function readZipEntryBytes(buf: Buffer, entry: ZipEntry, cap: number): Buffer {
  if (entry.size > cap) reject("UNSAFE_ARCHIVE", "A document package part is too large to inspect.")
  if (entry.size === 0) return Buffer.alloc(0)
  const data = buf.subarray(entry.dataStart, entry.dataEnd)
  let out: Buffer
  try {
    out = entry.method === 0 ? data : inflateRawSync(data, { maxOutputLength: cap })
  } catch {
    return reject("INVALID_DOCUMENT", DAMAGED)
  }
  if (out.length !== entry.size) reject("INVALID_DOCUMENT", DAMAGED)
  return out
}

function readEntryText(buf: Buffer, entry: ZipEntry, cap: number): string {
  return readZipEntryBytes(buf, entry, cap).toString("utf8")
}

/** Narrow a thrown validation rejection (from the exported ZIP helpers) to its code and safe message. */
export function asValidationRejection(err: unknown): { code: DocumentValidationCode; message: string } | null {
  return err instanceof Rejection ? { code: err.code, message: err.message } : null
}

// ---------------------------------------------------------------------------
// OOXML (PPTX / DOCX)
// ---------------------------------------------------------------------------

const OOXML_PROFILES: Record<Exclude<DocumentKind, "pdf">, { main: string; label: string }> = {
  docx: { main: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml", label: "Word (DOCX) document" },
  pptx: { main: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml", label: "PowerPoint (PPTX) presentation" },
}

/** External relationship types that make Office fetch and load remote content when opened. */
const REMOTE_LOAD_TYPES = new Set(["attachedtemplate", "oleobject", "frame", "subdocument", "package"])
const SAFE_EXTERNAL_TARGET = /^(https?:|mailto:|#)/i

function assertSafeXml(xml: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) reject("UNSAFE_ARCHIVE", "The document contains disallowed XML declarations.")
}

function xmlTags(xml: string, tag: string): Record<string, string>[] {
  const out: Record<string, string>[] = []
  const tagRe = new RegExp(`<(?:[\\w-]+:)?${tag}\\b([^>]*)>`, "g")
  const attrRe = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  for (const m of xml.matchAll(tagRe)) {
    const attrs: Record<string, string> = {}
    for (const a of m[1].matchAll(attrRe)) attrs[a[1]] = a[2] ?? a[3] ?? ""
    out.push(attrs)
  }
  return out
}

/** Resolve an internal relationship target to a lower-cased part name, or null if it escapes the package. */
export function resolvePartTarget(baseDir: string, target: string): string | null {
  let t = target.split("#")[0]
  try {
    t = decodeURIComponent(t)
  } catch {
    return null
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) || t.includes("\\") || t.includes("\0")) return null
  const parts = t.startsWith("/") ? [] : baseDir.split("/").filter(Boolean)
  for (const seg of t.split("/")) {
    if (!seg || seg === ".") continue
    if (seg === "..") {
      if (!parts.length) return null
      parts.pop()
    } else parts.push(seg)
  }
  return parts.join("/").toLowerCase()
}

function assertSafeRelationships(xml: string, baseDir: string) {
  assertSafeXml(xml)
  for (const rel of xmlTags(xml, "Relationship")) {
    const target = (rel.Target ?? "").trim()
    const type = (rel.Type ?? "").split("/").pop()?.toLowerCase() ?? ""
    if ((rel.TargetMode ?? "").toLowerCase() === "external") {
      if (REMOTE_LOAD_TYPES.has(type)) reject("ACTIVE_CONTENT", "The document references a remote template or embedded object.")
      if (!SAFE_EXTERNAL_TARGET.test(target)) reject("ACTIVE_CONTENT", "The document links to a local file or unsafe location.")
      continue
    }
    if (resolvePartTarget(baseDir, target) === null) reject("UNSAFE_ARCHIVE", "The document references a location outside its package.")
  }
}

const startsWith = (buf: Buffer, magic: number[]) => magic.every((b, i) => buf[i] === b)

function validateOoxml(buf: Buffer, kind: Exclude<DocumentKind, "pdf">) {
  const profile = OOXML_PROFILES[kind]
  if (startsWith(buf, CFB_MAGIC))
    reject("ENCRYPTED_DOCUMENT", "This document is password-protected or saved in a legacy Office format and cannot be inspected.")
  if (!startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) reject("CONTENT_MISMATCH", `The file is not a valid ${profile.label}.`)

  const entries = readZipDirectory(buf)
  assertSafeEntries(entries)

  for (const e of entries) {
    if (/(^|\/)vbaProject\.bin$|(^|\/)vbaData\.xml$/i.test(e.name)) reject("MACROS_NOT_ALLOWED", "Documents containing macros are not allowed.")
    if (/(^|\/)activeX\//i.test(e.name)) reject("ACTIVE_CONTENT", "Documents containing ActiveX controls are not allowed.")
  }

  const byName = new Map(entries.map((e) => [e.name.toLowerCase(), e]))
  const ctEntry = byName.get("[content_types].xml")
  const rootRels = byName.get("_rels/.rels")
  if (!ctEntry || !rootRels) reject("CONTENT_MISMATCH", `The file is a ZIP archive, not a valid ${profile.label}.`)

  let budget = LIMITS.maxXmlBudgetBytes
  const read = (entry: ZipEntry) => {
    budget -= entry.size
    if (budget < 0) reject("UNSAFE_ARCHIVE", "The document package is too complex to inspect.")
    return readEntryText(buf, entry, LIMITS.maxXmlPartBytes)
  }

  const contentTypes = read(ctEntry!)
  assertSafeXml(contentTypes)
  const declared = [...xmlTags(contentTypes, "Override"), ...xmlTags(contentTypes, "Default")].map((t) => t.ContentType ?? "")
  if (declared.some((ct) => /macroEnabled|vbaProject/i.test(ct))) reject("MACROS_NOT_ALLOWED", "Documents containing macros are not allowed.")
  const main = xmlTags(contentTypes, "Override").find((o) => o.ContentType === profile.main)
  if (!main) reject("CONTENT_MISMATCH", `The file is not a valid ${profile.label}.`)
  const mainPart = resolvePartTarget("", main!.PartName ?? "")
  if (!mainPart || !byName.has(mainPart)) reject("INVALID_DOCUMENT", "The document is missing its main content part.")

  const rootXml = read(rootRels!)
  assertSafeRelationships(rootXml, "")
  const officeDoc = xmlTags(rootXml, "Relationship").find(
    (r) => /\/officeDocument$/.test(r.Type ?? "") && (r.TargetMode ?? "").toLowerCase() !== "external",
  )
  if (!officeDoc || resolvePartTarget("", officeDoc.Target ?? "") !== mainPart)
    reject("INVALID_DOCUMENT", "The document's package relationships are invalid.")

  const relParts = entries.filter((e) => /(^|\/)_rels\/[^/]+\.rels$/i.test(e.name) && e !== rootRels)
  if (relParts.length > LIMITS.maxRelationshipParts) reject("UNSAFE_ARCHIVE", "The document package is too complex to inspect.")
  for (const part of relParts) {
    const baseDir = part.name.slice(0, part.name.toLowerCase().lastIndexOf("_rels/"))
    assertSafeRelationships(read(part), baseDir)
  }
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

function validatePdf(buf: Buffer) {
  if (!/^%PDF-[12]\.\d/.test(buf.subarray(0, 16).toString("latin1"))) reject("CONTENT_MISMATCH", "The file is not a valid PDF document.")
  const tail = buf.subarray(Math.max(0, buf.length - 4096)).toString("latin1")
  if (!tail.includes("%%EOF") || !tail.includes("startxref")) reject("INVALID_DOCUMENT", "The PDF is incomplete or damaged.")
  const text = buf.toString("latin1")
  if (/\/Encrypt\s*(?:\d+\s+\d+\s+R|<<)/.test(text)) reject("ENCRYPTED_DOCUMENT", "Password-protected or encrypted PDFs cannot be inspected safely.")
  if (/\/(?:JavaScript|JS|Launch)(?![A-Za-z0-9])/.test(text)) reject("ACTIVE_CONTENT", "PDFs containing scripts or launch actions are not allowed.")
}

/** Validate a document's bytes for its (extension-derived) kind. Never throws. */
export function validateDocumentBytes(buf: Buffer, kind: DocumentKind): DocumentValidationResult {
  try {
    if (kind === "pdf") validatePdf(buf)
    else validateOoxml(buf, kind)
    return { ok: true }
  } catch (err) {
    if (err instanceof Rejection) return { ok: false, code: err.code, message: err.message }
    return { ok: false, code: "INVALID_DOCUMENT", message: DAMAGED }
  }
}
