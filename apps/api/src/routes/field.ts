import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authFrom, requirePermission } from "../auth.js";
import { db } from "../db.js";

const inspectionType = z.enum([
  "PREVENTIVE", "STRUCTURAL", "TREE", "SLOPE", "FLOOD", "POST_EVENT", "OTHER"
]);
const riskLevel = z.enum(["UNASSESSED", "LOW", "MODERATE", "HIGH", "CRITICAL"]);
const historyQuerySchema=z.object({hours:z.coerce.number().int().min(1).max(168).default(24)});
const mapPointSchema=z.object({title:z.string().trim().min(3).max(160),description:z.string().trim().max(2000).default(""),
  latitude:z.number().finite().min(-90).max(90),longitude:z.number().finite().min(-180).max(180)});
const xml=(value:unknown)=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"})[char]!);
const csv=(value:unknown)=>'"'+String(value??"").replace(/[\r\n]/g," ").replace(/^[=+\-@]/,"'$&").replace(/"/g,'""')+'"';

function organization(id: string | null) {
  if (!id) {
    throw Object.assign(new Error("Usuário sem organização vinculada."), { statusCode: 409 });
  }
  return id;
}

const positionSchema = z.object({
  teamId: z.string().uuid().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().nonnegative().max(10000).optional(),
  capturedAt: z.coerce.date().optional(),
  recordedAt: z.coerce.date().optional()
});

const createInspectionSchema = z.object({
  incidentId: z.string().uuid().optional(),
  inspectionType,
  assignedTo: z.string().uuid().optional(),
  addressLine: z.string().trim().min(3).max(300),
  neighborhood: z.string().trim().max(140).optional(),
  referencePoint: z.string().trim().max(300).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  scheduledAt: z.coerce.date().optional(),
  notes: z.string().trim().max(5000).optional(),
  checklist: z.array(z.string().trim().min(2).max(300)).max(40).default([])
}).refine(
  (value) => (value.latitude === undefined) === (value.longitude === undefined),
  { message: "Latitude e longitude devem ser informadas em conjunto." }
);

const updateInspectionSchema = z.object({
  status: z.enum(["IN_PROGRESS", "COMPLETED", "CANCELLED"]),
  riskLevel: riskLevel.optional(),
  findings: z.string().trim().max(12000).optional(),
  recommendations: z.string().trim().max(12000).optional()
}).superRefine((value, context) => {
  if (value.status === "COMPLETED" && (!value.findings || value.findings.length < 5)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["findings"],
      message: "Informe a conclusão técnica para finalizar a vistoria."
    });
  }
});

const inspectionTransitions: Record<string, string[]> = {
  SCHEDULED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: []
};

