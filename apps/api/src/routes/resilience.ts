import type {FastifyInstance,FastifyRequest} from "fastify";
import {z} from "zod";
import {authFrom,requirePermission} from "../auth.js";
import {db} from "../db.js";

const uuid=z.string().uuid();
function org(request:FastifyRequest){
 const value=authFrom(request).organizationId;
 if(!value)throw Object.assign(new Error("Organização ausente."),{statusCode:409});
 return value;
}
async function matricula(request:FastifyRequest){
 const a=authFrom(request),o=org(request);
 const r=await db.query("SELECT matricula FROM users WHERE id=$1 AND organization_id=$2",[a.userId,o]);
 if(!r.rows[0])throw Object.assign(new Error("Servidor não localizado."),{statusCode:409});
 return String(r.rows[0].matricula);
}

const supportTypes=[
 "STATE_HUMANITARIAN","STATE_EMERGENCY_INSPECTION","STATE_KIT_CHUVAS","STATE_KIT_ESTIAGEM",
 "STATE_KIT_FRIO","STATE_EMERGENCY_SUPPORT","STATE_WORKS","STATE_EQUIPMENT_CONVENTION",
 "FEDERAL_RECOGNITION","FEDERAL_ASSISTANCE","FEDERAL_RESTORATION","FEDERAL_RECONSTRUCTION",
 "FEDERAL_HOUSING","FEDERAL_WATER_SUPPLY","MUTUAL_AID","OTHER"
] as const;
const supportStatuses=[
 "DRAFT","DOCUMENTING","READY_TO_SUBMIT","SUBMITTED","UNDER_REVIEW","REQUIREMENTS",
 "APPROVED","PARTIAL_APPROVED","REJECTED","EXECUTION","CLOSED","CANCELLED"
] as const;
const supportInput=z.object({
 scope:z.enum(["STATE","FEDERAL","MUTUAL_AID","OTHER"]),
 serviceType:z.enum(supportTypes),
 incidentProtocol:z.string().trim().max(80).optional().default(""),
 anomalyCaseId:z.string().uuid().optional(),
 cobradeCode:z.string().trim().max(30).optional().default(""),
 title:z.string().trim().min(3).max(300),
 summary:z.string().trim().min(5).max(8000),
 externalSystem:z.string().trim().max(80).optional().default(""),
 referenceUrl:z.string().url().max(2000).optional().or(z.literal("")).default(""),
 requestedAmount:z.number().nonnegative().max(99999999999999).optional(),
 deadlineAt:z.coerce.date().optional(),
 responsibleUserId:z.string().uuid().optional()
});
const supportUpdate=z.object({
 status:z.enum(supportStatuses),
 externalProtocol:z.string().trim().max(200).nullable().optional(),
 approvedAmount:z.number().nonnegative().max(99999999999999).nullable().optional(),
 deadlineAt:z.coerce.date().nullable().optional(),
 notes:z.string().trim().max(8000).optional().default("")
});
const reqInput=z.object({
 code:z.string().trim().min(1).max(80),
 title:z.string().trim().min(3).max(600),
 required:z.boolean().default(true),
 dueAt:z.coerce.date().optional(),
 notes:z.string().trim().max(5000).optional().default("")
});
const reqUpdate=z.object({
 status:z.enum(["MISSING","READY","SUBMITTED","ACCEPTED","REJECTED","NOT_APPLICABLE"]),
 dueAt:z.coerce.date().nullable().optional(),
 notes:z.string().trim().max(5000).optional().default("")
});

