import PDFDocument from "pdfkit";

export async function buildContinuityExerciseReportPdf(input:any){
 return new Promise<Buffer>((resolve,reject)=>{
  const pdf=new PDFDocument({size:"A4",margins:{top:46,right:48,bottom:54,left:48},bufferPages:true,
   info:{Title:`Relatório de Exercício de Continuidade SIDEC — Runbook v${input.exercise.planVersion}`,Author:input.organizationName}});
  const chunks:Buffer[]=[];
  pdf.on("data",(chunk:Buffer)=>chunks.push(chunk));pdf.on("end",()=>resolve(Buffer.concat(chunks)));pdf.on("error",reject);
  const width=pdf.page.width-pdf.page.margins.left-pdf.page.margins.right;
  const when=(v:any)=>v?new Date(v).toLocaleString("pt-BR"):"—";
  const section=(t:string)=>{pdf.moveDown(.7);pdf.font("Helvetica-Bold").fontSize(11).fillColor("#173f69").text(t);pdf.moveDown(.2)};
  const p=(t:any)=>pdf.font("Helvetica").fontSize(8.5).fillColor("#102033").text(String(t??"—"),{align:"justify",lineGap:1.2});
  pdf.font("Helvetica-Bold").fontSize(13).fillColor("#173f69").text(String(input.organizationName).toUpperCase(),{align:"center"});
  pdf.fontSize(10).text("SIGDEC — CONTINUIDADE SIDEC",{align:"center"});pdf.moveDown(.7);
  pdf.fontSize(16).fillColor("#102033").text("RELATÓRIO DE EXERCÍCIO DE CONTINUIDADE",{align:"center"});
  pdf.fontSize(10).text(`Runbook v${input.exercise.planVersion} · ${input.exercise.planTitle}`,{align:"center"});pdf.moveDown(1);
  for(const [label,value] of [["Exercício",input.exercise.id],["Status",input.exercise.status],["Resultado",input.exercise.result??"—"],["Início",when(input.exercise.startedAt)],["Encerramento",when(input.exercise.completedAt)]]){pdf.font("Helvetica-Bold").fontSize(8.4).text(`${label}:`,{continued:true});pdf.font("Helvetica").text(` ${value}`)}
  section("CENÁRIO");p(input.exercise.scenario);
  section("RESUMO DE EXECUÇÃO");p(`Etapas: ${input.exercise.summary.total}. Concluídas: ${input.exercise.summary.completed}. Puladas: ${input.exercise.summary.skipped}. Falhas: ${input.exercise.summary.failed}. Pendentes: ${input.exercise.summary.pending}. Progresso: ${input.exercise.summary.progressPct}%.`);if(input.exercise.notes)p(input.exercise.notes);
  section("ETAPAS E EVIDÊNCIAS");
  for(const step of input.exercise.steps){
   pdf.font("Helvetica-Bold").fontSize(9).fillColor("#102033").text(`${step.sortOrder}. ${step.phase} · ${step.title}`);
   pdf.font("Helvetica").fontSize(8).fillColor("#334e68").text(`Status: ${step.status} · Obrigatória: ${step.required?"sim":"não"} · Responsável: ${step.ownerName??"—"} · Previsão: ${step.expectedMinutes} min`);
   p(step.instructions);if(step.notes)p(`Observações: ${step.notes}`);
   const ev=step.evidence??[];if(!ev.length)p("Sem evidência referencial registrada.");
   for(const item of ev){pdf.font("Helvetica-Bold").fontSize(7.8).text(`• ${item.title} [${item.evidenceType}]`);pdf.font("Helvetica").fontSize(7.5).text(item.reference,{indent:10});if(item.contentHash)pdf.font("Courier").fontSize(6.8).text(`SHA-256: ${item.contentHash}`,{indent:10})}
   pdf.moveDown(.4);
  }
  section("AFTER ACTION REVIEW (AAR)");
  if(!input.aar)p("AAR ainda não registrado para este exercício.");else{
   p(`Status: ${input.aar.status}`);pdf.font("Helvetica-Bold").fontSize(8.5).text("Resumo executivo");p(input.aar.executiveSummary);pdf.font("Helvetica-Bold").fontSize(8.5).text("Pontos fortes");p(input.aar.strengths);pdf.font("Helvetica-Bold").fontSize(8.5).text("Lacunas");p(input.aar.gaps);pdf.font("Helvetica-Bold").fontSize(8.5).text("Recomendações");p(input.aar.recommendations);
   pdf.font("Helvetica-Bold").fontSize(9).fillColor("#173f69").text("Plano de ações corretivas");
   if(!(input.aar.actions??[]).length)p("Nenhuma ação corretiva registrada.");
   for(const a of input.aar.actions??[]){pdf.font("Helvetica-Bold").fontSize(8).text(`• [${a.priority}] ${a.title}`);pdf.font("Helvetica").fontSize(7.6).text(`Status: ${a.status} · Responsável: ${a.ownerName??"—"} · Prazo: ${when(a.dueAt)}`,{indent:10});if(a.description)p(a.description)}
   pdf.font("Helvetica-Bold").fontSize(9).fillColor("#173f69").text("Lições aprendidas estruturadas");
   if(!(input.aar.lessons??[]).length)p("Nenhuma lição estruturada registrada.");
   for(const l of input.aar.lessons??[]){pdf.font("Helvetica-Bold").fontSize(8).text(`• [${l.severity}] ${l.title}`);pdf.font("Helvetica").fontSize(7.6).text(`${l.category} · chave: ${l.recurrenceKey}`,{indent:10});p(l.observation)}
  }
  section("NOTA DE GOVERNANÇA");p("Este relatório documenta um exercício controlado de continuidade. Não comprova failover real, restauração produtiva, alteração de DNS, remoção de retenção WORM ou outra ação destrutiva. As evidências são referências auditáveis registradas pelos operadores.");
  const range=pdf.bufferedPageRange();for(let i=range.start;i<range.start+range.count;i++){pdf.switchToPage(i);pdf.font("Helvetica").fontSize(7).fillColor("#607388").text(`SIGDEC · Continuidade SIDEC · exercício ${input.exercise.id} · página ${i+1} de ${range.count}`,pdf.page.margins.left,pdf.page.height-36,{width,align:"center",lineBreak:false})}
  pdf.end();
 });
}
