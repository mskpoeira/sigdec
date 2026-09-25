import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { authFrom, requirePermission } from "../auth.js";
import { db } from "../db.js";
import { buildPublicBulletinContent } from "../lib/public-bulletin.js";

const documentType = z.enum(["REPORT","OPINION","INTERDICTION","DECLARATION","FORM","OTHER"]);

const createSchema = z.object({
  templateId: z.string().uuid().optional(),
  incidentId: z.string().uuid().optional(),
  inspectionId: z.string().uuid().optional(),
  documentType,
  title: z.string().trim().min(3).max(300),
  subject: z.string().trim().max(1000).optional(),
  content: z.string().trim().min(10).max(60000),
  legalBasis: z.string().trim().max(8000).optional(),
  recipient: z.string().trim().max(500).optional(),
  validUntil: z.coerce.date().optional()
});

const updateSchema = createSchema
  .omit({ templateId: true, incidentId: true, inspectionId: true, documentType: true })
  .partial()
  .extend({ changeSummary: z.string().trim().min(3).max(500) });

const noteSchema = z.object({
  note: z.string().trim().max(2000).optional()
});

const typePrefixes: Record<z.infer<typeof documentType>, string> = {
  REPORT: "REL",
  OPINION: "PAR",
  INTERDICTION: "INT",
  DECLARATION: "DEC",
  FORM: "FOR",
  OTHER: "DOC"
};

const typeLabels: Record<string, string> = {
  REPORT: "RELATÓRIO TÉCNICO",
  OPINION: "PARECER TÉCNICO",
  INTERDICTION: "AUTO DE INTERDIÇÃO",
  DECLARATION: "DECLARAÇÃO",
  FORM: "FORMULÁRIO",
  OTHER: "DOCUMENTO TÉCNICO"
};

const statusLabels: Record<string, string> = {
  DRAFT: "RASCUNHO",
  REVIEW: "EM REVISÃO",
  APPROVED: "APROVADO",
  ISSUED: "EMITIDO",
  CANCELLED: "CANCELADO"
};

function organization(id: string | null) {
  if (!id) throw Object.assign(new Error("Usuário sem organização vinculada."), { statusCode: 409 });
  return id;
}

function hashContent(input: {
  documentType: string;
  number: string;
  title: string;
  subject?: string | null;
  content: string;
  legalBasis?: string | null;
  recipient?: string | null;
  validUntil?: string | Date | null;
}) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function clientMeta(request: FastifyRequest) {
  return {
    ip: request.ip,
    userAgent: request.headers["user-agent"] ?? null
  };
}

