import {it,expect,vi,beforeEach,afterEach} from 'vitest'
const d=vi.hoisted(()=>({state:null as any,values:[] as any[],index:0,fetch:vi.fn(),mutate:vi.fn()}))
vi.mock('react',async original=>{const actual=await original<typeof import('react')>();return {...actual,useState:(initial:any)=>{const index=d.index++;return [index<d.values.length?d.values[index]:typeof initial==='function'?initial():initial,vi.fn()]},useId:()=>'fixture-control',useEffect:()=>{}}})
vi.mock('swr',()=>({default:()=>({data:d.state,mutate:d.mutate})}))
import * as React from 'react'
import {EpubContentPreflight} from '@/components/publishing/conversion/epub/epub-content-preflight'
import {InputBuilder} from '@/lib/epub/input-common'
import {analyzeContentPreflight} from '@/lib/epub/content-preflight'
import {parseContentReviewAction,applyContentReview} from '@/lib/epub/content-review'
const build=(name:string)=>{const b=new InputBuilder(name,Buffer.from('identical source bytes'),'txt');b.result.nodes=[b.node('paragraph','Original',b.ref('line:1'))];return b.finish()}
const first=build('client-a.txt'),second=build('client-b.txt'),documents=[first,second],evidence='Compared this exact client source block with the original manuscript.'
beforeEach(()=>{d.index=0;vi.stubGlobal('React',React);d.state={version:0,revision:1,sha256:'f'.repeat(64),analysis:analyzeContentPreflight(documents),decisions:[],assignment:null,history:[],canCorrect:true,aiHints:[],nodes:documents.flatMap(d=>d.nodes.map(n=>({...n,sourceName:d.sourceName,label:n.text,children:[]})))};d.values=[JSON.stringify([second.sourceName,second.nodes[0].id]),'text','Corrected second client source.',evidence,'',{version:0,sha256:d.state.sha256,revision:1},false,null,false,''];d.fetch.mockReset().mockResolvedValue({ok:true,json:async()=>({success:true})});d.mutate.mockReset().mockResolvedValue(undefined);vi.stubGlobal('fetch',d.fetch)})
afterEach(()=>vi.unstubAllGlobals())
function button(tree:any,label:string):any{if(!tree)return null;if(Array.isArray(tree))return tree.map(t=>button(t,label)).find(Boolean);if(typeof tree!=='object')return null;if(tree.props?.children===label)return tree;return button(tree.props?.children,label)}
it('submits the actual source node ID rather than the UI selection token and disambiguates identical source bytes',async()=>{
 expect(first.nodes[0].id).toBe(second.nodes[0].id)
 const tree=EpubContentPreflight({project:{id:'11111111-1111-4111-8111-111111111111',revision:1},requestId:'22222222-2222-4222-8222-222222222222',actorScope:'fixture',onDirtyChange:()=>{}});button(tree,'Save new review version').props.onClick();await vi.waitFor(()=>expect(d.fetch).toHaveBeenCalledOnce());const payload=JSON.parse(d.fetch.mock.calls[0][1].body);expect(payload.change.correction).toMatchObject({sourceName:'client-b.txt',nodeId:second.nodes[0].id});expect(parseContentReviewAction(payload.change)).not.toBeNull();const prior={documents,analysis:analyzeContentPreflight(documents),decisions:[]},review=applyContentReview(prior,payload.change,5,undefined);expect(review.documents[0].nodes[0].text).toBe('Original');expect(review.documents[1].nodes[0].text).toBe('Corrected second client source.')
})
it('preserves the expected base revision/version/hash in a correction request',async()=>{
 d.values[5]={version:0,sha256:'e'.repeat(64),revision:1};d.state.sha256='e'.repeat(64);const tree=EpubContentPreflight({project:{id:'11111111-1111-4111-8111-111111111111',revision:1},requestId:'22222222-2222-4222-8222-222222222222',actorScope:'fixture',onDirtyChange:()=>{}});button(tree,'Save new review version').props.onClick();await vi.waitFor(()=>expect(d.fetch).toHaveBeenCalledOnce());expect(JSON.parse(d.fetch.mock.calls[0][1].body)).toMatchObject({expectedRevision:1,expectedVersion:0,expectedSha256:'e'.repeat(64)})
})
