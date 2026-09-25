import PDFDocument from "pdfkit";

function metric(value:unknown){return value===null||value===undefined?"—":String(value)}
function pct(value:unknown){return value===null||value===undefined?"—":Number(value).toFixed(1)+"%"}
function dt(value:unknown){if(!value)return "—";const d=new Date(String(value));return Number.isNaN(d.getTime())?String(value):d.toLocaleString("pt-BR")}

export async function buildContinuityGovernancePdf(input:{organizationName:string;report:Record<string,any>}){
 return new Promise<Buffer>((resolve,reject)=>{
  const report=input.report;
  const pdf=new PDFDocument({size:"A4",margins:{top:46,right:48,bottom:54,left:48},bufferPages:true,
   info:{Title:"SIGDEC — Governança Executiva da Continuidade SIDEC",Author:input.organizationName,
    Subject:"Mudanças de runbook, eficácia, governança e preservação WORM"}});
  const chunks:Buffer[]=[];pdf.on("data",(x:Buffer)=>chunks.push(x));pdf.on("end",()=>resolve(Buffer.concat(chunks)));pdf.on("error",reject);
  const width=pdf.page.width-pdf.page.margins.left-pdf.page.margins.right;
  const section=(title:string)=>{pdf.moveDown(.8);pdf.font("Helvetica-Bold").fontSize(11).fillColor("#173f69").text(title);pdf.moveDown(.25)};
  const line=(value:string)=>pdf.font("Helvetica").fontSize(8.6).fillColor("#102033").text(value,{lineGap:1.2});
  pdf.font("Helvetica-Bold").fontSize(13).fillColor("#173f69").text(input.organizationName.toUpperCase(),{align:"center"});
  pdf.fontSize(10).text("SIGDEC — CONTINUIDADE SIDEC",{align:"center"});pdf.moveDown(.6);
  pdf.fontSize(16).fillColor("#102033").text("RELATÓRIO EXECUTIVO DE GOVERNANÇA",{align:"center"});
  pdf.font("Helvetica").fontSize(8.5).fillColor("#52657a").text(`Gerado em ${dt(report.generatedAt)} · período ${dt(report.period?.from)} a ${dt(report.period?.to)}`,{align:"center"});
  section("RESUMO EXECUTIVO");
  const s=report.summary??{};
  line(`Propostas: ${metric(s.total)} · verificadas: ${metric(s.verified)} (${pct(s.verifiedRate)}) · críticas: ${metric(s.critical)}.`);
  line(`Eficácia: ${metric(s.improved)} melhoraram · ${metric(s.stable)} estáveis · ${metric(s.regressed)} regrediram · taxa de melhora ${pct(s.improvedRate)}.`);
  line(`Tempo médio: criação → aplicação ${metric(s.avgApplyHours)} h · aplicação → verificação ${metric(s.avgVerificationHours)} h.`);

  section("GOVERNANÇA E PRESERVAÇÃO");
  const g=report.governance??{},w=report.worm??{},r=report.resilience??{};
  line(`Aprovações registradas: ${metric(g.approvals)} · decisões críticas rejeitadas: ${metric(g.rejections)} · delegações no período: ${metric(g.delegations)}.`);
  line(`Relatórios selados: ${metric(w.sealed)} · WORM principal: ${metric(w.archived)} · íntegros: ${metric(w.primaryHealthy)} · réplicas: ${metric(w.replicated)} · réplicas íntegras: ${metric(w.replicaHealthy)}.`);
  line(`Resiliência: ${metric(r.openConditions)} condição(ões) aberta(s) · ${metric(r.pendingRetries)} retry(ies) pendente(s) · ${metric(r.restoreFailures)} falha(s) de drill no período.`);

  section("METAS DE EFICÁCIA");
  const targets=Array.isArray(report.targets)?report.targets:[];
  if(!targets.length)line("Nenhuma meta quantitativa habilitada.");
  for(const item of targets){
   pdf.font("Helvetica-Bold").fontSize(8.5).fillColor(item.state==="PASS"?"#215732":item.state==="FAIL"?"#8f1d1d":"#6b5b1e")
    .text(`• ${item.scopeType} · ${item.scopeValue} · ${item.state}`);
   line(`  Verificação ${pct(item.actual?.verifiedRate)} / meta mín. ${pct(item.minVerifiedRate)} · melhora ${pct(item.actual?.improvedRate)} / meta mín. ${pct(item.minImprovedRate)} · aplicação ${metric(item.actual?.avgApplyHours)} h / máx. ${metric(item.maxAvgApplyHours)} h · verificação ${metric(item.actual?.avgVerificationHours)} h / máx. ${metric(item.maxAvgVerificationHours)} h.`);
  }

  section("DISTRIBUIÇÃO POR SEVERIDADE");
  const severity=Array.isArray(report.bySeverity)?report.bySeverity:[];
  if(!severity.length)line("Sem propostas no período.");
  for(const row of severity)line(`${metric(row.severity)} · ${metric(row.total)} proposta(s) · ${metric(row.verified)} verificada(s) · ${metric(row.improved)} melhorou · ${metric(row.regressed)} regrediu.`);

  section("RECORRÊNCIAS");
  const rec=Array.isArray(report.byRecurrence)?report.byRecurrence:[];
  if(!rec.length)line("Sem recorrências no período.");
  for(const row of rec.slice(0,40)){
   pdf.font("Courier").fontSize(7.7).fillColor("#102033").text(
    `${metric(row.recurrenceKey)} · propostas ${metric(row.proposals)} · verificadas ${metric(row.verified)} · melhora ${metric(row.improved)} · regressão ${metric(row.regressed)}`,{width}
   );
  }

  section("NOTA METODOLÓGICA");
  pdf.font("Helvetica").fontSize(8.2).fillColor("#52657a").text(
   "As metas deste relatório são parâmetros administrativos internos e configuráveis. Não constituem SLA legal, obrigação contratual, certificação externa ou prazo normativo. Os indicadores usam apenas registros auditáveis disponíveis no SIGDEC para o período selecionado.",
   {align:"justify",lineGap:2}
  );

  const range=pdf.bufferedPageRange();
  for(let i=range.start;i<range.start+range.count;i++){
   pdf.switchToPage(i);
   pdf.font("Helvetica").fontSize(7.2).fillColor("#607388").text(
    `SIGDEC · Governança da Continuidade · página ${i+1} de ${range.count}`,
    pdf.page.margins.left,pdf.page.height-36,{width,align:"center",lineBreak:false}
   );
  }
  pdf.end();
 });
}
