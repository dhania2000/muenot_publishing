import {describe,it,expect} from "vitest"
import {normalizeGenerationSettings,buildPrompt,parseAiOutput,toCsv} from "@/lib/alt-text/core"
import {terminologyPolicy,terminologyIssues,verifiedTerminologySources,TERMINOLOGY_RULE_VERSION} from "@/lib/alt-text/terminology-policy"
import type {DescriptionEvidence} from "@/lib/alt-text/description-evidence"
const evidence=(text="9.8 m/s²; H₂O; α²") :DescriptionEvidence=>({schemaVersion:1,assetId:1,occurrenceId:null,sourceSha256:"a".repeat(64),regionAnalysisId:null,classification:"scientific_diagram",strategy:"scientific",items:[{id:"image:1",version:1,kind:"ocr",regionId:null,state:"raw",payload:{text,recognitionLanguageMode:"hin"}},{id:"review:2",version:2,kind:"ocr_review",regionId:null,state:"transcription_verified",payload:{sourceRef:"image:1",correctedText:text,reviewState:"verified"}}],warnings:[],requiresReview:true,guidelineVersion:null})
describe("literal scientific terminology policy",()=>{
 it("separates Hindi OCR from English output without claiming a known source language",()=>{
  const p=terminologyPolicy(normalizeGenerationSettings({outputLanguage:"en",subject:"physics"}),evidence())
  expect(p).toMatchObject({outputLanguage:"en",sourceLanguage:"unknown",ocrLanguageModes:["hin"],documentContextLanguage:"unknown",reviewerEditedLanguage:"not_assessed",glossary:"unavailable",guideline:null,ruleVersion:TERMINOLOGY_RULE_VERSION,subject:"physics"})
 })
 it.each(["en","hi"])("continues %s generation normally without optional guidelines",language=>{
  const generation=normalizeGenerationSettings({outputLanguage:language}),p=buildPrompt({language:generation.outputLanguage,audience:"business_document",context:"",shortMaxChars:125,generation})
  expect(p.instructions).toContain("No approved glossary or client-guideline service is configured")
  expect(p.instructions).toContain("Never solve an exercise")
  expect(p.instructions).toContain("do not translate or transliterate source labels silently")
 })
 it.each(["क़्षि हिन्दी — H₂O SO₄²⁻ αβγ १२३","x₁² + α = √2; 9.8 m/s²","H₂SO₄ → H⁺ + HSO₄⁻; ΔT = २५ °C"])("preserves mixed notation through generation parsing and UTF-8 JSON: %s",value=>{
  const output=parseAiOutput(JSON.stringify({classification:"scientific_diagram",shortAlt:value,longDescription:value,extractedText:value,warnings:[],treatment:"Review"}),125)
  const roundTrip=JSON.parse(Buffer.from(JSON.stringify(output),"utf8").toString("utf8"))
  expect(roundTrip.shortAlt).toBe(value)
  expect(roundTrip.extractedText).toBe(value)
 })
 it("flags Latin-only requested Hindi prose as a heuristic, without translating it",()=>{
  const value="Yah ek vaigyanik chitra hai jisme prakash dikhaya gaya hai"
  expect(terminologyIssues(value,"hi")).toContainEqual(expect.objectContaining({code:"output_script_mismatch"}))
  expect(value).toContain("Yah ek")
  expect(terminologyIssues("H₂O, α² = β², 9.8 m/s²","hi").some(i=>i.code==="output_script_mismatch")).toBe(false)
 })
 it("flags Hindi-only requested English prose while allowing mixed source labels",()=>{
  expect(terminologyIssues("इस चित्र में प्रकाश की किरणों का पथ दिखाया गया है।","en").some(i=>i.code==="output_script_mismatch")).toBe(true)
  expect(terminologyIssues('The label reads “प्रकाश” and the angle is α.',"en")).toEqual([])
 })
 it("uses only verified current corrections as source constraints",()=>{
  const e=evidence();expect(verifiedTerminologySources(e)).toEqual([{id:"review:2",text:"9.8 m/s²; H₂O; α²"}])
  e.items[1].state="corrected";expect(verifiedTerminologySources(e)).toEqual([])
 })
 it("flags a missing printed unit only when its actual numeric token occurs",()=>{
  expect(terminologyIssues("The value is 9.8.","en",[{id:"review:2",text:"9.8 m/s²"}]).some(i=>i.code==="missing_printed_unit")).toBe(true)
  expect(terminologyIssues("The value is 10.","en",[{id:"r",text:"1 kg"}]).some(i=>i.code==="missing_printed_unit")).toBe(false)
  expect(terminologyIssues("The diagram shows 9.8.","en",[{id:"r",text:"9.8 m"}]).some(i=>i.code==="missing_printed_unit")).toBe(true)
  expect(terminologyIssues("The value is 9.8 m/s².","en",[{id:"r",text:"9.8 m/s²"}])).toEqual([])
 })
 it("flags changed source notation for review rather than declaring a spoken equivalent incorrect",()=>{
  const issues=terminologyIssues("alpha squared equals beta squared","en",[{id:"math-review:1",text:"α² = β²"}])
  expect(issues).toContainEqual(expect.objectContaining({code:"source_notation_changed",sourceId:"math-review:1"}))
  expect(issues[0].message).toContain("valid spoken/linear equivalent")
 })
 it.each([["H₂O","h₂o"],["NaCl","nacl"],["DNA","dna"]])("flags case changes in verified source token %s without replacement",(source,output)=>{
  expect(terminologyIssues(output,"en",[{id:"review:1",text:source}]).some(i=>i.code==="source_term_case_changed")).toBe(true)
  expect(output).not.toBe(source)
 })
 it("detects actual Unicode corruption",()=>{
  expect(terminologyIssues("हिन्दी \ufffd", "hi")[0].code).toBe("unicode_corruption")
  expect(()=>parseAiOutput(JSON.stringify({classification:"chart",shortAlt:"bad \ud800",longDescription:"Details",warnings:[],treatment:"Review"}),125)).toThrow("malformed Unicode")
  expect(()=>parseAiOutput(JSON.stringify({classification:"chart",shortAlt:"Valid",longDescription:"Details",warnings:["bad \ud800"],treatment:"Review"}),125)).toThrow("malformed Unicode")
 })
 it("bounds editor context without splitting Devanagari conjuncts or surrogate pairs",()=>{
  const g=normalizeGenerationSettings({imageContext:"क़्षि 🔬 ".repeat(2000)})
  expect(g.imageContext.isWellFormed()).toBe(true)
  expect(g.imageContext.endsWith("…")).toBe(true)
  expect(g.imageContext.endsWith("\ud83d…")).toBe(false)
 })
 it("preserves Unicode technical text through the existing CSV exporter",()=>{
  const text="क़्षि 🔬 H₂SO₄ α² 9.8 m/s²",csv=toCsv([{shortAlt:text}],{columns:["shortAlt"],bom:true})
  expect(Buffer.from(csv,"utf8").toString("utf8")).toContain(text)
  expect(csv.charCodeAt(0)).toBe(0xfeff)
 })
})
