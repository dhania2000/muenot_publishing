import type {NormalizedInput,InputNode} from './input-contract'
import {analyzeContentPreflight,inputNodes,type PreflightAnalysis} from './content-preflight'
import type {EpubDraft} from './intake-plan'
export type ContentCorrection={kind:'text'|'heading'|'language'|'order'|'caption'|'reference'|'transcription';sourceName:string;nodeId:string;value:string}
export type ContentReviewAction={action:'correct';correction:ContentCorrection;evidence:string}|{action:'assess';issueId:string;evidence:string}
export type ReviewedContent={documents:NormalizedInput[];analysis:PreflightAnalysis;decisions:{issueId:string;evidence:string;actorId:number}[];aiHints?:{baseSha256:string;model:string;provider:string;promptVersion:string;promptSha256:string;hints:{sourceName:string;nodeId:string;classification:string;confidence:number;humanApprovalRequired:true}[]}[]}
export function parseContentReviewAction(r:any):ContentReviewAction|null{
 const text=(s:any,n:number)=>typeof s==='string'&&s.length<=n&&s.isWellFormed()&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s)
 if(!r||typeof r!=='object'||Array.isArray(r)||!text(r.evidence,1000)||r.evidence.trim().length<20)return null
 if(r.action==='assess'&&Object.keys(r).sort().join()==='action,evidence,issueId'&&text(r.issueId,2000))return r
 const c=r.correction
 if(r.action==='correct'&&Object.keys(r).sort().join()==='action,correction,evidence'&&c&&typeof c==='object'&&!Array.isArray(c)&&Object.keys(c).sort().join()==='kind,nodeId,sourceName,value'&&['text','heading','language','order','caption','reference','transcription'].includes(c.kind)&&text(c.sourceName,255)&&/^n_[a-f0-9]{24}$|^review_n_[a-f0-9]{24}$/.test(c.nodeId)&&text(c.value,16000))return r
 return null
}
/** Corrections are new model versions; source bytes and their original evidence are immutable. */
export function applyContentReview(prior:ReviewedContent,action:ContentReviewAction,actorId:number,policy:unknown,plan?:EpubDraft):ReviewedContent{
 if(!parseContentReviewAction(action))throw Error('INVALID_CONTENT_CORRECTION')
 const documents=structuredClone(prior.documents);let decisions=structuredClone(prior.decisions)
 if(action.action==='correct'){
  const c=action.correction,d=documents.find(d=>d.sourceName===c.sourceName),all=d?(()=>{const visit=(nodes:InputNode[]):InputNode[]=>nodes.filter(n=>!n.attributes.editorialOnly).flatMap(n=>[n,...visit(n.children)]);return visit(d.nodes)})():[],n=all.find(n=>n.id===c.nodeId);if(!n||!d||n.attributes.editorialOnly)throw Error('CONTENT_NODE_UNAVAILABLE')
  const a=n.attributes
  if(c.kind==='text'){if(n.children.length||n.text.length>16000||['image','audio','video'].includes(n.kind)||!c.value.trim())throw Error('CONTENT_LEAF_REQUIRED');a.originalText??=n.text;n.text=c.value;a.humanCorrected=true}
  if(c.kind==='heading'){if(!['heading','paragraph'].includes(n.kind)||!['1','2','3','4','5','6'].includes(c.value))throw Error('CONTENT_HEADING_INVALID');a.originalKind??=n.kind;n.kind='heading';a.reviewLevel=Number(c.value)}
  if(c.kind==='language'){const [language,direction,...extra]=c.value.split('|');if(!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language)||language.length>35||!['ltr','rtl','auto'].includes(direction)||extra.length)throw Error('CONTENT_LANGUAGE_INVALID');a.reviewLanguage=language;a.reviewDirection=direction}
  if(c.kind==='order'){const publication=n.children.filter(c=>!c.attributes.editorialOnly);let ids:unknown;try{ids=JSON.parse(c.value)}catch{throw Error('CONTENT_ORDER_INVALID')}if(n.kind!=='section'||!Array.isArray(ids)||ids.length!==publication.length||ids.length>500||new Set(ids).size!==ids.length||ids.some(id=>!publication.some(c=>c.id===id)))throw Error('CONTENT_ORDER_INVALID');a.originalOrder??=JSON.stringify(n.children.map(c=>c.id));a.reviewOrder=JSON.stringify(ids);n.children=[...(ids as string[]).map(id=>publication.find(c=>c.id===id)!),...n.children.filter(c=>c.attributes.editorialOnly)]}
  if(c.kind==='caption'){if(n.kind!=='image'||c.value!=='none'&&!all.some(cn=>cn.id===c.value&&cn.kind==='paragraph'))throw Error('CONTENT_CAPTION_INVALID');a.reviewCaption=c.value;a.captionReviewed=true}
  if(c.kind==='reference'){if(n.kind!=='link'||!all.some(cn=>cn.id===c.value))throw Error('CONTENT_REFERENCE_INVALID');a.reviewTarget=c.value;delete a.noteId}
  if(c.kind==='transcription'){if(n.kind!=='section'||!n.source.page||!c.value.trim())throw Error('CONTENT_PAGE_REQUIRED');const id='review_'+n.id;const node:InputNode={id,kind:'paragraph',text:c.value,source:{...n.source,locator:n.source.locator+'/manual-transcription'},attributes:{method:'manual_transcription',humanCorrected:true},children:[]};n.children=n.children.filter(c=>c.id!==id);for(const child of n.children)if(['paragraph','heading','text'].includes(child.kind))Object.assign(child.attributes,{editorialOnly:true,exclusionReason:'superseded_by_human_page_transcription'});n.children.push(node);delete a.reviewOrder}
  a.reviewEvidence=action.evidence;a.reviewActor=actorId
  const refresh=(nodes:InputNode[])=>{for(const child of nodes){refresh(child.children);if(child.children.length&&child.text){child.text=child.children.filter(c=>!c.attributes.editorialOnly).map(c=>c.text).join('');if(child.text.length>32000)throw Error('CONTENT_AGGREGATE_LIMIT')}}};refresh(d.nodes)
  const counted=inputNodes(d.nodes);d.statistics={nodes:counted.length,characters:counted.reduce((n,c)=>n+c.text.length,0),assets:d.assets.length}
  // Text/order/mapping changes invalidate earlier sign-offs, rather than reusing stale approvals.
  decisions=[]
 }else{
  const issue=prior.analysis.issues.find(i=>i.id===action.issueId);if(!issue||issue.repair!=='human_correction')throw Error('CONTENT_ISSUE_NOT_OVERRIDABLE')
  decisions=decisions.filter(d=>d.issueId!==action.issueId);decisions.push({issueId:action.issueId,evidence:action.evidence,actorId})
 }
 const analysis=analyzeContentPreflight(documents,policy,plan),unresolved=analysis.issues.filter(i=>i.blocking&&!decisions.some(d=>d.issueId===i.id)).length
 return {documents,analysis:{...analysis,status:unresolved?'blocked':'extracted_for_review'},decisions}
}
