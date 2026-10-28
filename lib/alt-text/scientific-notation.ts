import {parseAxisScalar} from "./chart-axis-scale"
import type {DomainNotation,DomainObservation,DomainOptions,DomainSupport} from "./scientific-domain-contract"
// Element-symbol spelling only, following IUPAC's table. No valence/identity/chemical-validity claim.
// https://iupac.org/what-we-do/periodic-table-of-elements/
export const ELEMENT_SYMBOLS=new Set("H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og".split(" "))
const SUBSCRIPT="₀₁₂₃₄₅₆₇₈₉",SUPERSCRIPT="⁰¹²³⁴⁵⁶⁷⁸⁹"
const digits=(s:string,alphabet:string)=>Array.from(s,(c)=>alphabet.includes(c)?String(alphabet.indexOf(c)):c).join("")
export function inspectChemicalNotation(originalText:string){
 const warnings=["Lexical symbol/count checks do not establish molecular identity, valence, bond order, chemical validity or balanced reactions."]
 if(originalText.length>512)return {status:"unsupported",tokens:[],charge:null,arrows:[],warnings:[...warnings,"Notation exceeds the local parser limit."]}
 const arrows=Array.from(originalText.matchAll(/→|←|⇌|↔|->|<-/g),(m)=>({raw:m[0],offset:m.index}))
 if(arrows.length)return {status:"reaction_notation_only",tokens:[],charge:null,arrows,warnings:[...warnings,"Printed reaction arrows are preserved. Reactant/product identities and reaction balancing were not inferred."]}
 let body=originalText.trim(),charge:{raw:string;magnitude:number|null;sign:string;ambiguous:boolean}|null=null
 const explicit=body.match(/(?:\^(\d{0,3})([+-])|([⁰¹²³⁴⁵⁶⁷⁸⁹]{0,3})([⁺⁻]))$/)
 if(explicit){const magnitude=explicit[1]??digits(explicit[3]??"",SUPERSCRIPT),n=magnitude?Number(magnitude):1;charge={raw:explicit[0],magnitude:n>0?n:null,sign:explicit[2]??(explicit[4]==="⁺"?"+":"-"),ambiguous:n===0};body=body.slice(0,-explicit[0].length)}
 else if(/[+-]$/.test(body)){const raw=body.slice(-1),ambiguous=/\d[+-]$/.test(body);charge={raw,magnitude:ambiguous?null:1,sign:raw,ambiguous};body=body.slice(0,-1);if(ambiguous)warnings.push("Plain digits before a charge sign are ambiguous between atom count and charge magnitude; no magnitude was selected.")}
 const tokens:{symbol:string;count:number;raw:string;offset:number}[]=[],stack:string[]=[]
 let i=0,status="recognized_lexically"
 while(i<body.length){
  if(tokens.length>=128||stack.length>=24){status="unsupported";warnings.push("Notation token/group limit exceeded.");break}
  const c=body[i]
  if(c==="("||c==="["){stack.push(c);i++;continue}
  if(c===")"||c==="]"){if(body[i-1]==="("||body[i-1]==="["){status="unsupported";break}if(stack.pop()!==(c===")"?"(":"[")){status="unsupported";break}i++;const multiplier=body.slice(i).match(/^[0-9₀₁₂₃₄₅₆₇₈₉]+/);if(multiplier){const count=Number(digits(multiplier[0],SUBSCRIPT));if(!Number.isSafeInteger(count)||count<1||count>1_000_000||/^0/.test(digits(multiplier[0],SUBSCRIPT))){status="unsupported";break}i+=multiplier[0].length}continue}
  const match=body.slice(i).match(/^([A-Z][a-z]?)([0-9₀₁₂₃₄₅₆₇₈₉]*)/)
  if(!match||!ELEMENT_SYMBOLS.has(match[1])){status="unsupported";break}
  const count=match[2]?Number(digits(match[2],SUBSCRIPT)):1
  if(!Number.isSafeInteger(count)||count<1||count>1_000_000||/^0/.test(digits(match[2],SUBSCRIPT))){status="unsupported";break}
  tokens.push({symbol:match[1],count,raw:match[0],offset:i+originalText.indexOf(body)});i+=match[0].length
 }
 if(stack.length||!tokens.length||i!==body.length)status="unsupported"
 if(charge?.ambiguous&&status!=="unsupported")status="ambiguous"
 if(status==="unsupported")warnings.push("The whole source string is not supported chemical notation; partial tokens are not a verified formula.")
 if(tokens.length===1&&!charge)warnings.push("A single symbol can also be a variable or label. Element identity is unverified.")
 return {status,tokens,charge,arrows,groupMultipliersExpanded:false,warnings}
}
export function inspectGeometryNotation(text:string){
 const coordinate=text.match(/^\(\s*([+\-−]?\d+(?:\.\d+)?)\s*,\s*([+\-−]?\d+(?:\.\d+)?)\s*\)$/)
 return {literalMarkers:Array.from(text.matchAll(/[∠∥⊥△°]/g),(m)=>({raw:m[0],offset:m.index})),coordinate:coordinate?{raw:coordinate[0],x:coordinate[1],y:coordinate[2]}:null,proofVerified:false,equalitiesInferred:false,rightAngleInferred:false}
}
export function domainNotations(observations:DomainObservation[],support:DomainSupport,options:DomainOptions):DomainNotation[]{
 const labels=new Map(support.labels.map((l)=>[l.key,l])),seen=new Set<string>(),results:DomainNotation[]=[]
 for(const o of observations)for(const key of o.labelKeys){const id=`${o.subject}:${key}`;if(seen.has(id))continue;seen.add(id);const label=labels.get(key);if(!label)continue
  const base={labelKey:key,originalText:label.text,subject:o.subject,sourceTextVerified:label.sourceTextVerified,scientificAccuracyVerified:false as const}
  if(o.subject==="chemistry"&&options.chemicalSymbols){const parsed=inspectChemicalNotation(label.text);results.push({...base,kind:"chemical_notation",details:parsed,warnings:parsed.warnings})}
  else if(o.subject==="physics"&&options.units){const parsed=parseAxisScalar(label.text);results.push({...base,kind:"measurement_notation",details:{scalar:parsed,unitValidated:false,experimentalReadingVerified:false},warnings:["A literal numeric/unit label is not a verified physical measurement or component value.",...(parsed.warning?[parsed.warning]:[])]})}
  else if(o.subject==="geometry"&&options.notation)results.push({...base,kind:"geometry_notation",details:inspectGeometryNotation(label.text),warnings:["Printed markers and coordinate strings are preserved; drawing appearance establishes no equality, right angle or proof."]})
  else results.push({...base,kind:"literal_label",details:{identity:null,function:null},warnings:["Literal source label only. Domain identity, function and scientific correctness are not established."]})
 }
 return results
}
