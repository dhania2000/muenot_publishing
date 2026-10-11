import { deflateRawSync } from "node:zlib"

/** In-memory PDF / OOXML fixtures for the Phase 3 Task 3 document upload tests. */

export type ZipFixtureEntry = {
  name: string
  data: Buffer | string
  deflate?: boolean
  flags?: number
  /** Override the declared uncompressed size (central + local headers). */
  declaredSize?: number
}

export function buildZip(entries: ZipFixtureEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, "utf8")
    const body = e.deflate ? deflateRawSync(raw) : raw
    const method = e.deflate ? 8 : 0
    const size = e.declaredSize ?? raw.length
    const name = Buffer.from(e.name, "utf8")
    const flags = (e.flags ?? 0) | 0x800

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(size, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, body)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(size, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += 30 + name.length + body.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
const RELS_CT = "application/vnd.openxmlformats-package.relationships+xml"

export const MAIN_CONTENT_TYPES = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
} as const

const MAIN_PART = { docx: "word/document.xml", pptx: "ppt/presentation.xml" } as const

export type OoxmlOptions = {
  contentTypes?: string
  rootRels?: string
  mainRels?: string
  omitMain?: boolean
  extra?: ZipFixtureEntry[]
}

export function ooxmlEntries(kind: "docx" | "pptx", opts: OoxmlOptions = {}): ZipFixtureEntry[] {
  const main = MAIN_PART[kind]
  const dir = main.slice(0, main.lastIndexOf("/"))
  const file = main.slice(main.lastIndexOf("/") + 1)
  const entries: ZipFixtureEntry[] = [
    {
      name: "[Content_Types].xml",
      data:
        opts.contentTypes ??
        `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="${RELS_CT}"/><Override PartName="/${main}" ContentType="${MAIN_CONTENT_TYPES[kind]}"/></Types>`,
      deflate: true,
    },
    {
      name: "_rels/.rels",
      data: opts.rootRels ?? `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="${main}"/></Relationships>`,
      deflate: true,
    },
  ]
  if (!opts.omitMain) entries.push({ name: main, data: `<?xml version="1.0"?><root/>`, deflate: true })
  if (opts.mainRels) entries.push({ name: `${dir}/_rels/${file}.rels`, data: opts.mainRels, deflate: true })
  return [...entries, ...(opts.extra ?? [])]
}

export const ooxml = (kind: "docx" | "pptx", opts?: OoxmlOptions) => buildZip(ooxmlEntries(kind, opts))

export const rels = (...items: string[]) => `<?xml version="1.0"?><Relationships>${items.join("")}</Relationships>`
export const rel = (type: string, target: string, external = false) =>
  `<Relationship Id="r${Math.random().toString(36).slice(2, 8)}" Type="${REL_NS}/${type}" Target="${target}"${external ? ' TargetMode="External"' : ""}/>`

export function pdf(body = "1 0 obj\n<< /Type /Catalog >>\nendobj\n"): Buffer {
  return Buffer.from(`%PDF-1.7\n${body}xref\n0 1\ntrailer\n<< /Root 1 0 R >>\nstartxref\n9\n%%EOF\n`, "latin1")
}

export const EXE = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(256, 0x90)])

export const CFB = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)])
