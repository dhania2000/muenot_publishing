// Isolated local validator. Never register filesystem/network resource readers.
import {XmlDocument,XsdValidator,XmlValidateError,ParseOption,xmlCleanupInputProvider,xmlRegisterInputProvider} from 'libxml2-wasm'
let input='',length=0
process.stdin.setEncoding('utf8')
for await(const chunk of process.stdin){length+=Buffer.byteLength(chunk);if(length>3*1024*1024)throw Error('INPUT_LIMIT');input+=chunk}
const workerData=JSON.parse(input)
const send=result=>process.stdout.write(JSON.stringify(result))
let schema,validator,document
try{
 xmlCleanupInputProvider()
 if(!xmlRegisterInputProvider({match:()=>true,open:()=>undefined,read:()=>-1,close:()=>false}))throw Error('INPUT_DENIAL_UNAVAILABLE')
 const options={option:ParseOption.XML_PARSE_NONET|ParseOption.XML_PARSE_NO_XXE|ParseOption.XML_PARSE_NOERROR|ParseOption.XML_PARSE_NOWARNING}
 schema=XmlDocument.fromString(workerData.schema,options)
 validator=XsdValidator.fromDoc(schema)
 document=XmlDocument.fromString(workerData.xml,options)
 try{validator.validate(document);send({status:'passed',issues:[]})}
 catch(error){send({status:error instanceof XmlValidateError?'failed':'unable_to_test',issues:(error.details??[]).slice(0,20).map(e=>({line:Number(e.line)||0,code:Number(e.code)||0}))})}
}catch{send({status:'unable_to_test',issues:[]})}
finally{document?.dispose();validator?.dispose();schema?.dispose();xmlCleanupInputProvider()}
