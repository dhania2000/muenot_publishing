import {it,expect} from 'vitest'
import {PDFDocument,StandardFonts} from 'pdf-lib'
import {InputBuilder,inputHash} from '@/lib/epub/input-common'
import {analyzeContentPreflight,DEFAULT_PREFLIGHT_POLICY,parsePreflightPolicy,sourceScripts} from '@/lib/epub/content-preflight'
import {applyContentReview,parseContentReviewAction} from '@/lib/epub/content-review'
import {normalizeEpubInput} from '@/lib/epub/input-normalization'
import {DEFAULT_INPUT_OPTIONS,parseInputOptions} from '@/lib/epub/input-contract'
import {emptyEpubDraft} from '@/lib/epub/intake-plan'
const b=()=>new InputBuilder('book.xml',Buffer.from('fixture'),'xml')
async function normalized(name:string,text:string){const bytes=Buffer.from(text),sha256=inputHash(bytes);return normalizeEpubInput({name,bytes,sha256,checksum:sha256,scanStatus:'clean'},DEFAULT_INPUT_OPTIONS,new AbortController().signal)}
const evidence='Compared this exact source page and retained all original content.'
it('keeps configured checks bounded and rejects unknown/duplicate/unreviewed overrides',()=>{
 expect(parsePreflightPolicy(undefined)).toEqual(DEFAULT_PREFLIGHT_POLICY)
 for(const p of [{...DEFAULT_PREFLIGHT_POLICY,minimumOcrConfidence:.1},{...DEFAULT_PREFLIGHT_POLICY,maximumPages:0},{...DEFAULT_PREFLIGHT_POLICY,bypass:true},{...DEFAULT_PREFLIGHT_POLICY,pageOverrides:[{sourceName:'a.pdf',page:1,route:'native',reason:''}]}])expect(parsePreflightPolicy(p)).toBeNull()
 expect(parseInputOptions({...DEFAULT_INPUT_OPTIONS,preflight:{...DEFAULT_PREFLIGHT_POLICY,minimumOcrConfidence:.9}})?.preflight?.minimumOcrConfidence).toBe(.9)
 expect(parseInputOptions(null)).toBeNull()
})
it('never claims unreadable, unextracted or dependency-only sources production ready',async()=>{
 const d=await normalized('broken.xml','<book><chapter>unfinished'),a=analyzeContentPreflight([d]);expect(a.status).toBe('blocked');expect(a.issues.some(i=>i.repair==='source_replacement')).toBe(true);expect(a.productionReady).toBe(false)
 const css=await normalized('book.css','p { color: black }');expect(analyzeContentPreflight([css]).issues.some(i=>i.code==='EMPTY_EXTRACTION')).toBe(false)
})
it('retains semantic hierarchy, source IDs, front/back matter and detects skipped levels',async()=>{
 const d=await normalized('book.html','<html><body><h1 id="preface">Preface</h1><h3>Deep</h3><h1>References</h1></body></html>'),a=analyzeContentPreflight([d]);expect(a.outline.map(h=>[h.title,h.level,h.matter])).toEqual([['Preface',1,'front'],['Deep',3,'body'],['References',1,'back']]);expect(a.outline[1].parent).toBe(a.outline[0].nodeId);expect(a.issues.some(i=>i.code==='HEADING_LEVEL_GAP')).toBe(true)
})
it('counts leaf content once and excludes complete editorial-only subtrees',()=>{
 const x=b(),child=x.node('text','Secret',x.ref('comment-child')),note=x.node('note','Secret',x.ref('comment'),{editorialOnly:true},[child]),leaf=x.node('text','Public',x.ref('leaf')),p=x.node('paragraph','Public',x.ref('p'),{},[leaf]);x.result.nodes=[note,p];const a=analyzeContentPreflight([x.finish()]);expect(a.sources[0].characters).toBe(6);expect(a.languages.map(l=>l.nodeId)).toEqual([leaf.id])
})
it('preserves complex table spans, declared header rows, list levels and nested callouts',async()=>{
 const d=await normalized('book.html','<html><body><h1>Book</h1><table><tr><th colspan="2" scope="colgroup">Merged header</th></tr><tr><th>Left</th><th>Right</th></tr><tr><td>A</td><td>B</td></tr></table><ul><li>First<ul><li>Nested</li></ul></li></ul><aside><p>Warning</p></aside></body></html>'),a=analyzeContentPreflight([d]),table=a.structures.find(s=>s.kind==='table');expect(table.headers).toHaveLength(3);expect(table.headers[0]).toMatchObject({scope:'colgroup',colspan:'2'});expect(a.structures.filter(s=>s.kind==='list_item')).toHaveLength(2);expect(a.structures.some(s=>s.kind==='note')).toBe(true);expect(a.issues.some(i=>i.code==='TABLE_RELATIONSHIPS_REVIEW')).toBe(true)
})
it('builds internal links, note backlinks and explicit unresolved/duplicate targets',async()=>{
 const d=await normalized('book.html','<html><body><h1 id="intro">Intro</h1><a href="#intro">Return</a><a href="#missing">Unknown</a><aside id="note">Note</aside><a href="#note">Footnote</a><p id="dup">One</p><p id="dup">Two</p></body></html>'),a=analyzeContentPreflight([d]);expect(a.links.filter(l=>l.status==='resolved')).toHaveLength(2);expect(a.links.find(l=>l.rawTarget==='#note').backlink).toBeTruthy();expect(a.issues.some(i=>i.code==='DUPLICATE_TARGET')).toBe(true);expect(a.issues.some(i=>i.code==='REFERENCE_TARGET_UNRESOLVED')).toBe(true)
})
it('resolves same-project cross-source targets while keeping absent files unresolved',async()=>{
 const first=await normalized('one.html','<html><body><a href="two.html#chapter">Continue</a></body></html>'),second=await normalized('two.html','<html><body><h1 id="chapter">Next</h1></body></html>');expect(analyzeContentPreflight([first,second]).links[0].status).toBe('resolved');expect(analyzeContentPreflight([first]).links[0].status).toBe('unresolved')
})
it('records each figure’s asset provenance, candidate caption or open exception',()=>{
 const x=b(),asset=x.asset('figure.png',Buffer.from('identity only'),'image/png',x.ref('asset')),image=x.node('image','',x.ref('figure'),{assetId:asset.id,alt:'Printed chart.'}),caption=x.node('paragraph','Figure 1: Changes',x.ref('caption'),{originalTag:'figcaption'});x.result.nodes=[x.node('section','',x.ref('fig'),{},[image,caption]),x.node('image','',x.ref('orphan'))];const a=analyzeContentPreflight([x.finish()]);expect(a.figures[0]).toMatchObject({caption:caption.id,asset:{sha256:inputHash(Buffer.from('identity only'))}});expect(a.issues.some(i=>i.code==='FIGURE_CAPTION_MISSING')).toBe(true)
})
it('routes original notation/numbered scientific material without substituting bitmap equations',async()=>{
 const d=await normalized('book.tex','\\documentclass{book}\n\\chapter{Science}\n\\begin{equation}E=mc^2 \\label{eq:1}\\end{equation}\nReaction H2 + O2 → H2O; unreadable �'),a=analyzeContentPreflight([d]);expect(a.stem.some(s=>s.notation==='TeX'&&s.sourceCommand?.includes('eq:1'))).toBe(true);expect(a.issues.some(i=>i.code==='GLYPH_CORRUPTION')).toBe(true);expect(a.stem.every(s=>s.sourceRetained&&s.route==='STEM_expert')).toBe(true)
})
it('preserves Hindi/English/RTL codepoints and inherited language/direction without guessing Arabic from script',async()=>{
 const text='English नमस्ते مرحبا، 123!',d=await normalized('book.html',`<html><body><section lang="ar" dir="rtl"><p>${text}</p></section></body></html>`),a=analyzeContentPreflight([d]);expect(a.languages[0]).toMatchObject({direction:'mixed',declaredLanguage:'ar',declaredDirection:'rtl',fontCoverage:'unverified'});expect(a.languages[0].scripts.map((s:any)=>s.script)).toEqual(['Latn','Deva','Arab']);expect(d.nodes[0].children[0].text).toBe(text);expect(sourceScripts('مرحبا').language).toBeNull()
})
it('keeps OCR engine confidence, uncertain handwriting and cell correction as explicit gates',()=>{
 const x=b(),n=x.node('paragraph','नमस्ते hello',x.ref('ocr',{page:1}),{method:'local_ocr',confidence:.65,engine:'tesseract.js',languageMode:'eng_hin'});x.result.nodes=[n];const a=analyzeContentPreflight([x.finish()]);expect(a.issues.find(i=>i.code==='OCR_LOW_CONFIDENCE')).toMatchObject({confidence:.65,owner:'OCR reviewer',blocking:true});expect(a.issues.find(i=>i.code==='OCR_LOW_CONFIDENCE')?.message).toContain('handwriting')
})
it('exposes column, footer and floating image zones with unapproved candidate reading order',()=>{
 const x=b(),run=(text:string,box:any)=>x.node('paragraph',text,x.ref(text,{page:1,box})),l=run('Left',{x0:10,y0:20,x1:40,y1:30}),r=run('Right',{x0:60,y0:20,x1:90,y1:30}),footer=run('1',{x0:45,y0:95,x1:50,y1:99}),figure=x.node('image','',x.ref('floating',{page:1,box:{x0:30,y0:40,x1:70,y1:60}}));x.result.nodes=[x.node('section','',x.ref('page:1',{page:1}),{width:100,height:100},[r,l,figure,footer])];const a=analyzeContentPreflight([x.finish()]),p=a.pages[0];expect(p.sourceOrder[0]).toBe(r.id);expect(p.proposedOrder.indexOf(l.id)).toBeLessThan(p.proposedOrder.indexOf(r.id));expect(p.zones.map((z:any)=>z.kind)).toContain('page_number_candidate');expect(p.zones.map((z:any)=>z.kind)).toContain('figure');expect(p.orderVerified).toBe(false);expect(a.issues.some(i=>i.code==='READING_ORDER_REVIEW')).toBe(true)
})
it('permits only complete source-order permutations and stores corrections without changing the source',()=>{
 const x=b(),one=x.node('paragraph','One',x.ref('one')),two=x.node('paragraph','Two',x.ref('two')),page=x.node('section','',x.ref('page',{page:1}),{},[one,two]);x.result.nodes=[page];const d=x.finish(),prior={documents:[d],analysis:analyzeContentPreflight([d]),decisions:[]},correction={kind:'order' as const,sourceName:d.sourceName,nodeId:page.id,value:JSON.stringify([two.id,one.id])},next=applyContentReview(prior,{action:'correct',correction,evidence},5,undefined);expect(next.documents[0].nodes[0].children[0].id).toBe(two.id);expect(prior.documents[0].nodes[0].children[0].id).toBe(one.id);expect(()=>applyContentReview(prior,{action:'correct',correction:{...correction,value:JSON.stringify([one.id,one.id])},evidence},5,undefined)).toThrow('ORDER_INVALID')
})
it('requires accountable human evidence and cannot waive corrupt or missing dependencies',()=>{
 const x=b();x.finding('RESOURCE_MISSING','Missing actual bytes.',x.ref('asset'),true);const d=x.finish(),prior={documents:[d],analysis:analyzeContentPreflight([d]),decisions:[]};expect(()=>applyContentReview(prior,{action:'assess',issueId:prior.analysis.issues[0].id,evidence},5,undefined)).toThrow('NOT_OVERRIDABLE');expect(parseContentReviewAction({action:'assess',issueId:'x',evidence:'ok'})).toBeNull()
})
it('clears old source signoffs when text changes and retains original text in the reviewed model',async()=>{
 const d=await normalized('book.txt','OCR text.'),prior={documents:[d],analysis:analyzeContentPreflight([d]),decisions:[]},issue=prior.analysis.issues.find(i=>i.repair==='human_correction')!,reviewed=applyContentReview(prior,{action:'assess',issueId:issue.id,evidence},5,undefined),next=applyContentReview(reviewed,{action:'correct',correction:{kind:'text',sourceName:d.sourceName,nodeId:d.nodes[0].id,value:'Corrected text.'},evidence},5,undefined);expect(reviewed.decisions).toHaveLength(1);expect(next.decisions).toHaveLength(0);expect(next.documents[0].nodes[0]).toMatchObject({text:'Corrected text.',attributes:{originalText:'OCR text.',humanCorrected:true}});expect(d.nodes[0].text).toBe('OCR text.')
})
it('reuses compatibility caveats and never auto-approves unsupported experimental/fixed routes',async()=>{
 const d=await normalized('book.txt','Source.'),plan=emptyEpubDraft();plan.selection.version='3.4-experimental';plan.selection.layout='fixed';const a=analyzeContentPreflight([d],undefined,plan);expect(a.route.policyProblems.length).toBeGreaterThan(0);expect(a.route.compatibility.some(c=>c.id==='fixed-reader')).toBe(true);expect(a.route).toMatchObject({autoApproved:false,converterAvailable:false,productionReady:false})
})
it('classifies native PDF pages independently and honors reviewed manual routes without invoking OCR',async()=>{
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);pdf.addPage([300,400]).drawText('Native selectable text.',{font,x:20,y:300});pdf.addPage([300,400]);const bytes=Buffer.from(await pdf.save({useObjectStreams:false})),sha256=inputHash(bytes),options={...DEFAULT_INPUT_OPTIONS,preflight:{...DEFAULT_PREFLIGHT_POLICY,pageOverrides:[{sourceName:'mixed.pdf',page:2,route:'manual',reason:'Reviewed blank page; transcription is required.'}]}};const d=await normalizeEpubInput({name:'mixed.pdf',bytes,sha256,checksum:sha256,scanStatus:'clean'},options,new AbortController().signal),routes=JSON.parse(String(d.metadata.pageRouting));expect(routes[0]).toMatchObject({classification:'text_based',route:'native'});expect(routes[1]).toMatchObject({classification:'empty_or_unsupported',route:'manual'});expect(d.findings.some(f=>f.code==='PAGE_MANUAL_TRANSCRIPTION')).toBe(true);expect(d.nodes[0].children.some(n=>n.attributes.method==='local_ocr')).toBe(false)
})
