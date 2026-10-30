export const GUIDELINE_FORMATS=['pdf','docx','txt','xlsx','json'] as const
export type GuidelineFileFact={name:string;size:number;format:typeof GUIDELINE_FORMATS[number]}
export type GuidelineProfileRef={id:string;version:number}
export type GuidelineSelection={company?:GuidelineProfileRef;book?:GuidelineProfileRef}
export const GUIDELINE_FILE_MAX=5*1024*1024
export const GUIDELINE_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
export function guidelineFormat(name:string){const ext=name.split('.').at(-1)?.toLowerCase();return GUIDELINE_FORMATS.includes(ext as any)?ext as GuidelineFileFact['format']:null}
export function parseGuidelineSelection(value:unknown):GuidelineSelection|null{if(value===undefined)return {};if(!value||typeof value!=='object'||Array.isArray(value))return null;const v=value as any;if(Object.keys(v).some(k=>!['company','book'].includes(k)))return null;for(const ref of Object.values(v) as any[])if(!ref||typeof ref!=='object'||Object.keys(ref).sort().join()!=='id,version'||!GUIDELINE_ID.test(ref.id)||!Number.isSafeInteger(ref.version)||ref.version<1||ref.version>1000000)return null;return structuredClone(v)}
export function parseGuidelineFiles(value:unknown):GuidelineFileFact[]|null{if(value===undefined)return [];if(!Array.isArray(value)||value.length>3)return null;for(const f of value)if(!f||Object.keys(f).sort().join()!=='format,name,size'||typeof f.name!=='string'||!f.name||f.name.length>255||!f.name.isWellFormed()||/[\x00-\x1f\x7f\\/]/.test(f.name)||guidelineFormat(f.name)!==f.format||!Number.isSafeInteger(f.size)||f.size<1||f.size>GUIDELINE_FILE_MAX)return null;return structuredClone(value)}

export const DEFAULT_PUBLISHER_PROFILE_VERSION="2026.10.30.1"
