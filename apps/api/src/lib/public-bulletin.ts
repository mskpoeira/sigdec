type SitrepSnapshot={
 generatedAt?:string;
 summary?:Record<string,unknown>;
 monitoringEvents?:Array<Record<string,unknown>>;
};

const n=(value:unknown)=>Number.isFinite(Number(value))?Number(value):0;

export function buildPublicBulletinContent(snapshot:SitrepSnapshot){
 const s=snapshot.summary??{};
 const generated=snapshot.generatedAt?new Date(snapshot.generatedAt).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"}):"não informado";
 const events=(snapshot.monitoringEvents??[]).slice(0,10);
 const eventLines=events.length?events.map((x)=>{
  const severity=String(x.severity??"INFO");
  const station=String(x.stationName??x.stationCode??"Estação");
  const title=String(x.title??"Evento monitorado");
  return `- ${severity} · ${station} · ${title}`;
 }).join("\n"):"- Não há eventos ambientais abertos destacados neste boletim.";
 return [
  "BOLETIM PÚBLICO — DEFESA CIVIL",
  `Atualização da situação: ${generated}`,
  `Ocorrências em atendimento: ${n(s.activeIncidents)}. Alertas oficiais publicados: ${n(s.publishedAlerts)}. Abrigos abertos ou lotados: ${n(s.openShelters)}.`,
  `Eventos ambientais em acompanhamento: ${n(s.openMonitoringEvents)}, sendo ${n(s.emergencyMonitoringEvents)} classificados internamente como emergência.`,
  "MONITORAMENTO EM DESTAQUE",
  eventLines,
  "ORIENTAÇÃO À POPULAÇÃO",
  "Acompanhe os canais oficiais da Prefeitura e da Defesa Civil. Em situação de risco imediato, siga as orientações das autoridades e não se exponha a áreas alagadas, encostas instáveis ou locais interditados.",
  "Este boletim é derivado de SITREP previamente aprovado ou emitido e passa por fluxo próprio de revisão e aprovação antes da publicação."
 ].join("\n\n");
}
