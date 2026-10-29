/** Frontend planning contract. No upload, execution or availability claim. */
export const EPUB_SOURCES = ["docx", "pdf", "images", "html", "xml", "latex", "idml", "epub"] as const
export const EPUB_VERSIONS = ["3.3", "3.4-experimental", "2.0.1-legacy"] as const
export const EPUB_LAYOUTS = ["reflowable", "fixed", "mixed", "roll"] as const
export type EpubSelection = { source: typeof EPUB_SOURCES[number]; version: typeof EPUB_VERSIONS[number]; layout: typeof EPUB_LAYOUTS[number]; rendition: "single" | "multiple"; profile: "standard" | "accessible" | "enhanced" | "stem" }
export const DEFAULT_EPUB_SELECTION:EpubSelection = {source:"docx", version:"3.3", layout:"reflowable", rendition:"single", profile:"standard"}
export const EPUB_PROFILES = [
  {id:"reflowable",name:"Reflowable",sources:"DOCX, HTML, XML",detail:"Text adapts to the reader’s screen and font settings.",limit:"Complex page geometry needs editorial restructuring.",page:"layout-settings",status:"Planned"},
  {id:"fixed",name:"Fixed layout",sources:"Designed PDF, IDML, images",detail:"Preserve deliberate page composition and image placement.",limit:"Zoom and reading order require reader-specific review.",page:"layout-settings",status:"Conditional"},
  {id:"mixed",name:"Mixed layout",sources:"Structured text with fixed inserts",detail:"Combine reflowable chapters and designed inserts.",limit:"Reader support varies; separate editions may be needed.",page:"layout-settings",status:"Conditional"},
  {id:"roll",name:"Continuous / roll",sources:"Long illustrated content",detail:"Plan a continuous reading presentation.",limit:"A product layout choice, not a separate EPUB standard.",page:"layout-settings",status:"Conditional"},
  {id:"accessible",name:"Accessible publication",sources:"Structured sources with reviewed alternatives",detail:"Target accessible navigation, text and media alternatives.",limit:"Automated checks and human review are both required.",page:"accessibility-checks",status:"Planned"},
  {id:"enhanced",name:"Enhanced / multimedia",sources:"Text, licensed audio and video",detail:"Plan synchronized narration and rich media.",limit:"Codecs, rights, transcripts and reader support must be verified.",page:"media-manager",status:"Conditional"},
  {id:"stem",name:"STEM",sources:"DOCX, XML, LaTeX",detail:"Preserve equations, notation, tables and scientific figures.",limit:"Recognition and accessible math require expert review.",page:"accessibility-checks",status:"Planned"},
  {id:"legacy",name:"Legacy EPUB",sources:"Rights-cleared EPUB 2 / earlier EPUB 3",detail:"Plan inspection, migration and explicit feature-loss review.",limit:"DRM removal and protected-source processing are unsupported.",page:"epub-validation",status:"Conditional"},
] as const
export function selectionProblems(s:EpubSelection):string[]{
  const errors:string[]=[]
  if(s.version==="2.0.1-legacy"&&(s.layout!=="reflowable"||s.profile!=="standard"||s.rendition!=="single"))errors.push("Legacy EPUB 2 planning supports a standard, single reflowable rendition. Use EPUB 3.3 for other profiles.")
  if(s.layout==="roll"&&s.rendition==="multiple")errors.push("Continuous / roll with multiple renditions is not a defined profile. Choose a single rendition or reflowable layout.")
  if(s.profile==="enhanced"&&s.layout==="roll")errors.push("Enhanced continuous / roll output has no approved compatibility profile. Choose reflowable or fixed layout.")
  return errors
}
export function detectEpubSource(name:string):EpubSelection["source"]|null {
  const ext=name.toLowerCase().split(".").at(-1)
  if(["png","jpg","jpeg","tif","tiff","webp"].includes(ext??""))return "images"
  if(["html","xhtml","htm"].includes(ext??""))return "html"
  if(ext==="tex")return "latex"
  return EPUB_SOURCES.includes(ext as any)?ext as EpubSelection["source"]:null
}
export type EpubDraft = {schemaVersion:1;title:string;author:string;guidelineNotes:string;selection:EpubSelection;step:number;sources:{name:string;size:number;kind:EpubSelection["source"]}[]}
export const emptyEpubDraft=():EpubDraft=>({schemaVersion:1,title:"",author:"",guidelineNotes:"",selection:{...DEFAULT_EPUB_SELECTION},step:0,sources:[]})
export function parseEpubDraft(raw:unknown):EpubDraft|null {
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return null
  const d=raw as any,s=d.selection
  if(Object.keys(d).some(k=>!["schemaVersion","title","author","guidelineNotes","selection","step","sources"].includes(k))||d.schemaVersion!==1||typeof d.title!=="string"||d.title.length>160||typeof d.author!=="string"||d.author.length>160||typeof d.guidelineNotes!=="string"||d.guidelineNotes.length>2000||!Number.isInteger(d.step)||d.step<0||d.step>4||!s||Object.keys(s).sort().join()!=="layout,profile,rendition,source,version"||!EPUB_SOURCES.includes(s.source)||!EPUB_VERSIONS.includes(s.version)||!EPUB_LAYOUTS.includes(s.layout)||!["single","multiple"].includes(s.rendition)||!["standard","accessible","enhanced","stem"].includes(s.profile)||selectionProblems(s).length||!Array.isArray(d.sources)||d.sources.length>10)return null
  for(const f of d.sources)if(!f||Object.keys(f).sort().join()!=="kind,name,size"||typeof f.name!=="string"||!f.name||f.name.length>255||/[\x00-\x1f\\/]/.test(f.name)||!Number.isSafeInteger(f.size)||f.size<1||f.size>25*1024*1024||!EPUB_SOURCES.includes(f.kind)||detectEpubSource(f.name)!==f.kind)return null
  if(d.sources.reduce((n:number,f:any)=>n+f.size,0)>100*1024*1024)return null
  return structuredClone(d)
}
