import PDFDocument from "pdfkit";

export async function buildContinuityChangeReportPdf(input:any){
 return new Promise<Buffer>((resolve,reject)=>{
  const proposal=input.proposal;
  const diff=input.diff;
  const effectiveness=input.effectiveness;
  const pdf=new PDFDocument({size:"A4",margins:{top:46,right:48,bottom:54,left:48},bufferPages:true,
   info:{Title:`Relatório de Mudança Controlada SIDEC — Runbook v${proposal.targetPlanVersion}`,Author:input.organizationName}});
  const chunks:Buffer[]=[];
  pdf.on("data",(chunk:Buffer)=>chunks.push(chunk));pdf.on("end",()=>resolve(Buffer.concat(chunks)));pdf.on("error",reject);
  const width=pdf.page.width-pdf.page.margins.left-pdf.page.margins.right;
  const when=(v:any)=>v?new Date(v).toLocaleString("pt-BR"):"—";
  const section=(t:string)=>{pdf.moveDown(.7);pdf.font("Helvetica-Bold").fontSize(11).fillColor("#173f69").text(t);pdf.moveDown(.2)};
  const p=(t:any)=>pdf.font("Helvetica").fontSize(8.5).fillColor("#102033").text(String(t??"—"),{align:"justify",lineGap:1.2});
  pdf.font("Helvetica-Bold").fontSize(13).fillColor("#173f69").text(String(input.organizationName).toUpperCase(),{align:"center"});
  pdf.fontSize(10).text("SIGDEC — CONTINUIDADE SIDEC",{align:"center"});pdf.moveDown(.7);
  pdf.fontSize(16).fillColor("#102033").text("RELATÓRIO DE MUDANÇA CONTROLADA",{align:"center"});
  pdf.fontSize(10).text(`Runbook v${proposal.targetPlanVersion} · ${proposal.targetPlanTitle}`,{align:"center"});pdf.moveDown(1);
  for(const [label,value] of [
   ["Proposta",proposal.id],["Status",proposal.status],["Recomendação",proposal.recommendationTitle],
   ["Severidade",proposal.recommendationSeverity??"—"],["Recorrência",proposal.recurrenceKey],["Revisão-base",proposal.basePlanVersion?`v${proposal.basePlanVersion} · ${proposal.basePlanTitle}`:"—"],
   ["Revisão-alvo",`v${proposal.targetPlanVersion} · ${proposal.targetPlanTitle}`],["Criada em",when(proposal.createdAt)],
   ["Aplicada em",when(proposal.appliedAt)],["Verificada em",when(proposal.verifiedAt)]
  ]){pdf.font("Helvetica-Bold").fontSize(8.4).text(`${label}:`,{continued:true});pdf.font("Helvetica").text(` ${value}`)}
  section("PROPOSTA E FUNDAMENTAÇÃO");p(proposal.proposalText);if(proposal.statusNotes)p(proposal.statusNotes);

  section("APROVAÇÕES DE GOVERNANÇA");
  const approvals=proposal.approvals??[];
  if(proposal.recommendationSeverity!=="CRITICAL"){
   p("A proposta não está classificada como crítica e não exige dupla aprovação independente.");
  }else{
   const approved=approvals.filter((item:any)=>item.decision==="APPROVED").length;
   const rejected=approvals.filter((item:any)=>item.decision==="REJECTED").length;
   p(`Mudança crítica: ${approved} aprovação(ões) e ${rejected} rejeição(ões) registradas. A aplicação exige duas aprovações de usuários distintos do proponente e nenhuma rejeição vigente.`);
   if(!approvals.length)p("Nenhuma decisão de aprovação registrada.");
   for(const item of approvals){
    pdf.font("Helvetica-Bold").fontSize(8).fillColor("#102033").text(`• ${item.decision} · ${item.decidedByName??"Usuário"} · ${when(item.decidedAt)}`);
    p(item.notes);
   }
  }

  section("DIFF ESTRUTURAL");
  if(!diff){p("Diff não disponível.");}else{
   const s=diff.summary??{};
   p(`Campos gerais alterados: ${s.fieldsChanged??0}. Etapas adicionadas: ${s.stepsAdded??0}. Etapas modificadas: ${s.stepsModified??0}. Etapas removidas: ${s.stepsRemoved??0}. Total de alterações estruturais: ${s.totalChanges??0}.`);
   for(const field of diff.fields??[]){
    pdf.font("Helvetica-Bold").fontSize(8).fillColor("#102033").text(`• Campo: ${field.field}`);
    pdf.font("Helvetica").fontSize(7.5).fillColor("#334e68").text(`Antes: ${String(field.before??"—")}`,{indent:10});
    pdf.font("Helvetica").fontSize(7.5).fillColor("#334e68").text(`Depois: ${String(field.after??"—")}`,{indent:10});
   }
   for(const step of diff.steps??[]){
    pdf.font("Helvetica-Bold").fontSize(8).fillColor("#102033").text(`• [${step.changeType}] ${step.phase} #${step.sortOrder} · ${step.title}`);
    pdf.font("Helvetica").fontSize(7.5).fillColor("#334e68").text(`Campos alterados: ${(step.changedFields??[]).join(", ")||"—"}`,{indent:10});
   }
  }

  section("EVIDÊNCIAS DE IMPLEMENTAÇÃO");
  const evidence=proposal.evidence??[];
  if(!evidence.length)p("Nenhuma evidência registrada.");
  for(const item of evidence){
   pdf.font("Helvetica-Bold").fontSize(8).fillColor("#102033").text(`• ${item.title} [${item.evidenceType}]`);
   p(item.reference);if(item.contentHash)pdf.font("Courier").fontSize(6.8).text(`SHA-256: ${item.contentHash}`,{indent:10});
  }

  section("EFICÁCIA ANTES/DEPOIS");
  if(!effectiveness){p("A proposta ainda não foi verificada ou não possui snapshot de eficácia.");}else{
   p(`Resultado consolidado: ${effectiveness.outcome??"—"}.`);
   const base=effectiveness.baseline;
   const verification=effectiveness.verification;
   if(base)p(`Baseline: exercício ${base.id} · runbook v${base.planVersion} · resultado ${base.result??"—"} · falhas ${base.summary?.failed??0} · concluídas ${base.summary?.completed??0}/${base.summary?.total??0}.`);
   else p("Baseline: não havia exercício anterior finalizado com AAR final na revisão-base.");
   if(verification)p(`Verificação: exercício ${verification.id} · runbook v${verification.planVersion} · resultado ${verification.result??"—"} · falhas ${verification.summary?.failed??0} · concluídas ${verification.summary?.completed??0}/${verification.summary?.total??0}.`);
  }

  section("RASTREABILIDADE");
  p(`Criada por: ${proposal.createdByName??"—"}. Aplicada por: ${proposal.appliedByName??"—"}. Verificada por: ${proposal.verifiedByName??"—"}.`);
  section("NOTA DE GOVERNANÇA");
  p("Este relatório documenta a relação entre recomendação, revisão do runbook, diferenças estruturais, aprovações, evidências de implementação e exercício de verificação. A identidade persistente das etapas preserva a rastreabilidade entre revisões. O SIGDEC não altera o runbook automaticamente; edição, aprovação, ativação, aplicação, verificação e selagem permanecem atos humanos auditáveis. Quando selado, o PDF é armazenado de forma imutável no banco com SHA-256 e assinatura Ed25519 verificável.");
  const range=pdf.bufferedPageRange();for(let i=range.start;i<range.start+range.count;i++){pdf.switchToPage(i);pdf.font("Helvetica").fontSize(7).fillColor("#607388").text(`SIGDEC · Mudança controlada · proposta ${proposal.id} · página ${i+1} de ${range.count}`,pdf.page.margins.left,pdf.page.height-36,{width,align:"center",lineBreak:false})}
  pdf.end();
 });
}
