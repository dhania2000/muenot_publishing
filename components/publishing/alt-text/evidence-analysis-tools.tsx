"use client"
import {useState} from "react"
import {ImageRegionsPanel} from "./image-regions-panel"
import {ImageOcrPanel} from "./image-ocr-panel"
import {MathRecognitionPanel} from "./math-recognition-panel"
import {ChartStructurePanel} from "./chart-structure-panel"
import {ScientificStructureSection} from "./scientific-structure-panel"
import {IllustrationStructureSection} from "./illustration-structure-panel"
import {ProcessingPipelinePanel} from "./processing-pipeline-panel"
/** Mount only the selected existing analysis tool. Paid operations retain their own explicit confirmations. */
export function EvidenceAnalysisTools({assetId,occurrenceId=null}:{assetId:number;occurrenceId?:number|null}){
 const [selected,setSelected]=useState("regions")
 return <><ProcessingPipelinePanel assetId={assetId} occurrenceId={occurrenceId}/><details className="rounded border p-3"><summary className="cursor-pointer text-sm font-medium">Analysis tools</summary><div className="mt-3 space-y-3"><label className="grid gap-1 text-xs">Analysis tool<select className="rounded border bg-background p-2" value={selected} onChange={e=>setSelected(e.target.value)}>{[["regions","Image regions"],["ocr","OCR text"],["math","Mathematics"],["chart","Charts"],["science","Scientific diagrams"],["illustration","Flowchart / table / map"]].map(([id,title])=><option key={id} value={id}>{title}</option>)}</select></label>{selected==="regions"?<ImageRegionsPanel assetId={assetId} occurrenceId={occurrenceId}/>:selected==="ocr"?<ImageOcrPanel assetId={assetId} occurrenceId={occurrenceId}/>:selected==="math"?<MathRecognitionPanel assetId={assetId} occurrenceId={occurrenceId}/>:selected==="chart"?<ChartStructurePanel assetId={assetId} occurrenceId={occurrenceId}/>:selected==="science"?<ScientificStructureSection assetId={assetId} occurrenceId={occurrenceId}/>:<IllustrationStructureSection assetId={assetId} occurrenceId={occurrenceId}/>}</div></details></>
}
