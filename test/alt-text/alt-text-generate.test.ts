import { beforeEach, describe, expect, it, vi } from "vitest"
import {createHash} from "node:crypto"
import {terminologyPolicy} from "@/lib/alt-text/terminology-policy"
import { AiError } from "@/lib/ai/governance-core"

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])
const OUTPUT = {
  classification: "scientific_diagram",
  shortAlt: "Labelled diagram of H₂O bonding at 104.5°",
  longDescription: "Two hydrogen atoms bonded to one oxygen atom.",
  extractedText: "H₂O",
  warnings: ["Small labels"],
  treatment: "Informative",
}
const CREDITS = {
  requestId: "alttext:x",
  modelId: "openai/gpt-4o",
  provider: "openai",
  creditsReserved: 12,
  creditsCharged: 7,
  inputTokens: 900,
  outputTokens: 120,
  totalTokens: 1020,
  cachedInputTokens: 0,
  status: "settled",
  needsReconciliation: false,
}

const s = vi.hoisted(() => ({
  asset: null as any,
  claim: 1 as number | null,
  prior: null as any,
  policy: null as any,
  evidence: null as any,
  savedGeneration: null as any,
  documentResolution: {kind:"standalone"} as any,
  saveResult: true as boolean | Error,
  image: null as any,
  calls: { claim: 0, save: [] as any[], failed: [] as any[], open: [] as any[] },
}))

vi.mock("@/lib/ai/assistant-store", () => ({ getTenantAiSettings: vi.fn(async () => ({ enabled: true, allowVision: true })) }))
vi.mock("@/lib/ai/model-catalog", () => ({
  resolveTenantModels: vi.fn(async () => ({ usable: [{ id: "openai/gpt-4o" }], defaultModel: { id: "openai/gpt-4o" }, fallbackModel: null })),
}))
vi.mock("@/lib/alt-text/vision-service", () => ({
  selectVisionModel: vi.fn(({ usable, tenantSettings }: any) => {
    if (!tenantSettings.allowVision) throw new AiError("feature_disabled", "Image analysis is disabled.")
    if (!usable.length) throw new AiError("no_model_available", "No vision model.")
    return { id: usable[0].id, provider: "openai" }
  }),
}))
vi.mock("@/lib/alt-text/preview", () => ({
  openAltTextImage: vi.fn(async (id: number, actor: any) => {
    s.calls.open.push({ id, actor })
    return s.image
  }),
}))
vi.mock("@/lib/alt-text/store", () => ({
  getSettings: vi.fn(async () => ({ defaultLanguage: "en", defaultAudience: "business_document", preferredModelId: null, shortMaxChars: 125, requireReview: true, maxFileMb: 10, maxBatchSize: 20 })),
  getAsset: vi.fn(async () => s.asset),
  getSettingsRecord: vi.fn(async () => s.policy),
  getSavedGeneration: vi.fn(async () => s.savedGeneration),
  claimForGeneration: vi.fn(async () => (s.calls.claim++, s.claim)),
  saveGeneration: vi.fn(async (...args: any[]) => {
    s.calls.save.push(args)
    if (s.saveResult instanceof Error) throw s.saveResult
    if (s.saveResult) Object.assign(s.asset, { status: "in_review", currentVersion: s.asset.currentVersion + 1, ...OUTPUT })
    return s.saveResult
  }),
  markFailed: vi.fn(async (...args: any[]) => void s.calls.failed.push(args)),
}))
vi.mock("@/lib/alt-text/document-generation", () => ({ resolveDocumentPromptContext: vi.fn(async () => s.documentResolution) }))
vi.mock("@/lib/alt-text/description-evidence-source", () => ({ loadDescriptionEvidence: vi.fn(async () => { if (s.evidence instanceof Error) throw s.evidence; return s.evidence }) }))
vi.mock("@/lib/alt-text/credit-service", () => ({
  altTextRequestId: (op?: string | null) => `alttext:${op ?? "random-uuid"}`,
  getAltTextCreditUsage: vi.fn(async () => s.prior),
  runMeteredAltTextGeneration: vi.fn(),
}))

