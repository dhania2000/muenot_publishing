import {describe,it,expect} from "vitest"
import {parseOcrReviewInput,parseReviewTarget} from "@/lib/alt-text/ocr-review-contract"
const target={kind:"image_ocr",sourceId:"ocr_123",assetId:1,occurrenceId:2,documentId:null,pageIndex:null}
const base={target,expectedVersion:0,requestId:"request_123",text:"corrected",state:"corrected",comment:"Compared with source"}
describe("grapheme-preserving correction input",()=>{
 for(const text of ["The value is 1.25.","प्रकाश ऊर्जा है।","क्षेत्र में त्रिज्या ३ है।","Hindi मात्रा + English 123",String.raw`\frac{a}{b}`,"e\u0301 👩🏽‍🔬"])
 it(`preserves exact Unicode: ${text}`,()=>expect(parseOcrReviewInput({...base,text})?.text).toBe(text))
 it("rejects broken encoding, excessive text and unverifiable empty text without truncating",()=>{
  for(const extra of [{text:"\ud800"},{text:"a\0b"},{text:"x".repeat(20001)},{state:"verified",text:" "},{expectedVersion:-1},{editorId:99}])expect(parseOcrReviewInput({...base,...extra})).toBeNull()
 })
 it("keeps page and image/occurrence references separate",()=>{
  expect(parseReviewTarget({kind:"page_ocr",sourceId:"hash",documentId:3,pageIndex:0})?.assetId).toBeNull()
  expect(parseReviewTarget({...target,documentId:3})).toBeNull();expect(parseReviewTarget({...target,assetId:0})).toBeNull()
  expect(parseReviewTarget({kind:"page_ocr",sourceId:"hash",documentId:3,pageIndex:500})).toBeNull()
 })
})
