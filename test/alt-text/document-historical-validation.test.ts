import {expect,it,vi} from "vitest"
const d=vi.hoisted(()=>({versions:vi.fn(),approvals:vi.fn()}))
vi.mock("@/lib/alt-text/document-extraction-run",()=>({}))
vi.mock("@/lib/alt-text/document-service",()=>({}))
vi.mock("@/lib/alt-text/document-store",()=>({}))
vi.mock("@/lib/alt-text/docx-export-service",()=>({}))
vi.mock("@/lib/alt-text/docx-export-store",()=>({}))
vi.mock("@/lib/alt-text/output-validation-store",()=>({loadVersionTexts:d.versions,loadOccurrenceApprovals:d.approvals}))
vi.mock("@/lib/alt-text/store",()=>({}))
import {expectedOccurrences} from "@/lib/alt-text/output-validation-service"
const ctx=(item:object)=>({doc:{id:51},record:{report:{items:[{occurrenceId:101,status:"updated",code:"UPDATED",message:"Inserted",decorative:false,approvedVersionId:901,...item}]}}}) as any
it("validates historical exports against their saved locator and exact asset version even after current mapping moves",async()=>{
 d.approvals.mockResolvedValue(new Map([[101,{sourceLocator:"new-mapping",approvedVersionId:902}]]));d.versions.mockResolvedValue(new Map([[901,{assetId:11,version:3,shortAlt:"H₂O और ऊर्जा"}]]))
 expect(await expectedOccurrences(ctx({sourceLocator:"historical-mapping",assetId:11}))).toMatchObject([{sourceLocator:"historical-mapping",currentSourceLocator:"new-mapping",sourceLocatorSnapshotVerified:true,approvedVersionId:901,approvedVersion:3,approvedText:"H₂O और ऊर्जा",currentApprovedVersionId:902}])
})
it("rejects a version row belonging to another asset without returning its text",async()=>{
 d.approvals.mockResolvedValue(new Map());d.versions.mockResolvedValue(new Map([[901,{assetId:99,version:3,shortAlt:"OTHER IMAGE PRIVATE TEXT"}]]))
 expect(await expectedOccurrences(ctx({sourceLocator:"saved",assetId:11}))).toMatchObject([{sourceLocatorSnapshotVerified:false,versionFound:false,approvedText:null}])
})
it("keeps legacy locator fallback explicit rather than claiming a stored snapshot",async()=>{
 d.approvals.mockResolvedValue(new Map([[101,{sourceLocator:"current-only",approvedVersionId:901}]]));d.versions.mockResolvedValue(new Map([[901,{assetId:11,version:3,shortAlt:"legacy"}]]))
 expect(await expectedOccurrences(ctx({}))).toMatchObject([{sourceLocator:"current-only",sourceLocatorSnapshotVerified:false,approvedText:"legacy"}])
})