export async function buildPdf(record: Record<string, any>, signatures: Array<Record<string, any>>) {
  return new Promise<Buffer>((resolve, reject) => {
    const pdf = new PDFDocument({
      size: "A4",
      margins: { top: 58, right: 58, bottom: 64, left: 58 },
      bufferPages: true,
      info: {
        Title: String(record.title),
        Author: String(record.organizationName),
        Subject: String(record.subject ?? typeLabels[record.documentType] ?? "Documento SIGDEC"),
        Keywords: "SIGDEC, Defesa Civil, documento técnico"
      }
    });
    const chunks: Buffer[] = [];
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);

    const pageWidth = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;

    pdf.font("Helvetica-Bold").fontSize(13).fillColor("#173f69")
      .text(String(record.organizationName).toUpperCase(), { align: "center" });
    pdf.fontSize(10).fillColor("#334e68")
      .text("COORDENADORIA MUNICIPAL DE PROTEÇÃO E DEFESA CIVIL", { align: "center" });
    pdf.moveDown(0.4);
    pdf.moveTo(pdf.page.margins.left, pdf.y)
      .lineTo(pdf.page.width - pdf.page.margins.right, pdf.y)
      .strokeColor("#173f69").lineWidth(1.5).stroke();
    pdf.moveDown(1);

    pdf.font("Helvetica-Bold").fontSize(15).fillColor("#102033")
      .text(typeLabels[record.documentType] ?? "DOCUMENTO TÉCNICO", { align: "center" });
    pdf.fontSize(11).text(String(record.number ?? "SEM NUMERAÇÃO"), { align: "center" });
    pdf.moveDown(1);

    if (record.status !== "ISSUED") {
      pdf.save();
      pdf.rotate(-28, { origin: [pdf.page.width / 2, pdf.page.height / 2] });
      pdf.font("Helvetica-Bold").fontSize(55).fillColor("#d7dde5").opacity(0.38)
        .text(statusLabels[record.status] ?? String(record.status), 55, pdf.page.height / 2 - 20, {
          width: pdf.page.width - 110,
          align: "center"
        });
      pdf.restore().opacity(1);
    }

    pdf.font("Helvetica-Bold").fontSize(14).fillColor("#102033").text(String(record.title));
    if (record.subject) {
      pdf.moveDown(0.5).font("Helvetica").fontSize(10).fillColor("#52657a")
        .text(`Assunto: ${record.subject}`);
    }
    if (record.recipient) {
      pdf.moveDown(0.25).text(`Destinatário: ${record.recipient}`);
    }
    if (record.protocol) {
      pdf.moveDown(0.25).text(`Ocorrência vinculada: ${record.protocol}`);
    }

    pdf.moveDown(1);
    pdf.font("Helvetica").fontSize(11).fillColor("#102033")
      .text(String(record.contentText ?? ""), { align: "justify", lineGap: 3 });

    if (record.legalBasis) {
      pdf.moveDown(1.2).font("Helvetica-Bold").fontSize(10).text("FUNDAMENTAÇÃO");
      pdf.moveDown(0.35).font("Helvetica").fontSize(10)
        .text(String(record.legalBasis), { align: "justify", lineGap: 2 });
    }

    if (record.validUntil) {
      pdf.moveDown(1).font("Helvetica").fontSize(10)
        .text(`Validade: ${new Date(record.validUntil).toLocaleDateString("pt-BR", { timeZone: "UTC" })}`);
    }

    pdf.moveDown(1.5);
    if (signatures.length) {
      pdf.font("Helvetica-Bold").fontSize(10).text("REGISTROS ELETRÔNICOS");
      pdf.moveDown(0.4);
      for (const signature of signatures) {
        pdf.font("Helvetica").fontSize(9).fillColor("#334e68").text(
          `${signature.signatureType} · ${signature.displayName} · matrícula ${signature.matricula} · ${new Date(signature.signedAt).toLocaleString("pt-BR")}`
        );
      }
    }

    pdf.moveDown(1);
    pdf.font("Courier").fontSize(7).fillColor("#607388")
      .text(`Integridade SHA-256: ${record.contentHash ?? "não calculada"}`, { width: pageWidth });

    const range = pdf.bufferedPageRange();
    for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
      pdf.switchToPage(pageIndex);
      const footerY = pdf.page.height - 42;
      pdf.font("Helvetica").fontSize(7.5).fillColor("#607388")
        .text(
          `SIGDEC · Documento ${record.number ?? record.id} · revisão ${record.revision} · página ${pageIndex + 1} de ${range.count}`,
          pdf.page.margins.left,
          footerY,
          { width: pageWidth, align: "center", lineBreak: false }
        );
    }

    pdf.end();
  });
}

