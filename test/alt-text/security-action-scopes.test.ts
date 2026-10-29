import {it,expect} from "vitest"
import {withinScope} from "@/lib/alt-text/history"
import {exportOwner} from "@/lib/alt-text/batch-export"
import {ownerScopeFor} from "@/lib/alt-text/document-service"
import type {PermissionScope} from "@/lib/permission-model"
const scopes:PermissionScope[]=["all","added","owned","both","none"]
it("intersects view and export permissions for every scope and owner/reviewer combination",()=>{for(const viewScope of scopes)for(const exportScope of scopes)for(const createdBy of [7,8])for(const reviewerId of [7,8,null]){const asset={createdBy,reviewerId},result=exportOwner({userId:7,viewScope,exportScope}),expected=withinScope(viewScope,7,asset)&&withinScope(exportScope,7,asset);const actual=result.ok&&(!result.owner||result.owner.match==="intersection"?result.owner?.match==="intersection"?createdBy===7&&reviewerId===7:true:withinScope(result.owner.match,7,asset));expect(actual,`${viewScope}/${exportScope}/${createdBy}/${reviewerId}`).toBe(expected)}})
it("requires source-document ownership when either view or export is narrower than all",()=>{expect(ownerScopeFor({userId:7,viewScope:"all",exportScope:"added"})).toEqual({uploadedBy:7});expect(ownerScopeFor({userId:7,viewScope:"added",exportScope:"all"})).toEqual({uploadedBy:7});expect(ownerScopeFor({userId:7,viewScope:"all",exportScope:"all"})).toBeNull();expect(ownerScopeFor({userId:7,viewScope:"all"})).toBeNull()})
