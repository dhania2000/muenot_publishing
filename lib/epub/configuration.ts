import {parseBookFields,BOOK_FIELDS,type BibliographicFields} from "./book-metadata"
export type EpubConfiguration = {
  metadata:{language:string;publisher:string;identifier:string;description:string;rights:string}&BibliographicFields
  typography:{font:"reader-default"|"serif"|"sans-serif";scale:number;direction:"auto"|"ltr"|"rtl"}
  media:{images:"preserve"|"lossless";audio:boolean;video:boolean}
  accessibility:{target:"1.1"|"1.2-experimental";requireDescriptions:boolean;requireTranscript:boolean}
  compatibility:{reader:"general"|"apple-books"|"thorium"|"kobo";scripting:false}
}
export const DEFAULT_EPUB_CONFIGURATION:EpubConfiguration={metadata:{language:"en",publisher:"",identifier:"",description:"",rights:""},typography:{font:"reader-default",scale:100,direction:"auto"},media:{images:"preserve",audio:false,video:false},accessibility:{target:"1.1",requireDescriptions:true,requireTranscript:true},compatibility:{reader:"general",scripting:false}}
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==="object"&&!Array.isArray(v)
const keys=(o:unknown,names:string[])=>object(o)&&Object.keys(o).sort().join()===names.sort().join()
export function parseEpubConfiguration(raw:unknown):EpubConfiguration|null{
 if(raw===undefined)return structuredClone(DEFAULT_EPUB_CONFIGURATION)
 if(!keys(raw,["metadata","typography","media","accessibility","compatibility"]))return null
 const {metadata:m,typography:t,media:d,accessibility:a,compatibility:c}=raw as EpubConfiguration
 if((!object(m)||Object.keys(m).some(k=>!["language","publisher","identifier","description","rights",...Object.keys(BOOK_FIELDS)].includes(k))||!["language","publisher","identifier","description","rights"].every(k=>Object.hasOwn(m,k)))||!keys(t,["font","scale","direction"])||!keys(d,["images","audio","video"])||!keys(a,["target","requireDescriptions","requireTranscript"])||!keys(c,["reader","scripting"]))return null
 for(const [name,max]of Object.entries({language:35,publisher:160,identifier:160,description:2000,rights:500})){const s=(m as any)[name];if(typeof s!=="string"||s.length>max||!s.isWellFormed()||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s))return null}
 if(!/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(m.language)||!["reader-default","serif","sans-serif"].includes(t.font)||!Number.isInteger(t.scale)||t.scale<80||t.scale>200||!["auto","ltr","rtl"].includes(t.direction)||!["preserve","lossless"].includes(d.images)||typeof d.audio!=="boolean"||typeof d.video!=="boolean"||!["1.1","1.2-experimental"].includes(a.target)||typeof a.requireDescriptions!=="boolean"||typeof a.requireTranscript!=="boolean"||!["general","apple-books","thorium","kobo"].includes(c.reader)||c.scripting!==false)return null
 const book=parseBookFields(m);if(!book)return null
 // Canonical property order keeps request fingerprints stable across equivalent JSON encodings.
 return {metadata:{language:m.language,publisher:m.publisher,identifier:m.identifier,description:m.description,rights:m.rights,...book},typography:{font:t.font,scale:t.scale,direction:t.direction},media:{images:d.images,audio:d.audio,video:d.video},accessibility:{target:a.target,requireDescriptions:a.requireDescriptions,requireTranscript:a.requireTranscript},compatibility:{reader:c.reader,scripting:false}}
}
export function configurationProblems(c:EpubConfiguration,s:{version:string;layout:string;profile:string}):string[]{
 const problems:string[]=[]
 if(c.accessibility.target==="1.2-experimental"&&s.version!=="3.4-experimental")problems.push("The experimental accessibility target requires the experimental EPUB 3.4 profile.")
 if(s.version==="2.0.1-legacy"&&(c.media.audio||c.media.video))problems.push("Legacy planning does not include audio/video. Choose EPUB 3.3 for enhanced media.")
 if(s.layout==="fixed"&&c.typography.scale!==100)problems.push("Fixed-layout planning requires a 100% base text scale. Reader zoom remains a separate check.")
 return problems
}