export async function documentRoutes(app: FastifyInstance) {
  app.get("/api/v1/technical-documents/templates", {
    preHandler: requirePermission("documents.read")
  }, async (request) => {
    const orgId = organization(authFrom(request).organizationId);
    const result = await db.query(
      `SELECT id, code, name, document_type AS "documentType", version,
              default_title AS "defaultTitle", default_content AS "defaultContent",
              default_legal_basis AS "defaultLegalBasis"
         FROM technical_document_templates
        WHERE active = true
          AND (organization_id IS NULL OR organization_id = $1)
        ORDER BY name, version DESC`,
      [orgId]
    );
    return { items: result.rows };
  });

  app.get("/api/v1/technical-documents", {
    preHandler: requirePermission("documents.read")
  }, async (request) => {
    const orgId = organization(authFrom(request).organizationId);
    const result = await db.query(
      `SELECT d.id, d.document_type AS "documentType", d.number, d.title,
              d.subject, d.status, d.revision, d.content_hash AS "contentHash",
              d.recipient, d.valid_until AS "validUntil",
              d.created_at AS "createdAt", d.updated_at AS "updatedAt",
              d.approved_at AS "approvedAt", d.issued_at AS "issuedAt",
              d.cancelled_at AS "cancelledAt", d.source_type AS "sourceType",
              i.protocol, creator.display_name AS "createdByName", creator.matricula AS "createdByMatricula",
              approver.display_name AS "approvedByName", approver.matricula AS "approvedByMatricula"
         FROM technical_documents d
         LEFT JOIN incidents i ON i.id = d.incident_id
         JOIN users creator ON creator.id = d.created_by
         LEFT JOIN users approver ON approver.id = d.approved_by
        WHERE d.organization_id = $1
        ORDER BY d.created_at DESC
        LIMIT 300`,
      [orgId]
    );
    return { items: result.rows };
  });

  app.post("/api/v1/technical-documents/sitrep-draft", {
    preHandler: requirePermission("documents.manage")
  }, async (request, reply) => {
    const auth = authFrom(request);
    const orgId = organization(auth.organizationId);

    const [summary, incidents, monitoring] = await Promise.all([
      db.query(`SELECT
        (SELECT count(*) FROM incidents WHERE organization_id=$1 AND status NOT IN ('CLOSED','CANCELLED','DUPLICATE'))::int AS "activeIncidents",
        (SELECT count(*) FROM incidents WHERE organization_id=$1 AND status NOT IN ('CLOSED','CANCELLED','DUPLICATE') AND priority='P1')::int AS "p1Incidents",
        (SELECT count(*) FROM incidents WHERE organization_id=$1 AND status NOT IN ('CLOSED','CANCELLED','DUPLICATE') AND priority='P2')::int AS "p2Incidents",
        (SELECT count(*) FROM monitoring_events WHERE organization_id=$1 AND status<>'CLOSED')::int AS "openMonitoringEvents",
        (SELECT count(*) FROM monitoring_events WHERE organization_id=$1 AND status<>'CLOSED' AND severity='EMERGENCY')::int AS "emergencyMonitoringEvents",
        (SELECT count(*) FROM alerts WHERE organization_id=$1 AND status='PUBLISHED')::int AS "publishedAlerts",
        (SELECT count(*) FROM shelters WHERE organization_id=$1 AND status IN ('OPEN','FULL'))::int AS "openShelters",
        (SELECT count(*) FROM assisted_households WHERE organization_id=$1 AND departed_at IS NULL AND condition='DISPLACED')::int AS "displacedHouseholds",
        (SELECT count(*) FROM assisted_households WHERE organization_id=$1 AND departed_at IS NULL AND condition='HOMELESS')::int AS "homelessHouseholds",
        (SELECT count(*) FROM emergency_operations WHERE organization_id=$1 AND ended_at IS NULL)::int AS "activeOperations",
        (SELECT count(*) FROM operational_periods p JOIN emergency_operations e ON e.id=p.operation_id WHERE e.organization_id=$1 AND p.status='ACTIVE')::int AS "activeOperationalPeriods"`,[orgId]),
      db.query(`SELECT protocol,priority,summary,neighborhood,status,updated_at AS "updatedAt"
        FROM incidents
        WHERE organization_id=$1 AND status NOT IN ('CLOSED','CANCELLED','DUPLICATE')
        ORDER BY CASE priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END,updated_at DESC
        LIMIT 15`,[orgId]),
      db.query(`SELECT e.severity,e.title,e.metric,e.observed_value AS "observedValue",e.threshold_value AS "thresholdValue",e.unit,e.status,e.created_at AS "createdAt",
          s.code AS "stationCode",s.name AS "stationName",p.code AS "protocolCode",pv.version_no AS "protocolVersionNo"
        FROM monitoring_events e
        JOIN monitoring_stations s ON s.id=e.station_id
        LEFT JOIN operational_protocol_versions pv ON pv.id=e.protocol_version_id
        LEFT JOIN operational_protocols p ON p.id=pv.protocol_id
        WHERE e.organization_id=$1 AND e.status<>'CLOSED'
        ORDER BY CASE e.severity WHEN 'EMERGENCY' THEN 1 WHEN 'WARNING' THEN 2 WHEN 'WATCH' THEN 3 ELSE 4 END,e.created_at DESC
        LIMIT 15`,[orgId])
    ]);

    const snapshot = {
      generatedAt: new Date().toISOString(),
      summary: summary.rows[0] ?? {},
      incidents: incidents.rows,
      monitoringEvents: monitoring.rows
    };
    const s = snapshot.summary as Record<string, any>;
    const generatedLabel = new Date(snapshot.generatedAt).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"});
    const incidentLines = incidents.rows.length
      ? incidents.rows.map((x:any)=>`- ${x.protocol} · ${x.priority} · ${x.summary}${x.neighborhood?" · "+x.neighborhood:""} · ${x.status}`).join("\n")
      : "- Nenhuma ocorrência ativa.";
    const monitoringLines = monitoring.rows.length
      ? monitoring.rows.map((x:any)=>`- ${x.severity} · ${x.stationCode} / ${x.stationName} · ${x.title} · ${x.metric}: ${x.observedValue} ${x.unit} (limiar ${x.thresholdValue} ${x.unit})${x.protocolCode?" · protocolo "+x.protocolCode+" v"+x.protocolVersionNo:""}`).join("\n")
      : "- Nenhum evento de monitoramento aberto.";

    const content = [
      `SITREP — SITUAÇÃO OPERACIONAL\nGerado em: ${generatedLabel}`,
      `1. RESUMO EXECUTIVO\nOcorrências ativas: ${s.activeIncidents??0} (P1: ${s.p1Incidents??0}; P2: ${s.p2Incidents??0})\nEventos de monitoramento abertos: ${s.openMonitoringEvents??0} (emergência: ${s.emergencyMonitoringEvents??0})\nAlertas publicados: ${s.publishedAlerts??0}\nAbrigos abertos/lotados: ${s.openShelters??0}\nFamílias desalojadas assistidas: ${s.displacedHouseholds??0}\nFamílias desabrigadas assistidas: ${s.homelessHouseholds??0}\nOperações SCO ativas: ${s.activeOperations??0}\nPeríodos operacionais ativos: ${s.activeOperationalPeriods??0}`,
      `2. OCORRÊNCIAS ATIVAS\n${incidentLines}`,
      `3. MONITORAMENTO E ALERTAS OPERACIONAIS\n${monitoringLines}`,
      "4. OBSERVAÇÕES DO COMANDO\n[Inserir avaliação do comando antes de encaminhar para revisão.]",
      "5. PRÓXIMAS AÇÕES\n[Registrar prioridades, responsáveis e prazos do próximo período operacional.]"
    ].join("\n\n");

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const year = new Date().getFullYear();
      const counter = await client.query<{ last_number: number }>(
        `INSERT INTO technical_document_counters(organization_id,year,document_type,last_number)
         VALUES($1,$2,'REPORT',1)
         ON CONFLICT(organization_id,year,document_type)
         DO UPDATE SET last_number=technical_document_counters.last_number+1
         RETURNING last_number`,
        [orgId,year]
      );
      const sequence = counter.rows[0]?.last_number;
      if (!sequence) throw new Error("Falha ao gerar numeração do SITREP.");
      const number = `REL-${year}-${String(sequence).padStart(6,"0")}`;
      const title = `SITREP — Situação Operacional — ${generatedLabel}`;
      const subject = "Situação operacional consolidada da Defesa Civil";
      const legalBasis = "Lei Federal nº 12.608/2012 e normas de proteção e defesa civil aplicáveis.";
      const contentHash = hashContent({documentType:"REPORT",number,title,subject,content,legalBasis});

      const created = await client.query<{id:string}>(
        `INSERT INTO technical_documents(
           organization_id,document_type,number,title,subject,content,legal_basis,
           revision,content_hash,created_by,source_type,source_snapshot
         ) VALUES($1,'REPORT',$2,$3,$4,$5::jsonb,$6,1,$7,$8,'SITREP',$9::jsonb)
         RETURNING id`,
        [orgId,number,title,subject,JSON.stringify({text:content}),legalBasis,contentHash,auth.userId,JSON.stringify(snapshot)]
      );
      const id=created.rows[0]?.id;
      if(!id) throw new Error("Falha ao criar SITREP.");

      await client.query(
        `INSERT INTO technical_document_versions(document_id,version_no,content,change_summary,created_by,content_hash,metadata)
         VALUES($1,1,$2::jsonb,'Geração automática do SITREP',$3,$4,$5::jsonb)`,
        [id,JSON.stringify({text:content}),auth.userId,contentHash,JSON.stringify({sourceType:"SITREP",generatedAt:snapshot.generatedAt})]
      );
      await client.query(
        `INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data,metadata)
         VALUES($1,'technical_document.sitrep_generate','technical_document',$2,$3,$4,$5::jsonb,$6::jsonb)`,
        [auth.userId,id,request.ip,request.headers["user-agent"]??null,JSON.stringify({number,status:"DRAFT",contentHash}),JSON.stringify({sourceType:"SITREP",generatedAt:snapshot.generatedAt})]
      );
      await client.query("COMMIT");
      return reply.code(201).send({document:{id,number,status:"DRAFT",revision:1},snapshot});
    } catch(error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/api/v1/technical-documents/:id/public-bulletin-draft", {
    preHandler: requirePermission("documents.manage")
  }, async (request, reply) => {
    const auth=authFrom(request);
    const orgId=organization(auth.organizationId);
    const {id}=request.params as {id:string};
    const source=await db.query(
      `SELECT id,number,status,content_hash AS "contentHash",source_type AS "sourceType",source_snapshot AS "sourceSnapshot"
         FROM technical_documents
        WHERE id=$1 AND organization_id=$2`,
      [id,orgId]
    );
    const sitrep=source.rows[0] as Record<string,any>|undefined;
    if(!sitrep)return reply.code(404).send({error:"NOT_FOUND"});
    if(sitrep.sourceType!=="SITREP")return reply.code(409).send({error:"SOURCE_NOT_SITREP"});
    if(!["APPROVED","ISSUED"].includes(String(sitrep.status)))return reply.code(409).send({error:"SITREP_NOT_APPROVED"});

    const content=buildPublicBulletinContent(sitrep.sourceSnapshot??{});
    const client=await db.connect();
    try{
      await client.query("BEGIN");
      const year=new Date().getFullYear();
      const counter=await client.query<{last_number:number}>(
        `INSERT INTO technical_document_counters(organization_id,year,document_type,last_number)
         VALUES($1,$2,'OTHER',1)
         ON CONFLICT(organization_id,year,document_type)
         DO UPDATE SET last_number=technical_document_counters.last_number+1
         RETURNING last_number`,
        [orgId,year]
      );
      const sequence=counter.rows[0]?.last_number;
      if(!sequence)throw new Error("Falha ao gerar numeração do boletim.");
      const number=`DOC-${year}-${String(sequence).padStart(6,"0")}`;
      const title="Boletim Público — Defesa Civil";
      const subject=`Boletim derivado do SITREP ${sitrep.number}`;
      const legalBasis="Lei Federal nº 12.608/2012 e normas de proteção e defesa civil aplicáveis.";
      const contentHash=hashContent({documentType:"OTHER",number,title,subject,content,legalBasis});
      const snapshot={sourceDocumentId:id,sourceNumber:sitrep.number,sourceHash:sitrep.contentHash,sourceSnapshot:sitrep.sourceSnapshot,generatedAt:new Date().toISOString()};
      const created=await client.query<{id:string}>(
        `INSERT INTO technical_documents(
          organization_id,document_type,number,title,subject,content,legal_basis,
          revision,content_hash,created_by,source_type,source_snapshot
        ) VALUES($1,'OTHER',$2,$3,$4,$5::jsonb,$6,1,$7,$8,'PUBLIC_BULLETIN',$9::jsonb)
        RETURNING id`,
        [orgId,number,title,subject,JSON.stringify({text:content}),legalBasis,contentHash,auth.userId,JSON.stringify(snapshot)]
      );
      const bulletinId=created.rows[0]?.id;
      if(!bulletinId)throw new Error("Falha ao criar boletim.");
      await client.query(
        `INSERT INTO technical_document_versions(document_id,version_no,content,change_summary,created_by,content_hash,metadata)
         VALUES($1,1,$2::jsonb,'Derivação de SITREP aprovado/emitido',$3,$4,$5::jsonb)`,
        [bulletinId,JSON.stringify({text:content}),auth.userId,contentHash,JSON.stringify({sourceDocumentId:id,sourceNumber:sitrep.number})]
      );
      await client.query(
        `INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data,metadata)
         VALUES($1,'technical_document.public_bulletin_generate','technical_document',$2,$3,$4,$5::jsonb,$6::jsonb)`,
        [auth.userId,bulletinId,request.ip,request.headers["user-agent"]??null,JSON.stringify({number,status:"DRAFT",contentHash}),JSON.stringify({sourceDocumentId:id,sourceNumber:sitrep.number})]
      );
      await client.query("COMMIT");
      return reply.code(201).send({document:{id:bulletinId,number,status:"DRAFT",revision:1},source:{id,number:sitrep.number}});
    }catch(error){
      await client.query("ROLLBACK");throw error;
    }finally{client.release();}
  });

  app.get("/api/v1/technical-documents/:id", {
    preHandler: requirePermission("documents.read")
  }, async (request, reply) => {
    const orgId = organization(authFrom(request).organizationId);
    const { id } = request.params as { id: string };
    const result = await db.query(
      `SELECT d.*, d.content->>'text' AS "contentText",
              o.name AS "organizationName", i.protocol,
              creator.display_name AS "createdByName",
              approver.display_name AS "approvedByName"
         FROM technical_documents d
         JOIN organizations o ON o.id = d.organization_id
         LEFT JOIN incidents i ON i.id = d.incident_id
         JOIN users creator ON creator.id = d.created_by
         LEFT JOIN users approver ON approver.id = d.approved_by
        WHERE d.id = $1 AND d.organization_id = $2`,
      [id, orgId]
    );
    if (!result.rows[0]) return reply.code(404).send({ error: "NOT_FOUND" });

    const versions = await db.query(
      `SELECT v.id, v.version_no AS "versionNo", v.change_summary AS "changeSummary",
              v.content_hash AS "contentHash", v.created_at AS "createdAt",
              u.display_name AS "createdByName"
         FROM technical_document_versions v
         JOIN users u ON u.id = v.created_by
        WHERE v.document_id = $1
        ORDER BY v.version_no DESC`,
      [id]
    );
    const signatures = await db.query(
      `SELECT s.id, s.signature_type AS "signatureType", s.content_hash AS "contentHash",
              s.signed_at AS "signedAt", s.note,
              u.display_name AS "displayName", u.matricula
         FROM technical_document_signatures s
         JOIN users u ON u.id = s.signed_by
        WHERE s.document_id = $1
        ORDER BY s.signed_at`,
      [id]
    );
    return { document: result.rows[0], versions: versions.rows, signatures: signatures.rows };
  });

  app.post("/api/v1/technical-documents", {
    preHandler: requirePermission("documents.manage")
  }, async (request, reply) => {
    const auth = authFrom(request);
    const orgId = organization(auth.organizationId);
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_INPUT", details: parsed.error.flatten() });
    }
    const value = parsed.data;
    const client = await db.connect();

    try {
      await client.query("BEGIN");
      const year = new Date().getFullYear();
      const counter = await client.query<{ last_number: number }>(
        `INSERT INTO technical_document_counters(organization_id, year, document_type, last_number)
         VALUES($1,$2,$3,1)
         ON CONFLICT(organization_id, year, document_type)
         DO UPDATE SET last_number = technical_document_counters.last_number + 1
         RETURNING last_number`,
        [orgId, year, value.documentType]
      );
      const sequence = counter.rows[0]?.last_number;
      if (!sequence) throw new Error("Falha ao gerar numeração do documento.");
      const number = `${typePrefixes[value.documentType]}-${year}-${String(sequence).padStart(6, "0")}`;

      const contentHash = hashContent({
        documentType: value.documentType,
        number,
        title: value.title,
        subject: value.subject,
        content: value.content,
        legalBasis: value.legalBasis,
        recipient: value.recipient,
        validUntil: value.validUntil
      });

      const created = await client.query<{ id: string }>(
        `INSERT INTO technical_documents(
           organization_id, incident_id, inspection_id, document_type, number,
           title, subject, content, legal_basis, recipient, valid_until,
           revision, content_hash, created_by
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,1,$12,$13)
         RETURNING id`,
        [
          orgId, value.incidentId ?? null, value.inspectionId ?? null,
          value.documentType, number, value.title, value.subject ?? null,
          JSON.stringify({ text: value.content }), value.legalBasis ?? null,
          value.recipient ?? null, value.validUntil ?? null, contentHash, auth.userId
        ]
      );
      const id = created.rows[0]?.id;
      if (!id) throw new Error("Falha ao criar documento.");

      await client.query(
        `INSERT INTO technical_document_versions(
           document_id, version_no, content, change_summary, created_by, content_hash, metadata
         ) VALUES($1,1,$2::jsonb,'Criação do documento',$3,$4,$5::jsonb)`,
        [
          id, JSON.stringify({ text: value.content }), auth.userId, contentHash,
          JSON.stringify({ title: value.title, subject: value.subject, legalBasis: value.legalBasis })
        ]
      );
      await client.query(
        `INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,after_data)
         VALUES($1,'technical_document.create','technical_document',$2,$3,$4,$5::jsonb)`,
        [
          auth.userId, id, request.ip, request.headers["user-agent"] ?? null,
          JSON.stringify({ number, status: "DRAFT", revision: 1, contentHash })
        ]
      );
      await client.query("COMMIT");
      return reply.code(201).send({ document: { id, number, status: "DRAFT", revision: 1 } });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.patch("/api/v1/technical-documents/:id", {
    preHandler: requirePermission("documents.manage")
  }, async (request, reply) => {
    const auth = authFrom(request);
    const orgId = organization(auth.organizationId);
    const { id } = request.params as { id: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_INPUT", details: parsed.error.flatten() });
    }
    const value = parsed.data;
    const client = await db.connect();

    try {
      await client.query("BEGIN");
      const current = await client.query<Record<string, any>>(
        `SELECT * FROM technical_documents
          WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
        [id, orgId]
      );
      const document = current.rows[0];
      if (!document) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "NOT_FOUND" });
      }
      if (document.status !== "DRAFT") {
        await client.query("ROLLBACK");
        return reply.code(409).send({
          error: "DOCUMENT_LOCKED",
          message: "Somente documentos em rascunho podem ser alterados."
        });
      }

      const contentText = value.content ?? document.content?.text ?? "";
      const title = value.title ?? document.title;
      const subject = value.subject ?? document.subject;
      const legalBasis = value.legalBasis ?? document.legal_basis;
      const recipient = value.recipient ?? document.recipient;
      const validUntil = value.validUntil ?? document.valid_until;
      const contentHash = hashContent({
        documentType: document.document_type,
        number: document.number,
        title, subject, content: contentText, legalBasis, recipient, validUntil
      });
      const revision = Number(document.revision) + 1;

      await client.query(
        `UPDATE technical_documents
            SET title=$1, subject=$2, content=$3::jsonb, legal_basis=$4,
                recipient=$5, valid_until=$6, revision=$7, content_hash=$8, updated_at=now()
          WHERE id=$9`,
        [
          title, subject ?? null, JSON.stringify({ text: contentText }), legalBasis ?? null,
          recipient ?? null, validUntil ?? null, revision, contentHash, id
        ]
      );
      await client.query(
        `INSERT INTO technical_document_versions(
           document_id, version_no, content, change_summary, created_by, content_hash, metadata
         ) VALUES($1,$2,$3::jsonb,$4,$5,$6,$7::jsonb)`,
        [
          id, revision, JSON.stringify({ text: contentText }), value.changeSummary,
          auth.userId, contentHash, JSON.stringify({ title, subject, legalBasis, recipient })
        ]
      );
      await client.query(
        `INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data)
         VALUES($1,'technical_document.update','technical_document',$2,$3,$4,$5::jsonb,$6::jsonb)`,
        [
          auth.userId, id, request.ip, request.headers["user-agent"] ?? null,
          JSON.stringify({ revision: document.revision, contentHash: document.content_hash }),
          JSON.stringify({ revision, contentHash, changeSummary: value.changeSummary })
        ]
      );
      await client.query("COMMIT");
      return { ok: true, revision, contentHash };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  async function transition(
    request: FastifyRequest,
    reply: any,
    from: string[],
    to: string,
    signatureType?: "APPROVAL" | "ISSUANCE" | "CANCELLATION"
  ) {
    const auth = authFrom(request);
    const orgId = organization(auth.organizationId);
    const { id } = request.params as { id: string };
    const parsed = noteSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_INPUT" });
    const client = await db.connect();

    try {
      await client.query("BEGIN");
      const current = await client.query<Record<string, any>>(
        "SELECT * FROM technical_documents WHERE id=$1 AND organization_id=$2 FOR UPDATE",
        [id, orgId]
      );
      const document = current.rows[0];
      if (!document) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "NOT_FOUND" });
      }
      if (!from.includes(document.status)) {
        await client.query("ROLLBACK");
        return reply.code(409).send({
          error: "INVALID_TRANSITION",
          message: `Transição de ${document.status} para ${to} não permitida.`
        });
      }

      const approval = to === "APPROVED";
      const issuance = to === "ISSUED";
      const cancellation = to === "CANCELLED";
      await client.query(
        `UPDATE technical_documents
            SET status=$1,
                approved_by=CASE WHEN $2 THEN $3 ELSE approved_by END,
                approved_at=CASE WHEN $2 THEN now() ELSE approved_at END,
                issued_at=CASE WHEN $4 THEN now() ELSE issued_at END,
                cancelled_by=CASE WHEN $5 THEN $3 ELSE cancelled_by END,
                cancelled_at=CASE WHEN $5 THEN now() ELSE cancelled_at END,
                updated_at=now()
          WHERE id=$6`,
        [to, approval, auth.userId, issuance, cancellation, id]
      );

      if (signatureType) {
        await client.query(
          `INSERT INTO technical_document_signatures(
             document_id, signature_type, signed_by, content_hash, ip, user_agent, note
           ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            id, signatureType, auth.userId, document.content_hash, request.ip,
            request.headers["user-agent"] ?? null, parsed.data.note ?? null
          ]
        );
      }
      await client.query(
        `INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,ip,user_agent,before_data,after_data)
         VALUES($1,$2,'technical_document',$3,$4,$5,$6::jsonb,$7::jsonb)`,
        [
          auth.userId, `technical_document.${to.toLowerCase()}`, id,
          request.ip, request.headers["user-agent"] ?? null,
          JSON.stringify({ status: document.status }),
          JSON.stringify({ status: to, note: parsed.data.note })
        ]
      );
      await client.query("COMMIT");
      return { ok: true, status: to };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  app.post("/api/v1/technical-documents/:id/submit", {
    preHandler: requirePermission("documents.manage")
  }, (request, reply) => transition(request, reply, ["DRAFT"], "REVIEW"));

  app.post("/api/v1/technical-documents/:id/return", {
    preHandler: requirePermission("documents.review")
  }, (request, reply) => transition(request, reply, ["REVIEW","APPROVED"], "DRAFT"));

  app.post("/api/v1/technical-documents/:id/approve", {
    preHandler: requirePermission("documents.approve")
  }, (request, reply) => transition(request, reply, ["REVIEW"], "APPROVED", "APPROVAL"));

  app.post("/api/v1/technical-documents/:id/issue", {
    preHandler: requirePermission("documents.issue")
  }, (request, reply) => transition(request, reply, ["APPROVED"], "ISSUED", "ISSUANCE"));

  app.post("/api/v1/technical-documents/:id/cancel", {
    preHandler: requirePermission("documents.issue")
  }, (request, reply) => transition(request, reply, ["ISSUED"], "CANCELLED", "CANCELLATION"));

  app.get("/api/v1/technical-documents/:id/pdf", {
    preHandler: requirePermission("documents.read")
  }, async (request, reply) => {
    const orgId = organization(authFrom(request).organizationId);
    const { id } = request.params as { id: string };
    const result = await db.query<Record<string, any>>(
      `SELECT d.id, d.document_type AS "documentType", d.number, d.title,
              d.subject, d.status, d.revision, d.content->>'text' AS "contentText",
              d.legal_basis AS "legalBasis", d.recipient,
              d.valid_until AS "validUntil", d.content_hash AS "contentHash",
              o.name AS "organizationName", i.protocol
         FROM technical_documents d
         JOIN organizations o ON o.id = d.organization_id
         LEFT JOIN incidents i ON i.id = d.incident_id
        WHERE d.id=$1 AND d.organization_id=$2`,
      [id, orgId]
    );
    const document = result.rows[0];
    if (!document) return reply.code(404).send({ error: "NOT_FOUND" });

    const signatures = await db.query<Record<string, any>>(
      `SELECT s.signature_type AS "signatureType", s.signed_at AS "signedAt",
              u.display_name AS "displayName", u.matricula
         FROM technical_document_signatures s
         JOIN users u ON u.id=s.signed_by
        WHERE s.document_id=$1
        ORDER BY s.signed_at`,
      [id]
    );
    const pdf = await buildPdf(document, signatures.rows);
    const filename = String(document.number ?? id).replace(/[^0-9A-Za-z_-]/g, "_");
    return reply
      .type("application/pdf")
      .header("Content-Disposition", `inline; filename="${filename}.pdf"`)
      .header("Content-Length", String(pdf.length))
      .send(pdf);
  });
}
