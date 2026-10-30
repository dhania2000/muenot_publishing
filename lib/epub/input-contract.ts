/** Source normalization describes observed content; it never certifies output or grants release. */
export const INPUT_MODEL_VERSION='2026.10.30.1'
export const INPUT_NODE_KINDS=['text','section','heading','paragraph','list','list_item','table','row','cell','image','math','note','link','audio','video','cue','unknown'] as const
export type InputNodeKind=typeof INPUT_NODE_KINDS[number]
export type InputReference={locator:string;part?:string;page?:number;sheet?:string;cell?:string;box?:{x0:number;y0:number;x1:number;y1:number}}
/** Containers retain ordered children; text is a searchable aggregate, never render both twice. */
export type InputNode={id:string;kind:InputNodeKind;text:string;source:InputReference;attributes:Record<string,string|number|boolean|null>;children:InputNode[]}
export type InputAsset={id:string;path:string;mediaType:string;size:number|null;sha256:string|null;availability:'available'|'missing'|'blocked';source:InputReference;rights:'unverified';properties:Record<string,string|number|boolean|null>}
export type InputFinding={code:string;severity:'error'|'warning'|'info';detail:string;source:InputReference;owner:string;blocking:boolean}
export type NormalizedInput={modelVersion:string;sourceName:string;sourceSha256:string;adapter:string;status:'normalized'|'review_required'|'blocked';nodes:InputNode[];assets:InputAsset[];findings:InputFinding[];metadata:Record<string,string|number|boolean|null>;statistics:{nodes:number;characters:number;assets:number};releaseAuthorized:false}
export type InputOptions={comments:'exclude'|'review';presenterNotes:'exclude'|'review';slides:'fixed'|'reconstruct';ocr:'off'|'eng'|'hin'|'eng_hin';xmlMapping:Record<string,InputNodeKind>;schemas:{sourceName:string;schemaName:string}[];tables:{sourceName:string;sheet:string;range:string;headerRows:number}[]}
export const DEFAULT_INPUT_OPTIONS:InputOptions={comments:'exclude',presenterNotes:'exclude',slides:'fixed',ocr:'off',xmlMapping:{},schemas:[],tables:[]}
const object=(r:unknown):r is Record<string,any>=>!!r&&typeof r==='object'&&!Array.isArray(r)
const text=(s:unknown,n:number)=>typeof s==='string'&&s.isWellFormed()&&s.length<=n&&!/[\x00-\x1f\x7f]/.test(s)
export function parseInputOptions(raw:unknown):InputOptions|null{
 if(raw===undefined)return structuredClone(DEFAULT_INPUT_OPTIONS)
 if(!object(raw)||Object.keys(raw).some(k=>!['comments','ocr','presenterNotes','schemas','slides','tables','xmlMapping'].includes(k))||!['exclude','review'].includes(raw.comments)||!['exclude','review'].includes(raw.presenterNotes)||!['fixed','reconstruct'].includes(raw.slides)||!['off','eng','hin','eng_hin'].includes(raw.ocr)||!object(raw.xmlMapping)||Object.keys(raw.xmlMapping).length>50||Object.entries(raw.xmlMapping).some(([k,v])=>!/^[A-Za-z][\w:.-]{0,63}$/.test(k)||['constructor','prototype','__proto__'].includes(k)||!INPUT_NODE_KINDS.includes(v as any))||raw.schemas!==undefined&&(!Array.isArray(raw.schemas)||raw.schemas.length>10||new Set(raw.schemas.map((s:any)=>s?.sourceName)).size!==raw.schemas.length||raw.schemas.some((s:any)=>!object(s)||Object.keys(s).sort().join()!=='schemaName,sourceName'||!text(s.sourceName,255)||!s.sourceName||!text(s.schemaName,255)||!s.schemaName||s.sourceName===s.schemaName))||!Array.isArray(raw.tables)||raw.tables.length>20||raw.tables.some((r:any)=>!object(r)||Object.keys(r).sort().join()!=='headerRows,range,sheet,sourceName'||!text(r.sourceName,255)||!text(r.sheet,100)||!text(r.range,40)||!/^\$?[A-Z]{1,3}\$?[1-9]\d{0,5}:\$?[A-Z]{1,3}\$?[1-9]\d{0,5}$/.test(r.range)||!Number.isInteger(r.headerRows)||r.headerRows<0||r.headerRows>5))return null
 return {...structuredClone(raw),schemas:structuredClone(raw.schemas??[])} as InputOptions
}
