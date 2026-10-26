/** Opt-in REAL MySQL + renderer + multilingual OCR persistence test.
 * Requires PAGE_OCR_TEST_DATABASE_URL naming a dedicated *_test database.
 * This verifies the database adapter, not authenticated HTTP/private-storage integration. */
import { randomUUID, randomInt } from "node:crypto"
import { readFileSync } from "node:fs"
import { PDFDocument } from "pdf-lib"
import { describe,it,expect } from "vitest"

describe.runIf(!!process.env.PAGE_OCR_TEST_DATABASE_URL)("real MySQL page OCR round trip",()=>{
 it("persists real English/Hindi/bilingual output, survives reopen and denies another tenant",async()=>{
  const url=process.env.PAGE_OCR_TEST_DATABASE_URL!
  if (!new URL(url).pathname.endsWith("_test")) throw new Error("Use a dedicated database with a name ending in _test.")
  process.env.DATABASE_URL=url
  const {query,getPool}=await import("@/lib/db")
  const {runForTenant}=await import("@/lib/tenant-scope")
  const {ensurePageOcrSchema,saveInspectedPages,writePageState,readOcrPages}=await import("@/lib/alt-text/pdf-page-ocr-store")
  const {inspectPdfPages,recognizePdfPage}=await import("@/lib/alt-text/pdf-page-ocr-pipeline")
  const {shutdownOcrEngine}=await import("@/lib/alt-text/ocr-engine")
  const tenantId=randomInt(100_000_000,900_000_000)
  const docIds:number[]=[],jobIds:number[]=[]
  try {
   await runForTenant({tenantId},async()=>{
    await ensurePageOcrSchema()
    for(const [id,languageMode] of [["eng-clean","eng"],["hin-paragraph","hin"],["bi-01","eng_hin"]] as const){
     const pdf=await PDFDocument.create(), image=await pdf.embedPng(readFileSync(`test/fixtures/ocr/multilingual/${id}.png`))
     pdf.addPage([image.width*72/200,image.height*72/200]).drawImage(image,{x:0,y:0,width:image.width*72/200,height:image.height*72/200})
     const bytes=await pdf.save()
     const d=await query<any>(`INSERT INTO alt_text_documents (tenant_id,upload_reference_id,file_object_id,private_storage_reference,original_filename,document_type,mime_type,file_size_bytes,security_scan_status,uploaded_by) VALUES (?,?,0,'synthetic-smoke','synthetic.pdf','pdf','application/pdf',?,'clean',1)`,[tenantId,randomUUID(),bytes.length])
     const documentId=Number(d.insertId);docIds.push(documentId)
     const j=await query<any>(`INSERT INTO platform_background_jobs (job_type,tenant_id,payload,status,worker_id,lease_expires_at,idempotency_key) VALUES ('alt_text.pdf_page_ocr',?,?,'running','mysql-smoke',DATE_ADD(UTC_TIMESTAMP(),INTERVAL 280 SECOND),?)`,[tenantId,JSON.stringify({documentId,request:{action:"inspect"}}),randomUUID()])
     const job={id:Number(j.insertId),tenant_id:tenantId,worker_id:"mysql-smoke"} as any;jobIds.push(job.id)
     const pages=await inspectPdfPages(documentId,bytes);await saveInspectedPages(documentId,pages,job)
     await query("UPDATE alt_text_document_page_ocr SET job_id=? WHERE tenant_id=? AND document_id=?",[job.id,tenantId,documentId])
     await writePageState(job,0,"rendering",{attempt:true})
     const result=await recognizePdfPage({documentId,page:pages[0],bytes,runId:job.id,request:{action:"recognize",mode:"selected",pages:[0],languageMode,dpi:300,segmentation:"auto"},guard:async()=>{},onRecognizing:()=>writePageState(job,0,"recognizing")})
     await writePageState(job,0,result.status,{result})
     const [reopened]=await readOcrPages(documentId,0,1,0)
     expect(reopened.result?.rawText).toBe(result.rawText);expect(reopened.result?.render.viewportTransform).toEqual(result.render.viewportTransform)
     if(languageMode!=="eng")expect(reopened.result?.rawText).toMatch(/\p{Script=Devanagari}/u)
     await runForTenant({tenantId:tenantId+1},async()=>expect(await readOcrPages(documentId,0,1)).toEqual([]))
    }
   })
  } finally {
   for(const id of docIds){await query("DELETE FROM alt_text_document_page_ocr WHERE tenant_id=? AND document_id=?",[tenantId,id]);await query("DELETE FROM alt_text_documents WHERE tenant_id=? AND id=?",[tenantId,id])}
   for(const id of jobIds)await query("DELETE FROM platform_background_jobs WHERE tenant_id=? AND id=?",[tenantId,id])
   await shutdownOcrEngine();await getPool().end()
  }
 },300_000)
})
