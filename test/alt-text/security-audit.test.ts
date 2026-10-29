import {it,expect,vi} from "vitest"
vi.mock("@/lib/tenant-scope",()=>({currentTenantId:()=>5}))
import {auditAccessibilityDenial} from "@/lib/alt-text/security-audit"
it("records bounded denial metadata without accepting private text, secrets, URLs or filenames",()=>{const warn=vi.spyOn(console,"warn").mockImplementation(()=>{});try{auditAccessibilityDenial(7,"review",11);expect(warn).toHaveBeenCalledWith("[alt-text/security]",{tenantId:5,userId:7,assetId:11,action:"review",code:"ACCESS_DENIED"});expect(Object.keys(warn.mock.calls[0][1] as object).sort()).toEqual(["action","assetId","code","tenantId","userId"])}finally{warn.mockRestore()}})
