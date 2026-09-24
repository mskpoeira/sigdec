import PDFDocument from "pdfkit";

export function resiliencePct(value:number,total:number){
  return total?Math.round((value/total)*10000)/100:null;
}

function metric(value:unknown){
  return value===null||value===undefined?"—":String(value);
}

function percent(value:unknown){
  return value===null||value===undefined?"—":`${value}%`;
}

function dateTime(value:unknown){
  if(!value)return "—";
  const date=new Date(String(value));
  return Number.isNaN(date.getTime())?String(value):date.toLocaleString("pt-BR");
}

export async function buildSidecResiliencePdf(input:{organizationName:string;report:Record<string,any>}){
  return new Promise<Buffer>((resolve,reject)=>{
    const report=input.report;
    const pdf=new PDFDocument({
      size:"A4",
      margins:{top:48,right:48,bottom:58,left:48},
      bufferPages:true,
      info:{
        Title:"SIGDEC — Relatório de Resiliência SIDEC",
        Author:input.organizationName,
        Subject:"Resiliência operacional, integridade e redundância WORM",
        Keywords:"SIGDEC, SIDEC, Defesa Civil, WORM, resiliência, integridade"
      }
    });
    const chunks:Buffer[]=[];
    pdf.on("data",(chunk:Buffer)=>chunks.push(chunk));
    pdf.on("end",()=>resolve(Buffer.concat(chunks)));
    pdf.on("error",reject);

    const width=pdf.page.width-pdf.page.margins.left-pdf.page.margins.right;
    pdf.font("Helvetica-Bold").fontSize(13).fillColor("#173f69").text(input.organizationName.toUpperCase(),{align:"center"});
    pdf.fontSize(10).fillColor("#334e68").text("SISTEMA INTEGRADO DE GESTÃO DA DEFESA CIVIL — SIGDEC",{align:"center"});
    pdf.moveDown(0.4);
    pdf.moveTo(pdf.page.margins.left,pdf.y).lineTo(pdf.page.width-pdf.page.margins.right,pdf.y).strokeColor("#173f69").lineWidth(1.3).stroke();
    pdf.moveDown(0.9);
    pdf.font("Helvetica-Bold").fontSize(16).fillColor("#102033").text("RELATÓRIO DE RESILIÊNCIA SIDEC",{align:"center"});
    pdf.font("Helvetica").fontSize(9).fillColor("#52657a").text(`Versão do relatório: ${metric(report.reportVersion)} · Gerado em ${dateTime(report.generatedAt)}`,{align:"center"});
    pdf.moveDown(0.8);

    const period=report.period??{};
    pdf.font("Helvetica-Bold").fontSize(10).fillColor("#102033").text("PERÍODO ANALISADO");
    pdf.font("Helvetica").fontSize(10).text(`${metric(period.days)} dias · ${dateTime(period.from)} até ${dateTime(period.to)}`);
    pdf.moveDown(0.8);

    const redundancy=report.redundancy??{},primary=report.primary??{},replica=report.replica??{};
    pdf.font("Helvetica-Bold").fontSize(10).text("INDICADORES-CHAVE");
    pdf.moveDown(0.25);
    const keyRows:Array<[string,string,string]>=[
      ["Cobertura da réplica",percent(redundancy.coveragePct),`${metric(redundancy.replicas)} de ${metric(redundancy.archives)} arquivos`],
      ["Integridade primária",percent(primary.integrityCheckPct),`${metric(primary.checks)} verificações`],
      ["Integridade da réplica",percent(replica.integrityCheckPct),`${metric(replica.checks)} verificações`],
      ["Alertas persistentes",metric(report.conditions?.openAlerts),"Condições ainda abertas"],
      ["Retries pendentes",metric(report.retries?.pending),`${metric(report.retries?.attempts)} tentativas registradas`]
    ];
    for(const [label,value,note] of keyRows){
      pdf.font("Helvetica-Bold").fontSize(9.5).fillColor("#173f69").text(`${label}: ${value}`);
      pdf.font("Helvetica").fontSize(8.5).fillColor("#52657a").text(note);
      pdf.moveDown(0.25);
    }

    pdf.moveDown(0.5).font("Helvetica-Bold").fontSize(10).fillColor("#102033").text("DRILLS DE RESTAURAÇÃO");
    const drills=Array.isArray(report.restoreDrills)?report.restoreDrills:[];
    if(!drills.length){
      pdf.font("Helvetica").fontSize(9).fillColor("#52657a").text("Nenhum drill registrado no período.");
    }else{
      for(const drill of drills){
        pdf.font("Helvetica").fontSize(9).fillColor("#102033").text(
          `${metric(drill.destination)} · ${metric(drill.successful)}/${metric(drill.drills)} com sucesso (${percent(drill.successPct)}) · duração média ${metric(drill.averageDurationMs)} ms`
        );
      }
    }

    pdf.moveDown(0.8).font("Helvetica-Bold").fontSize(10).text("CONDIÇÕES E RETRIES");
    pdf.font("Helvetica").fontSize(9).text(
      `Condições detectadas: ${metric(report.conditions?.detected)} · alertadas: ${metric(report.conditions?.alerted)} · resolvidas: ${metric(report.conditions?.resolved)} · abertas: ${metric(report.conditions?.openAlerts)}`
    );
    pdf.text(
      `Jobs de retry: ${metric(report.retries?.jobs)} · pendentes: ${metric(report.retries?.pending)} · concluídos: ${metric(report.retries?.succeeded)} · tentativas: ${metric(report.retries?.attempts)}`
    );

    const continuity=report.continuity;
    if(continuity){
      pdf.moveDown(0.9).font("Helvetica-Bold").fontSize(10).fillColor("#102033").text("OBJETIVOS ADMINISTRATIVOS DE CONTINUIDADE");
      pdf.font("Helvetica").fontSize(9).fillColor("#102033").text(
        `Estado geral: ${metric(continuity.readiness?.overall)} · RPO ${metric(continuity.policy?.rpoMinutes)} min · RTO ${metric(continuity.policy?.rtoMinutes)} min · validade de drill ${metric(continuity.policy?.drillMaxAgeHours)} h`
      );
      pdf.fontSize(8.5).fillColor("#52657a").text(
        `RPO observado: ${metric(continuity.readiness?.rpo?.observedMinutes)} min · ${metric(continuity.readiness?.rpo?.state)}. ${metric(continuity.readiness?.rpo?.reason)}`
      );
      pdf.text(
        `RTO observado em drill: ${metric(continuity.readiness?.rto?.observedMinutes)} min · ${metric(continuity.readiness?.rto?.state)}. ${metric(continuity.readiness?.rto?.reason)}`
      );
      pdf.text(
        `Atualidade dos drills: ${metric(continuity.readiness?.drillFreshness?.state)} · idade máxima observada ${metric(continuity.readiness?.drillFreshness?.ageHours)} h.`
      );
    }

    const trend=Array.isArray(report.trend)?report.trend:[];
    if(trend.length){
      pdf.moveDown(0.9).font("Helvetica-Bold").fontSize(10).text("SÉRIE HISTÓRICA MENSAL");
      pdf.font("Helvetica").fontSize(8.5).fillColor("#52657a").text("Mês · integridade primária · integridade réplica · alertas detectados · drills com sucesso");
      pdf.moveDown(0.3);
      for(const row of trend){
        pdf.font("Courier").fontSize(8).fillColor("#102033").text(
          `${metric(row.month)} · P ${percent(row.primaryIntegrityPct)} · R ${percent(row.replicaIntegrityPct)} · alertas ${metric(row.alertsDetected)} · drills ${metric(row.drillsSuccessful)}/${metric(row.drills)}`,
          {width}
        );
      }
    }

    pdf.moveDown(1).font("Helvetica-Bold").fontSize(9).fillColor("#102033").text("NOTA METODOLÓGICA");
    pdf.font("Helvetica").fontSize(8.5).fillColor("#52657a").text(
      "Os percentuais representam os resultados das verificações efetivamente registradas no SIGDEC. RPO e RTO são objetivos administrativos: o RPO é confrontado com atraso de replicação WORM e o RTO usa duração de drills como evidência, sem equivaler à recuperação integral do SIGDEC. Não constituem SLA contratual, disponibilidade contínua do provedor ou certificação externa de continuidade de negócios.",
      {align:"justify",lineGap:2}
    );

    const range=pdf.bufferedPageRange();
    for(let pageIndex=range.start;pageIndex<range.start+range.count;pageIndex+=1){
      pdf.switchToPage(pageIndex);
      const footerY=pdf.page.height-38;
      pdf.font("Helvetica").fontSize(7.5).fillColor("#607388").text(
        `SIGDEC · Resiliência SIDEC · página ${pageIndex+1} de ${range.count}`,
        pdf.page.margins.left,footerY,{width,align:"center",lineBreak:false}
      );
    }
    pdf.end();
  });
}
