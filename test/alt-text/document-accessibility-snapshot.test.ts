import {beforeEach,expect,it,vi} from "vitest"
const d=vi.hoisted(()=>({query:vi.fn(),tenant:5}))
vi.mock("@/lib/db",()=>({query:d.query}))
vi.mock("@/lib/tenant-scope",()=>({currentTenantId:()=>d.tenant}))
vi.mock("@/lib/alt-text/math-store",()=>({ensureEvidenceSchema:vi.fn()}))
import {captureDocumentAccessibility} from "@/lib/alt-text/document-accessibility-snapshot"
import {approvalSnapshot,planDocxExport,mergeExportReport} from "@/lib/alt-text/docx-export-plan"
import {documentProvenanceChecks} from "@/lib/alt-text/document-export-provenance"
import type {InsertionReadinessRow} from "@/lib/alt-text/document-approval-contract"
const actor={userId:7,role:"employee",viewScope:"all",exportScope:"added"} as const
const row=(n=101):InsertionReadinessRow=>({documentId:51,imageOccurrenceId:n,sourceLocator:`ppt/slides/slide1.xml#pic:${n}:rId1`,approvedVersionId:901,approvedVersion:3,approvedShortAlt:"मानव हृदय का चित्र",approvedLongDescription:"Private detailed science description <math>raw</math>",decorativeApproved:false,reviewerId:7,approvedAt:"2026-10-29",eligible:true,blockingReason:null,blockingMessage:null})
const meta=(n=101)=>({occurrence_id:n,asset_id:11,source_locator:row(n).sourceLocator,created_by:7,reviewer_id:null,current_version:3,approved_id:901,approved_version:3,generation_sha:"a".repeat(64),generation_occurrence:n,generation_refs:[{id:"science:41",kind:"science",version:2,state:"reviewed"}],generation_ref_count:1,qa_id:80,qa_version:2,qa_run:"qa_test123",qa_rule:"advanced-quality.v1",qa_content_version:3,qa_blockers:2,qa_manual:1})
beforeEach(()=>{vi.clearAllMocks();d.query.mockImplementation(async(sql:string)=>sql.includes("FROM alt_text_document_images")?[meta()]:[{id:41,asset_id:11,occurrence_key:101,kind:"scientific_structure",version:2,region_id:"region_1"}])})
it("captures exact approved occurrence metadata and scoped references without copying descriptions",async()=>{
 const [r]=await captureDocumentAccessibility(51,[row()],actor)
 expect(r.accessibility).toMatchObject({documentId:51,occurrenceId:101,assetId:11,approvedVersionId:901,approvedVersion:3,conformance:"not_verified",structuredEvidenceEmbedded:false,generation:{references:[{id:"science:41",regionId:"region_1",recordedState:"reviewed"}]},qa:{blockingFailures:2,matchesApprovedVersion:true,freshness:"not_recomputed"}})
 expect(JSON.stringify(r.accessibility)).not.toContain("Private detailed")
 expect(d.query.mock.calls[0][1]).toEqual([5,51,101])
 expect(d.query.mock.calls[1][1]).toEqual([5,41])
})
it.each(["approved_id","approved_version","current_version","source_locator","created_by"])("fails closed when %s changes under the approved export",async key=>{
 const m={...meta(),[key]:key==="source_locator"?"other":999};d.query.mockResolvedValue([m])
 const [r]=await captureDocumentAccessibility(51,[row()],actor)
 expect(r).toMatchObject({eligible:false,approvedShortAlt:null,approvedVersionId:null,blockingReason:"VALIDATION_FAILED"});expect(r.accessibility).toBeUndefined()
})
it("does not attach generation evidence from another occurrence sharing the same image",async()=>{
 d.query.mockResolvedValue([{...meta(),generation_occurrence:102}]);const [r]=await captureDocumentAccessibility(51,[row()],actor)
 expect(r.accessibility?.generation).toBeNull();expect(r.accessibility?.warnings).toContain("GENERATION_OCCURRENCE_NOT_BOUND")
})
it("never trusts a generation reference's claimed region without an exact scoped evidence match",async()=>{
 d.query.mockImplementation(async(sql:string)=>sql.includes("FROM alt_text_document_images")?[{...meta(),generation_refs:[{id:"science:41",kind:"science",version:2,regionId:"secret_region"}]}]:[{id:41,asset_id:99,occurrence_key:101,kind:"scientific_structure",version:2,region_id:"secret_region"}])
 const [r]=await captureDocumentAccessibility(51,[row()],actor);expect(r.accessibility?.generation?.references[0].regionId).toBeNull()
})
it("bounds reference metadata and records omissions rather than embedding raw scientific content",async()=>{
 d.query.mockImplementation(async(sql:string)=>sql.includes("FROM alt_text_document_images")?[{...meta(),generation_ref_count:40,generation_refs:Array.from({length:40},(_,i)=>({id:`science:${i+1}`,kind:"science",version:1}))}]:[])
 const [r]=await captureDocumentAccessibility(51,[row()],actor);expect(r.accessibility?.generation?.references).toHaveLength(12);expect(r.accessibility?.generation?.omittedReferences).toBe(28)
})
it("keeps missing or different-version QA as truthful warnings without approving or blocking legacy text",async()=>{
 d.query.mockResolvedValue([{...meta(),qa_content_version:2}]);const [r]=await captureDocumentAccessibility(51,[row()],actor)
 expect(r.eligible).toBe(true);expect(r.accessibility?.qa?.matchesApprovedVersion).toBe(false);expect(r.accessibility?.warnings).toContain("NO_QA_FOR_APPROVED_VERSION")
})
it("keeps rejected occurrences out of native instructions and preserves the exact approved Short Alt Text",async()=>{
 const [r]=await captureDocumentAccessibility(51,[row()],actor),plan=planDocxExport([r,{...row(102),eligible:false,blockingReason:"NOT_APPROVED",approvedShortAlt:null}])
 expect(plan.instructions).toEqual([{occurrenceId:101,sourceLocator:r.sourceLocator,text:"मानव हृदय का चित्र",decorative:false}])
 const merged=mergeExportReport(null,plan);expect(merged.items[0]).toMatchObject({occurrenceId:102,sourceLocator:row(102).sourceLocator});expect(merged.items[0].accessibility).toBeUndefined()
 expect(approvalSnapshot([r])).not.toBe(approvalSnapshot([{...r,accessibility:{...r.accessibility!,fingerprint:"changed"}}]))
})
it("distinguishes historical file binding, changed mapping and saved QA from fresh validation",async()=>{
 const [r]=await captureDocumentAccessibility(51,[row()],actor)
 const checks=documentProvenanceChecks([{occurrenceId:101,sourceLocator:r.sourceLocator,currentSourceLocator:"moved",sourceLocatorSnapshotVerified:true,exportStatus:"updated",accessibility:r.accessibility,approvedVersionId:901,location:{}} as any])
 expect(checks.find(c=>c.ruleId==="DOC-SNAPSHOT-BINDING")?.status).toBe("passed")
 expect(checks.find(c=>c.ruleId==="DOC-MAPPING-CHANGED")?.status).toBe("warning")
 expect(checks.find(c=>c.ruleId==="DOC-ADVANCED-QA")).toMatchObject({status:"manual_review",machineCheckable:false})
 expect(documentProvenanceChecks([{occurrenceId:1,exportStatus:"unchanged",location:{}} as any])[0].status).toBe("not_verified")
})