export async function fieldRoutes(app: FastifyInstance) {
  app.get("/api/v1/field/map-points",{preHandler:requirePermission("field.read")},async request=>{
    const result=await db.query(`SELECT p.id,p.title,p.description,p.latitude,p.longitude,p.created_at AS "createdAt",
      u.display_name AS "createdBy" FROM field_map_points p JOIN users u ON u.id=p.created_by
      WHERE p.organization_id=$1 AND p.archived_at IS NULL ORDER BY p.created_at DESC LIMIT 1000`,
      [organization(authFrom(request).organizationId)]);
    return {items:result.rows};
  });
  app.post("/api/v1/field/map-points",{preHandler:requirePermission("field.location.update")},async(request,reply)=>{
    const parsed=mapPointSchema.safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",details:parsed.error.flatten()});
    const v=parsed.data,auth=authFrom(request),org=organization(auth.organizationId);
    const result=await db.query(`INSERT INTO field_map_points(organization_id,created_by,title,description,latitude,longitude,location)
      VALUES($1,$2,$3,$4,$5,$6,ST_SetSRID(ST_MakePoint($6::double precision,$5::double precision),4326)::geography)
      RETURNING id,title,description,latitude,longitude,created_at AS "createdAt"`,
      [org,auth.userId,v.title,v.description,v.latitude,v.longitude]);
    return reply.code(201).send(result.rows[0]);
  });
  app.delete("/api/v1/field/map-points/:id",{preHandler:requirePermission("field.location.update")},async(request,reply)=>{
    const {id}=request.params as {id:string};
    if(!z.string().uuid().safeParse(id).success)return reply.code(400).send({error:"INVALID_ID"});
    const result=await db.query(`UPDATE field_map_points SET archived_at=now()
      WHERE id=$1 AND organization_id=$2 AND archived_at IS NULL RETURNING id`,
      [id,organization(authFrom(request).organizationId)]);
    if(!result.rows[0])return reply.code(404).send({error:"NOT_FOUND"});
    return {ok:true};
  });
  async function exportPoints(request: Parameters<typeof authFrom>[0]){
    const org=organization(authFrom(request).organizationId);
    const [points,incidents]=await Promise.all([
      db.query(`SELECT title,description,latitude,longitude FROM field_map_points
        WHERE organization_id=$1 AND archived_at IS NULL ORDER BY created_at DESC LIMIT 1000`,[org]),
      db.query(`SELECT protocol AS title,summary AS description,latitude,longitude FROM incidents
        WHERE organization_id=$1 AND status NOT IN ('CLOSED','CANCELLED','DUPLICATE')
          AND latitude IS NOT NULL AND longitude IS NOT NULL ORDER BY updated_at DESC LIMIT 500`,[org])
    ]);
    return [...points.rows,...incidents.rows] as Array<{title:string;description:string;latitude:number;longitude:number}>;
  }
  app.get("/api/v1/field/map-points.kml",{preHandler:requirePermission("field.read")},async(request,reply)=>{
    const points=await exportPoints(request);
    reply.header("content-type","application/vnd.google-earth.kml+xml; charset=utf-8")
      .header("content-disposition",'attachment; filename="sigdec-pontos.kml"').header("cache-control","no-store");
    return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>SIGDEC - Ubatuba</name>${points.map(p=>
      `<Placemark><name>${xml(p.title)}</name><description>${xml(p.description)}</description><Point><coordinates>${p.longitude},${p.latitude},0</coordinates></Point></Placemark>`
    ).join("")}</Document></kml>`;
  });
  app.get("/api/v1/field/map-points.csv",{preHandler:requirePermission("field.read")},async(request,reply)=>{
    const points=await exportPoints(request);
    reply.header("content-type","text/csv; charset=utf-8")
      .header("content-disposition",'attachment; filename="sigdec-pontos.csv"').header("cache-control","no-store");
    return "\uFEFF"+["Nome,Descrição,Latitude,Longitude",...points.map(p=>
      [p.title,p.description,p.latitude,p.longitude].map(csv).join(","))].join("\r\n")+"\r\n";
  });
  app.get("/api/v1/field/map", {
    preHandler: requirePermission("field.read")
  }, async (request) => {
    const orgId = organization(authFrom(request).organizationId);

    const incidents = await db.query(
      `SELECT i.id, i.protocol, i.status, i.priority, i.risk_to_life AS "riskToLife",
              i.summary, i.address_line AS "addressLine", i.neighborhood,
              i.latitude, i.longitude, i.updated_at AS "updatedAt",
              t.name AS "typeName", tm.code AS "teamCode"
         FROM incidents i
         JOIN incident_types t ON t.id = i.incident_type_id
         LEFT JOIN teams tm ON tm.id = i.current_team_id
        WHERE i.organization_id = $1
          AND i.status NOT IN ('CLOSED','CANCELLED','DUPLICATE')
        ORDER BY
          CASE i.priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 WHEN 'P4' THEN 4 ELSE 5 END,
          i.updated_at DESC
        LIMIT 200`,
      [orgId]
    );

    const positions = await db.query(
      `SELECT DISTINCT ON (p.user_id)
              p.user_id AS "userId", u.display_name AS "displayName", u.matricula,
              p.team_id AS "teamId", tm.code AS "teamCode",
              p.latitude, p.longitude, p.accuracy_meters AS "accuracyMeters",
              p.recorded_at AS "recordedAt", p.captured_at AS "capturedAt"
         FROM field_positions p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN teams tm ON tm.id = p.team_id
        WHERE p.organization_id = $1
          AND p.recorded_at > now() - interval '24 hours'
        ORDER BY p.user_id, p.recorded_at DESC`,
      [orgId]
    );

    const monitoringEvents = await db.query(
      `SELECT e.id,e.severity,e.title,e.status,e.metric,
              e.observed_value AS "observedValue",e.threshold_value AS "thresholdValue",e.unit,
              e.created_at AS "createdAt",s.code AS "stationCode",s.name AS "stationName",
              s.latitude,s.longitude,p.code AS "protocolCode",pv.version_no AS "protocolVersionNo"
         FROM monitoring_events e
         JOIN monitoring_stations s ON s.id=e.station_id
         LEFT JOIN operational_protocol_versions pv ON pv.id=e.protocol_version_id
         LEFT JOIN operational_protocols p ON p.id=pv.protocol_id
        WHERE e.organization_id=$1
          AND e.status<>'CLOSED'
          AND s.latitude IS NOT NULL
          AND s.longitude IS NOT NULL
        ORDER BY CASE e.severity WHEN 'EMERGENCY' THEN 1 WHEN 'WARNING' THEN 2 WHEN 'WATCH' THEN 3 ELSE 4 END,
                 e.created_at DESC
        LIMIT 100`,
      [orgId]
    );

    return { incidents: incidents.rows, positions: positions.rows, monitoringEvents: monitoringEvents.rows };
  });

  app.get("/api/v1/field/history", {
    preHandler: requirePermission("field.read")
  }, async (request, reply) => {
    const orgId = organization(authFrom(request).organizationId);
    const parsed=historyQuerySchema.safeParse(request.query??{});
    if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT"});
    const hours=parsed.data.hours;

    const [positions, monitoring] = await Promise.all([
      db.query(
        `SELECT p.user_id AS "userId",u.display_name AS "displayName",u.matricula,tm.code AS "teamCode",
                p.latitude,p.longitude,p.accuracy_meters AS "accuracyMeters",p.recorded_at AS "recordedAt",p.captured_at AS "capturedAt"
           FROM field_positions p
           JOIN users u ON u.id=p.user_id
           LEFT JOIN teams tm ON tm.id=p.team_id
          WHERE p.organization_id=$1
            AND p.recorded_at >= now() - ($2::int * interval '1 hour')
          ORDER BY p.recorded_at DESC
          LIMIT 1000`,
        [orgId,hours]
      ),
      db.query(
        `SELECT e.id,e.severity,e.title,e.status,e.metric,
                e.observed_value AS "observedValue",e.threshold_value AS "thresholdValue",e.unit,
                e.created_at AS "createdAt",e.closed_at AS "closedAt",
                s.code AS "stationCode",s.name AS "stationName",s.latitude,s.longitude,
                p.code AS "protocolCode",pv.version_no AS "protocolVersionNo"
           FROM monitoring_events e
           JOIN monitoring_stations s ON s.id=e.station_id
           LEFT JOIN operational_protocol_versions pv ON pv.id=e.protocol_version_id
           LEFT JOIN operational_protocols p ON p.id=pv.protocol_id
          WHERE e.organization_id=$1
            AND e.created_at >= now() - ($2::int * interval '1 hour')
            AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
          ORDER BY e.created_at DESC
          LIMIT 500`,
        [orgId,hours]
      )
    ]);

    return {hours,positions:positions.rows,monitoringEvents:monitoring.rows};
  });

  app.post("/api/v1/field/location", {
    preHandler: requirePermission("field.location.update")
  }, async (request, reply) => {
    const auth = authFrom(request);
    const orgId = organization(auth.organizationId);
    const parsed = positionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_INPUT", details: parsed.error.flatten() });
    }

    const value = parsed.data;
    if (value.teamId) {
      const team = await db.query(
        "SELECT 1 FROM teams WHERE id = $1 AND organization_id = $2 AND active = true",
        [value.teamId, orgId]
      );
      if (!team.rows[0]) {
        return reply.code(400).send({ error: "INVALID_TEAM", message: "Equipe inválida." });
      }
    }

    const result = await db.query(
      `INSERT INTO field_positions (
         organization_id, user_id, team_id, latitude, longitude,
         accuracy_meters, captured_at, location
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,
         ST_SetSRID(ST_MakePoint($5::double precision,$4::double precision),4326)::geography
       )
       RETURNING recorded_at AS "recordedAt", captured_at AS "capturedAt"`,
      [
        orgId, auth.userId, value.teamId ?? null, value.latitude, value.longitude,
        value.accuracyMeters ?? null, value.capturedAt ?? value.recordedAt ?? new Date()
      ]
    );

    return reply.code(201).send({ ok: true, ...result.rows[0] });
  });

  app.get("/api/v1/inspections", {
    preHandler: requirePermission("inspections.read")
  }, async (request) => {
    const orgId = organization(authFrom(request).organizationId);
    const result = await db.query(
      `SELECT v.id, v.inspection_type AS "inspectionType", v.status,
              v.risk_level AS "riskLevel", v.address_line AS "addressLine",
              v.neighborhood, v.reference_point AS "referencePoint",
              v.latitude, v.longitude, v.scheduled_at AS "scheduledAt",
              v.started_at AS "startedAt", v.completed_at AS "completedAt",
              v.notes, v.findings, v.recommendations,
              v.created_at AS "createdAt", v.updated_at AS "updatedAt",
              i.id AS "incidentId", i.protocol,
              assigned.display_name AS "assignedName",
              requester.display_name AS "requestedByName",
              COALESCE((
                SELECT json_agg(json_build_object(
                  'id', c.id, 'order', c.item_order, 'label', c.label,
                  'checked', c.checked, 'observation', c.observation
                ) ORDER BY c.item_order)
                FROM inspection_checklist_items c
                WHERE c.inspection_id = v.id
              ), '[]'::json) AS checklist
         FROM inspections v
         LEFT JOIN incidents i ON i.id = v.incident_id
         LEFT JOIN users assigned ON assigned.id = v.assigned_to
         JOIN users requester ON requester.id = v.requested_by
        WHERE v.organization_id = $1
        ORDER BY
          CASE v.status WHEN 'IN_PROGRESS' THEN 1 WHEN 'SCHEDULED' THEN 2 ELSE 3 END,
          COALESCE(v.scheduled_at, v.created_at) DESC
        LIMIT 200`,
      [orgId]
    );
    return { items: result.rows };
  });

  app.post("/api/v1/inspections", {
    preHandler: requirePermission("inspections.manage")
  }, async (request, reply) => {
    const auth = authFrom(request);
    const orgId = organization(auth.organizationId);
    const parsed = createInspectionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_INPUT", details: parsed.error.flatten() });
    }
    const value = parsed.data;
    const client = await db.connect();

    try {
      await client.query("BEGIN");

      if (value.incidentId) {
        const incident = await client.query(
          "SELECT 1 FROM incidents WHERE id = $1 AND organization_id = $2",
          [value.incidentId, orgId]
        );
        if (!incident.rows[0]) {
          await client.query("ROLLBACK");
          return reply.code(400).send({ error: "INVALID_INCIDENT", message: "Ocorrência inválida." });
        }
      }

      if (value.assignedTo) {
        const user = await client.query(
          "SELECT 1 FROM users WHERE id = $1 AND organization_id = $2 AND active = true",
          [value.assignedTo, orgId]
        );
        if (!user.rows[0]) {
          await client.query("ROLLBACK");
          return reply.code(400).send({ error: "INVALID_ASSIGNEE", message: "Responsável inválido." });
        }
      }

      const created = await client.query<{ id: string }>(
        `INSERT INTO inspections (
           organization_id, incident_id, inspection_type, requested_by, assigned_to,
           address_line, neighborhood, reference_point, latitude, longitude, location,
           scheduled_at, notes
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
           CASE WHEN $9::double precision IS NULL THEN NULL
                ELSE ST_SetSRID(ST_MakePoint($10::double precision,$9::double precision),4326)::geography END,
           $11,$12
         ) RETURNING id`,
        [
          orgId, value.incidentId ?? null, value.inspectionType, auth.userId,
          value.assignedTo ?? null, value.addressLine, value.neighborhood ?? null,
          value.referencePoint ?? null, value.latitude ?? null, value.longitude ?? null,
          value.scheduledAt ?? null, value.notes ?? null
        ]
      );

      const inspectionId = created.rows[0]?.id;
      if (!inspectionId) throw new Error("Falha ao criar vistoria.");

      for (const [index, label] of value.checklist.entries()) {
        await client.query(
          `INSERT INTO inspection_checklist_items
           (inspection_id, item_order, label)
           VALUES ($1,$2,$3)`,
          [inspectionId, index + 1, label]
        );
      }

      if (value.incidentId) {
        await client.query(
          `INSERT INTO incident_timeline
           (incident_id, event_type, actor_user_id, note, metadata)
           VALUES ($1,'inspection.created',$2,$3,$4::jsonb)`,
          [
            value.incidentId, auth.userId, `Vistoria ${value.inspectionType} criada.`,
            JSON.stringify({ inspectionId })
          ]
        );
      }

      await client.query(
        `INSERT INTO audit_logs
         (actor_user_id, action, entity_type, entity_id, ip, user_agent, after_data)
         VALUES ($1,'inspection.create','inspection',$2,$3,$4,$5::jsonb)`,
        [
          auth.userId, inspectionId, request.ip, request.headers["user-agent"] ?? null,
          JSON.stringify({ type: value.inspectionType, status: "SCHEDULED" })
        ]
      );

      await client.query("COMMIT");
      return reply.code(201).send({ inspection: { id: inspectionId, status: "SCHEDULED" } });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/api/v1/inspections/:id/status", {
    preHandler: requirePermission("inspections.manage")
  }, async (request, reply) => {
    const auth = authFrom(request);
    const orgId = organization(auth.organizationId);
    const { id } = request.params as { id: string };
    const parsed = updateInspectionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_INPUT", details: parsed.error.flatten() });
    }

    const current = await db.query<{ status: string; incident_id: string | null }>(
      "SELECT status, incident_id FROM inspections WHERE id = $1 AND organization_id = $2",
      [id, orgId]
    );
    const inspection = current.rows[0];
    if (!inspection) return reply.code(404).send({ error: "NOT_FOUND" });

    const value = parsed.data;
    if (!(inspectionTransitions[inspection.status] ?? []).includes(value.status)) {
      return reply.code(409).send({
        error: "INVALID_TRANSITION",
        message: `Transição de ${inspection.status} para ${value.status} não permitida.`
      });
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE inspections
            SET status = $1,
                risk_level = COALESCE($2, risk_level),
                findings = COALESCE($3, findings),
                recommendations = COALESCE($4, recommendations),
                started_at = CASE WHEN $1 = 'IN_PROGRESS' THEN COALESCE(started_at, now()) ELSE started_at END,
                completed_at = CASE WHEN $1 = 'COMPLETED' THEN now() ELSE completed_at END,
                updated_at = now()
          WHERE id = $5`,
        [value.status, value.riskLevel ?? null, value.findings ?? null, value.recommendations ?? null, id]
      );

      if (inspection.incident_id) {
        await client.query(
          `INSERT INTO incident_timeline
           (incident_id, event_type, actor_user_id, note, metadata)
           VALUES ($1,'inspection.status_changed',$2,$3,$4::jsonb)`,
          [
            inspection.incident_id, auth.userId, `Vistoria atualizada para ${value.status}.`,
            JSON.stringify({ inspectionId: id, from: inspection.status, to: value.status })
          ]
        );
      }

      await client.query(
        `INSERT INTO audit_logs
         (actor_user_id, action, entity_type, entity_id, ip, user_agent, before_data, after_data)
         VALUES ($1,'inspection.status','inspection',$2,$3,$4,$5::jsonb,$6::jsonb)`,
        [
          auth.userId, id, request.ip, request.headers["user-agent"] ?? null,
          JSON.stringify({ status: inspection.status }),
          JSON.stringify({ status: value.status, riskLevel: value.riskLevel })
        ]
      );

      await client.query("COMMIT");
      return { ok: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
}
