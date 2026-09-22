import "dotenv/config";
import argon2 from "argon2";
import { db } from "../db.js";
import { normalizeMatricula } from "../auth.js";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} não configurada.`);
  return value;
}

const matricula = normalizeMatricula(required("SIGDEC_MASTER_MATRICULA"));
const name = required("SIGDEC_MASTER_NAME");
const password = required("SIGDEC_MASTER_PASSWORD");
const orgName = required("SIGDEC_ORG_NAME");
const orgSlug = required("SIGDEC_ORG_SLUG").toLowerCase();

if (password.length < 14) {
  throw new Error("A senha inicial Master deve ter no mínimo 14 caracteres.");
}

const client = await db.connect();

try {
  await client.query("BEGIN");

  const org = await client.query<{ id: string }>(
    `INSERT INTO organizations (name, slug, type)
     VALUES ($1, $2, 'municipality')
     ON CONFLICT (slug) WHERE slug IS NOT NULL
     DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [orgName, orgSlug]
  );

  const organizationId = org.rows[0]?.id;
  if (!organizationId) throw new Error("Falha ao criar/localizar organização.");

  const existing = await client.query<{ id: string }>(
    `SELECT id FROM users WHERE organization_id = $1 AND matricula = $2 LIMIT 1`,
    [organizationId, matricula]
  );

  let userId = existing.rows[0]?.id;

  if (!userId) {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    const created = await client.query<{ id: string }>(
      `INSERT INTO users
       (organization_id, matricula, display_name, email, phone, job_title, department,
        password_hash, active, must_change_password, mfa_required)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,true,true)
       RETURNING id`,
      [
        organizationId,
        matricula,
        name,
        process.env.SIGDEC_MASTER_EMAIL?.trim() || null,
        process.env.SIGDEC_MASTER_PHONE?.trim() || null,
        process.env.SIGDEC_MASTER_JOB_TITLE?.trim() || null,
        process.env.SIGDEC_MASTER_DEPARTMENT?.trim() || null,
        passwordHash
      ]
    );
    userId = created.rows[0]?.id;
  } else {
    await client.query(
      `UPDATE users
          SET display_name = $2,
              email = COALESCE(NULLIF($3, ''), email),
              phone = COALESCE(NULLIF($4, ''), phone),
              job_title = COALESCE(NULLIF($5, ''), job_title),
              department = COALESCE(NULLIF($6, ''), department),
              active = true,
              updated_at = now()
        WHERE id = $1`,
      [
        userId,
        name,
        process.env.SIGDEC_MASTER_EMAIL?.trim() ?? "",
        process.env.SIGDEC_MASTER_PHONE?.trim() ?? "",
        process.env.SIGDEC_MASTER_JOB_TITLE?.trim() ?? "",
        process.env.SIGDEC_MASTER_DEPARTMENT?.trim() ?? ""
      ]
    );
  }

  if (!userId) throw new Error("Falha ao provisionar usuário Master.");

  await client.query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT $1::uuid, id FROM roles WHERE code = 'MASTER'
     ON CONFLICT DO NOTHING`,
    [userId]
  );

  await client.query(
    `INSERT INTO audit_logs
     (actor_user_id, action, entity_type, entity_id, metadata)
     VALUES ($1::uuid, 'system.master_bootstrap', 'user', $2::text, $3::jsonb)`,
    [userId, userId, JSON.stringify({ organizationId })]
  );

  await client.query("COMMIT");
  console.log(`Master provisionado com sucesso para a matrícula ${matricula}.`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await db.end();
}
