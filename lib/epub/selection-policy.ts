import type {EpubDraft} from "./intake-plan"
export const COMPATIBILITY_ACKS=["legacy-loss","candidate-34","fixed-reader","mixed-reader","roll-reader","multiple-renditions","enhanced-media"] as const
export function compatibilityCaveats(plan:Pick<EpubDraft,"selection"|"configuration">){
 const s=plan.selection,c=plan.configuration,items:{id:string;text:string}[]=[]
 if(s.version==="2.0.1-legacy")items.push({id:"legacy-loss",text:"Legacy output needs a feature-loss review for navigation, media, mathematics and accessibility metadata before delivery."})
 if(s.version==="3.4-experimental")items.push({id:"candidate-34",text:"EPUB 3.4 is an experimental planning target. The pinned candidate draft and validator/reader support require separate review."})
 if(s.layout!=="reflowable")items.push({id:`${s.layout}-reader`,text:`${s.layout} layout requires reading-order, zoom and target-reader review. Universal reader compatibility is not promised.`})
 if(s.rendition==="multiple")items.push({id:"multiple-renditions",text:"Multiple renditions need explicit reader testing; unsupported readers may require separate editions."})
 if(s.profile==="enhanced"||c?.media.audio||c?.media.video)items.push({id:"enhanced-media",text:"Enhanced media requires codec, fallback, rights and transcript review for the selected reader."})
 return items
}
export function selectionPolicyProblems(plan:Pick<EpubDraft,"selection"|"configuration"|"compatibilityAcknowledgements">,candidatePlanning=false){const problems:string[]=[];if(plan.selection.version==="3.4-experimental"&&!candidatePlanning)problems.push("Experimental EPUB 3.4 planning is not enabled on this installation. Choose EPUB 3.3.");for(const item of compatibilityCaveats(plan))if(!plan.compatibilityAcknowledgements?.includes(item.id))problems.push(`Acknowledge the compatibility caveat: ${item.id}.`);return problems}
