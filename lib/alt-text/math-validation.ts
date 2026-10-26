import katex from "katex"
import {XMLParser,XMLValidator} from "fast-xml-parser"
import type {MathIssue,MathValidation} from "./math-validation-contract"

export const MATH_PARSER_POLICY=1
export const MATH_RENDERER_VERSION=katex.version
const MAX_LENGTH=4000,MAX_DEPTH=32,MAX_COMMANDS=700,MAX_NODES=12000
const forbidden=/\\(?:gdef|edef|xdef|def|let|futurelet|newcommand|renewcommand|providecommand|newenvironment|renewenvironment|catcode|csname|endcsname|expandafter|input|include|includegraphics|usepackage|require|write|openout|read|special|href|url|html\w*|class|style|data|id|global)\b/g
const allowedEnvironments=new Set(["array","matrix","pmatrix","bmatrix","Bmatrix","vmatrix","Vmatrix","smallmatrix","aligned","alignedat","gathered","cases","dcases","split","equation","equation*","align","align*","gather","gather*"])
const tags=new Set("math semantics annotation mrow mi mn mo mtext mspace ms mfrac msqrt mroot mstyle merror mpadded mphantom mfenced menclose msub msup msubsup munder mover munderover mmultiscripts mprescripts none mtable mlabeledtr mtr mtd".split(" "))
const attributes=new Set("display mathvariant mathsize mathcolor mathbackground dir scriptlevel displaystyle scriptsizemultiplier scriptminsize infixlinebreakstyle stretchy symmetric maxsize minsize largeop movablelimits accent accentunder fence separator form lspace rspace width height depth voffset linethickness bevelled numalign denomalign notation columnalign rowalign groupalign rowspacing columnspacing columnlines rowlines frame framespacing equalrows equalcolumns align side minlabelspacing rowspan columnspan encoding".split(" "))
const escape=(s:unknown)=>String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&apos;")
/** Rebuild only presentation MathML tags/attributes. No HTML/SVG, URL attributes, style or event handlers. */
export function sanitizePresentationMathml(markup:string):string{
 if(markup.length>200_000||/<!|<\?/.test(markup)||XMLValidator.validate(markup)!==true)throw new Error("MATHML_INVALID")
 const parsed=new XMLParser({preserveOrder:true,ignoreAttributes:false,trimValues:false,parseTagValue:false,processEntities:true}).parse(markup)
 let count=0
 function visit(nodes:any[],depth:number):string{
  if(depth>100||!Array.isArray(nodes))throw new Error("MATHML_LIMIT")
  return nodes.map((node)=>{
   if(++count>MAX_NODES)throw new Error("MATHML_LIMIT")
   if(Object.hasOwn(node,"#text"))return escape(node["#text"])
   const keys=Object.keys(node).filter((k)=>k!==":@")
   if(keys.length!==1||!tags.has(keys[0]))throw new Error("MATHML_TAG_UNSUPPORTED")
   const tag=keys[0]
   let attrs=""
   for(const [key,value] of Object.entries(node[":@"]??{})){
    const name=key.slice(2),text=String(value)
    if(name==="xmlns"&&tag==="math"&&text==="http://www.w3.org/1998/Math/MathML")attrs+=` xmlns="${text}"`
    else if(attributes.has(name)&&text.length<=120&&/^[A-Za-z0-9 .+%#,:_\-/*]*$/.test(text))attrs+=` ${name}="${escape(text)}"`
    else throw new Error("MATHML_ATTRIBUTE_UNSUPPORTED")
   }
   return `<${tag}${attrs}>${visit(node[tag],depth+1)}</${tag}>`
  }).join("")
 }
 if(parsed.length!==1||!parsed[0].math)throw new Error("MATHML_ROOT_INVALID")
 return visit(parsed,0)
}
export function validateEquation(candidate:string,sourceEvidenceId:number):MathValidation{
 const issues:MathIssue[]=[]
 const issue=(code:string,message:string,position:number|null=null,severity:"error"|"warning"="error")=>issues.push({code,message,position,severity})
 const result:MathValidation={schemaVersion:1,sourceEvidenceId,originalCandidate:candidate,selectedLatex:candidate,parserInput:candidate,delimiterHandling:"none",syntaxStatus:"failed",renderStatus:"not_attempted",mathmlStatus:"not_attempted",presentationMathml:null,mathmlKind:"presentation",humanVerified:false,sourceMatchVerified:false,renderer:{id:"katex",version:katex.version,policyVersion:1},issues,createdAt:new Date().toISOString(),reviewReference:null}
 if(typeof candidate!=="string"||!candidate.trim()||candidate.length>MAX_LENGTH){issue("INPUT_LIMIT","An equation must contain 1–4000 characters.");return result}
 if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(candidate)||candidate.isWellFormed&&!candidate.isWellFormed()){issue("INVALID_ENCODING","Input contains broken Unicode or control characters.");return result}
 for(const match of candidate.matchAll(forbidden))issue("UNSAFE_COMMAND","Macro definitions, external resources and HTML commands are disabled.",match.index)
 let body=candidate.trim(),offset=candidate.indexOf(body)
 for(const [left,right] of [["\\[","\\]"],["\\(","\\)"],["$$","$$"],["$","$"]])if(body.startsWith(left)&&body.endsWith(right)&&body.length>=left.length+right.length){body=body.slice(left.length,-right.length);offset+=left.length;result.delimiterHandling="outer_math_delimiters";break}
 result.parserInput=body
 const braces:number[]=[],envs:{name:string;position:number;start:number}[]=[]
 let commands=0
 for(let i=0;i<body.length;i++){
  if(body[i]==="\\"){
   const token=/^\\([A-Za-z]+|.)/.exec(body.slice(i))
   if(!token)continue
   if(++commands>MAX_COMMANDS){issue("COMPLEXITY_LIMIT","Equation contains too many commands.",i+offset);break}
   const env=/^\\(begin|end)\{([^}]+)\}/.exec(body.slice(i))
   if(env){
    const name=env[2]
    if(!allowedEnvironments.has(name))issue("UNSUPPORTED_ENVIRONMENT",`Environment ${name.slice(0,40)} is unsupported.`,i+offset)
    if(env[1]==="begin")envs.push({name,position:i+offset,start:i+env[0].length})
    else{
     const opened=envs.pop()
     if(opened?.name!==name)issue("ENVIRONMENT_MISMATCH","Environment delimiters do not match.",i+offset)
     else if(/matrix$/.test(name)){
      // Nested braces/environments require the real parser; only inspect simple matrix rows here.
      const content=body.slice(opened.start,i)
      if(!/\\begin|[{}]/.test(content)){
       const counts=content.split(/\\\\/).filter((r)=>r.trim()).map((r)=>r.split(/(?<!\\)&/).length)
       if(new Set(counts).size>1)issue("MATRIX_COLUMNS","Matrix rows have inconsistent column counts.",opened.position)
      }
     }
    }
    i+=env[0].length-1;continue
   }
   i+=token[0].length-1;continue
  }
  if(body[i]==="{"){braces.push(i);if(braces.length>MAX_DEPTH){issue("NESTING_LIMIT","Equation nesting exceeds the limit.",i+offset);break}}
  if(body[i]==="}"&&braces.pop()===undefined)issue("UNMATCHED_GROUP","Unexpected closing brace.",i+offset)
 }
 if(braces.length)issue("UNMATCHED_GROUP","Unclosed brace.",braces[0]+offset)
 if(envs.length)issue("UNCLOSED_ENVIRONMENT","Unclosed mathematical environment.",envs[0].position)
 if(/(?:[=+*/]|\\(?:times|cdot|leq|geq))\s*$/.test(body))issue("MISSING_OPERAND","An expression appears to end with an operator.",offset+body.length-1)
 if(/\\(?:frac|sqrt)\s*\{\s*\}/.test(body))issue("MISSING_OPERAND","A fraction or root has an empty operand.")
 const brackets:string[]=[]
 for(const match of body.matchAll(/(?<!\\)[()[\]]/g)){
  if(/[([]/.test(match[0]))brackets.push(match[0])
  else if(brackets.pop()!==(")"===match[0]?"(":"[")){issue("DELIMITER_REVIEW","Check unmatched delimiters; interval notation may intentionally mix brackets.",offset+match.index,"warning");break}
 }
 if(brackets.length)issue("DELIMITER_REVIEW","Check unmatched opening delimiters against the source.",null,"warning")
 if(/[Ol1×]/u.test(body))issue("AMBIGUOUS_SYMBOL","Check visually similar symbols such as O/0, l/1 and ×/x against the source.",null,"warning")
 issue("SOURCE_REVIEW_REQUIRED","Parsing does not prove the transcription matches the source image.",null,"warning")
 if(issues.some((x)=>x.severity==="error")){result.syntaxStatus=issues.some((x)=>x.code.includes("UNSUPPORTED")||x.code==="UNSAFE_COMMAND")?"unsupported":"failed";return result}
 try{
  const markup=katex.renderToString(body,{output:"mathml",displayMode:true,throwOnError:true,trust:false,strict:(code)=>{
   if(["unicodeTextInMathMode","unknownSymbol"].includes(code)){if(!issues.some((i)=>i.code==="UNICODE_REVIEW"))issue("UNICODE_REVIEW","Unicode text needs visual and language review; font coverage may vary.",null,"warning");return "ignore"}
   return "error"
  },maxSize:10,maxExpand:500,macros:{},globalGroup:false})
  result.syntaxStatus="valid"
  const math=markup.match(/<math\b[\s\S]*<\/math>/)?.[0]
  if(!math)throw new Error("MATHML_MISSING")
  result.presentationMathml=sanitizePresentationMathml(math)
  result.renderStatus="rendered";result.mathmlStatus="generated"
 }catch(error){
  if(error instanceof katex.ParseError){result.syntaxStatus=/Undefined control sequence|No such environment/.test(error.message)?"unsupported":"failed";issue("PARSER_ERROR",error.message.slice(0,500),typeof error.position==="number"?error.position+offset:null)}
  else{result.renderStatus="failed";result.mathmlStatus="failed";issue("CONVERSION_FAILED","The expression could not be converted to safe presentation MathML.")}
 }
 return result
}
