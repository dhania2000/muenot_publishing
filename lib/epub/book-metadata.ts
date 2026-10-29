import type {EpubDraft} from "./intake-plan"
export const BOOK_FIELDS={subtitle:200,imprint:160,series:160,edition:80,isbn:24} as const
export type BibliographicFields=Partial<Record<keyof typeof BOOK_FIELDS,string>>
export function normalizeIsbn(raw:string):string|null{
 const value=raw.replace(/[\s-]/g,'').toUpperCase();if(!value)return ""
 if(/^\d{13}$/.test(value)&&/^(978|979)/.test(value)){const sum=[...value].reduce((n,c,i)=>n+Number(c)*(i%2?3:1),0);return sum%10===0?value:null}
 if(/^\d{9}[\dX]$/.test(value)){const sum=[...value].reduce((n,c,i)=>n+(c==='X'?10:Number(c))*(10-i),0);return sum%11===0?value:null}
 return null
}
export function parseBookFields(raw:Record<string,unknown>):BibliographicFields|null{
 const fields:BibliographicFields={}
 for(const [k,max]of Object.entries(BOOK_FIELDS)){
  const value=raw[k];if(value===undefined||value==="")continue
  if(typeof value!=="string"||value.length>max||!value.isWellFormed()||/[\x00-\x1f\x7f]/.test(value))return null
  const normalized=k==='isbn'?normalizeIsbn(value):value.normalize("NFC").trim();if(normalized===null)return null
  if(normalized)fields[k as keyof BibliographicFields]=normalized
 }
 return fields
}
/** Exact metadata contract for a future package builder; this does not produce an EPUB or assign an ISBN. */
export function epubPackageMetadata(projectId:string,plan:EpubDraft){
 const m=plan.configuration?.metadata,extra=parseBookFields(m??{})
 if(!/^[a-f0-9-]{36}$/i.test(projectId)||!plan.title.trim()||!m||!extra)throw Error("Valid project metadata is required.")
 return {identifier:extra.isbn?`urn:isbn:${extra.isbn}`:m.identifier.trim()||`urn:uuid:${projectId}`,title:plan.title,creators:plan.author.trim()?[plan.author]:[],language:m.language,publisher:m.publisher,description:m.description,rights:m.rights,subtitle:extra.subtitle??"",imprint:extra.imprint??"",series:extra.series??"",edition:extra.edition??"",isbn:extra.isbn??""}
}
