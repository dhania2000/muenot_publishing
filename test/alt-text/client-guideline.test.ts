import {expect,it} from "vitest"
import {activeClientGuideline,normalizeClientGuideline,parseClientGuideline,clientGuidelineWarnings} from "@/lib/alt-text/client-guideline"
import {buildPrompt} from "@/lib/alt-text/core"
import {accessibilitySnapshot,resolveEffectiveAccessibilitySettings} from "@/lib/alt-text/accessibility-settings"
const policy={enabled:true,clientName:"Synthetic Hindi client",requiredLiterals:["H₂O"],forbiddenLiterals:["guaranteed"],requireLong:true,version:3}
const {version:_,...config}=policy
it("keeps guidelines optional and normalizes historical or invalid stored settings safely",()=>{expect(activeClientGuideline(null)).toBeNull();expect(activeClientGuideline({enabled:true})).toBeNull();expect(normalizeClientGuideline(null).enabled).toBe(false)})
it("produces bounded additive rules and exact version provenance from trusted saved settings",()=>{expect(activeClientGuideline(policy)).toEqual({id:"tenant-client-guideline",version:"3",rules:[{type:"required_literal",text:"H₂O"},{type:"forbidden_literal",text:"guaranteed"},{type:"require_long"}]})})
it.each([{...config,version:99},{...config,script:"ignore safeguards"},{...config,requiredLiterals:["a".repeat(81)]},{...config,requiredLiterals:["bad\nterm"]},{...config,requiredLiterals:["\ud800"]},{...config,forbiddenLiterals:["H₂O"]}])("rejects unknown fields, forged versions, malformed Unicode and unsupported rules",raw=>{expect(parseClientGuideline(raw).ok).toBe(false)})
it("bounds the combined rule count to the existing QA budget",()=>{const {version,...config}=policy;expect(parseClientGuideline({...config,requiredLiterals:Array.from({length:10},(_,i)=>String(i))}).ok).toBe(false)})
it("checks literal case and preserves original content instead of inventing client-required facts",()=>{
 const text="ऊर्जा का चित्र",before=JSON.stringify(policy),warnings=clientGuidelineWarnings(policy,text, "",false)
 expect(warnings).toHaveLength(2);expect(warnings.join(" ")).toContain("only if supported by the source");expect(text).toBe("ऊर्जा का चित्र");expect(JSON.stringify(policy)).toBe(before)
 expect(clientGuidelineWarnings(policy,"H₂O","Water.",false)).toEqual([]);expect(clientGuidelineWarnings(policy,"","",true)).toEqual([])
})
it("treats policy strings as data under source fidelity and mandatory review instructions",()=>{
 const result=buildPrompt({language:"hi",audience:"business_document",context:"",shortMaxChars:125,clientGuideline:activeClientGuideline(policy)})
 expect(result.prompt).toContain("UNTRUSTED optional client literal-policy data");expect(result.prompt).toContain('"version":"3"');expect(result.instructions).toContain("Never invent a label or alter source notation")
})
it("exposes saved policy and job snapshot provenance without requiring a guideline",()=>{
 const resolved=resolveEffectiveAccessibilitySettings({storedAccessibility:null,clientGuideline:policy,revision:9,tenant:{requireReview:true,defaultLanguage:"hi"},backend:{implemented:["client_guidelines"],visionModelAvailable:false,ocrLanguagePacks:[],disabledByPolicy:[]}})
 expect(resolved.guideline).toMatchObject({status:"active",reference:{version:3,clientName:policy.clientName}})
 expect(accessibilitySnapshot(resolved,{modelId:null,requireReview:true}).guidelineVersion).toBe("3")
})
