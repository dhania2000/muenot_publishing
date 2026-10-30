import type {EpubDraft} from "./intake-plan"
export const READER_PLATFORMS=["general","apple-books","thorium","kobo"] as const
export const ASSISTIVE_TECH=["nvda","jaws","voiceover","talkback","refreshable-braille"] as const
export const SCRIPT_REQUIREMENTS=["Latn","Deva","Arab","Cyrl","Hans","Hant","Hebr","Beng","Taml"] as const
export type EpubReaderRequirements={wcagTarget:"2.1-AA"|"2.2-AA";additionalLanguages:string[];scripts:string[];readers:string[];assistiveTech:string[];media:"text-only"|"audio"|"video"|"synchronized";notes:string}
export const DEFAULT_READER_REQUIREMENTS:EpubReaderRequirements={wcagTarget:"2.2-AA",additionalLanguages:[],scripts:[],readers:["general"],assistiveTech:[],media:"text-only",notes:""}
export function parseReaderRequirements(raw:unknown):EpubReaderRequirements|null{
 if(raw===undefined)return structuredClone(DEFAULT_READER_REQUIREMENTS)
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return null
 const r=raw as any;if(Object.keys(r).sort().join()!=="additionalLanguages,assistiveTech,media,notes,readers,scripts,wcagTarget"||!["2.1-AA","2.2-AA"].includes(r.wcagTarget)||!["text-only","audio","video","synchronized"].includes(r.media)||typeof r.notes!=="string"||r.notes.length>1000||!r.notes.isWellFormed()||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(r.notes))return null
 for(const [key,allowed,max] of [["additionalLanguages",null,8],["scripts",SCRIPT_REQUIREMENTS,9],["readers",READER_PLATFORMS,4],["assistiveTech",ASSISTIVE_TECH,5]] as const){const a=r[key];if(!Array.isArray(a)||a.length>max||new Set(a).size!==a.length||a.some(v=>typeof v!=="string"||(allowed?!allowed.includes(v as never):!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(v)||v.length>35)))return null}
 if(!r.readers.length)return null
 return {wcagTarget:r.wcagTarget,additionalLanguages:[...r.additionalLanguages].sort(),scripts:[...r.scripts].sort(),readers:[...r.readers].sort(),assistiveTech:[...r.assistiveTech].sort(),media:r.media,notes:r.notes}
}
export type EpubQaRequirement={id:string;stage:"preflight"|"qa"|"delivery";method:"automated"|"manual";severity:"error"|"warning";detail:string;status:"not_run"}
export function epubValidationPlan(plan:EpubDraft):EpubQaRequirement[]{
 const r=parseReaderRequirements(plan.requirements),m=plan.configuration?.metadata
 if(!r)throw Error("Invalid reader requirements")
 const rules:EpubQaRequirement[]=[];const add=(id:string,stage:EpubQaRequirement["stage"],method:EpubQaRequirement["method"],detail:string,severity:EpubQaRequirement["severity"]="error")=>rules.push({id,stage,method,severity,detail,status:"not_run"})
 add("EPUBCHECK","qa","automated",`Pinned validator must support the requested ${plan.selection.version} profile.`)
 add("ACCESSIBILITY-AUTOMATION","qa","automated",`Run available accessibility checks for EPUB accessibility ${plan.configuration?.accessibility.target??"1.1"}; record unsupported checks.`)
 add("MANUAL-WCAG","qa","manual",`Human assessment for WCAG ${r.wcagTarget}; automated reports do not establish conformance.`)
 add("LANGUAGE-METADATA","preflight","automated",`Primary ${m?.language??"en"}; additional ${r.additionalLanguages.join(", ")||"none requested"}. Check content and package language attributes.`)
 add("SOURCE-SECURITY","preflight","automated","Every source must have an actual clean scan; receipt/signature checks do not satisfy this rule.")
 add("IMPORTED-SCRIPT-POLICY","preflight","automated","Do not execute imported scripts, external entities or remote resource fetches.")
 for(const reader of new Set([...r.readers,plan.configuration?.compatibility.reader??"general"]))add(`READER-${reader}`,"delivery","manual",`Test reading order, navigation and selected layout in ${reader}.`)
 for(const tech of r.assistiveTech)add(`AT-${tech}`,"qa","manual",`Verify reading/navigation announcements with ${tech}; record device and version.`)
 for(const script of r.scripts)add(`SCRIPT-${script}`,"qa","manual",`Verify ${script} shaping, direction, fallback fonts and spoken content.`)
 if(plan.configuration?.accessibility.requireDescriptions)add("IMAGE-ALTERNATIVES","qa","manual","Review descriptions and decorative classification against source meaning.")
 if(r.media!=="text-only"||plan.configuration?.media.audio||plan.configuration?.media.video)add("MEDIA-ALTERNATIVES","qa","manual",`Verify ${r.media} transcripts/captions, fallback content, codec/reader support and rights.`)
 if(plan.selection.layout!=="reflowable")add("LAYOUT-ACCESSIBILITY","qa","manual",`Review ${plan.selection.layout} zoom, text alternatives and logical reading order.`)
 return rules
}
