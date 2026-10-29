import type {ExpectedOccurrence} from "./output-validation"
import type {ValidationCheck} from "./output-validation-contract"
/** These checks concern the recorded export snapshot, never scientific truth or conformance. */
export function documentProvenanceChecks(occurrences:ExpectedOccurrence[]):ValidationCheck[]{
 const checks:ValidationCheck[]=[]
 for(const o of occurrences){
  if(!["updated","unchanged"].includes(o.exportStatus))continue
  const add=(ruleId:string,title:string,status:ValidationCheck["status"],actual:string,machineCheckable:boolean,severity:ValidationCheck["severity"]="medium")=>checks.push({id:`${ruleId}:${o.occurrenceId}`,ruleId,title,status,actual,machineCheckable,severity,category:"manual",description:"Checks immutable occurrence/version provenance and saved evidence metadata. It does not certify accessibility or verify mathematical/scientific meaning.",location:o.location,occurrenceId:o.occurrenceId,expectedVersionId:o.approvedVersionId,recommendation:status==="passed"?null:"Inspect this occurrence's existing image review and saved evidence. Re-export from current approvals when needed."})
  add("DOC-SNAPSHOT-BINDING","Recorded occurrence and version binding",o.sourceLocatorSnapshotVerified?"passed":"not_verified",o.sourceLocatorSnapshotVerified?"Validation uses the source locator and image/version identity recorded with this export.":"Legacy or incomplete metadata lacks a verified occurrence/version snapshot; a current locator is only a fallback.",o.sourceLocatorSnapshotVerified===true)
  if(o.currentSourceLocator!=null&&o.currentSourceLocator!==o.sourceLocator)add("DOC-MAPPING-CHANGED","Source mapping changed after export","warning","The current occurrence locator differs from the recorded export locator. File checks use the historical locator.",true,"high")
  const s=o.accessibility
  if(!s)continue
  if(s.qa?.matchesApprovedVersion&&s.qa.blockingFailures===0)add("DOC-ADVANCED-QA","Saved advanced QA provenance","not_verified",`A QA snapshot for approved content v${s.qa.contentVersion} was recorded. Evidence freshness was not recomputed during export.`,false)
  else add("DOC-ADVANCED-QA","Saved advanced QA provenance",s.qa?.blockingFailures?"manual_review":"not_verified",s.qa?.blockingFailures?`The recorded QA snapshot has ${s.qa.blockingFailures} blockers; inspect current image findings before release.`:"No saved QA snapshot matches this approved version. Native insertion does not establish advanced-content accuracy.",false,s.qa?.blockingFailures?"high":"medium")
  if(s.generation?.references.length||s.warnings.includes("GENERATION_OCCURRENCE_NOT_BOUND"))add("DOC-STRUCTURED-EVIDENCE","Structured evidence retained separately","manual_review","OCR, LaTeX/MathML, graph data and scientific corrections remain in ERP. Only the exact approved Short Alt Text was sent to native picture/Figure metadata.",false)
 }
 return checks
}
