import type {AxisScalar,AxisScale,AxisTick} from "./chart-axis-contract"
const digits=(s:string)=>s.replace(/[०-९]/g,(d)=>String(d.charCodeAt(0)-0x966)).replaceAll("−","-").replaceAll("﹣","-")
const numberPart="[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)"
/** Explicit printed notation only. Commas and ambiguous slash dates are not silently localized. */
export function parseAxisScalar(raw:string):AxisScalar{
 const superscripts:Record<string,string>={"⁰":"0","¹":"1","²":"2","³":"3","⁴":"4","⁵":"5","⁶":"6","⁷":"7","⁸":"8","⁹":"9","⁺":"+","⁻":"-"}
 const text=digits(raw.trim()).replace(/10([⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+)/g,(_m,exponent:string)=>`10^${Array.from(exponent,(c)=>superscripts[c]).join("")}`),base={raw,unit:null,value:null,warning:null}
 if(!text||text.length>120)return {...base,kind:"unknown",warning:"Label is empty or exceeds the scalar limit."}
 if(/^(?:NaN|[+-]?(?:Inf(?:inity)?|∞))$/i.test(text))return {...base,kind:"unknown",warning:"Non-finite labels cannot establish an axis scale."}
 if((text.match(/\{/g)??[]).length!==(text.match(/\}/g)??[]).length||/[{}]/.test(text)&&!/(?:10\^\{[+-]?\d+\})/.test(text))return {...base,kind:"unknown",warning:"Scientific notation has malformed exponent groups."}
 if(/^\d{4}-\d{2}(?:-\d{2})?$/.test(text)){
  const full=text.length===7?`${text}-01`:text,value=Date.parse(`${full}T00:00:00.000Z`)
  if(Number.isFinite(value)&&new Date(value).toISOString().slice(0,10)===full)return {...base,kind:"date",value}
  return {...base,kind:"unknown",warning:"Invalid ISO calendar date."}
 }
 const clock=/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text)
 if(clock){const h=Number(clock[1]),m=Number(clock[2]),s=Number(clock[3]??0);return h<24&&m<60&&s<60?{...base,kind:"time",value:(h*3600+m*60+s)*1000}:{...base,kind:"unknown",warning:"Invalid clock label."}}
 if(/\d,\d|\d\/\d/.test(text))return {...base,kind:"unknown",warning:"Comma notation or slash date is ambiguous; review its locale and meaning."}
 const scientific=new RegExp(`^(${numberPart})\\s*(?:×|\\\\times|\\\\cdot)\\s*10\\^\\{?([+-]?\\d+)\\}?\\s*([\\p{L}\\p{M}°µμΩ/%²³^0-9 ._-]{0,24})$`,"u").exec(text)
 const power=new RegExp(`^10\\^\\{?([+-]?\\d+)\\}?\\s*([\\p{L}\\p{M}°µμΩ/%²³^0-9 ._-]{0,24})$`,"u").exec(text)
 const normal=new RegExp(`^(${numberPart}(?:[eE][+-]?\\d+)?)\\s*([\\p{L}\\p{M}°µμΩ/%²³^0-9 ._-]{0,24})$`,"u").exec(text)
 if(scientific||power||normal){
  const value=scientific?Number(scientific[1])*10**Number(scientific[2]):power?10**Number(power[1]):Number(normal![1]),unit=(scientific?scientific[3]:power?power[2]:normal![2]).trim()||null
  const mantissa=scientific?Number(scientific[1]):power?1:Number(normal![1].split(/[eE]/)[0])
  if(!Number.isFinite(value)||value===0&&mantissa!==0||Math.abs(value)>1e100||value!==0&&Math.abs(value)<1e-100)return {...base,kind:"unknown",warning:"Numeric range is unsupported for bounded scale fitting."}
  if(unit&&(/^[0-9.]/.test(unit)||!/[\p{L}°µμΩ/%²³]/u.test(unit)))return {...base,kind:"unknown",warning:"Multiple numeric tokens or unsupported unit notation cannot be treated as one tick."}
  if(unit&&(["O","I","l"].includes(unit)&&!/\s/.test(text)||/[xX]10\^/.test(unit))||unit?.startsWith("^"))return {...base,kind:"unknown",warning:"A confusable symbol or unsupported power needs source review."}
  return {raw,value,unit,kind:unit==="%"?"percentage":scientific||power||/[eE][+-]?\d/.test(normal![1])?"scientific":"number",warning:null}
 }
 if(/[0-9]/.test(text)&&/^[\d\s+\-.^×eE]+$/.test(text))return {...base,kind:"unknown",warning:"The numeric label is malformed or unreadable."}
 if(/^[+-]?(?:\d|\.\d)|^[₹$€£¥]\s*\d/.test(text))return {...base,kind:"unknown",warning:"Numeric, currency or temporal notation is unsupported; it was not treated as a category."}
 return {...base,kind:"category"}
}
function fit(points:{p:number;v:number}[]){
 const meanP=points.reduce((a,b)=>a+b.p,0)/points.length,meanV=points.reduce((a,b)=>a+b.v,0)/points.length
 const variance=points.reduce((a,b)=>a+(b.p-meanP)**2,0)
 if(variance<=0)return null
 const slope=points.reduce((a,b)=>a+(b.p-meanP)*(b.v-meanV),0)/variance,intercept=meanV-slope*meanP
 const range=Math.max(...points.map((p)=>p.v))-Math.min(...points.map((p)=>p.v))
 if(!Number.isFinite(slope)||!Number.isFinite(intercept)||range<=0)return null
 const normalizedResidual=Math.max(...points.map((p)=>Math.abs(p.v-(slope*p.p+intercept))))/range
 return {slope,intercept,normalizedResidual}
}
export function deriveAxisScale(ticks:AxisTick[],explicitUnit:string|null=null):AxisScale{
 const warnings:string[]=[],out:AxisScale={kind:"unknown",direction:"unknown",unit:explicitUnit,model:null,sourceLabelIds:ticks.map((t)=>t.labelId),candidate:true,usableForPixelExtraction:false,warnings}
 if(ticks.length<3){warnings.push("At least three positioned, reviewed tick labels are required.");return out}
 const ordered=[...ticks].sort((a,b)=>a.position-b.position)
 if(ordered.some((t)=>!Number.isFinite(t.position))||ordered.some((t,i)=>i>0&&t.position-ordered[i-1].position<1)){warnings.push("Tick positions are missing, repeated or too close.");return out}
 if(ordered.every((t)=>t.scalar.kind==="category")){
  if(new Set(ordered.map((t)=>t.text)).size!==ordered.length){warnings.push("Repeated categorical labels need review.");return out}
  out.kind="categorical";warnings.push("Categorical ordering does not define a numeric calibration.");return out
 }
 if(ordered.some((t)=>t.scalar.value==null||t.scalar.kind==="unknown"||t.scalar.kind==="category")){warnings.push("Some tick labels are ambiguous, unparsed or mix incompatible types.");return out}
 const dates=ordered.every((t)=>t.scalar.kind==="date"),times=ordered.every((t)=>t.scalar.kind==="time"),someDates=ordered.some((t)=>t.scalar.kind==="date"||t.scalar.kind==="time")
 if(someDates&&!dates&&!times){warnings.push("Calendar dates, clock times and numeric ticks cannot be mixed into one scale model.");return out}
 const units=new Set(ordered.map((t)=>t.scalar.unit).filter((u):u is string=>u!=null))
 if(units.size>1||explicitUnit&&units.size&&![...units].every((u)=>u===explicitUnit)||units.has("%")&&ordered.some((t)=>t.scalar.kind!=="percentage")){warnings.push("Tick units or percentage notation are inconsistent.");return out}
 out.unit=explicitUnit??[...units][0]??null
 const points=ordered.map((t)=>({p:t.position,v:t.scalar.value!})),differences=points.slice(1).map((p,i)=>p.v-points[i].v)
 if(differences.some((n)=>n===0)||!(differences.every((n)=>n>0)||differences.every((n)=>n<0))){warnings.push("Tick values are non-monotonic or repeat; a broken/ambiguous axis cannot be calibrated.");return out}
 const linear=fit(points),log=points.every((p)=>p.v>0)&&!dates&&!times&&!units.has("%")?fit(points.map((p)=>({p:p.p,v:Math.log10(p.v)}))):null
 const wins=(a:ReturnType<typeof fit>,b:ReturnType<typeof fit>)=>!!a&&a.normalizedResidual<=.01&&(!b||b.normalizedResidual>.03||b.normalizedResidual>.002&&a.normalizedResidual<b.normalizedResidual*.2)
 let selected:ReturnType<typeof fit>=null,transform:"identity"|"log10"|"utc_milliseconds"|"clock_milliseconds"="identity"
 if((dates||times)&&linear&&linear.normalizedResidual<=.01){selected=linear;transform=dates?"utc_milliseconds":"clock_milliseconds";out.kind="date_time"}
 else if(wins(linear,log)){selected=linear;out.kind=out.unit==="%"?"percentage":ordered.some((t)=>t.scalar.kind==="scientific")?"scientific_notation":"linear_numeric"}
 else if(wins(log,linear)){selected=log;transform="log10";out.kind="logarithmic"}
 if(!selected){warnings.push("Tick spacing does not establish a supported linear/logarithmic model, or both fits remain ambiguous.");return out}
 out.direction=selected.slope>0?"increasing_with_pixel":"decreasing_with_pixel"
 out.model={...selected,transform,pixelRange:[points[0].p,points.at(-1)!.p],valueAtPixelRange:[points[0].v,points.at(-1)!.v]}
 warnings.push("Model uses reviewed text and estimated label positions. It is a candidate within observed ticks, not verified pixel calibration; no zero baseline is assumed.")
 return out
}

