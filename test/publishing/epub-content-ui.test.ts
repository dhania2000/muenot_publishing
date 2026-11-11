import {it,expect,vi,beforeEach,afterEach} from 'vitest'
import * as React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {analyzeContentPreflight} from '@/lib/epub/content-preflight'
import {InputBuilder} from '@/lib/epub/input-common'
const d=vi.hoisted(()=>({state:null as any,error:null as any}))
vi.mock('swr',()=>({default:()=>({data:d.state,error:d.error,mutate:async()=>{}})}))
import {EpubContentPreflight} from '@/components/publishing/conversion/epub/epub-content-preflight'
beforeEach(()=>{vi.stubGlobal('React',React);const b=new InputBuilder('book.txt',Buffer.from('fixture'),'txt');b.result.nodes=[b.node('paragraph','<script>untrusted source</script>',b.ref('line:1'))];const doc=b.finish();d.state={version:0,revision:1,sha256:'f'.repeat(64),analysis:analyzeContentPreflight([doc]),decisions:[],assignment:{name:'Expert A'},history:[],canCorrect:true,aiHints:[],nodes:[{...doc.nodes[0],sourceName:doc.sourceName,label:doc.nodes[0].text,children:[]}]};d.error=null})
afterEach(()=>vi.unstubAllGlobals())
const render=()=>renderToStaticMarkup(React.createElement(EpubContentPreflight,{project:{id:'11111111-1111-4111-8111-111111111111',revision:1},requestId:'22222222-2222-4222-8222-222222222222',actorScope:'fixture',onDirtyChange:()=>{}}))
it('renders actual review controls with escaped source labels and no automatic AI approval',()=>{const html=render();expect(html).toContain('Save new review version');expect(html).toContain('Expert A');expect(html).toContain('Optional AI structural hint');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');expect(html).toContain('not a production-ready EPUB');expect(html).toContain('?review=')})
it('keeps source correction actions out of the read-only owner view',()=>{d.state.canCorrect=false;const html=render();expect(html).not.toContain('Save new review version');expect(html).not.toContain('Request scoped structural hint');expect(html).toContain('Correction worklist')})
it('does not expose retained source information after an authorization/security refresh fails',()=>{d.error=Error('source access changed');const html=render();expect(html).toContain('Current source analysis is unavailable');expect(html).not.toContain('untrusted source');expect(html).not.toContain('Expert A')})
