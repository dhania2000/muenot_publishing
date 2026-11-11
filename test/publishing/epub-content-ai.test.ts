import {it,expect,vi,beforeEach,afterEach} from 'vitest'
const d=vi.hoisted(()=>({policy:{enabled:true,features:{content:true},allowFileAnalysis:true,allowSensitiveData:true,blockedModels:[],allowedFamilies:null,employeeModels:null,maxModelTier:'advanced'},model:{id:'fixture/model',provider:'fixture',family:'fixture',inputPricePerMTok:1,outputPricePerMTok:2,maxOutputTokens:1000,supportsReasoning:false},generate:vi.fn(),begin:vi.fn(),finish:vi.fn(),abort:vi.fn(),gateway:true,outbound:vi.fn()}))
vi.mock('ai',()=>({generateText:d.generate}))
vi.mock('@/lib/ai/assistant-store',()=>({getTenantAiSettings:async()=>d.policy}))
vi.mock('@/lib/ai/model-catalog',()=>({resolveTenantModels:async()=>({defaultModel:d.model})}))
vi.mock('@/lib/ai/provider',()=>({gatewayAuthAvailable:()=>d.gateway,resolveLanguageModel:async(id:string)=>id}))
vi.mock('@/lib/ai/credits/credits-service',()=>({beginMeteredRequest:d.begin,finishMeteredRequest:d.finish,abortMeteredRequest:d.abort}))
vi.mock('@/lib/demo/outbound-guard',()=>({assertOutboundAllowed:d.outbound}))
import {parseContentHints,suggestContentStructure} from '@/lib/epub/content-ai'
const sources=[{sourceName:'book.txt',nodeId:'n_111111111111111111111111',text:'Chapter 1. Contact someone@example.com for details.'}],raw=(overrides:any={})=>JSON.stringify([{sourceName:sources[0].sourceName,nodeId:sources[0].nodeId,classification:'heading',confidence:.6,quote:'Chapter 1.',...overrides}]),request=()=>({tenantId:9,userId:5,role:'employee' as const,requestKey:'22222222-2222-4222-8222-222222222222',sources,consent:true,signal:new AbortController().signal})
beforeEach(()=>{vi.stubEnv('EPUB_PREFLIGHT_AI_ENABLED','true');vi.stubEnv('EPUB_PREFLIGHT_AI_PRIVACY_APPROVED','true');d.policy.enabled=true;d.policy.allowSensitiveData=true;d.policy.blockedModels=[];d.policy.allowedFamilies=null;d.policy.employeeModels=null;d.gateway=true;d.generate.mockReset().mockResolvedValue({text:raw(),usage:{inputTokens:100,outputTokens:50}});d.begin.mockReset().mockResolvedValue({requestId:'reservation'});d.finish.mockReset().mockResolvedValue({credits:.1});d.abort.mockReset().mockResolvedValue(undefined);d.outbound.mockReset().mockResolvedValue(undefined)})
afterEach(()=>vi.unstubAllEnvs())
it('does not transmit or reserve credits without explicit consent, deployment/privacy approval and source-data policy',async()=>{
 for(const mode of ['consent','enabled','privacy','policy','gateway']){const input=request();if(mode==='consent')input.consent=false;if(mode==='enabled')vi.stubEnv('EPUB_PREFLIGHT_AI_ENABLED','false');if(mode==='privacy')vi.stubEnv('EPUB_PREFLIGHT_AI_PRIVACY_APPROVED','false');if(mode==='policy')d.policy.allowSensitiveData=false;if(mode==='gateway')d.gateway=false;await expect(suggestContentStructure(input)).rejects.toThrow('CONSENT_OR_POLICY');vi.stubEnv('EPUB_PREFLIGHT_AI_ENABLED','true');vi.stubEnv('EPUB_PREFLIGHT_AI_PRIVACY_APPROVED','true');d.policy.allowSensitiveData=true;d.gateway=true}expect(d.generate).not.toHaveBeenCalled();expect(d.begin).not.toHaveBeenCalled()
})
it('meters a scoped actual provider invocation, removes obvious contact strings, records versions and never modifies input',async()=>{
 const before=JSON.stringify(sources),result=await suggestContentStructure(request());expect(result).toMatchObject({sourceOverwritten:false,authoritative:false,releaseAuthorized:false,hints:[{classification:'heading',confidence:.6,humanApprovalRequired:true}]});expect(JSON.stringify(sources)).toBe(before);expect(d.generate.mock.calls[0][0]).toMatchObject({maxRetries:0,maxOutputTokens:1000,timeout:30000});expect(d.generate.mock.calls[0][0].prompt).not.toContain('someone@example.com');expect(d.finish).toHaveBeenCalledOnce();expect(d.abort).not.toHaveBeenCalled();expect(JSON.stringify(d.finish.mock.calls)).not.toContain('Chapter 1.')
})
it('rejects fabricated quotes, unknown nodes, instructions, malformed or oversized model output',()=>{
 for(const response of ['not json',raw({quote:'Fabricated content'}),raw({nodeId:'foreign'}),raw({verified:true}),raw({classification:'execute'}),raw({confidence:1.1}),' '.repeat(12001)])expect(()=>parseContentHints(response,sources)).toThrow()
})
it('keeps low confidence suggestions unverified and rejects excessive source scope',async()=>{
 d.generate.mockResolvedValue({text:raw({confidence:.05}),usage:{inputTokens:10,outputTokens:10}});expect((await suggestContentStructure(request())).hints[0]).toMatchObject({confidence:.05,humanApprovalRequired:true});await expect(suggestContentStructure({...request(),sources:Array.from({length:6},()=>sources[0])})).rejects.toThrow('SCOPE_LIMIT')
})
it('fails closed on blocked models and provider exceptions, releasing an uncompleted reservation',async()=>{
 d.policy.blockedModels=[d.model.id] as any;await expect(suggestContentStructure(request())).rejects.toThrow('MODEL_UNAVAILABLE');expect(d.begin).not.toHaveBeenCalled();d.policy.blockedModels=[];d.generate.mockRejectedValue(Error('provider unavailable'));await expect(suggestContentStructure(request())).rejects.toThrow('provider unavailable');expect(d.abort).toHaveBeenCalledOnce();expect(d.finish).not.toHaveBeenCalled()
})
it('charges actual completed generation even when the returned suggestion fails grounding; no fallback runs',async()=>{
 d.generate.mockResolvedValue({text:raw({quote:'Imagined quotation'}),usage:{inputTokens:50,outputTokens:30}});await expect(suggestContentStructure(request())).rejects.toThrow('SOURCE_GROUNDED');expect(d.finish).toHaveBeenCalledOnce();expect(d.generate).toHaveBeenCalledOnce();expect(d.abort).not.toHaveBeenCalled()
})
