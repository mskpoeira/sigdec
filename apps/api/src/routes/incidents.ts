import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authFrom, requirePermission } from "../auth.js";
import { db } from "../db.js";

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

      const year = new Date().getFullYear();
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

      const protocol = `DC-${year}-${String(sequenceNo).padStart(6, "0")}`;
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
