import {beforeEach,it,expect,vi} from 'vitest'
const d=vi.hoisted(()=>({actor:null as any,allowed:true,download:vi.fn(),attach:vi.fn(),state:vi.fn(),assess:vi.fn(),extract:vi.fn()}))
vi.mock('@/lib/auth',()=>({getSession:async()=>d.actor}))
vi.mock('@/lib/rate-limit',()=>({checkRateLimit:async()=>({allowed:d.allowed})}))
vi.mock('@/lib/epub/guideline-documents',()=>({readProjectGuidelineFile:d.download,requestGuidelineExtraction:d.extract}))
vi.mock('@/lib/epub/guideline-attachments',()=>({attachProjectGuidelines:d.attach}))
vi.mock('@/lib/epub/guideline-review-store',()=>({projectGuidelineState:d.state,assessProjectGuidelines:d.assess,guidelineComplianceCsv:()=> 'Synthetic report'}))
import {GET,POST} from '@/app/api/conversion/epub/projects/[projectId]/guidelines/route'
const projectId='11111111-1111-4111-8111-111111111111',documentId='22222222-2222-4222-8222-222222222222',url=`http://local/api/conversion/epub/projects/${projectId}/guidelines`,ctx={params:Promise.resolve({projectId})}
beforeEach(()=>{vi.clearAllMocks();d.actor={tenantId:9,userId:5,role:'client'};d.allowed=true;d.state.mockResolvedValue({revision:2,checklist:[]});d.attach.mockResolvedValue({revision:3});d.download.mockResolvedValue({body:Buffer.from('Private instructions'),name:'Client A.txt',format:'txt'})})
it('rejects absent identity, foreign origin and exhausted request budgets before touching sources',async()=>{
 d.actor=null;expect((await GET(new Request(url+'?download='+documentId),ctx)).status).toBe(401);d.actor={tenantId:9,userId:5,role:'client'}
 expect((await POST(new Request(url,{method:'POST',headers:{origin:'http://foreign'},body:'{}'}),ctx)).status).toBe(403);d.allowed=false
 expect((await GET(new Request(url+'?download='+documentId),ctx)).status).toBe(429);expect(d.download).not.toHaveBeenCalled();expect(d.attach).not.toHaveBeenCalled()
})
it('downloads only through the scoped source helper with private attachment and sandbox headers',async()=>{
 const response=await GET(new Request(url+'?download='+documentId),ctx);expect(response.status).toBe(200);expect(d.download).toHaveBeenCalledWith(projectId,documentId,d.actor)
 expect(response.headers.get('cache-control')).toBe('private, no-store');expect(response.headers.get('content-disposition')).toContain('attachment;');expect(response.headers.get('content-security-policy')).toContain('sandbox');expect(response.headers.get('x-content-type-options')).toBe('nosniff');expect(await response.text()).toBe('Private instructions')
 expect((await GET(new Request(url+'?download='+documentId+'&format=csv'),ctx)).status).toBe(422)
})
it('inspects actual optional attachment bytes and requires rights plus the saved revision',async()=>{
 const form=new FormData();form.set('expectedRevision','2');form.set('rightsConfirmed','true');form.append('guidelines',new File(['Use Client A.'],'Client A.txt',{type:'text/plain'}))
 const response=await POST(new Request(url,{method:'POST',headers:{origin:'http://local'},body:form}),ctx);expect(response.status).toBe(200)
 const args=d.attach.mock.calls[0];expect(args[0]).toBe(projectId);expect(args[1]).toBe(2);expect(args[2][0]).toMatchObject({name:'Client A.txt',format:'txt',size:13});expect(args[2][0].sha256).toMatch(/^[a-f0-9]{64}$/);expect(args[3]).toEqual(d.actor)
 form.set('rightsConfirmed','false');expect((await POST(new Request(url,{method:'POST',headers:{origin:'http://local'},body:form}),ctx)).status).toBe(422);expect(d.attach).toHaveBeenCalledTimes(1)
})
it('rejects unsafe file types and excessive JSON bodies without invoking a review action',async()=>{
 const form=new FormData();form.set('expectedRevision','2');form.set('rightsConfirmed','true');form.append('guidelines',new File(['binary'],'guide.exe'))
 expect((await POST(new Request(url,{method:'POST',headers:{origin:'http://local'},body:form}),ctx)).status).toBe(415)
 expect((await POST(new Request(url,{method:'POST',headers:{origin:'http://local','content-type':'application/json'},body:'x'.repeat(8193)}),ctx)).status).toBe(413);expect(d.assess).not.toHaveBeenCalled();expect(d.attach).not.toHaveBeenCalled()
})
