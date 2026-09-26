import type {FastifyInstance,FastifyRequest} from "fastify";
import {z} from "zod";
import {authFrom,loadAccess,requireAuth} from "../auth.js";
import {db} from "../db.js";

const searchQuery=z.object({q:z.string().trim().min(2).max(120),limit:z.coerce.number().int().min(5).max(60).default(36)});

function organization(request:FastifyRequest){
 const id=authFrom(request).organizationId;
 if(!id)throw Object.assign(new Error("Usuário sem organização vinculada."),{statusCode:409});
 return id;
}

type SearchResult={
 kind:string;title:string;subtitle:string;meta?:string|null;href:string;status?:string|null;icon:string;
};

export async function experienceRoutes(app:FastifyInstance){
 app.get("/api/v1/search",{preHandler:requireAuth},async(request,reply)=>{
  const parsed=searchQuery.safeParse(request.query);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_QUERY",details:parsed.error.flatten()});
  const auth=authFrom(request),org=organization(request),access=await loadAccess(auth.userId),permissions=new Set(access.permissions);
  const can=(...codes:string[])=>permissions.has("system.master")||codes.some(code=>permissions.has(code));
  const q=parsed.data.q,pattern="%"+q+"%",starts=q+"%",perGroup=Math.max(3,Math.min(8,Math.ceil(parsed.data.limit/7)));
  const tasks:Array<Promise<SearchResult[]>>=[];

  if(can("incidents.read","incidents.manage")){
   tasks.push(db.query(`SELECT id,protocol,summary,neighborhood,status,priority
    FROM incidents WHERE organization_id=$1 AND (
      protocol ILIKE $2 OR summary ILIKE $2 OR COALESCE(neighborhood,'') ILIKE $2 OR COALESCE(address_line,'') ILIKE $2
    )
    ORDER BY CASE WHEN protocol ILIKE $3 THEN 0 ELSE 1 END,updated_at DESC LIMIT $4`,[org,pattern,starts,perGroup])
    .then(r=>r.rows.map(x=>({kind:"INCIDENT",title:x.protocol+" · "+x.summary,subtitle:[x.neighborhood,x.priority].filter(Boolean).join(" · "),meta:x.status,href:"/ocorrencias/"+x.id,status:x.status,icon:"⚠"}))));
  }

  if(can("humanitarian.read","humanitarian.manage")){
   tasks.push(Promise.all([
    db.query(`SELECT id,responsible_name AS name,condition,phone,address_origin
      FROM assisted_households WHERE organization_id=$1 AND (
       responsible_name ILIKE $2 OR COALESCE(phone,'') ILIKE $2 OR COALESCE(address_origin,'') ILIKE $2
      ) ORDER BY admitted_at DESC LIMIT $3`,[org,pattern,perGroup]),
    db.query(`SELECT id,name,status,neighborhood,address_line
      FROM shelters WHERE organization_id=$1 AND (
       name ILIKE $2 OR COALESCE(neighborhood,'') ILIKE $2 OR COALESCE(address_line,'') ILIKE $2
      ) ORDER BY created_at DESC LIMIT $3`,[org,pattern,perGroup]),
    db.query(`SELECT id,code,name,category,unit
      FROM humanitarian_items WHERE organization_id=$1 AND active=true AND (
       code ILIKE $2 OR name ILIKE $2 OR category ILIKE $2
      ) ORDER BY name LIMIT $3`,[org,pattern,perGroup])
   ]).then(([h,s,i])=>[
    ...h.rows.map(x=>({kind:"HOUSEHOLD",title:x.name,subtitle:[x.condition,x.address_origin].filter(Boolean).join(" · "),meta:x.phone,href:"/assistencia#familias",status:x.condition,icon:"♟"})),
    ...s.rows.map(x=>({kind:"SHELTER",title:x.name,subtitle:[x.neighborhood,x.address_line].filter(Boolean).join(" · "),meta:x.status,href:"/assistencia#abrigos",status:x.status,icon:"⌂"})),
    ...i.rows.map(x=>({kind:"ITEM",title:x.code+" · "+x.name,subtitle:x.category,meta:x.unit,href:"/assistencia#estoque",icon:"◇"}))
   ]));
  }

  if(can("volunteers.read","volunteers.manage")){
   tasks.push(db.query(`SELECT id,full_name AS name,status,phone,email
    FROM volunteers WHERE organization_id=$1 AND (
      full_name ILIKE $2 OR COALESCE(phone,'') ILIKE $2 OR COALESCE(email,'') ILIKE $2
    ) ORDER BY updated_at DESC LIMIT $3`,[org,pattern,perGroup])
    .then(r=>r.rows.map(x=>({kind:"VOLUNTEER",title:x.name,subtitle:[x.phone,x.email].filter(Boolean).join(" · "),meta:x.status,href:"/voluntarios",status:x.status,icon:"♥"}))));
  }

  if(can("dispatch.read","dispatch.manage","resources.manage")){
   tasks.push(Promise.all([
    db.query(`SELECT id,code,name,status FROM teams WHERE organization_id=$1 AND (
      code ILIKE $2 OR name ILIKE $2
    ) ORDER BY active DESC,code LIMIT $3`,[org,pattern,perGroup]),
    db.query(`SELECT id,code,plate,description,status FROM vehicles WHERE organization_id=$1 AND (
      code ILIKE $2 OR COALESCE(plate,'') ILIKE $2 OR description ILIKE $2
    ) ORDER BY active DESC,code LIMIT $3`,[org,pattern,perGroup])
   ]).then(([t,v])=>[
    ...t.rows.map(x=>({kind:"TEAM",title:x.code+" · "+x.name,subtitle:"Equipe operacional",meta:x.status,href:"/administracao/cadastros",status:x.status,icon:"♜"})),
    ...v.rows.map(x=>({kind:"VEHICLE",title:x.code+" · "+x.description,subtitle:x.plate??"Sem placa",meta:x.status,href:"/administracao/cadastros",status:x.status,icon:"▣"}))
   ]));
  }

  if(can("documents.read","documents.manage")){
   tasks.push(db.query(`SELECT id,number,title,status,subject
    FROM technical_documents WHERE organization_id=$1 AND (
      number ILIKE $2 OR title ILIKE $2 OR COALESCE(subject,'') ILIKE $2
    ) ORDER BY updated_at DESC LIMIT $3`,[org,pattern,perGroup])
    .then(r=>r.rows.map(x=>({kind:"DOCUMENT",title:(x.number??"Documento")+" · "+x.title,subtitle:x.subject??"Documento técnico",meta:x.status,href:"/documentos",status:x.status,icon:"▤"}))));
  }

  if(can("monitoring.read","monitoring.manage")){
   tasks.push(db.query(`SELECT id,code,name,station_type AS "stationType",provider,active
    FROM monitoring_stations WHERE organization_id=$1 AND (
      code ILIKE $2 OR name ILIKE $2 OR COALESCE(provider,'') ILIKE $2
    ) ORDER BY active DESC,name LIMIT $3`,[org,pattern,perGroup])
    .then(r=>r.rows.map(x=>({kind:"STATION",title:x.code+" · "+x.name,subtitle:[x.stationType,x.provider].filter(Boolean).join(" · "),meta:x.active?"ATIVA":"INATIVA",href:"/monitoramento",status:x.active?"ACTIVE":"INACTIVE",icon:"▲"}))));
  }

  if(can("plancon.manage")){
   tasks.push(db.query(`SELECT id,code,version,title,status,current_level AS "currentLevel",cobrade_code AS "cobradeCode"
    FROM contingency_plans WHERE organization_id=$1 AND (
      code ILIKE $2 OR title ILIKE $2 OR COALESCE(cobrade_code,'') ILIKE $2
    ) ORDER BY updated_at DESC LIMIT $3`,[org,pattern,perGroup])
    .then(r=>r.rows.map(x=>({kind:"PLANCON",title:x.code+" · v"+x.version+" · "+x.title,subtitle:[x.cobradeCode,x.currentLevel].filter(Boolean).join(" · "),meta:x.status,href:"/planejamento",status:x.status,icon:"▦"}))));
  }

  if(can("support_requests.manage")){
   tasks.push(db.query(`SELECT id,title,scope,service_type AS "serviceType",status,external_protocol AS "externalProtocol"
    FROM external_support_requests WHERE organization_id=$1 AND (
      title ILIKE $2 OR service_type ILIKE $2 OR COALESCE(external_protocol,'') ILIKE $2
    ) ORDER BY updated_at DESC LIMIT $3`,[org,pattern,perGroup])
    .then(r=>r.rows.map(x=>({kind:"SUPPORT",title:x.title,subtitle:x.scope+" · "+x.serviceType,meta:x.externalProtocol??x.status,href:"/apoios",status:x.status,icon:"◆"}))));
  }

  if(can("system.master","users.manage")){
   tasks.push(db.query(`SELECT id,matricula,display_name AS "displayName",job_title AS "jobTitle",department,active
    FROM users WHERE organization_id=$1 AND (
      matricula ILIKE $2 OR display_name ILIKE $2 OR COALESCE(job_title,'') ILIKE $2 OR COALESCE(department,'') ILIKE $2
    ) ORDER BY active DESC,display_name LIMIT $3`,[org,pattern,perGroup])
    .then(r=>r.rows.map(x=>({kind:"USER",title:x.matricula+" · "+x.displayName,subtitle:[x.jobTitle,x.department].filter(Boolean).join(" · "),meta:x.active?"ATIVO":"INATIVO",href:"/administracao/usuarios",status:x.active?"ACTIVE":"INACTIVE",icon:"♙"}))));
  }

  const groups=await Promise.all(tasks);
  const items=groups.flat().slice(0,parsed.data.limit);
  return {query:q,total:items.length,items};
 });

 app.get("/api/v1/presentation/overview",{preHandler:requireAuth},async request=>{
  const auth=authFrom(request),org=organization(request),access=await loadAccess(auth.userId),permissions=new Set(access.permissions);
  const can=(...codes:string[])=>permissions.has("system.master")||codes.some(code=>permissions.has(code));
  const organizationResult=await db.query("SELECT name FROM organizations WHERE id=$1",[org]);
  const metrics:Record<string,number|null>={};

  const count=async(key:string,sql:string,allowed:boolean)=>{
   if(!allowed){metrics[key]=null;return}
   const r=await db.query(sql,[org]);metrics[key]=Number(r.rows[0]?.value??0);
  };

  await Promise.all([
   count("activeIncidents",`SELECT count(*)::int AS value FROM incidents WHERE organization_id=$1 AND status NOT IN ('CLOSED','CANCELLED','DUPLICATE')`,can("incidents.read","incidents.manage")),
   count("criticalIncidents",`SELECT count(*)::int AS value FROM incidents WHERE organization_id=$1 AND status NOT IN ('CLOSED','CANCELLED','DUPLICATE') AND priority IN ('P1','P2')`,can("incidents.read","incidents.manage")),
   count("monitoringStations",`SELECT count(*)::int AS value FROM monitoring_stations WHERE organization_id=$1 AND active=true`,can("monitoring.read","monitoring.manage")),
   count("openMonitoringEvents",`SELECT count(*)::int AS value FROM monitoring_events WHERE organization_id=$1 AND status<>'CLOSED'`,can("monitoring.read","monitoring.manage")),
   count("activeHouseholds",`SELECT count(*)::int AS value FROM assisted_households WHERE organization_id=$1 AND departed_at IS NULL`,can("humanitarian.read","humanitarian.manage")),
   count("openShelters",`SELECT count(*)::int AS value FROM shelters WHERE organization_id=$1 AND status IN ('OPEN','FULL')`,can("humanitarian.read","humanitarian.manage")),
   count("availableTeams",`SELECT count(*)::int AS value FROM teams WHERE organization_id=$1 AND active=true AND status='AVAILABLE'`,can("dispatch.read","dispatch.manage","resources.manage")),
   count("availableVehicles",`SELECT count(*)::int AS value FROM vehicles WHERE organization_id=$1 AND active=true AND status='AVAILABLE'`,can("dispatch.read","dispatch.manage","resources.manage")),
   count("activeVolunteers",`SELECT count(*)::int AS value FROM volunteers WHERE organization_id=$1 AND status='ACTIVE'`,can("volunteers.read","volunteers.manage")),
   count("activePlancon",`SELECT count(*)::int AS value FROM contingency_plans WHERE organization_id=$1 AND status='ACTIVE'`,can("plancon.manage")),
   count("openSupportRequests",`SELECT count(*)::int AS value FROM external_support_requests WHERE organization_id=$1 AND status NOT IN ('CLOSED','CANCELLED','REJECTED')`,can("support_requests.manage")),
   count("openExercises",`SELECT count(*)::int AS value FROM preparedness_exercises WHERE organization_id=$1 AND status IN ('PLANNED','RUNNING')`,can("exercises.manage")),
   count("issuedDocuments",`SELECT count(*)::int AS value FROM technical_documents WHERE organization_id=$1 AND status='ISSUED'`,can("documents.read","documents.manage"))
  ]);

  const modules=[
   {code:"monitoring",step:1,title:"Prevenção e Monitoramento",description:"Estações, leituras, limiares, mapas de risco e alertas apoiam a decisão antes e durante os eventos.",href:"/monitoramento",available:can("monitoring.read","monitoring.manage"),metrics:[["Estações ativas",metrics.monitoringStations],["Eventos abertos",metrics.openMonitoringEvents]]},
   {code:"incidents",step:2,title:"Ocorrências e Despacho",description:"Registro padronizado, protocolo, prioridade, georreferenciamento, equipes, viaturas e linha do tempo operacional.",href:"/ocorrencias",available:can("incidents.read","incidents.manage"),metrics:[["Ocorrências ativas",metrics.activeIncidents],["P1/P2",metrics.criticalIncidents]]},
   {code:"operations",step:3,title:"Comando, SCO e PLANCON",description:"Estrutura de comando, ativação de PLANCON, checklists, plano de chamada e mobilização de recursos.",href:"/planejamento/operacao",available:can("plancon.manage"),metrics:[["PLANCON ativos",metrics.activePlancon],["Equipes disponíveis",metrics.availableTeams],["Viaturas disponíveis",metrics.availableVehicles]]},
   {code:"humanitarian",step:4,title:"Assistência Humanitária",description:"Famílias, pessoas afetadas, abrigos, estoque e entregas ficam conectados ao contexto operacional.",href:"/assistencia",available:can("humanitarian.read","humanitarian.manage"),metrics:[["Famílias acompanhadas",metrics.activeHouseholds],["Abrigos abertos/lotados",metrics.openShelters]]},
   {code:"resilience",step:5,title:"Resiliência e Apoio Externo",description:"Voluntariado, capacitação, ajuda mútua, operações sazonais, simulados e solicitações a Estado/União.",href:"/resiliencia",available:can("support_requests.manage","volunteers.read","volunteers.manage","exercises.manage"),metrics:[["Voluntários ativos",metrics.activeVolunteers],["Apoios em andamento",metrics.openSupportRequests],["Simulados abertos",metrics.openExercises]]},
   {code:"documents",step:6,title:"Documentos, Evidências e Integridade",description:"Relatórios técnicos, rastreabilidade, auditoria e mecanismos de integridade preservam a confiança institucional.",href:"/documentos",available:can("documents.read","documents.manage"),metrics:[["Documentos emitidos",metrics.issuedDocuments]]}
  ];

  return {
   organization:organizationResult.rows[0]?.name??"Organização",
   generatedAt:new Date().toISOString(),
   user:{matricula:(await db.query("SELECT matricula,display_name FROM users WHERE id=$1",[auth.userId])).rows[0]?.matricula??"",displayName:(await db.query("SELECT matricula,display_name FROM users WHERE id=$1",[auth.userId])).rows[0]?.display_name??""},
   metrics,modules
  };
 });
}