const defaultRequirements:Record<(typeof supportTypes)[number],Array<[string,string]>>={
 STATE_HUMANITARIAN:[
  ["REQUEST","Ofício/solicitação municipal"],["NEEDS","Levantamento das necessidades e quantitativos"],
  ["AFFECTED","População/famílias afetadas"],["EVIDENCE","Relatório e evidências do evento"]
 ],
 STATE_EMERGENCY_INSPECTION:[
  ["REQUEST","Solicitação formal de vistoria"],["LOCATION","Localização e referência do ponto"],
  ["RISK","Descrição do risco e urgência"],["PHOTOS","Registro fotográfico/georreferenciado"]
 ],
 STATE_KIT_CHUVAS:[
  ["COMPDEC","Comprovação da COMPDEC formalizada"],["TRAINING","Comprovação de capacitação exigida"],
  ["SIDEC","Cadastro municipal no SIDEC"],["PLANCON","PLANCON com riscos, rotas, abrigos e procedimentos"],
  ["REQUEST","Solicitação formal do kit"]
 ],
 STATE_KIT_ESTIAGEM:[
  ["ELIGIBILITY","Comprovação dos requisitos da operação vigente"],["PLANCON","PLANCON/Operação Estiagem"],
  ["TRAINING","Capacitação aplicável"],["REQUEST","Solicitação formal do material"]
 ],
 STATE_KIT_FRIO:[
  ["VULNERABLE","Levantamento da população vulnerável"],["PLAN","Plano de atendimento para baixas temperaturas"],
  ["REQUEST","Solicitação formal dos materiais"]
 ],
 STATE_EMERGENCY_SUPPORT:[
  ["INCIDENT","Caracterização do desastre"],["NEEDS","Necessidades de apoio"],["PHOTOS","Evidências e fotos"],
  ["REQUEST","Solicitação formal"]
 ],
 STATE_WORKS:[
  ["MUNICIPAL_REPORT","Relatório da Defesa Civil Municipal"],["BUDGET","Planilha orçamentária"],
  ["PUBLIC_DOMAIN","Declaração de domínio público"],["POPULATION","Declaração indicativa de população"],
  ["TECHNICAL_SOLUTION","Solução/projeto técnico"],["WORK_PLAN","Plano de trabalho"]
 ],
 STATE_EQUIPMENT_CONVENTION:[
  ["NEEDS","Justificativa e necessidade de aparelhamento"],["COMPDEC","Regularidade da COMPDEC"],
  ["WORK_PLAN","Plano de trabalho"],["REQUEST","Ofício de solicitação"]
 ],
 FEDERAL_RECOGNITION:[
  ["FIDE","FIDE preenchido"],["DMATE","DMATE preenchida"],["PHOTO_REPORT","Relatório fotográfico datado e georreferenciado"],
  ["DECREE","Decreto municipal de SE/ECP"],["OFFICIAL_REQUEST","Ofício requerendo reconhecimento"],["TECH_REPORT","Relatórios/laudos comprobatórios"]
 ],
 FEDERAL_ASSISTANCE:[
  ["RECOGNITION","Processo de reconhecimento vinculado"],["BANK_DATA","Dados bancários"],
  ["REQUEST_FORM","Formulário de solicitação de recursos"],["HUMAN_DAMAGE","Danos humanos"],
  ["GOALS_ITEMS","Metas e itens da solicitação"],["OFFICIAL_REQUEST","Ofício/termo de solicitação"]
 ],
 FEDERAL_RESTORATION:[
  ["RECOGNITION","Reconhecimento federal vinculado"],["DAMAGE_REPORT","Relatório dos serviços essenciais afetados"],
  ["WORK_PLAN","Plano de trabalho/restabelecimento"],["BUDGET","Orçamento/quantitativos"],["EVIDENCE","Evidências dos danos"]
 ],
 FEDERAL_RECONSTRUCTION:[
  ["RECOGNITION","Reconhecimento federal vinculado"],["ENGINEERING","Projeto/solução de engenharia"],
  ["WORK_PLAN","Plano de trabalho"],["BUDGET","Orçamento"],["OWNERSHIP","Comprovação de domínio/competência"],["EVIDENCE","Evidências dos danos"]
 ],
 FEDERAL_HOUSING:[
  ["RECOGNITION","Reconhecimento federal vinculado"],["HOUSEHOLDS","Cadastro das famílias/habitações atingidas"],
  ["DAMAGE","Caracterização dos danos habitacionais"],["DOCUMENTS","Documentação exigida pelo programa"]
 ],
 FEDERAL_WATER_SUPPLY:[
  ["ELIGIBILITY","Comprovação da situação de escassez/desastre"],["COMMUNITIES","Comunidades/localidades atendidas"],
  ["ROUTES","Rotas/pontos de abastecimento"],["REQUEST","Solicitação formal"]
 ],
 MUTUAL_AID:[
  ["PARTNER","Parceiro/acordo de ajuda mútua"],["RESOURCE","Recursos/capacidades solicitadas"],
  ["MOBILIZATION","Condições de mobilização"],["REIMBURSEMENT","Responsabilidades e reembolso"]
 ],
 OTHER:[["REQUEST","Solicitação e documentação básica"]]
};

const statusTransitions:Record<string,string[]>={
 DRAFT:["DOCUMENTING","CANCELLED"],
 DOCUMENTING:["READY_TO_SUBMIT","CANCELLED"],
 READY_TO_SUBMIT:["SUBMITTED","DOCUMENTING","CANCELLED"],
 SUBMITTED:["UNDER_REVIEW","REQUIREMENTS","APPROVED","PARTIAL_APPROVED","REJECTED","CANCELLED"],
 UNDER_REVIEW:["REQUIREMENTS","APPROVED","PARTIAL_APPROVED","REJECTED"],
 REQUIREMENTS:["UNDER_REVIEW","SUBMITTED","REJECTED","CANCELLED"],
 APPROVED:["EXECUTION","CLOSED"],
 PARTIAL_APPROVED:["EXECUTION","REQUIREMENTS","CLOSED"],
 EXECUTION:["CLOSED","REQUIREMENTS"],
 REJECTED:["DOCUMENTING","CLOSED"],
 CLOSED:[],
 CANCELLED:[]
};

const courseInput=z.object({
 code:z.string().trim().min(2).max(80),title:z.string().trim().min(3).max(300),
 provider:z.string().trim().max(300).optional().default(""),
 category:z.enum(["SIDEC","S2ID","PLANCON","SCO","FIELD_INSPECTION","ALERTS","RADIO","FIRST_AID","FIRE","LOGISTICS","HUMANITARIAN","OTHER"]).default("OTHER"),
 workloadHours:z.number().nonnegative().max(10000).optional(),
 validityMonths:z.number().int().positive().max(240).optional(),
 mandatory:z.boolean().default(false)
});
const trainingRecordInput=z.object({
 courseId:z.string().uuid(),personType:z.enum(["USER","VOLUNTEER"]),personId:z.string().uuid(),
 completedAt:z.coerce.date(),expiresAt:z.coerce.date().optional(),
 certificateNumber:z.string().trim().max(150).optional().default(""),
 certificateReference:z.string().trim().max(2000).optional().default(""),
 notes:z.string().trim().max(5000).optional().default("")
});

const agreementInput=z.object({
 partnerName:z.string().trim().min(2).max(300),
 partnerType:z.enum(["MUNICIPALITY","STATE","FEDERAL","FIRE_DEPARTMENT","NGO","PRIVATE","UTILITY","OTHER"]),
 agreementReference:z.string().trim().max(200).optional().default(""),
 startsAt:z.coerce.date().optional(),endsAt:z.coerce.date().optional(),
 status:z.enum(["DRAFT","ACTIVE","SUSPENDED","EXPIRED","CLOSED"]).default("DRAFT"),
 liabilityTerms:z.string().trim().max(8000).optional().default(""),
 reimbursementTerms:z.string().trim().max(8000).optional().default(""),
 contacts:z.array(z.string().trim().min(1).max(500)).max(100).default([]),
 capabilities:z.array(z.string().trim().min(1).max(500)).max(200).default([]),
 notes:z.string().trim().max(8000).optional().default("")
});
const mutualResourceInput=z.object({
 resourceType:z.enum(["PERSONNEL","TEAM","VEHICLE","EQUIPMENT","FACILITY","SUPPLY","SERVICE","OTHER"]),
 resourceName:z.string().trim().min(2).max(300),capabilityType:z.string().trim().max(300).optional().default(""),
 quantity:z.number().nonnegative().max(1000000).optional(),unit:z.string().trim().max(40).optional().default(""),
 leadTimeMinutes:z.number().int().nonnegative().max(1000000).optional(),
 availabilityNotes:z.string().trim().max(4000).optional().default("")
});

