import PDFDocument from "pdfkit";
import QRCode from "qrcode";

export type CustodyEvent={occurredAt:string|Date;eventType:string;description:string};

function short(value:string,length=24){return value.length<=length?value:`${value.slice(0,length)}…`;}

export async function buildSidecCustodyPdf(input:{
 organizationName:string;
 protocol:string;
 revision:number;
 proof:any;
 publicUrl:string;
 events:CustodyEvent[];
}){
 const qr=await QRCode.toBuffer(input.publicUrl,{type:"png",width:180,margin:1,errorCorrectionLevel:"M"});
 return new Promise<Buffer>((resolve,reject)=>{
  const pdf=new PDFDocument({
   size:"A4",margins:{top:48,right:48,bottom:56,left:48},bufferPages:true,
   info:{Title:`Cadeia de Custódia SIDEC — ${input.protocol} R${input.revision}`,Author:input.organizationName,Subject:"Integridade e cadeia de custódia SIGDEC"}
  });
  const chunks:Buffer[]=[];
  pdf.on("data",(chunk:Buffer)=>chunks.push(chunk));
  pdf.on("end",()=>resolve(Buffer.concat(chunks)));
  pdf.on("error",reject);

  const width=pdf.page.width-pdf.page.margins.left-pdf.page.margins.right;
  pdf.font("Helvetica-Bold").fontSize(13).fillColor("#173f69").text(input.organizationName.toUpperCase(),{align:"center"});
  pdf.fontSize(10).fillColor("#334e68").text("SIGDEC — SISTEMA INTEGRADO DE GESTÃO DA DEFESA CIVIL",{align:"center"});
  pdf.moveDown(0.5);
  pdf.moveTo(pdf.page.margins.left,pdf.y).lineTo(pdf.page.width-pdf.page.margins.right,pdf.y).strokeColor("#173f69").lineWidth(1.5).stroke();
  pdf.moveDown(1);

  pdf.font("Helvetica-Bold").fontSize(16).fillColor("#102033").text("CADEIA DE CUSTÓDIA — ARTEFATO SIDEC",{align:"center"});
  pdf.fontSize(11).text(`${input.protocol} · revisão ${input.revision}`,{align:"center"});
  pdf.moveDown(1);

  const qrX=pdf.page.width-pdf.page.margins.right-108;
  const qrY=pdf.y;
  pdf.image(qr,qrX,qrY,{width:108,height:108});
  pdf.font("Helvetica-Bold").fontSize(9).fillColor("#102033").text("VERIFICAÇÃO PÚBLICA",pdf.page.margins.left,qrY,{width:width-128});
  pdf.font("Helvetica").fontSize(8).fillColor("#52657a").text(input.publicUrl,{width:width-128});
  pdf.moveDown(0.5);
  pdf.font("Helvetica").fontSize(8).text("O QR Code leva à consulta pública do estado criptográfico registrado no SIGDEC.",{width:width-128});
  pdf.y=Math.max(pdf.y,qrY+116);
  pdf.moveDown(0.8);

  const p=input.proof;
  pdf.font("Helvetica-Bold").fontSize(10).fillColor("#102033").text("IDENTIFICAÇÃO E INTEGRIDADE");
  pdf.moveDown(0.35);
  const rows=[
   ["Versão do comprovante",String(p.proofVersion)],
   ["ZIP SHA-256",String(p.artifact.sha256)],
   ["Manifesto SHA-256",String(p.manifest.sha256)],
   ["HMAC keyId",String(p.hmac.keyId)],
   ["Ed25519 keyId",String(p.ed25519.keyId)],
   ["Fingerprint Ed25519",String(p.ed25519.publicKeyFingerprint)],
   ["Selado em",new Date(p.export.sealedAt).toLocaleString("pt-BR")],
   ["Atestado em",new Date(p.ed25519.attestedAt).toLocaleString("pt-BR")],
   ["Carimbo interno",new Date(p.timestamp.timestampedAt).toLocaleString("pt-BR")],
   ["Statement SHA-256",String(p.timestamp.statementHash)],
   ["Fingerprint timestamp",String(p.timestamp.publicKeyFingerprint)]
  ];
  for(const [label,value] of rows){
   pdf.font("Helvetica-Bold").fontSize(8.5).fillColor("#334e68").text(`${label}:`,{continued:true});
   pdf.font("Courier").fontSize(7.4).fillColor("#102033").text(` ${value}`,{width});
   pdf.moveDown(0.18);
  }

  pdf.moveDown(0.8);
  pdf.font("Helvetica-Bold").fontSize(10).text("LINHA DO TEMPO DA CUSTÓDIA");
  pdf.moveDown(0.4);
  if(!input.events.length){
   pdf.font("Helvetica").fontSize(9).text("Nenhum evento adicional registrado.");
  }else{
   for(const event of input.events){
    const when=new Date(event.occurredAt).toLocaleString("pt-BR");
    pdf.font("Helvetica-Bold").fontSize(8.5).fillColor("#334e68").text(`${when} · ${event.eventType}`);
    pdf.font("Helvetica").fontSize(8.5).fillColor("#102033").text(event.description,{indent:10,lineGap:1});
    pdf.moveDown(0.35);
   }
  }

  pdf.moveDown(1);
  pdf.font("Helvetica-Bold").fontSize(9).fillColor("#7a4a00").text("NOTA SOBRE O CARIMBO DE TEMPO");
  pdf.font("Helvetica").fontSize(8).fillColor("#52657a").text(
   "O carimbo de tempo apresentado é interno ao SIGDEC e assinado por Ed25519. Ele registra de forma auditável o instante em que o sistema vinculou os hashes e a atestação. Não equivale a carimbo do tempo emitido por Autoridade de Carimbo do Tempo externa ou ICP-Brasil.",
   {align:"justify",lineGap:2}
  );

  const range=pdf.bufferedPageRange();
  for(let i=range.start;i<range.start+range.count;i++){
   pdf.switchToPage(i);
   pdf.font("Helvetica").fontSize(7).fillColor("#607388").text(
    `SIGDEC · Cadeia de Custódia · ${input.protocol} R${input.revision} · página ${i+1} de ${range.count}`,
    pdf.page.margins.left,pdf.page.height-38,{width,align:"center",lineBreak:false}
   );
  }
  pdf.end();
 });
}
