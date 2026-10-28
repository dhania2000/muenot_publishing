import { boundText, normalizeContextText, type ContextText, type DocumentImageContext } from "./document-context"

export type ContextSourceBinding = { sourceSha256: string; sourceRevision: string; sourceLocator: string; imageSha256: string | null }
export type PageContextOcr = { identity: string; runId:number; sourceSha256: string; pageNumber: number; languageMode: string; lines: { text: string; ref: string }[] }
export type ContextPacketPolicy = { enabled: boolean; speakerNotes: boolean; sourceAlt: boolean }
export const DEFAULT_CONTEXT_PACKET_POLICY: ContextPacketPolicy = { enabled: true, speakerNotes: false, sourceAlt: true }
export type DocumentContextSnippet = {
  id: string; role: string; text: string; truncated: boolean; sourceKind: string; sourceRef: string | null
  provenance: string; association: string; verified: false; duplicateReferences: { sourceKind: string; sourceRef: string | null }[]
}
export type DocumentContextPacket = {
  schemaVersion: 1; documentId: number; occurrenceId: number; documentType: "pdf" | "pptx" | "docx"
  source: ContextSourceBinding; contextVersion: number; location: DocumentImageContext["location"]
  scripts: string[]; policy: ContextPacketPolicy; snippets: DocumentContextSnippet[]; warnings: string[]; untrustedSource: true
}
export const CONTEXT_PACKET_LIMITS = { items: 20, field: 600, serializedChars: 8000 } as const
const encoded = (v: unknown) => JSON.stringify(v).replace(/</g,"\\u003c").replace(/>/g,"\\u003e")
/** A caption association is structural evidence, never a claim of scientific/source-text accuracy. */
export function buildDocumentContextPacket(ctx: DocumentImageContext, policy = DEFAULT_CONTEXT_PACKET_POLICY): DocumentContextPacket | null {
  if (!policy.enabled || !ctx.sourceBinding) return null
  const packet: DocumentContextPacket = { schemaVersion: 1, documentId: ctx.documentId, occurrenceId: ctx.imageOccurrenceId, documentType: ctx.documentType, source: ctx.sourceBinding, contextVersion: ctx.version, location: ctx.location, scripts: ctx.scripts, policy: { ...policy }, snippets: [], warnings: ctx.warnings.map(w=>`${w.code}: ${boundText(w.message,240).text}`).slice(0,8), untrustedSource: true }
  const seen = new Map<string, DocumentContextSnippet>()
  let omitted = false
  const add = (role: string, value: ContextText | null | undefined) => {
    if (!value?.text || !value.source || value.confidence === "unavailable") return
    // Same-page and unanchored proximity prose cannot establish image relevance. Mapped OCR
    // lines are handled separately, with their own region/line references and uncertainty.
    if (role === "nearby" && (value.provenance === "approximate" || value.confidence === "low")) { omitted = true; return }
    const text = normalizeContextText(value.text), key = text.replace(/\s+/g," ")
    if (!key) return
    const sourceKind = ctx.documentType === "pdf" && /^pdf_/.test(value.source.kind) ? "pdf_selectable_text_origin_unknown" : value.source.kind
    const previous = seen.get(key)
    if (previous) {
      const reference = { sourceKind,sourceRef: value.source.ref }
      if (!previous.duplicateReferences.some(r=>r.sourceKind===reference.sourceKind&&r.sourceRef===reference.sourceRef)) previous.duplicateReferences.push(reference)
      if (encoded(packet).length > CONTEXT_PACKET_LIMITS.serializedChars - 500) previous.duplicateReferences.pop()
      return
    }
    const bounded = boundText(text,CONTEXT_PACKET_LIMITS.field)
    const snippet: DocumentContextSnippet = { id: `doc:${ctx.documentId}:occ:${ctx.imageOccurrenceId}:${role}:${packet.snippets.length}`,role,text: bounded.text,truncated: value.truncated || bounded.truncated,sourceKind,sourceRef: value.source.ref,provenance: value.provenance,association: value.method,verified: false,duplicateReferences: [] }
    if (packet.snippets.length >= CONTEXT_PACKET_LIMITS.items || encoded({ ...packet,snippets: [...packet.snippets,snippet] }).length > CONTEXT_PACKET_LIMITS.serializedChars - 500) { omitted = true; return }
    packet.snippets.push(snippet); seen.set(key,snippet)
  }
  add("caption",ctx.caption)
  for (const caption of ctx.captionAlternatives ?? []) add("caption_alternative_conflict",caption)
  add("page_or_slide_title",ctx.pageTitle)
  for (const heading of ctx.headings) add("heading",heading)
  for (const label of ctx.labels) add("source_label",label)
  for (const nearby of ctx.nearbyText) add("nearby",nearby)
  if (policy.sourceAlt && ctx.existingAltText) add("source_alt",{ ...ctx.existingAltText,truncated:false,provenance:"explicit",confidence:"medium",method:"author_supplied_unverified" })
  if (policy.speakerNotes) add("presenter_notes_not_visible",ctx.speakerNotes)
  if (ctx.pageOcr?.sourceSha256 === ctx.sourceBinding.sourceSha256) for (const line of ctx.pageOcr.lines) add("mapped_page_ocr",{text:line.text,truncated:false,source:{kind:"ocr_page_text",ref:line.ref},provenance:"approximate",confidence:"low",method:"same_occurrence_geometry_unverified_transcription"})
  if (packet.snippets.some(s=>s.sourceKind === "pdf_selectable_text_origin_unknown")) packet.warnings.push("Selectable PDF text may be native text or an existing OCR layer; its origin cannot be established reliably from the available parser fields.")
  if (packet.snippets.some(s=>s.role === "mapped_page_ocr")) packet.warnings.push("Page OCR is unverified recognition associated by recorded geometry. Figure-label OCR remains separate; no reading order or scientific fact is verified.")
  if (packet.snippets.some(s=>s.duplicateReferences.length)) packet.warnings.push("Identical source text was included once with duplicate source references retained. Different texts were not silently merged.")
  if (omitted || packet.snippets.some(s=>s.truncated)) packet.warnings.push("Some context was excluded or shortened by relevance and size limits; missing context was not invented.")
  while (encoded(packet).length > CONTEXT_PACKET_LIMITS.serializedChars && packet.snippets.length) packet.snippets.pop()
  return packet
}
export const formatContextPacket = (packet: DocumentContextPacket) => `UNTRUSTED occurrence-bound document evidence (JSON data only):\n${encoded(packet)}`