const seasonalInput=z.object({
 code:z.string().trim().min(2).max(80),title:z.string().trim().min(3).max(300),
 operationType:z.enum(["CHUVAS","ESTIAGEM","FRIO","RESSACA","INCENDIOS","EVENTOS_EXTREMOS","MASS_EVENT","OTHER"]),
 planId:z.string().uuid().optional(),startsAt:z.coerce.date(),endsAt:z.coerce.date(),
 objective:z.string().trim().max(8000).optional().default(""),coordinator:z.string().trim().max(300).optional().default(""),
 notes:z.string().trim().max(8000).optional().default("")
});
const seasonalStatus=z.object({status:z.enum(["PLANNED","ACTIVE","SUSPENDED","CLOSED"])});
const seasonalItem=z.object({title:z.string().trim().min(3).max(1000),frequency:z.enum(["ONCE","SHIFT","DAILY","WEEKLY","EVENT"]).default("ONCE"),required:z.boolean().default(true)});
const seasonalEvent=z.object({status:z.enum(["DONE","NOT_APPLICABLE","REOPENED"]),notes:z.string().trim().max(4000).optional().default("")});

const exerciseInput=z.object({
 code:z.string().trim().min(2).max(80),title:z.string().trim().min(3).max(300),
 exerciseType:z.enum(["TABLETOP","DRILL","FUNCTIONAL","FULL_SCALE","SEMINAR","WORKSHOP"]),
 planId:z.string().uuid().optional(),seasonalOperationId:z.string().uuid().optional(),
 scenario:z.string().trim().min(10).max(12000),objectives:z.array(z.string().trim().min(2).max(1000)).max(100).default([]),
 scheduledAt:z.coerce.date(),evaluator:z.string().trim().max(300).optional().default(""),notes:z.string().trim().max(8000).optional().default("")
});
const exerciseStatus=z.object({status:z.enum(["PLANNED","RUNNING","COMPLETED","CANCELLED"])});
const evaluationInput=z.object({
 capability:z.string().trim().min(2).max(300),objective:z.string().trim().min(2).max(1000),
 target:z.string().trim().max(1000).optional().default(""),result:z.enum(["MET","PARTIAL","NOT_MET","OBSERVATION"]),
 evidence:z.string().trim().max(8000).optional().default(""),notes:z.string().trim().max(8000).optional().default("")
});
const improvementInput=z.object({
 title:z.string().trim().min(3).max(500),correctiveAction:z.string().trim().min(5).max(8000),
 ownerUserId:z.string().uuid().optional(),dueAt:z.coerce.date().optional(),notes:z.string().trim().max(8000).optional().default("")
});
const improvementUpdate=z.object({status:z.enum(["OPEN","IN_PROGRESS","DONE","VERIFIED","CANCELLED"]),notes:z.string().trim().max(8000).optional().default("")});