import { generateAltTextForAsset, parseGenerateRequest } from "@/lib/alt-text/generate"
import { getAltTextCreditUsage } from "@/lib/alt-text/credit-service"
import { getTenantAiSettings } from "@/lib/ai/assistant-store"

const actor = { userId: 5, tenantId: 9, role: "employee" as const, viewScope: "added" as const, updateScope: "added" as const }
const settings = parseGenerateRequest({ assetId: 3, requestId: "req-abcdef12", settings: { outputLanguage: "hi", imageType: "scientific_diagram" } })
if (!settings.ok) throw new Error("fixture")
const req = settings.value
const run = vi.fn()

beforeEach(() => {
  s.asset = { id: 3, status: "uploaded", currentVersion: 0, classification: null, shortAlt: null, longDescription: null, extractedText: null, warnings: [], treatment: null, storageKey: "tenants/9/secret", createdBy: 5, reviewerId: null }
  s.claim = 1
  s.prior = null
  s.policy = null
  s.evidence = null
  s.savedGeneration = null
  s.documentResolution = {kind:"standalone"}
  s.saveResult = true
  s.image = { ok: true, body: PNG, contentType: "image/png", size: PNG.length, filename: "x.png" }
  s.calls = { claim: 0, save: [], failed: [], open: [] }
  run.mockReset().mockResolvedValue({ status: "generated", output: OUTPUT, vision: { modelId: "openai/gpt-4o" }, credits: CREDITS })
})

describe("parseGenerateRequest", () => {
  it("rejects unsupported output languages instead of silently translating into a default",()=>{
    expect(parseGenerateRequest({assetId:3,settings:{outputLanguage:"fr"}})).toMatchObject({ok:false,code:"UNSUPPORTED_LANGUAGE"})
  })
  it("cannot accept a client-supplied or cross-tenant glossary as approved guidance",()=>{
    expect(parseGenerateRequest({assetId:3,settings:{outputLanguage:"hi"},guideline:{tenantId:10,approved:true,version:9}})).toMatchObject({ok:false,code:"INVALID_REQUEST"})
  })
  it("normalizes settings and rejects client-supplied storage/tenant/url fields", () => {
    expect(req.settings.outputLanguage).toBe("hi")
    for (const bad of [{ assetId: 3, tenantId: 1 }, { assetId: 3, storageKey: "k" }, { assetId: 3, imageUrl: "http://x" }, { assetId: 3, apiKey: "sk" }]) {
      expect(parseGenerateRequest(bad)).toMatchObject({ ok: false, status: 400 })
    }
    expect(parseGenerateRequest({ assetId: -1 })).toMatchObject({ ok: false, code: "INVALID_ID" })
    expect(parseGenerateRequest({ assetId: 3, requestId: "x" })).toMatchObject({ ok: false, code: "INVALID_REQUEST_ID" })
  })
})

