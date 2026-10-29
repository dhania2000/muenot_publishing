import {expect,it,vi} from "vitest"
vi.mock("@/lib/ai/assistant-store",()=>({getTenantAiSettings:async()=>({})}))
vi.mock("@/lib/ai/model-catalog",()=>({resolveTenantModels:async()=>({usable:[]})}))
vi.mock("@/lib/alt-text/ocr-engine",()=>({checkOcrReadiness:async()=>({status:"unavailable",reason:"Synthetic missing pack"})}))
vi.mock("@/lib/alt-text/math-engine",()=>({checkMathReadiness:async()=>({available:false,reason:"Synthetic missing recognizer"})}))
vi.mock("@/lib/alt-text/vision-service",()=>({isVisionCompatible:()=>false}))
import {IMPLEMENTED_ACCESSIBILITY_ENGINES,detectAccessibilityBackend} from "@/lib/alt-text/accessibility-backend"
import {CAPABILITY_IDS,deriveCapabilityStates,ADVANCED_QA_CHECKS} from "@/lib/alt-text/accessibility-settings"
it("registers real implemented capabilities across all Settings pages without stale planned entries",()=>{expect([...IMPLEMENTED_ACCESSIBILITY_ENGINES].sort()).toEqual([...CAPABILITY_IDS].sort());expect(ADVANCED_QA_CHECKS).toHaveLength(4)})
it("separates implementation from missing model, OCR pack and mathematical runtime configuration",async()=>{const states=deriveCapabilityStates(await detectAccessibilityBackend(5,"employee"));for(const id of CAPABILITY_IDS)expect(states[id].status).not.toBe("not_implemented");expect(states.math_analysis.status).toBe("not_configured");expect(states.ocr.status).toBe("not_configured");expect(states.chart_analysis.status).toBe("not_configured");for(const id of ["advanced_qa","client_guidelines","math_verification","mathml_output"] as const)expect(states[id].status).toBe("available")})