export async function resilienceRoutes(app:FastifyInstance){
 app.get("/api/v1/resilience/summary",{preHandler:requirePermission("support_requests.manage")},async request=>{
  const o=org(request);
  const r=await db.query(`SELECT
   (SELECT count(*) FROM external_support_requests WHERE organization_id=$1 AND status NOT IN ('CLOSED','CANCELLED','REJECTED'))::int AS "openRequests",
   (SELECT count(*) FROM external_support_requirements WHERE organization_id=$1 AND status IN ('MISSING','REJECTED'))::int AS "missingRequirements",
   (SELECT count(*) FROM training_records WHERE organization_id=$1 AND expires_at IS NOT NULL AND expires_at<=current_date+30)::int AS "trainingDue",
   (SELECT count(*) FROM mutual_aid_agreements WHERE organization_id=$1 AND status='ACTIVE')::int AS "activeAgreements",
   (SELECT count(*) FROM seasonal_operations WHERE organization_id=$1 AND status='ACTIVE')::int AS "activeSeasonalOperations",
   (SELECT count(*) FROM preparedness_exercises WHERE organization_id=$1 AND status IN ('PLANNED','RUNNING'))::int AS "openExercises",
   (SELECT count(*) FROM exercise_improvement_actions WHERE organization_id=$1 AND status IN ('OPEN','IN_PROGRESS'))::int AS "openImprovements"`,[o]);
  return r.rows[0];
 });

 app.get("/api/v1/support-requests",{preHandler:requirePermission("support_requests.manage")},async request=>{
  const o=org(request);
  const r=await db.query(`SELECT s.id,s.scope,s.service_type AS "serviceType",s.cobrade_code AS "cobradeCode",s.title,s.summary,s.status,
    s.external_system AS "externalSystem",s.external_protocol AS "externalProtocol",s.reference_url AS "referenceUrl",
    s.requested_amount::float8 AS "requestedAmount",s.approved_amount::float8 AS "approvedAmount",
    s.deadline_at AS "deadlineAt",s.submitted_at AS "submittedAt",s.approved_at AS "approvedAt",
    s.created_at AS "createdAt",s.updated_at AS "updatedAt",i.protocol AS "incidentProtocol",
    u.matricula AS "createdByMatricula",u.display_name AS "createdByName",
    ru.matricula AS "responsibleMatricula",ru.display_name AS "responsibleName",
    count(rq.id)::int AS "requirementCount",
    count(rq.id) FILTER(WHERE rq.status IN ('MISSING','REJECTED'))::int AS "pendingRequirements"
    FROM external_support_requests s
    JOIN users u ON u.id=s.created_by LEFT JOIN users ru ON ru.id=s.responsible_user_id
    LEFT JOIN incidents i ON i.id=s.incident_id LEFT JOIN external_support_requirements rq ON rq.request_id=s.id
    WHERE s.organization_id=$1
    GROUP BY s.id,i.protocol,u.matricula,u.display_name,ru.matricula,ru.display_name
    ORDER BY s.updated_at DESC`,[o]);
  return {items:r.rows};
 });

 app.post("/api/v1/support-requests",{preHandler:requirePermission("support_requests.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),m=await matricula(request),p=supportInput.safeParse(request.body);
  if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const v=p.data;let incidentId:string|null=null;
  if(v.incidentProtocol){
   const i=await db.query("SELECT id FROM incidents WHERE organization_id=$1 AND protocol=$2",[o,v.incidentProtocol]);
   if(!i.rows[0])return reply.code(404).send({error:"INCIDENT_NOT_FOUND"});
   incidentId=i.rows[0].id;
  }
  if(v.anomalyCaseId){
   const c=await db.query("SELECT id FROM abnormal_situation_cases WHERE id=$1 AND organization_id=$2",[v.anomalyCaseId,o]);
   if(!c.rows[0])return reply.code(404).send({error:"ANOMALY_CASE_NOT_FOUND"});
  }
  const client=await db.connect();
  try{
   await client.query("BEGIN");
   const r=await client.query(`INSERT INTO external_support_requests(
    organization_id,scope,service_type,incident_id,anomaly_case_id,cobrade_code,title,summary,external_system,reference_url,
    requested_amount,deadline_at,responsible_user_id,created_by
   ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
   RETURNING id,status,created_at AS "createdAt"`,[
    o,v.scope,v.serviceType,incidentId,v.anomalyCaseId??null,v.cobradeCode||null,v.title,v.summary,v.externalSystem||null,
    v.referenceUrl||null,v.requestedAmount??null,v.deadlineAt??null,v.responsibleUserId??a.userId,a.userId
   ]);
   const requestId=r.rows[0].id;
   const defs=defaultRequirements[v.serviceType]??[];
   for(const [code,title] of defs){
    await client.query(`INSERT INTO external_support_requirements(organization_id,request_id,code,title,created_by)
     VALUES($1,$2,$3,$4,$5) ON CONFLICT(request_id,code) DO NOTHING`,[o,requestId,code,title,a.userId]);
   }
   await client.query(`INSERT INTO external_support_events(
    organization_id,request_id,event_type,to_status,notes,actor_user_id,actor_matricula)
    VALUES($1,$2,'CREATED','DRAFT',$3,$4,$5)`,[o,requestId,"Solicitação criada",a.userId,m]);
   await client.query("COMMIT");return reply.code(201).send(r.rows[0]);
  }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
 });

 app.patch("/api/v1/support-requests/:id",{preHandler:requirePermission("support_requests.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),m=await matricula(request),{id}=request.params as {id:string},p=supportUpdate.safeParse(request.body);
  if(!uuid.safeParse(id).success||!p.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const current=await db.query("SELECT * FROM external_support_requests WHERE id=$1 AND organization_id=$2",[id,o]);
  const row=current.rows[0];if(!row)return reply.code(404).send({error:"NOT_FOUND"});
  const next=p.data.status;
  if(row.status!==next&&!statusTransitions[row.status]?.includes(next))return reply.code(409).send({error:"INVALID_TRANSITION",from:row.status,to:next});
  if(next==="READY_TO_SUBMIT"){
   const pending=await db.query("SELECT count(*)::int AS count FROM external_support_requirements WHERE request_id=$1 AND required=true AND status NOT IN ('READY','SUBMITTED','ACCEPTED','NOT_APPLICABLE')",[id]);
   if(Number(pending.rows[0]?.count??0)>0)return reply.code(409).send({error:"REQUIREMENTS_PENDING",count:pending.rows[0].count});
  }
  const v=p.data;
  const r=await db.query(`UPDATE external_support_requests SET status=$3,
    external_protocol=COALESCE($4,external_protocol),approved_amount=COALESCE($5,approved_amount),
    deadline_at=COALESCE($6,deadline_at),
    submitted_at=CASE WHEN $3='SUBMITTED' THEN COALESCE(submitted_at,now()) ELSE submitted_at END,
    approved_at=CASE WHEN $3 IN ('APPROVED','PARTIAL_APPROVED') THEN COALESCE(approved_at,now()) ELSE approved_at END,
    updated_at=now() WHERE id=$1 AND organization_id=$2
    RETURNING id,status,external_protocol AS "externalProtocol",updated_at AS "updatedAt"`,[
    id,o,next,v.externalProtocol??null,v.approvedAmount??null,v.deadlineAt??null
   ]);
  await db.query(`INSERT INTO external_support_events(
   organization_id,request_id,event_type,from_status,to_status,notes,external_protocol,amount,actor_user_id,actor_matricula)
   VALUES($1,$2,'STATUS_CHANGED',$3,$4,$5,$6,$7,$8,$9)`,[
   o,id,row.status,next,v.notes||null,v.externalProtocol??null,v.approvedAmount??null,a.userId,m
  ]);
  return r.rows[0];
 });

 app.get("/api/v1/support-requests/:id",{preHandler:requirePermission("support_requests.manage")},async(request,reply)=>{
  const o=org(request),{id}=request.params as {id:string};
  if(!uuid.safeParse(id).success)return reply.code(400).send({error:"INVALID_ID"});
  const [record,requirements,events]=await Promise.all([
   db.query(`SELECT s.*,i.protocol AS "incidentProtocol",u.display_name AS "createdByName",u.matricula AS "createdByMatricula",
     ru.display_name AS "responsibleName",ru.matricula AS "responsibleMatricula"
     FROM external_support_requests s JOIN users u ON u.id=s.created_by LEFT JOIN users ru ON ru.id=s.responsible_user_id
     LEFT JOIN incidents i ON i.id=s.incident_id WHERE s.id=$1 AND s.organization_id=$2`,[id,o]),
   db.query(`SELECT id,code,title,required,status,due_at AS "dueAt",notes,created_at AS "createdAt",updated_at AS "updatedAt"
     FROM external_support_requirements WHERE request_id=$1 AND organization_id=$2 ORDER BY required DESC,code`,[id,o]),
   db.query(`SELECT e.id::text AS id,e.event_type AS "eventType",e.from_status AS "fromStatus",e.to_status AS "toStatus",
     e.notes,e.external_protocol AS "externalProtocol",e.amount::float8 AS amount,e.actor_matricula AS "actorMatricula",
     u.display_name AS "actorName",e.occurred_at AS "occurredAt"
     FROM external_support_events e JOIN users u ON u.id=e.actor_user_id
     WHERE e.request_id=$1 AND e.organization_id=$2 ORDER BY e.occurred_at DESC,e.id DESC`,[id,o])
  ]);
  if(!record.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  return {item:record.rows[0],requirements:requirements.rows,events:events.rows};
 });

 app.post("/api/v1/support-requests/:id/requirements",{preHandler:requirePermission("support_requests.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),m=await matricula(request),{id}=request.params as {id:string},p=reqInput.safeParse(request.body);
  if(!uuid.safeParse(id).success||!p.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const parent=await db.query("SELECT id FROM external_support_requests WHERE id=$1 AND organization_id=$2",[id,o]);
  if(!parent.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const v=p.data;
  try{
   const r=await db.query(`INSERT INTO external_support_requirements(
    organization_id,request_id,code,title,required,due_at,notes,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,code,status`,[o,id,v.code,v.title,v.required,v.dueAt??null,v.notes||null,a.userId]);
   await db.query(`INSERT INTO external_support_events(organization_id,request_id,event_type,notes,actor_user_id,actor_matricula)
    VALUES($1,$2,'REQUIREMENT_ADDED',$3,$4,$5)`,[o,id,v.code+" · "+v.title,a.userId,m]);
   return reply.code(201).send(r.rows[0]);
  }catch(e:any){if(e?.code==="23505")return reply.code(409).send({error:"REQUIREMENT_EXISTS"});throw e}
 });

 app.patch("/api/v1/support-requests/:requestId/requirements/:requirementId",{preHandler:requirePermission("support_requests.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),m=await matricula(request),{requestId,requirementId}=request.params as {requestId:string;requirementId:string},p=reqUpdate.safeParse(request.body);
  if(!uuid.safeParse(requestId).success||!uuid.safeParse(requirementId).success||!p.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const v=p.data;
  const r=await db.query(`UPDATE external_support_requirements SET status=$4,due_at=COALESCE($5,due_at),
    notes=CASE WHEN $6<>'' THEN $6 ELSE notes END,updated_by=$7,updated_at=now()
    WHERE id=$1 AND request_id=$2 AND organization_id=$3
    RETURNING id,code,title,status,due_at AS "dueAt",updated_at AS "updatedAt"`,[
    requirementId,requestId,o,v.status,v.dueAt??null,v.notes,a.userId
  ]);
  if(!r.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  await db.query(`INSERT INTO external_support_events(organization_id,request_id,event_type,notes,actor_user_id,actor_matricula)
   VALUES($1,$2,'REQUIREMENT_UPDATED',$3,$4,$5)`,[o,requestId,r.rows[0].code+" → "+v.status+(v.notes?" · "+v.notes:""),a.userId,m]);
  return r.rows[0];
 });

 app.get("/api/v1/training/courses",{preHandler:requirePermission("training.manage")},async request=>{
  const o=org(request);
  const r=await db.query(`SELECT id,code,title,provider,category,workload_hours::float8 AS "workloadHours",
   validity_months AS "validityMonths",mandatory,active,created_at AS "createdAt"
   FROM training_courses WHERE organization_id=$1 ORDER BY active DESC,mandatory DESC,title`,[o]);
  return {items:r.rows};
 });

 app.post("/api/v1/training/courses",{preHandler:requirePermission("training.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),p=courseInput.safeParse(request.body);
  if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const v=p.data;
  const r=await db.query(`INSERT INTO training_courses(
   organization_id,code,title,provider,category,workload_hours,validity_months,mandatory,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
   ON CONFLICT(organization_id,code) DO UPDATE SET title=EXCLUDED.title,provider=EXCLUDED.provider,
    category=EXCLUDED.category,workload_hours=EXCLUDED.workload_hours,validity_months=EXCLUDED.validity_months,
    mandatory=EXCLUDED.mandatory,active=true
   RETURNING id,code,title`,[o,v.code,v.title,v.provider||null,v.category,v.workloadHours??null,v.validityMonths??null,v.mandatory,a.userId]);
  return reply.code(201).send(r.rows[0]);
 });

 app.get("/api/v1/training/people",{preHandler:requirePermission("training.manage")},async request=>{
  const o=org(request);
  const [users,volunteers]=await Promise.all([
   db.query("SELECT id,matricula,display_name AS name,'USER' AS type FROM users WHERE organization_id=$1 AND active=true ORDER BY display_name",[o]),
   db.query("SELECT id,NULL::text AS matricula,full_name AS name,'VOLUNTEER' AS type FROM volunteers WHERE organization_id=$1 AND status='ACTIVE' ORDER BY full_name",[o])
  ]);
  return {items:[...users.rows,...volunteers.rows]};
 });

 app.get("/api/v1/training/records",{preHandler:requirePermission("training.manage")},async request=>{
  const o=org(request);
  const r=await db.query(`SELECT r.id,r.person_type AS "personType",r.completed_at AS "completedAt",r.expires_at AS "expiresAt",
    r.certificate_number AS "certificateNumber",r.certificate_reference AS "certificateReference",r.notes,
    c.id AS "courseId",c.code AS "courseCode",c.title AS "courseTitle",c.category,c.mandatory,
    COALESCE(u.display_name,v.full_name) AS "personName",u.matricula,
    CASE WHEN r.expires_at IS NULL THEN 'VALID' WHEN r.expires_at<current_date THEN 'EXPIRED'
         WHEN r.expires_at<=current_date+30 THEN 'EXPIRING' ELSE 'VALID' END AS status
    FROM training_records r JOIN training_courses c ON c.id=r.course_id
    LEFT JOIN users u ON u.id=r.user_id LEFT JOIN volunteers v ON v.id=r.volunteer_id
    WHERE r.organization_id=$1 ORDER BY COALESCE(r.expires_at,'9999-12-31'::date),c.title`,[o]);
  return {items:r.rows};
 });

 app.post("/api/v1/training/records",{preHandler:requirePermission("training.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),p=trainingRecordInput.safeParse(request.body);
  if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const v=p.data;
  const course=await db.query("SELECT validity_months FROM training_courses WHERE id=$1 AND organization_id=$2 AND active=true",[v.courseId,o]);
  if(!course.rows[0])return reply.code(404).send({error:"COURSE_NOT_FOUND"});
  if(v.personType==="USER"){
   const person=await db.query("SELECT id FROM users WHERE id=$1 AND organization_id=$2",[v.personId,o]);if(!person.rows[0])return reply.code(404).send({error:"PERSON_NOT_FOUND"});
  }else{
   const person=await db.query("SELECT id FROM volunteers WHERE id=$1 AND organization_id=$2",[v.personId,o]);if(!person.rows[0])return reply.code(404).send({error:"PERSON_NOT_FOUND"});
  }
  let expires=v.expiresAt??null;
  if(!expires&&course.rows[0].validity_months){
   expires=new Date(v.completedAt);expires.setUTCMonth(expires.getUTCMonth()+Number(course.rows[0].validity_months));
  }
  const r=await db.query(`INSERT INTO training_records(
   organization_id,course_id,person_type,user_id,volunteer_id,completed_at,expires_at,certificate_number,certificate_reference,notes,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
   RETURNING id,completed_at AS "completedAt",expires_at AS "expiresAt"`,[
   o,v.courseId,v.personType,v.personType==="USER"?v.personId:null,v.personType==="VOLUNTEER"?v.personId:null,
   v.completedAt,expires,v.certificateNumber||null,v.certificateReference||null,v.notes||null,a.userId
  ]);
  return reply.code(201).send(r.rows[0]);
 });

 app.get("/api/v1/mutual-aid",{preHandler:requirePermission("mutual_aid.manage")},async request=>{
  const o=org(request);
  const r=await db.query(`SELECT a.id,a.partner_name AS "partnerName",a.partner_type AS "partnerType",a.agreement_reference AS "agreementReference",
    a.starts_at AS "startsAt",a.ends_at AS "endsAt",a.status,a.liability_terms AS "liabilityTerms",a.reimbursement_terms AS "reimbursementTerms",
    a.contacts,a.capabilities,a.notes,a.created_at AS "createdAt",
    count(r.id)::int AS "resourceCount"
    FROM mutual_aid_agreements a LEFT JOIN mutual_aid_resources r ON r.agreement_id=a.id AND r.active=true
    WHERE a.organization_id=$1 GROUP BY a.id ORDER BY a.status,a.partner_name`,[o]);
  return {items:r.rows};
 });

 app.post("/api/v1/mutual-aid",{preHandler:requirePermission("mutual_aid.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),p=agreementInput.safeParse(request.body);
  if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const v=p.data;
  if(v.startsAt&&v.endsAt&&v.endsAt<=v.startsAt)return reply.code(400).send({error:"INVALID_PERIOD"});
  const r=await db.query(`INSERT INTO mutual_aid_agreements(
   organization_id,partner_name,partner_type,agreement_reference,starts_at,ends_at,status,liability_terms,reimbursement_terms,contacts,capabilities,notes,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13)
   RETURNING id,status,created_at AS "createdAt"`,[
   o,v.partnerName,v.partnerType,v.agreementReference||null,v.startsAt??null,v.endsAt??null,v.status,v.liabilityTerms||null,
   v.reimbursementTerms||null,JSON.stringify(v.contacts),JSON.stringify(v.capabilities),v.notes||null,a.userId
  ]);
  return reply.code(201).send(r.rows[0]);
 });

 app.get("/api/v1/mutual-aid/:id/resources",{preHandler:requirePermission("mutual_aid.manage")},async(request,reply)=>{
  const o=org(request),{id}=request.params as {id:string};if(!uuid.safeParse(id).success)return reply.code(400).send({error:"INVALID_ID"});
  const r=await db.query(`SELECT r.id,r.resource_type AS "resourceType",r.resource_name AS "resourceName",r.capability_type AS "capabilityType",
    r.quantity::float8 AS quantity,r.unit,r.lead_time_minutes AS "leadTimeMinutes",r.availability_notes AS "availabilityNotes",r.active
    FROM mutual_aid_resources r JOIN mutual_aid_agreements a ON a.id=r.agreement_id
    WHERE r.agreement_id=$1 AND r.organization_id=$2 AND a.organization_id=$2 ORDER BY r.active DESC,r.resource_type,r.resource_name`,[id,o]);
  return {items:r.rows};
 });

 app.post("/api/v1/mutual-aid/:id/resources",{preHandler:requirePermission("mutual_aid.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),{id}=request.params as {id:string},p=mutualResourceInput.safeParse(request.body);
  if(!uuid.safeParse(id).success||!p.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const agreement=await db.query("SELECT id FROM mutual_aid_agreements WHERE id=$1 AND organization_id=$2",[id,o]);if(!agreement.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const v=p.data;
  const r=await db.query(`INSERT INTO mutual_aid_resources(
   organization_id,agreement_id,resource_type,resource_name,capability_type,quantity,unit,lead_time_minutes,availability_notes,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,[
   o,id,v.resourceType,v.resourceName,v.capabilityType||null,v.quantity??null,v.unit||null,v.leadTimeMinutes??null,v.availabilityNotes||null,a.userId
  ]);
  return reply.code(201).send(r.rows[0]);
 });

 app.get("/api/v1/seasonal-operations",{preHandler:requirePermission("seasonal_operations.manage")},async request=>{
  const o=org(request);
  const r=await db.query(`SELECT s.id,s.code,s.title,s.operation_type AS "operationType",s.starts_at AS "startsAt",s.ends_at AS "endsAt",
    s.status,s.objective,s.coordinator,s.notes,s.created_at AS "createdAt",p.code AS "planCode",p.version AS "planVersion",
    count(i.id)::int AS "checklistCount"
    FROM seasonal_operations s LEFT JOIN contingency_plans p ON p.id=s.plan_id
    LEFT JOIN seasonal_checklist_items i ON i.operation_id=s.id
    WHERE s.organization_id=$1 GROUP BY s.id,p.code,p.version ORDER BY s.starts_at DESC`,[o]);
  return {items:r.rows};
 });

 app.post("/api/v1/seasonal-operations",{preHandler:requirePermission("seasonal_operations.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),p=seasonalInput.safeParse(request.body);
  if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const v=p.data;if(v.endsAt<=v.startsAt)return reply.code(400).send({error:"INVALID_PERIOD"});
  if(v.planId){const plan=await db.query("SELECT id FROM contingency_plans WHERE id=$1 AND organization_id=$2",[v.planId,o]);if(!plan.rows[0])return reply.code(404).send({error:"PLAN_NOT_FOUND"});}
  try{
   const r=await db.query(`INSERT INTO seasonal_operations(
    organization_id,code,title,operation_type,plan_id,starts_at,ends_at,objective,coordinator,notes,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,status`,[
    o,v.code,v.title,v.operationType,v.planId??null,v.startsAt,v.endsAt,v.objective||null,v.coordinator||null,v.notes||null,a.userId
   ]);
   return reply.code(201).send(r.rows[0]);
  }catch(e:any){if(e?.code==="23505")return reply.code(409).send({error:"CODE_EXISTS"});throw e}
 });

 app.patch("/api/v1/seasonal-operations/:id/status",{preHandler:requirePermission("seasonal_operations.manage")},async(request,reply)=>{
  const o=org(request),{id}=request.params as {id:string},p=seasonalStatus.safeParse(request.body);
  if(!uuid.safeParse(id).success||!p.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const r=await db.query("UPDATE seasonal_operations SET status=$3,updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING id,status",[id,o,p.data.status]);
  if(!r.rows[0])return reply.code(404).send({error:"NOT_FOUND"});return r.rows[0];
 });

 app.get("/api/v1/seasonal-operations/:id/checklist",{preHandler:requirePermission("seasonal_operations.manage")},async(request,reply)=>{
  const o=org(request),{id}=request.params as {id:string};if(!uuid.safeParse(id).success)return reply.code(400).send({error:"INVALID_ID"});
  const r=await db.query(`SELECT i.id,i.sequence_no AS "sequenceNo",i.title,i.frequency,i.required,
    e.status AS "latestStatus",e.notes AS "latestNotes",e.actor_matricula AS "latestActorMatricula",e.occurred_at AS "latestAt"
    FROM seasonal_checklist_items i LEFT JOIN LATERAL(
      SELECT status,notes,actor_matricula,occurred_at FROM seasonal_checklist_events
      WHERE item_id=i.id ORDER BY occurred_at DESC,id DESC LIMIT 1
    ) e ON true
    WHERE i.operation_id=$1 AND i.organization_id=$2 ORDER BY i.sequence_no`,[id,o]);
  return {items:r.rows};
 });

 app.post("/api/v1/seasonal-operations/:id/checklist",{preHandler:requirePermission("seasonal_operations.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),{id}=request.params as {id:string},p=seasonalItem.safeParse(request.body);
  if(!uuid.safeParse(id).success||!p.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const parent=await db.query("SELECT id FROM seasonal_operations WHERE id=$1 AND organization_id=$2",[id,o]);if(!parent.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const v=p.data;
  const r=await db.query(`INSERT INTO seasonal_checklist_items(organization_id,operation_id,sequence_no,title,frequency,required,created_by)
    SELECT $1,$2,COALESCE(max(sequence_no),0)+1,$3,$4,$5,$6 FROM seasonal_checklist_items WHERE operation_id=$2
    RETURNING id,sequence_no AS "sequenceNo"`,[o,id,v.title,v.frequency,v.required,a.userId]);
  return reply.code(201).send(r.rows[0]);
 });

 app.post("/api/v1/seasonal-operations/:operationId/checklist/:itemId/events",{preHandler:requirePermission("seasonal_operations.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),m=await matricula(request),{operationId,itemId}=request.params as {operationId:string;itemId:string},p=seasonalEvent.safeParse(request.body);
  if(!uuid.safeParse(operationId).success||!uuid.safeParse(itemId).success||!p.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const item=await db.query("SELECT id FROM seasonal_checklist_items WHERE id=$1 AND operation_id=$2 AND organization_id=$3",[itemId,operationId,o]);if(!item.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const r=await db.query(`INSERT INTO seasonal_checklist_events(
    organization_id,operation_id,item_id,status,notes,actor_user_id,actor_matricula)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id::text AS id,status,occurred_at AS "occurredAt"`,[
    o,operationId,itemId,p.data.status,p.data.notes||null,a.userId,m
  ]);
  return reply.code(201).send(r.rows[0]);
 });

 app.get("/api/v1/exercises",{preHandler:requirePermission("exercises.manage")},async request=>{
  const o=org(request);
  const r=await db.query(`SELECT e.id,e.code,e.title,e.exercise_type AS "exerciseType",e.scenario,e.objectives,e.scheduled_at AS "scheduledAt",
    e.started_at AS "startedAt",e.ended_at AS "endedAt",e.status,e.evaluator,e.notes,e.created_at AS "createdAt",
    p.code AS "planCode",p.version AS "planVersion",s.code AS "seasonalCode",
    (SELECT count(*)::int FROM exercise_evaluations v WHERE v.exercise_id=e.id) AS "evaluationCount",
    (SELECT count(*)::int FROM exercise_improvement_actions a WHERE a.exercise_id=e.id AND a.status IN ('OPEN','IN_PROGRESS')) AS "openActions"
    FROM preparedness_exercises e LEFT JOIN contingency_plans p ON p.id=e.plan_id
    LEFT JOIN seasonal_operations s ON s.id=e.seasonal_operation_id
    WHERE e.organization_id=$1 ORDER BY e.scheduled_at DESC`,[o]);
  return {items:r.rows};
 });

 app.post("/api/v1/exercises",{preHandler:requirePermission("exercises.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),p=exerciseInput.safeParse(request.body);
  if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const v=p.data;
  try{
   const r=await db.query(`INSERT INTO preparedness_exercises(
    organization_id,code,title,exercise_type,plan_id,seasonal_operation_id,scenario,objectives,scheduled_at,evaluator,notes,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12) RETURNING id,status`,[
    o,v.code,v.title,v.exerciseType,v.planId??null,v.seasonalOperationId??null,v.scenario,JSON.stringify(v.objectives),v.scheduledAt,v.evaluator||null,v.notes||null,a.userId
   ]);
   return reply.code(201).send(r.rows[0]);
  }catch(e:any){if(e?.code==="23505")return reply.code(409).send({error:"CODE_EXISTS"});throw e}
 });

 app.patch("/api/v1/exercises/:id/status",{preHandler:requirePermission("exercises.manage")},async(request,reply)=>{
  const o=org(request),{id}=request.params as {id:string},p=exerciseStatus.safeParse(request.body);
  if(!uuid.safeParse(id).success||!p.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const status=p.data.status;
  const r=await db.query(`UPDATE preparedness_exercises SET status=$3,
    started_at=CASE WHEN $3='RUNNING' THEN COALESCE(started_at,now()) ELSE started_at END,
    ended_at=CASE WHEN $3='COMPLETED' THEN COALESCE(ended_at,now()) ELSE ended_at END,updated_at=now()
    WHERE id=$1 AND organization_id=$2 RETURNING id,status,started_at AS "startedAt",ended_at AS "endedAt"`,[id,o,status]);
  if(!r.rows[0])return reply.code(404).send({error:"NOT_FOUND"});return r.rows[0];
 });

 app.get("/api/v1/exercises/:id/review",{preHandler:requirePermission("exercises.manage")},async(request,reply)=>{
  const o=org(request),{id}=request.params as {id:string};if(!uuid.safeParse(id).success)return reply.code(400).send({error:"INVALID_ID"});
  const [evaluations,actions]=await Promise.all([
   db.query(`SELECT id,capability,objective,target,result,evidence,notes,created_at AS "createdAt"
    FROM exercise_evaluations WHERE exercise_id=$1 AND organization_id=$2 ORDER BY created_at`,[id,o]),
   db.query(`SELECT a.id,a.title,a.corrective_action AS "correctiveAction",a.due_at AS "dueAt",a.status,a.notes,
    u.display_name AS "ownerName",u.matricula AS "ownerMatricula",a.verified_at AS "verifiedAt",
    vu.display_name AS "verifiedByName",vu.matricula AS "verifiedByMatricula"
    FROM exercise_improvement_actions a LEFT JOIN users u ON u.id=a.owner_user_id LEFT JOIN users vu ON vu.id=a.verified_by
    WHERE a.exercise_id=$1 AND a.organization_id=$2 ORDER BY a.status,a.due_at NULLS LAST,a.created_at`,[id,o])
  ]);
  return {evaluations:evaluations.rows,actions:actions.rows};
 });

 app.post("/api/v1/exercises/:id/evaluations",{preHandler:requirePermission("exercises.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),{id}=request.params as {id:string},p=evaluationInput.safeParse(request.body);
  if(!uuid.safeParse(id).success||!p.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const ex=await db.query("SELECT id FROM preparedness_exercises WHERE id=$1 AND organization_id=$2",[id,o]);if(!ex.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const v=p.data;
  const r=await db.query(`INSERT INTO exercise_evaluations(
   organization_id,exercise_id,capability,objective,target,result,evidence,notes,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[
   o,id,v.capability,v.objective,v.target||null,v.result,v.evidence||null,v.notes||null,a.userId
  ]);
  return reply.code(201).send(r.rows[0]);
 });

 app.post("/api/v1/exercises/:id/improvements",{preHandler:requirePermission("exercises.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),{id}=request.params as {id:string},p=improvementInput.safeParse(request.body);
  if(!uuid.safeParse(id).success||!p.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const ex=await db.query("SELECT id FROM preparedness_exercises WHERE id=$1 AND organization_id=$2",[id,o]);if(!ex.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
  const v=p.data;
  const r=await db.query(`INSERT INTO exercise_improvement_actions(
   organization_id,exercise_id,title,corrective_action,owner_user_id,due_at,notes,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,status`,[
   o,id,v.title,v.correctiveAction,v.ownerUserId??null,v.dueAt??null,v.notes||null,a.userId
  ]);
  return reply.code(201).send(r.rows[0]);
 });

 app.patch("/api/v1/exercises/:exerciseId/improvements/:actionId",{preHandler:requirePermission("exercises.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),{exerciseId,actionId}=request.params as {exerciseId:string;actionId:string},p=improvementUpdate.safeParse(request.body);
  if(!uuid.safeParse(exerciseId).success||!uuid.safeParse(actionId).success||!p.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const v=p.data;
  const r=await db.query(`UPDATE exercise_improvement_actions SET status=$4,
    verified_by=CASE WHEN $4='VERIFIED' THEN $5 ELSE verified_by END,
    verified_at=CASE WHEN $4='VERIFIED' THEN COALESCE(verified_at,now()) ELSE verified_at END,
    notes=CASE WHEN $6<>'' THEN $6 ELSE notes END,updated_at=now()
    WHERE id=$1 AND exercise_id=$2 AND organization_id=$3
    RETURNING id,status,verified_at AS "verifiedAt"`,[actionId,exerciseId,o,v.status,a.userId,v.notes]);
  if(!r.rows[0])return reply.code(404).send({error:"NOT_FOUND"});return r.rows[0];
 });
}
