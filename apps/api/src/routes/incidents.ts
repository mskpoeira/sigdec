import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authFrom, requirePermission } from "../auth.js";
import { db } from "../db.js";
import { incidentProtocolParts } from "../lib/incident-protocol.js";

const prioritySchema = z.enum(["P1","P2","P3","P4","P5"]);
const sourceSchema = z.enum([
  "phone_199","phone_admin","radio","whatsapp","portal","walk_in","internal","other"
]);

const createIncidentSchema = z.object({
  typeId: z.string().uuid(),
  source: sourceSchema,
  summary: z.string().trim().min(5).max(240),
  description: z.string().trim().max(8000).optional(),
  priority: prioritySchema.optional(),
  riskToLife: z.boolean().default(false),
  callerName: z.string().trim().max(160).optional(),
  callerPhone: z.string().trim().max(40).optional(),
  addressLine: z.string().trim().max(300).optional(),
  neighborhood: z.string().trim().max(140).optional(),
  referencePoint: z.string().trim().max(300).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional()
}).refine(
  (data) => (data.latitude === undefined) === (data.longitude === undefined),
  { message: "Latitude e longitude devem ser informadas em conjunto." }
);

const listSchema = z.object({
  status: z.string().trim().max(40).optional(),
  priority: prioritySchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

const statusSchema = z.object({
  status: z.enum([
    "TRIAGE","WAITING_DISPATCH","DISPATCHED","EN_ROUTE","ON_SCENE",
    "IN_SERVICE","WAITING_SUPPORT","INSPECTION","MONITORING",
    "COMPLETED","CLOSED","CANCELLED","DUPLICATE"
  ]),
  note: z.string().trim().max(2000).optional()
});

const dispatchSchema = z.object({
  teamId: z.string().uuid(),
  vehicleId: z.string().uuid().optional(),
  notes: z.string().trim().max(2000).optional()
});

const dispatchStatusSchema = z.object({
  status: z.enum(["ACKNOWLEDGED", "EN_ROUTE", "ON_SCENE", "RELEASED", "CANCELLED"]),
  note: z.string().trim().max(2000).optional()
});

const civilActionSchema = z.object({
  incidentId: z.string().uuid().optional(),
  actionType: z.enum(["PREVENTION","PREPAREDNESS","MONITORING","INSPECTION","RESPONSE","HUMANITARIAN","TRAINING","RECOVERY","COMMUNICATION","OTHER"]),
  title: z.string().trim().min(3).max(240),
  description: z.string().trim().max(8000).optional(),
  startedAt: z.coerce.date().optional(),
  endedAt: z.coerce.date().optional(),
  addressLine: z.string().trim().max(300).optional(),
  neighborhood: z.string().trim().max(140).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  participantsCount: z.number().int().min(0).max(100000).default(0)
}).refine(v=>(v.latitude===undefined)===(v.longitude===undefined),{message:"Latitude e longitude devem ser informadas em conjunto."});

const supportRequestSchema = z.object({
  incidentId: z.string().uuid().optional(),
  requestType: z.enum(["HUMANITARIAN_AID","EMERGENCY_INSPECTION","STATE_SUPPORT","LOGISTICS","EQUIPMENT","OTHER"]),
  destination: z.string().trim().max(160).optional(),
  justification: z.string().trim().min(5).max(12000),
  requestedItems: z.array(z.object({name:z.string().trim().min(2).max(160),quantity:z.number().positive().optional(),unit:z.string().trim().max(40).optional()})).max(100).default([]),
  externalProtocol: z.string().trim().max(160).optional()
});

const supportStatusSchema = z.object({
  status: z.enum(["SUBMITTED","IN_ANALYSIS","APPROVED","REJECTED","COMPLETED","CANCELLED"]),
  externalProtocol: z.string().trim().max(160).optional(),
  resolutionNotes: z.string().trim().max(8000).optional()
});

const dispatchTransitions: Record<string, string[]> = {
  DISPATCHED: ["ACKNOWLEDGED", "CANCELLED"],
  ACKNOWLEDGED: ["EN_ROUTE", "CANCELLED"],
  EN_ROUTE: ["ON_SCENE", "CANCELLED"],
  ON_SCENE: ["RELEASED"],
  RELEASED: [],
  CANCELLED: []
};

const transitions: Record<string, string[]> = {
  RECEIVED: ["TRIAGE","WAITING_DISPATCH","DISPATCHED","CANCELLED","DUPLICATE"],
  TRIAGE: ["WAITING_DISPATCH","DISPATCHED","CANCELLED","DUPLICATE"],
  WAITING_DISPATCH: ["DISPATCHED","CANCELLED"],
  DISPATCHED: ["EN_ROUTE","ON_SCENE","CANCELLED"],
  EN_ROUTE: ["ON_SCENE","CANCELLED"],
  ON_SCENE: ["IN_SERVICE","INSPECTION","MONITORING","COMPLETED"],
  IN_SERVICE: ["WAITING_SUPPORT","INSPECTION","MONITORING","COMPLETED"],
  WAITING_SUPPORT: ["IN_SERVICE","MONITORING","COMPLETED"],
  INSPECTION: ["IN_SERVICE","MONITORING","COMPLETED"],
  MONITORING: ["IN_SERVICE","COMPLETED"],
  COMPLETED: ["CLOSED","IN_SERVICE"],
  CLOSED: [],
  CANCELLED: [],
  DUPLICATE: []
};

function requireOrganization(organizationId: string | null) {
  if (!organizationId) {
    const error = new Error("Usuário sem organização vinculada.");
    (error as Error & { statusCode?: number }).statusCode = 409;
    throw error;
  }
  return organizationId;
}

export async function incidentRoutes(app: FastifyInstance) {
  app.get("/api/v1/incident-types", {
    preHandler: requirePermission("incidents.read")
  }, async (request) => {
    const auth = authFrom(request);
    const result = await db.query(
      `SELECT id, code, name, group_name AS "groupName", parent_id AS "parentId",
              cobrade_code AS "cobradeCode", default_priority AS "defaultPriority"
         FROM incident_types
        WHERE active = true
          AND (organization_id IS NULL OR organization_id = $1)
        ORDER BY group_name, name`,
      [auth.organizationId]
    );
    return { items: result.rows };
  });

  app.get("/api/v1/incidents", {
    preHandler: requirePermission("incidents.read")
  }, async (request, reply) => {
    const auth = authFrom(request);
    const organizationId = requireOrganization(auth.organizationId);
    const parsed = listSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_QUERY", details: parsed.error.flatten() });
    }

    const { status, priority, limit } = parsed.data;
    const values: unknown[] = [organizationId];
    const where = ["i.organization_id = $1"];

    if (status) {
      values.push(status);
      where.push(`i.status = $${values.length}`);
    }
    if (priority) {
      values.push(priority);
      where.push(`i.priority = $${values.length}`);
    }
    values.push(limit);

    const result = await db.query(
      `SELECT i.id, i.protocol, i.status, i.priority, i.risk_to_life AS "riskToLife",
              i.summary, i.source, i.address_line AS "addressLine",
              i.neighborhood, i.latitude, i.longitude,
              i.created_at AS "createdAt", i.updated_at AS "updatedAt",
              t.name AS "typeName", t.group_name AS "typeGroup",
              tm.code AS "teamCode", v.code AS "vehicleCode"
         FROM incidents i
         JOIN incident_types t ON t.id = i.incident_type_id
         LEFT JOIN teams tm ON tm.id = i.current_team_id
         LEFT JOIN vehicles v ON v.id = i.current_vehicle_id
        WHERE ${where.join(" AND ")}
        ORDER BY
          CASE i.priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 WHEN 'P4' THEN 4 ELSE 5 END,
          i.created_at DESC
        LIMIT $${values.length}`,
      values
    );

    return { items: result.rows };
  });

  app.post("/api/v1/incidents", {
    preHandler: requirePermission("incidents.create")
  }, async (request, reply) => {
    const auth = authFrom(request);
    const organizationId = requireOrganization(auth.organizationId);
    const parsed = createIncidentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_INPUT", details: parsed.error.flatten() });
    }

    const input = parsed.data;
    const client = await db.connect();

    try {
      await client.query("BEGIN");

      const typeResult = await client.query<{ default_priority: string }>(
        `SELECT default_priority
           FROM incident_types
          WHERE id = $1
            AND active = true
            AND (organization_id IS NULL OR organization_id = $2)`,
        [input.typeId, organizationId]
      );

      const type = typeResult.rows[0];
      if (!type) {
        await client.query("ROLLBACK");
        return reply.code(400).send({ error: "INVALID_TYPE", message: "Tipo de ocorrência inválido." });
      }

      const protocolDate = incidentProtocolParts(new Date());
      const year = protocolDate.year;
      const counter = await client.query<{ last_number: number }>(
        `INSERT INTO incident_counters (organization_id, year, last_number)
         VALUES ($1, $2, 1)
         ON CONFLICT (organization_id, year)
         DO UPDATE SET last_number = incident_counters.last_number + 1
         RETURNING last_number`,
        [organizationId, year]
      );

      const sequenceNo = counter.rows[0]?.last_number;
      if (!sequenceNo) throw new Error("Falha ao gerar sequência da ocorrência.");

      const protocol = protocolDate.format(sequenceNo);
      const priority = input.priority ?? type.default_priority;

      const created = await client.query<{ id: string }>(
        `INSERT INTO incidents (
          organization_id, incident_type_id, year, sequence_no, protocol,
          source, priority, risk_to_life, summary, description,
          caller_name, caller_phone, address_line, neighborhood, reference_point,
          latitude, longitude, location, created_by
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
          CASE
            WHEN $16::double precision IS NULL OR $17::double precision IS NULL THEN NULL
            ELSE ST_SetSRID(ST_MakePoint($17::double precision,$16::double precision),4326)::geography
          END,
          $18
        )
        RETURNING id`,
        [
          organizationId, input.typeId, year, sequenceNo, protocol,
          input.source, priority, input.riskToLife, input.summary, input.description ?? null,
          input.callerName ?? null, input.callerPhone ?? null, input.addressLine ?? null,
          input.neighborhood ?? null, input.referencePoint ?? null,
          input.latitude ?? null, input.longitude ?? null, auth.userId
        ]
      );

      const incidentId = created.rows[0]?.id;
      if (!incidentId) throw new Error("Falha ao criar ocorrência.");

      await client.query(
        `INSERT INTO incident_timeline
         (incident_id, event_type, actor_user_id, note, metadata)
         VALUES ($1,'incident.created',$2,$3,$4::jsonb)`,
        [
          incidentId,
          auth.userId,
          input.summary,
          JSON.stringify({ protocol, source: input.source, priority, riskToLife: input.riskToLife })
        ]
      );

      await client.query(
        `INSERT INTO audit_logs
         (actor_user_id, action, entity_type, entity_id, ip, user_agent, after_data)
         VALUES ($1,'incident.create','incident',$2,$3,$4,$5::jsonb)`,
        [
          auth.userId,
          incidentId,
          request.ip,
          request.headers["user-agent"] ?? null,
          JSON.stringify({ protocol, priority, status: "RECEIVED" })
        ]
      );

      await client.query("COMMIT");

      return reply.code(201).send({
        incident: { id: incidentId, protocol, priority, status: "RECEIVED" }
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.get("/api/v1/incidents/:id", {
    preHandler: requirePermission("incidents.read")
  }, async (request, reply) => {
    const auth = authFrom(request);
    const organizationId = requireOrganization(auth.organizationId);
    const { id } = request.params as { id: string };

    const incident = await db.query(
      `SELECT i.*, t.name AS type_name, t.group_name AS type_group,
              tm.code AS team_code, v.code AS vehicle_code
         FROM incidents i
         JOIN incident_types t ON t.id = i.incident_type_id
         LEFT JOIN teams tm ON tm.id = i.current_team_id
         LEFT JOIN vehicles v ON v.id = i.current_vehicle_id
        WHERE i.id = $1 AND i.organization_id = $2`,
      [id, organizationId]
    );

    const incidentRow = incident.rows[0] as { status: string } | undefined;
    if (!incidentRow) {
      return reply.code(404).send({ error: "NOT_FOUND" });
    }

    const timeline = await db.query(
      `SELECT tl.id, tl.occurred_at AS "occurredAt", tl.event_type AS "eventType",
              tl.note, tl.metadata,
              u.display_name AS "actorName", u.matricula AS "actorMatricula"
         FROM incident_timeline tl
         LEFT JOIN users u ON u.id = tl.actor_user_id
        WHERE tl.incident_id = $1
        ORDER BY tl.occurred_at ASC, tl.id ASC`,
      [id]
    );

    const dispatches = await db.query(
      `SELECT d.id, d.status, d.notes, d.dispatched_at AS "dispatchedAt",
              d.acknowledged_at AS "acknowledgedAt", d.enroute_at AS "enrouteAt",
              d.arrived_at AS "arrivedAt", d.released_at AS "releasedAt",
              t.code AS "teamCode", t.name AS "teamName",
              v.code AS "vehicleCode", v.description AS "vehicleDescription"
         FROM dispatches d
         JOIN teams t ON t.id = d.team_id
         LEFT JOIN vehicles v ON v.id = d.vehicle_id
        WHERE d.incident_id = $1
        ORDER BY d.dispatched_at DESC`,
      [id]
    );

    return {
      incident: incidentRow,
      timeline: timeline.rows,
      dispatches: dispatches.rows,
      allowedTransitions: transitions[incidentRow.status] ?? []
    };
  });

  app.get("/api/v1/incidents/:id/extract", {
    preHandler: requirePermission("incidents.read")
  }, async (request, reply) => {
    const auth=authFrom(request);
    const organizationId=requireOrganization(auth.organizationId);
    const {id}=request.params as {id:string};
    const incident=await db.query(`SELECT i.id,i.protocol,i.status,i.priority,i.risk_to_life AS "riskToLife",i.summary,i.description,i.source,
      i.address_line AS "addressLine",i.neighborhood,i.reference_point AS "referencePoint",i.latitude,i.longitude,
      i.created_at AS "createdAt",i.updated_at AS "updatedAt",t.name AS "typeName",t.group_name AS "typeGroup"
      FROM incidents i JOIN incident_types t ON t.id=i.incident_type_id
      WHERE i.id=$1 AND i.organization_id=$2`,[id,organizationId]);
    if(!incident.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
    const [timeline,dispatches,inspections,actions,supportRequests,deliveries]=await Promise.all([
      db.query(`SELECT tl.occurred_at AS "occurredAt",tl.event_type AS "eventType",tl.note,tl.metadata,u.display_name AS "actorName"
        FROM incident_timeline tl LEFT JOIN users u ON u.id=tl.actor_user_id WHERE tl.incident_id=$1 ORDER BY tl.occurred_at ASC,tl.id ASC`,[id]),
      db.query(`SELECT d.status,d.notes,d.dispatched_at AS "dispatchedAt",t.code AS "teamCode",t.name AS "teamName",v.code AS "vehicleCode"
        FROM dispatches d JOIN teams t ON t.id=d.team_id LEFT JOIN vehicles v ON v.id=d.vehicle_id WHERE d.incident_id=$1 ORDER BY d.dispatched_at ASC`,[id]),
      db.query(`SELECT id,inspection_type AS "inspectionType",status,risk_level AS "riskLevel",address_line AS "addressLine",scheduled_at AS "scheduledAt",completed_at AS "completedAt",findings,recommendations
        FROM inspections WHERE incident_id=$1 AND organization_id=$2 ORDER BY created_at ASC`,[id,organizationId]),
      db.query(`SELECT id,action_type AS "actionType",title,description,started_at AS "startedAt",ended_at AS "endedAt",address_line AS "addressLine",neighborhood,latitude,longitude,participants_count AS "participantsCount"
        FROM civil_defense_actions WHERE incident_id=$1 AND organization_id=$2 ORDER BY started_at ASC`,[id,organizationId]),
      db.query(`SELECT id,request_type AS "requestType",status,destination,justification,requested_items AS "requestedItems",external_protocol AS "externalProtocol",submitted_at AS "submittedAt",resolved_at AS "resolvedAt",resolution_notes AS "resolutionNotes",created_at AS "createdAt"
        FROM operational_support_requests WHERE incident_id=$1 AND organization_id=$2 ORDER BY created_at ASC`,[id,organizationId]),
      db.query(`SELECT d.delivered_at AS "deliveredAt",d.recipient_name AS "recipientName",d.notes,
        COALESCE(json_agg(json_build_object('item',hi.name,'quantity',di.quantity,'unit',hi.unit)) FILTER (WHERE hi.id IS NOT NULL),'[]'::json) AS items
        FROM humanitarian_deliveries d
        LEFT JOIN humanitarian_delivery_items di ON di.delivery_id=d.id
        LEFT JOIN humanitarian_items hi ON hi.id=di.item_id
        WHERE d.incident_id=$1 AND d.organization_id=$2
        GROUP BY d.id ORDER BY d.delivered_at ASC`,[id,organizationId])
    ]);
    return {generatedAt:new Date().toISOString(),incident:incident.rows[0],timeline:timeline.rows,dispatches:dispatches.rows,inspections:inspections.rows,actions:actions.rows,supportRequests:supportRequests.rows,humanitarianDeliveries:deliveries.rows};
  });

  app.get("/api/v1/civil-defense/actions", {
    preHandler: requirePermission("actions.read")
  }, async (request) => {
    const organizationId=requireOrganization(authFrom(request).organizationId);
    const result=await db.query(`SELECT a.id,a.incident_id AS "incidentId",i.protocol,a.action_type AS "actionType",a.title,a.description,
      a.started_at AS "startedAt",a.ended_at AS "endedAt",a.address_line AS "addressLine",a.neighborhood,a.latitude,a.longitude,
      a.participants_count AS "participantsCount",u.display_name AS "createdByName"
      FROM civil_defense_actions a
      LEFT JOIN incidents i ON i.id=a.incident_id
      JOIN users u ON u.id=a.created_by
      WHERE a.organization_id=$1 ORDER BY a.started_at DESC LIMIT 300`,[organizationId]);
    return {items:result.rows};
  });

  app.post("/api/v1/civil-defense/actions", {
    preHandler: requirePermission("actions.manage")
  }, async (request, reply) => {
    const auth=authFrom(request),organizationId=requireOrganization(auth.organizationId);
    const parsed=civilActionSchema.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
    const v=parsed.data;
    if(v.incidentId){const incident=await db.query("SELECT 1 FROM incidents WHERE id=$1 AND organization_id=$2",[v.incidentId,organizationId]);if(!incident.rows[0])return reply.code(400).send({error:"INVALID_INCIDENT"});}
    const r=await db.query(`INSERT INTO civil_defense_actions(organization_id,incident_id,action_type,title,description,started_at,ended_at,address_line,neighborhood,latitude,longitude,location,participants_count,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
      CASE WHEN $10::double precision IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($11::double precision,$10::double precision),4326)::geography END,$12,$13)
      RETURNING id`,[organizationId,v.incidentId??null,v.actionType,v.title,v.description??null,v.startedAt??new Date(),v.endedAt??null,v.addressLine??null,v.neighborhood??null,v.latitude??null,v.longitude??null,v.participantsCount,auth.userId]);
    const actionId=r.rows[0]?.id;
    if(v.incidentId)await db.query(`INSERT INTO incident_timeline(incident_id,event_type,actor_user_id,note,metadata) VALUES($1,'civil_action.created',$2,$3,$4::jsonb)`,[v.incidentId,auth.userId,v.title,JSON.stringify({actionId,actionType:v.actionType})]);
    await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data) VALUES($1,'civil_action.create','civil_defense_action',$2,$3,$4,$5::jsonb)`,[auth.userId,actionId,request.ip,request.headers["user-agent"]??null,JSON.stringify({actionType:v.actionType,title:v.title,incidentId:v.incidentId??null})]);
    return reply.code(201).send({id:actionId});
  });

  app.get("/api/v1/support-requests", {
    preHandler: requirePermission("support_requests.read")
  }, async (request) => {
    const organizationId=requireOrganization(authFrom(request).organizationId);
    const r=await db.query(`SELECT s.id,s.incident_id AS "incidentId",i.protocol,s.request_type AS "requestType",s.status,s.destination,s.justification,
      s.requested_items AS "requestedItems",s.external_protocol AS "externalProtocol",s.submitted_at AS "submittedAt",s.resolved_at AS "resolvedAt",
      s.resolution_notes AS "resolutionNotes",s.created_at AS "createdAt",u.display_name AS "createdByName"
      FROM operational_support_requests s
      LEFT JOIN incidents i ON i.id=s.incident_id JOIN users u ON u.id=s.created_by
      WHERE s.organization_id=$1 ORDER BY CASE s.status WHEN 'SUBMITTED' THEN 1 WHEN 'IN_ANALYSIS' THEN 2 WHEN 'DRAFT' THEN 3 ELSE 4 END,s.created_at DESC LIMIT 300`,[organizationId]);
    return {items:r.rows};
  });

  app.post("/api/v1/support-requests", {
    preHandler: requirePermission("support_requests.manage")
  }, async (request, reply) => {
    const auth=authFrom(request),organizationId=requireOrganization(auth.organizationId);
    const parsed=supportRequestSchema.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
    const v=parsed.data;
    if(v.incidentId){const incident=await db.query("SELECT 1 FROM incidents WHERE id=$1 AND organization_id=$2",[v.incidentId,organizationId]);if(!incident.rows[0])return reply.code(400).send({error:"INVALID_INCIDENT"});}
    const r=await db.query(`INSERT INTO operational_support_requests(organization_id,incident_id,request_type,destination,justification,requested_items,external_protocol,created_by)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING id,status`,[organizationId,v.incidentId??null,v.requestType,v.destination??null,v.justification,JSON.stringify(v.requestedItems),v.externalProtocol??null,auth.userId]);
    const requestId=r.rows[0]?.id;
    if(v.incidentId)await db.query(`INSERT INTO incident_timeline(incident_id,event_type,actor_user_id,note,metadata) VALUES($1,'support_request.created',$2,$3,$4::jsonb)`,[v.incidentId,auth.userId,`Solicitação operacional: ${v.requestType}`,JSON.stringify({requestId})]);
    await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data) VALUES($1,'support_request.create','operational_support_request',$2,$3,$4,$5::jsonb)`,[auth.userId,requestId,request.ip,request.headers["user-agent"]??null,JSON.stringify({requestType:v.requestType,incidentId:v.incidentId??null,status:"DRAFT"})]);
    return reply.code(201).send({id:requestId,status:r.rows[0]?.status});
  });

  app.patch("/api/v1/support-requests/:id/status", {
    preHandler: requirePermission("support_requests.manage")
  }, async (request, reply) => {
    const auth=authFrom(request),organizationId=requireOrganization(auth.organizationId),{id}=request.params as {id:string};
    const parsed=supportStatusSchema.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT"});
    const before=await db.query(`SELECT id,status,incident_id AS "incidentId" FROM operational_support_requests WHERE id=$1 AND organization_id=$2`,[id,organizationId]);
    const current=before.rows[0] as {status:string;incidentId?:string|null}|undefined;if(!current)return reply.code(404).send({error:"NOT_FOUND"});
    const v=parsed.data;
    const r=await db.query(`UPDATE operational_support_requests SET status=$1,external_protocol=COALESCE($2,external_protocol),resolution_notes=COALESCE($3,resolution_notes),
      submitted_at=CASE WHEN $1='SUBMITTED' THEN COALESCE(submitted_at,now()) ELSE submitted_at END,
      resolved_at=CASE WHEN $1 IN ('APPROVED','REJECTED','COMPLETED','CANCELLED') THEN now() ELSE resolved_at END,updated_at=now()
      WHERE id=$4 AND organization_id=$5 RETURNING id,status,external_protocol AS "externalProtocol",resolved_at AS "resolvedAt"`,[v.status,v.externalProtocol??null,v.resolutionNotes??null,id,organizationId]);
    if(current.incidentId)await db.query(`INSERT INTO incident_timeline(incident_id,event_type,actor_user_id,note,metadata) VALUES($1,'support_request.status_changed',$2,$3,$4::jsonb)`,[current.incidentId,auth.userId,`Solicitação operacional atualizada para ${v.status}.`,JSON.stringify({requestId:id,from:current.status,to:v.status})]);
    await db.query(`INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data) VALUES($1,'support_request.status','operational_support_request',$2,$3,$4,$5::jsonb,$6::jsonb)`,[auth.userId,id,request.ip,request.headers["user-agent"]??null,JSON.stringify(before.rows[0]),JSON.stringify(r.rows[0])]);
    return r.rows[0];
  });

  app.post("/api/v1/incidents/:id/status", {
    preHandler: requirePermission("incidents.update")
  }, async (request, reply) => {
    const auth = authFrom(request);
    const organizationId = requireOrganization(auth.organizationId);
    const { id } = request.params as { id: string };
    const parsed = statusSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_INPUT", details: parsed.error.flatten() });
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const currentResult = await client.query<{ status: string; protocol: string }>(
        `SELECT status, protocol FROM incidents
          WHERE id = $1 AND organization_id = $2
          FOR UPDATE`,
        [id, organizationId]
      );
      const current = currentResult.rows[0];
      if (!current) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "NOT_FOUND" });
      }

      if (!(transitions[current.status] ?? []).includes(parsed.data.status)) {
        await client.query("ROLLBACK");
        return reply.code(409).send({
          error: "INVALID_TRANSITION",
          message: `Transição ${current.status} → ${parsed.data.status} não permitida.`
        });
      }

      await client.query(
        `UPDATE incidents
            SET status = $3,
                dispatched_at = CASE WHEN $3='DISPATCHED' AND dispatched_at IS NULL THEN now() ELSE dispatched_at END,
                enroute_at = CASE WHEN $3='EN_ROUTE' AND enroute_at IS NULL THEN now() ELSE enroute_at END,
                arrived_at = CASE WHEN $3='ON_SCENE' AND arrived_at IS NULL THEN now() ELSE arrived_at END,
                completed_at = CASE WHEN $3='COMPLETED' AND completed_at IS NULL THEN now() ELSE completed_at END,
                closed_at = CASE WHEN $3='CLOSED' AND closed_at IS NULL THEN now() ELSE closed_at END,
                updated_at = now()
          WHERE id = $1 AND organization_id = $2`,
        [id, organizationId, parsed.data.status]
      );

      await client.query(
        `INSERT INTO incident_timeline
         (incident_id, event_type, actor_user_id, note, metadata)
         VALUES ($1,'incident.status_changed',$2,$3,$4::jsonb)`,
        [
          id,
          auth.userId,
          parsed.data.note ?? null,
          JSON.stringify({ from: current.status, to: parsed.data.status })
        ]
      );

      await client.query(
        `INSERT INTO audit_logs
         (actor_user_id, action, entity_type, entity_id, ip, user_agent, before_data, after_data)
         VALUES ($1,'incident.status_change','incident',$2,$3,$4,$5::jsonb,$6::jsonb)`,
        [
          auth.userId, id, request.ip, request.headers["user-agent"] ?? null,
          JSON.stringify({ status: current.status }),
          JSON.stringify({ status: parsed.data.status })
        ]
      );

      await client.query("COMMIT");
      return { ok: true, status: parsed.data.status };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/api/v1/incidents/:id/dispatch", {
    preHandler: requirePermission("dispatch.create")
  }, async (request, reply) => {
    const auth = authFrom(request);
    const organizationId = requireOrganization(auth.organizationId);
    const { id } = request.params as { id: string };
    const parsed = dispatchSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_INPUT", details: parsed.error.flatten() });
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const incident = await client.query<{ status: string }>(
        `SELECT status FROM incidents
          WHERE id = $1 AND organization_id = $2
          FOR UPDATE`,
        [id, organizationId]
      );
      if (!incident.rows[0]) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "NOT_FOUND" });
      }

      const team = await client.query(
        `SELECT id FROM teams
          WHERE id = $1 AND organization_id = $2 AND active = true`,
        [parsed.data.teamId, organizationId]
      );
      if (!team.rows[0]) {
        await client.query("ROLLBACK");
        return reply.code(400).send({ error: "INVALID_TEAM" });
      }

      if (parsed.data.vehicleId) {
        const vehicle = await client.query(
          `SELECT id FROM vehicles
            WHERE id = $1 AND organization_id = $2 AND active = true`,
          [parsed.data.vehicleId, organizationId]
        );
        if (!vehicle.rows[0]) {
          await client.query("ROLLBACK");
          return reply.code(400).send({ error: "INVALID_VEHICLE" });
        }
      }

      const dispatch = await client.query<{ id: string }>(
        `INSERT INTO dispatches
         (incident_id, team_id, vehicle_id, dispatched_by, notes)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id`,
        [id, parsed.data.teamId, parsed.data.vehicleId ?? null, auth.userId, parsed.data.notes ?? null]
      );

      await client.query(
        `UPDATE incidents
            SET current_team_id = $2,
                current_vehicle_id = $3,
                status = CASE WHEN status IN ('RECEIVED','TRIAGE','WAITING_DISPATCH') THEN 'DISPATCHED' ELSE status END,
                dispatched_at = COALESCE(dispatched_at, now()),
                updated_at = now()
          WHERE id = $1`,
        [id, parsed.data.teamId, parsed.data.vehicleId ?? null]
      );

      await client.query(
        `UPDATE teams SET status='DISPATCHED' WHERE id=$1`,
        [parsed.data.teamId]
      );
      if (parsed.data.vehicleId) {
        await client.query(
          `UPDATE vehicles SET status='DISPATCHED' WHERE id=$1`,
          [parsed.data.vehicleId]
        );
      }

      await client.query(
        `INSERT INTO incident_timeline
         (incident_id, event_type, actor_user_id, note, metadata)
         VALUES ($1,'dispatch.created',$2,$3,$4::jsonb)`,
        [
          id,
          auth.userId,
          parsed.data.notes ?? null,
          JSON.stringify({
            dispatchId: dispatch.rows[0]?.id,
            teamId: parsed.data.teamId,
            vehicleId: parsed.data.vehicleId ?? null
          })
        ]
      );

      await client.query("COMMIT");
      return reply.code(201).send({ dispatchId: dispatch.rows[0]?.id });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/api/v1/dispatches/:id/status", {
    preHandler: requirePermission("dispatch.update")
  }, async (request, reply) => {
    const auth = authFrom(request);
    const organizationId = requireOrganization(auth.organizationId);
    const { id } = request.params as { id: string };
    const parsed = dispatchStatusSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_INPUT", details: parsed.error.flatten() });
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{
        id: string;
        status: string;
        incident_id: string;
        incident_status: string;
        team_id: string;
        vehicle_id: string | null;
      }>(
        `SELECT d.id, d.status, d.incident_id, d.team_id, d.vehicle_id,
                i.status AS incident_status
           FROM dispatches d
           JOIN incidents i ON i.id = d.incident_id
          WHERE d.id = $1
            AND i.organization_id = $2
          FOR UPDATE OF d, i`,
        [id, organizationId]
      );

      const dispatch = result.rows[0];
      if (!dispatch) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "NOT_FOUND" });
      }

      const nextStatus = parsed.data.status;
      if (!(dispatchTransitions[dispatch.status] ?? []).includes(nextStatus)) {
        await client.query("ROLLBACK");
        return reply.code(409).send({
          error: "INVALID_TRANSITION",
          message: `Transição ${dispatch.status} → ${nextStatus} não permitida.`
        });
      }

      await client.query(
        `UPDATE dispatches
            SET status = $2::varchar,
                acknowledged_at = CASE WHEN $2::varchar = 'ACKNOWLEDGED' THEN COALESCE(acknowledged_at, now()) ELSE acknowledged_at END,
                enroute_at = CASE WHEN $2::varchar = 'EN_ROUTE' THEN COALESCE(enroute_at, now()) ELSE enroute_at END,
                arrived_at = CASE WHEN $2::varchar = 'ON_SCENE' THEN COALESCE(arrived_at, now()) ELSE arrived_at END,
                released_at = CASE WHEN $2::varchar IN ('RELEASED','CANCELLED') THEN COALESCE(released_at, now()) ELSE released_at END
          WHERE id = $1`,
        [id, nextStatus]
      );

      const resourceStatus =
        nextStatus === "EN_ROUTE" ? "EN_ROUTE" :
        nextStatus === "ON_SCENE" ? "ON_SCENE" :
        nextStatus === "RELEASED" || nextStatus === "CANCELLED" ? "AVAILABLE" :
        "DISPATCHED";

      await client.query("UPDATE teams SET status = $2 WHERE id = $1", [
        dispatch.team_id,
        resourceStatus
      ]);
      if (dispatch.vehicle_id) {
        await client.query("UPDATE vehicles SET status = $2 WHERE id = $1", [
          dispatch.vehicle_id,
          resourceStatus
        ]);
      }

      const incidentStatus =
        nextStatus === "EN_ROUTE" ? "EN_ROUTE" :
        nextStatus === "ON_SCENE" ? "ON_SCENE" :
        null;

      if (
        incidentStatus &&
        (transitions[dispatch.incident_status] ?? []).includes(incidentStatus)
      ) {
        await client.query(
          `UPDATE incidents
              SET status = $2::varchar,
                  enroute_at = CASE WHEN $2::varchar = 'EN_ROUTE' THEN COALESCE(enroute_at, now()) ELSE enroute_at END,
                  arrived_at = CASE WHEN $2::varchar = 'ON_SCENE' THEN COALESCE(arrived_at, now()) ELSE arrived_at END,
                  updated_at = now()
            WHERE id = $1`,
          [dispatch.incident_id, incidentStatus]
        );
      }

      await client.query(
        `INSERT INTO incident_timeline
           (incident_id, event_type, actor_user_id, note, metadata)
         VALUES ($1, 'dispatch.status_changed', $2, $3, $4::jsonb)`,
        [
          dispatch.incident_id,
          auth.userId,
          parsed.data.note ?? null,
          JSON.stringify({
            dispatchId: dispatch.id,
            from: dispatch.status,
            to: nextStatus
          })
        ]
      );

      await client.query(
        `INSERT INTO audit_logs
           (actor_user_id, action, entity_type, entity_id, ip, user_agent, before_data, after_data)
         VALUES ($1, 'dispatch.status_change', 'dispatch', $2, $3, $4, $5::jsonb, $6::jsonb)`,
        [
          auth.userId,
          dispatch.id,
          request.ip,
          request.headers["user-agent"] ?? null,
          JSON.stringify({ status: dispatch.status }),
          JSON.stringify({ status: nextStatus })
        ]
      );

      await client.query("COMMIT");
      return { ok: true, status: nextStatus };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.get("/api/v1/teams", {
    preHandler: requirePermission("dispatch.read")
  }, async (request) => {
    const auth = authFrom(request);
    const organizationId = requireOrganization(auth.organizationId);
    const result = await db.query(
      `SELECT id, code, name, status
         FROM teams
        WHERE organization_id=$1 AND active=true
        ORDER BY code`,
      [organizationId]
    );
    return { items: result.rows };
  });

  app.get("/api/v1/vehicles", {
    preHandler: requirePermission("dispatch.read")
  }, async (request) => {
    const auth = authFrom(request);
    const organizationId = requireOrganization(auth.organizationId);
    const result = await db.query(
      `SELECT id, code, plate, description, status, odometer_km AS "odometerKm"
         FROM vehicles
        WHERE organization_id=$1 AND active=true
        ORDER BY code`,
      [organizationId]
    );
    return { items: result.rows };
  });
}
