// Dev-only: Node's TypeScript stripping loads the same typed source fixtures used by tests.
import {illustrationFixture} from '../test/alt-text/illustration-fixtures.ts'
import {mkdir,writeFile} from 'node:fs/promises'
const root=new URL('../test/fixtures/illustration-structure/',import.meta.url)
await mkdir(root,{recursive:true})
const definitions=[['branching-flow','flowchart'],['looping-flow','flowchart'],['ambiguous-arrow','flowchart'],['merged-cells','table'],['hindi-headings','table'],['missing-borders','table'],['route-map','map'],['map-legend','map'],['scientific-infographic','mixed'],['multi-panel-mixed','mixed'],['unreadable-labels','flowchart'],['repeated-occurrence','flowchart']]
const samples=definitions.map(([id,type])=>{
 const {rootId,input,output}=illustrationFixture(type)
 if(id==='looping-flow')output.edges.push({connectorRegionId:'arrow3',fromRegionId:'b',toRegionId:'a',direction:'from_to',arrowhead:'at_to',labelRegionIds:[]})
 if(id==='ambiguous-arrow'){output.edges[0].direction='unknown';output.edges[0].arrowhead='unclear';output.edges[0].toRegionId=null;output.warnings.push('ambiguous_direction')}
 if(id==='missing-borders'){output.table.rowRegionIds=[];output.table.columnRegionIds=[];output.table.borders='partial';for(const c of output.table.cells){c.row=null;c.column=null;c.rowSpan=1;c.columnSpan=1}output.warnings.push('missing_borders','partial_table')}
 if(id==='unreadable-labels'){input.support={ocrEvidence:[],reviewEvidence:[]};output.warnings.push('unreadable_labels')}
 if(id==='repeated-occurrence'){input.occurrenceId=3;input.request.occurrenceId=3}
 return {id,file:id+'.png',rootId,input,expected:output,synthetic:true}
})
await writeFile(new URL('manifest.json',root),JSON.stringify({purpose:'Supplied synthetic source regions, OCR/review and provider output contracts. No live extraction accuracy or reading-order correctness measured.',samples},null,2),'utf8')
process.stdout.write(`Prepared ${samples.length} illustration cases; render PNGs next.\n`)
