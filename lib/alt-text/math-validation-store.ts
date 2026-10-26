import "server-only"
import {createHash,randomBytes} from "node:crypto"
import {query,withTransaction} from "@/lib/db"
import {currentTenantId} from "@/lib/tenant-scope"
import {ensureEvidenceSchema} from "./math-store"
import {validateEquation,MATH_RENDERER_VERSION,MATH_PARSER_POLICY} from "./math-validation"
import type {MathEvidenceRecord} from "./math-contract"
import type {MathValidationRecord} from "./math-validation-contract"
const parsed=(value:any)=>typeof value==="string"?JSON.parse(value):value
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex")
function view(row:any):MathValidationRecord{return {id:Number(row.id),version:Number(row.version),result:parsed(row.result_json)}}
export async function readEquationValidations(assetId:number,occurrenceId:number|null):Promise<MathValidationRecord[]>{
 await ensureEvidenceSchema()
 const rows=await query<any[]>(`SELECT id,version,result_json FROM alt_text_accessibility_evidence WHERE tenant_id=? AND asset_id=? AND occurrence_key=? AND kind='math_validation' ORDER BY id DESC LIMIT 120`,[currentTenantId(),assetId,occurrenceId??0])
 return rows.map(view)
}
/** Caller already authorized this exact evidence through the image/occurrence service. The locked
 * source row is checked again to prevent persistence against a removed/replaced recognition. */
export async function saveEquationValidation(assetId:number,occurrenceId:number|null,source:MathEvidenceRecord,actorId:number){
 await ensureEvidenceSchema()
 const candidate=source.result?.candidateLatex
 if(!candidate)throw new Error("NO_MATH_CANDIDATE")
 const result=validateEquation(candidate,source.id),tenantId=currentTenantId(),configKey=hash([source.id,candidate,MATH_RENDERER_VERSION,MATH_PARSER_POLICY])
 return withTransaction(async(conn)=>{
  const [assets]=await conn.query<any[]>("SELECT id FROM alt_text_assets WHERE tenant_id=? AND id=? FOR UPDATE",[tenantId,assetId])
  if(!assets.length)throw new Error("MATH_SOURCE_MISSING")
  const [parents]=await conn.query<any[]>(`SELECT result_json FROM alt_text_accessibility_evidence WHERE tenant_id=? AND asset_id=? AND occurrence_key=? AND id=? AND kind='math_recognition'`,[tenantId,assetId,occurrenceId??0,source.id])
  if(!parents[0]||parsed(parents[0].result_json)?.candidateLatex!==candidate)throw new Error("MATH_SOURCE_CHANGED")
  const [existing]=await conn.query<any[]>(`SELECT * FROM alt_text_accessibility_evidence WHERE tenant_id=? AND asset_id=? AND occurrence_key=? AND kind='math_validation' AND region_id=? AND config_key=? LIMIT 1`,[tenantId,assetId,occurrenceId??0,source.regionId,configKey])
  if(existing[0])return {record:view(existing[0]),replayed:true}
  const [prior]=await conn.query<any[]>(`SELECT version FROM alt_text_accessibility_evidence WHERE tenant_id=? AND asset_id=? AND occurrence_key=? AND kind='math_validation' AND region_id=? ORDER BY version DESC LIMIT 1`,[tenantId,assetId,occurrenceId??0,source.regionId])
  const version=Number(prior[0]?.version??0)+1
  const [inserted]=await conn.query<any>(`INSERT INTO alt_text_accessibility_evidence (tenant_id,asset_id,occurrence_key,region_id,kind,version,analysis_id,request_key,config_key,status,input_json,result_json,created_by) VALUES (?,?,?,?,'math_validation',?,?,?,?,?,?,?,?)`,[tenantId,assetId,occurrenceId??0,source.regionId,version,`mathv_${randomBytes(12).toString("hex")}`,hash(["math_validation",assetId,occurrenceId,configKey]),configKey,result.syntaxStatus,JSON.stringify({sourceEvidenceId:source.id,sourceAnalysisId:source.result!.analysisId,source:source.result!.source}),JSON.stringify(result),actorId])
  return {record:{id:Number(inserted.insertId),version,result},replayed:false}
 })
}