describe("generateAltTextForAsset", () => {
  it("records the effective terminology policy in the existing generation version",async()=>{
    const policy=terminologyPolicy(req.settings)
    ;(OUTPUT as any).terminologyReview={policy,issues:[]}
    const r=await generateAltTextForAsset(req,actor,{run})
    expect(r).toMatchObject({ok:true,body:{result:{generationEvidence:{terminology:{policy:{ruleVersion:"literal-source.v1",outputLanguage:"hi",guideline:null}}}}}})
    expect(s.calls.save[0][1].generationEvidence.terminology.policy).toEqual(policy)
    delete (OUTPUT as any).terminologyReview
  })
  it("rechecks source-document denial before a claim or provider call",async()=>{
    s.documentResolution={kind:"ineligible",code:"NOT_FOUND",error:"Source document not found"}
    expect(await generateAltTextForAsset(req,actor,{run})).toMatchObject({ok:false,status:404})
    expect(run).not.toHaveBeenCalled();expect(s.calls.claim).toBe(0)
  })
  it("refuses context whose occurrence image hash differs from the actual private image bytes",async()=>{
    s.documentResolution={kind:"document",document:{packet:{source:{imageSha256:"wrong"}}}}
    expect(await generateAltTextForAsset(req,actor,{run})).toMatchObject({ok:false,code:"DOCUMENT_SOURCE_CHANGED"})
    expect(run).not.toHaveBeenCalled();expect(s.calls.claim).toBe(0)
  })
  it("links a private document snapshot but returns only safe source references",async()=>{
    const packet={schemaVersion:1,documentId:30,occurrenceId:2,documentType:"pdf",source:{sourceSha256:"a".repeat(64),sourceRevision:"b".repeat(64),sourceLocator:"pdf:p1:o1",imageSha256:createHash("sha256").update(PNG).digest("hex")},contextVersion:1,location:{page:1,slide:null,paragraph:null,part:null,label:null},scripts:["Latin"],policy:{enabled:true,speakerNotes:false,sourceAlt:true},snippets:[{id:"doc:30:occ:2:caption:0",sourceKind:"pdf_struct",sourceRef:"ref:1",duplicateReferences:[],text:"PRIVATE_DOCUMENT_EXCERPT"}],warnings:[],untrustedSource:true}
    s.documentResolution={kind:"document",document:{imageAssetId:3,imageOccurrenceId:2,documentId:30,documentType:"pdf",context:null,contextVersion:1,stale:false,sourceDecorative:false,locationLabel:"Page 1",packet}}
    const r=await generateAltTextForAsset({...req,occurrenceId:2},actor,{run})
    expect(r.ok).toBe(true)
    expect(run.mock.calls[0][0].vision.document.packet).toBe(packet)
    expect(s.calls.save[0][1].documentContextSnapshot).toBe(packet)
    expect(JSON.stringify(r)).not.toContain("PRIVATE_DOCUMENT_EXCERPT")
    expect(JSON.stringify(r)).toContain("doc:30:occ:2:caption:0")
    expect(run.mock.calls[0][0].operationId).toMatch(/^d[a-f0-9]{60}$/)
  })
  it("uses the saved-evidence path only when the tenant opts in and preserves metering ownership", async () => {
    s.policy = { accessibility: { general: { processingPreference: "advanced_when_available",analysisTypes: ["math"] } } }
    s.evidence = { schemaVersion: 1,assetId: 3,occurrenceId: null,sourceSha256: "a".repeat(64),regionAnalysisId: "rga_12345678",classification: "math_equation",strategy: "math",items: [{ id: "math:1",version: 2,kind: "math",regionId: "rgn_12345678",state: "candidate",payload: { latex: "x=1" } }],warnings: [],requiresReview: true,guidelineVersion: null }
    const r = await generateAltTextForAsset(req,actor,{ run })
    expect(r.ok).toBe(true)
    expect(run).toHaveBeenCalledOnce()
    expect(run.mock.calls[0][0].vision.advancedEvidence).toBe(s.evidence)
    expect(s.calls.save[0][1].generationEvidence).toMatchObject({ strategy: "math",outputLanguage: "hi",reviewStatus: "needs_review",evidence: [{ id: "math:1",version: 2 }] })
  })
  it("stops before a processing claim or charge when saved evidence cannot be checked", async () => {
    s.policy = { accessibility: { general: { processingPreference: "both",analysisTypes: ["math"] } } }; s.evidence = new Error("DB unavailable")
    expect(await generateAltTextForAsset(req,actor,{ run })).toMatchObject({ ok: false,code: "EVIDENCE_UNAVAILABLE" })
    expect(run).not.toHaveBeenCalled(); expect(s.calls.claim).toBe(0)
  })
  it("replays an exact candidate while keeping the approved active version", async () => {
    s.asset.status = "approved"; s.asset.currentVersion = 3; s.asset.shortAlt = "Approved original"; s.prior = CREDITS
    s.savedGeneration = { version: 7,candidate: true,result: { ...OUTPUT,shortAlt: "New candidate" } }
    expect(await generateAltTextForAsset(req,actor,{ run })).toMatchObject({ ok: true,body: { version: 7,activeVersion: 3,candidate: true,replayed: true,result: { shortAlt: "New candidate" } } })
    expect(run).not.toHaveBeenCalled(); expect(s.asset.shortAlt).toBe("Approved original")
  })
  it("generates from real bytes, saves a version and returns metered usage", async () => {
    const r = await generateAltTextForAsset(req, actor, { run })
    expect(run).toHaveBeenCalledOnce()
    const input = run.mock.calls[0][0]
    expect(input).toMatchObject({ tenantId: 9, userId: 5, operationId: "a3_req-abcdef12" })
    expect(input.vision.image).toEqual({ bytes: PNG, mediaType: "image/png" })
    expect(input.vision.generation.outputLanguage).toBe("hi")
    expect(s.calls.save[0]).toEqual([3, OUTPUT, "openai/gpt-4o", 7, 5, true, 1])
    expect(r).toMatchObject({ ok: true, body: { success: true, status: "in_review", version: 1, replayed: false, result: { shortAlt: OUTPUT.shortAlt, extractedText: "H₂O" }, usage: { model: "openai/gpt-4o", creditsCharged: 7, requestId: "req-abcdef12" } } })
    expect(JSON.stringify(r)).not.toMatch(/tenants\/9|secret|storageKey|bytes/)
    expect(s.calls.failed).toEqual([])
  })

  it("passes server tenant/user + view scope to the scoped image loader and stops on denial", async () => {
    s.image = { ok: false, status: 404, code: "NOT_FOUND", error: "Image not found." }
    const r = await generateAltTextForAsset(req, actor, { run })
    expect(s.calls.open[0]).toEqual({ id: 3, actor: { userId: 5, tenantId: 9, scope: "added" } })
    expect(r).toMatchObject({ ok: false, status: 404 })
    expect(run).not.toHaveBeenCalled()
    expect(s.calls.claim).toBe(0)
  })

  it("refuses to overwrite a visible asset outside the caller's update scope (no claim, no charge)", async () => {
    s.asset.createdBy = 77
    const viewAll = { ...actor, viewScope: "all" as const, updateScope: "added" as const }
    expect(await generateAltTextForAsset(req, viewAll, { run })).toMatchObject({ ok: false, status: 403, code: "FORBIDDEN" })
    expect(run).not.toHaveBeenCalled()
    expect(s.calls.claim).toBe(0)
    expect(await generateAltTextForAsset(req, { ...viewAll, updateScope: "all" }, { run })).toMatchObject({ ok: true })
  })

  it("treats an asset missing from the tenant-scoped store as not found", async () => {
    s.asset = null
    expect(await generateAltTextForAsset(req, actor, { run })).toMatchObject({ ok: false, status: 404 })
    expect(run).not.toHaveBeenCalled()
  })

  it("rejects pending-scan images before any claim or charge", async () => {
    s.image = { ok: false, status: 409, code: "SCAN_PENDING", error: "Awaiting scan." }
    expect(await generateAltTextForAsset(req, actor, { run })).toMatchObject({ ok: false, code: "SCAN_PENDING" })
    expect(run).not.toHaveBeenCalled()
  })

  it("rejects when AI governance disables vision", async () => {
    vi.mocked(getTenantAiSettings).mockResolvedValueOnce({ enabled: true, allowVision: false } as any)
    expect(await generateAltTextForAsset(req, actor, { run })).toMatchObject({ ok: false, code: "FEATURE_DISABLED" })
    expect(s.calls.open).toEqual([])
  })

  it("maps insufficient credits and releases the claim", async () => {
    run.mockRejectedValueOnce(new AiError("tenant_budget_exceeded", "Not enough AI credits.", { creditCode: "insufficient_credits" }))
    const r = await generateAltTextForAsset(req, actor, { run })
    expect(r).toMatchObject({ ok: false, status: 402, code: "INSUFFICIENT_CREDITS" })
    expect(s.calls.failed[0]).toEqual([3, "Not enough AI credits.", 1, "INSUFFICIENT_CREDITS"])
  })

  it("provider failure / invalid output marks the attempt failed (previous result kept by markFailed)", async () => {
    run.mockRejectedValueOnce(new AiError("provider_error", "Timed out.", { reason: "timeout" }))
    expect(await generateAltTextForAsset(req, actor, { run })).toMatchObject({ ok: false, status: 502, code: "PROVIDER_TIMEOUT" })
    run.mockRejectedValueOnce(new AiError("provider_error", "Invalid response.", { reason: "invalid_output" }))
    expect(await generateAltTextForAsset(req, actor, { run })).toMatchObject({ code: "INVALID_AI_RESPONSE" })
    run.mockRejectedValueOnce(new Error("db password=hunter2"))
    const r = await generateAltTextForAsset(req, actor, { run })
    expect(r).toMatchObject({ status: 500, code: "GENERATION_FAILED" })
    expect(JSON.stringify(r)).not.toContain("hunter2")
    expect(s.calls.failed).toHaveLength(3)
    expect(s.calls.save).toEqual([])
  })

  it("replays a settled duplicate requestId without claiming or charging again", async () => {
    s.prior = CREDITS
    Object.assign(s.asset, { status: "in_review", currentVersion: 2, ...OUTPUT })
    const r = await generateAltTextForAsset(req, actor, { run })
    expect(vi.mocked(getAltTextCreditUsage)).toHaveBeenCalledWith(9, 5, "alttext:a3_req-abcdef12")
    expect(r).toMatchObject({ ok: true, body: { replayed: true, usage: { creditsCharged: 7 } } })
    expect(run).not.toHaveBeenCalled()
    expect(s.calls.claim).toBe(0)
  })

  it("refuses an in-flight duplicate and a concurrent claim", async () => {
    s.prior = { ...CREDITS, creditsCharged: null, status: "reserved" }
    expect(await generateAltTextForAsset(req, actor, { run })).toMatchObject({ status: 409, code: "GENERATION_IN_PROGRESS" })
    s.prior = null
    s.claim = null
    expect(await generateAltTextForAsset(req, actor, { run })).toMatchObject({ status: 409, code: "GENERATION_CONFLICT" })
    expect(run).not.toHaveBeenCalled()
  })

  it("save failure after provider usage keeps the charge, unlocks the asset and reports usage", async () => {
    s.saveResult = new Error("deadlock")
    const r = await generateAltTextForAsset(req, actor, { run })
    expect(r).toMatchObject({ ok: false, status: 500, code: "SAVE_FAILED", details: { usage: { creditsCharged: 7 } } })
    expect(s.calls.failed[0]).toEqual([3, "The generated alt text could not be saved.", 1, "SAVE_FAILED"])
  })

  it("a superseded attempt never overwrites newer edits", async () => {
    s.saveResult = false
    expect(await generateAltTextForAsset(req, actor, { run })).toMatchObject({ status: 409, code: "GENERATION_SUPERSEDED" })
    expect(s.calls.failed).toEqual([])
  })

  it("rejects oversized streamed images before claiming", async () => {
    const big = new Uint8Array(6 * 1024 * 1024)
    s.image = { ...s.image, body: new ReadableStream({ start: (c) => (c.enqueue(big), c.enqueue(big), c.close()) }) }
    expect(await generateAltTextForAsset(req, actor, { run })).toMatchObject({ status: 413 })
    expect(s.calls.claim).toBe(0)
  })
})
