import {it,expect} from "vitest"
import {readFile} from "node:fs/promises"
import {checkMathReadiness,recognizeMath,MATH_MODEL} from "@/lib/alt-text/math-engine"
it.skipIf(process.env.RUN_LOCAL_MATH_SMOKE!=="1")("runs the pinned CPU worker offline through the actual Node bridge",async()=>{
 expect(await checkMathReadiness()).toEqual({available:true,reason:null})
 const png=await readFile("test/fixtures/math/arithmetic.png"),copy=Buffer.from(png)
 const output=await recognizeMath(png)
 expect(output.modelId).toBe(MATH_MODEL.modelId)
 expect(output.rawOutput).toContain("1+2=3")
 expect(output.confidence).toBeNull()
 expect(output.generation.truncated).toBe(false)
 expect(png).toEqual(copy)
},110_000)
