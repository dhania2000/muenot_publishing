/** Small structurally valid PDF fixture with an exact xref and one native-text page. */
export function pdf(text="Book text"):Buffer{
 const content=`BT /F1 12 Tf 10 10 Td (${text.replace(/[\\()]/g,c=>'\\'+c)}) Tj ET`
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 1 /Kids [3 0 R] >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`]
 let body='%PDF-1.7\n',offsets:number[]=[]
 objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(body));body+=`${i+1} 0 obj\n${o}\nendobj\n`})
 const xref=Buffer.byteLength(body);body+=`xref\n0 6\n0000000000 65535 f \n${offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
 return Buffer.from(body)
}
