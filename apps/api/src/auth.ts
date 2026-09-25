import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { db } from "./db.js";

const COOKIE_NAME = "sigdec_session";

export type AuthContext = {
  userId: string;
  sessionId: string;
  organizationId: string | null;
  roles: string[];
  permissions: string[];
};

type SigdecPayload = JWTPayload & {
  sid: string;
  org: string | null;
  roles: string[];
  permissions: string[];
};

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET deve possuir pelo menos 32 caracteres.");
  }
  return new TextEncoder().encode(secret);
}

export function normalizeMatricula(value: string) {
  return value.trim().replace(/[^0-9A-Za-z_-]/g, "").toUpperCase();
}

export async function loadAccess(userId: string) {
  const roles = await db.query<{ code: string }>(
    `SELECT DISTINCT r.code
       FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id
      WHERE ur.user_id = $1
      ORDER BY r.code`,
    [userId]
  );

  const permissions = await db.query<{ code: string }>(
    `SELECT DISTINCT p.code
       FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       JOIN user_roles ur ON ur.role_id = rp.role_id
      WHERE ur.user_id = $1
      ORDER BY p.code`,
    [userId]
  );

  return {
    roles: roles.rows.map((row) => row.code),
    permissions: permissions.rows.map((row) => row.code)
  };
}

const FEATURE_PERMISSION_PREFIXES: Array<[string,string]> = [
  ["incidents.","incidents"],["dispatch.","dispatch"],["field.","field"],["inspections.","inspections"],
  ["monitoring.","monitoring"],["alerts.","alerts"],["humanitarian.","humanitarian"],["volunteers.","volunteers"],
  ["communications.","communications"],["documents.","documents"],["sco.","sco"],["risks.","risks"],
  ["s2id.","s2id"],["training.","training"],["recovery.","recovery"],["library.","library"],
  ["bi.","bi"],["assistive.","assistive"],["sidec_continuity","sidec-continuity"],["sidec.","sidec"]
];

export function featureCodeForPermission(permission:string){
  return FEATURE_PERMISSION_PREFIXES.find(([prefix])=>permission.startsWith(prefix))?.[1]??null;
}

export async function isFeatureEnabled(organizationId:string|null,code:string){
  if(!organizationId)return true;
  const result=await db.query<{enabled:boolean}>(
    "SELECT enabled FROM feature_flags WHERE organization_id=$1 AND code=$2",
    [organizationId,code]
  );
  return result.rows[0]?.enabled??true;
}

export async function hasLivePermission(userId: string, permission: string) {
  const result = await db.query(
    `SELECT 1
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE u.id = $1
        AND u.active = true
        AND p.code IN ($2, 'system.master')
      LIMIT 1`,
    [userId, permission]
  );
  return result.rowCount === 1;
}

export async function createSession(params: {
  userId: string;
  organizationId: string | null;
  roles: string[];
  permissions: string[];
  ip?: string;
  userAgent?: string;
  mfaVerified?: boolean;
}) {
  const sessionId = randomUUID();
  const sessionHours = Math.max(1, Math.min(24, Number(process.env.SESSION_HOURS ?? 8)));
  const expiresAt = new Date(Date.now() + sessionHours * 60 * 60 * 1000);

  await db.query(
    `INSERT INTO auth_sessions
       (id, user_id, expires_at, ip, user_agent, mfa_verified_at)
     VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN now() ELSE NULL END)`,
    [sessionId, params.userId, expiresAt, params.ip ?? null, params.userAgent ?? null, params.mfaVerified === true]
  );

  const token = await new SignJWT({
    sid: sessionId,
    org: params.organizationId,
    roles: params.roles,
    permissions: params.permissions
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(params.userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(jwtSecret());

  return { sessionId, token, expiresAt };
}

export async function readSessionToken(token: string): Promise<AuthContext> {
  const result = await jwtVerify(token, jwtSecret(), { algorithms: ["HS256"] });
  const payload = result.payload as SigdecPayload;

  if (!payload.sub || !payload.sid || !Array.isArray(payload.roles) || !Array.isArray(payload.permissions)) {
    throw new Error("Sessão inválida.");
  }

  const strategicLevel=Math.max(1,Math.min(100,Number(process.env.MFA_STRATEGIC_ROLE_LEVEL??80)));
  const active = await db.query(
    `SELECT 1
       FROM auth_sessions s
       JOIN users u ON u.id=s.user_id AND u.active=true
      WHERE s.id = $1
        AND s.user_id = $2
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND (
          (
            u.mfa_required=false
            AND NOT EXISTS(
              SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id
              WHERE ur.user_id=u.id AND r.level >= $3
            )
          )
          OR s.mfa_verified_at IS NOT NULL
        )`,
    [payload.sid, payload.sub, strategicLevel]
  );

  if (active.rowCount !== 1) {
    throw new Error("Sessão expirada ou revogada.");
  }

  return {
    userId: payload.sub,
    sessionId: payload.sid,
    organizationId: payload.org ?? null,
    roles: payload.roles,
    permissions: payload.permissions
  };
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[COOKIE_NAME];
  if (!token) {
    return reply.code(401).send({ error: "UNAUTHENTICATED", message: "Autenticação necessária." });
  }

  try {
    const auth = await readSessionToken(token);
    (request as FastifyRequest & { auth: AuthContext }).auth = auth;
  } catch {
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return reply.code(401).send({ error: "UNAUTHENTICATED", message: "Sessão inválida ou expirada." });
  }
}

export function requirePermission(permission: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(request, reply);
    if (reply.sent) return;

    const auth = authFrom(request);
    const userState = await db.query<{ must_change_password: boolean; organization_id: string | null }>(
      "SELECT must_change_password, organization_id::text AS organization_id FROM users WHERE id = $1 AND active = true",
      [auth.userId]
    );

    const user = userState.rows[0];
    if (!user) {
      return reply.code(401).send({
        error: "UNAUTHENTICATED",
        message: "Usuário inativo ou inexistente."
      });
    }

    if ((user.organization_id ?? null) !== (auth.organizationId ?? null)) {
      return reply.code(401).send({
        error: "SESSION_CONTEXT_STALE",
        message: "A vinculação organizacional mudou. Entre novamente para atualizar a sessão."
      });
    }

    if (user.must_change_password) {
      return reply.code(403).send({
        error: "PASSWORD_CHANGE_REQUIRED",
        message: "Altere a senha temporária antes de continuar."
      });
    }

    if (!(await hasLivePermission(auth.userId, permission))) {
      return reply.code(403).send({
        error: "FORBIDDEN",
        message: "Permissão insuficiente para esta operação."
      });
    }

    const featureCode=featureCodeForPermission(permission);
    if(featureCode&&!(await isFeatureEnabled(auth.organizationId,featureCode))){
      return reply.code(403).send({
        error:"FEATURE_DISABLED",
        featureCode,
        message:"Este módulo está desativado para a organização."
      });
    }
  };
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date) {
  reply.setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(COOKIE_NAME, { path: "/" });
}

export function authFrom(request: FastifyRequest) {
  return (request as FastifyRequest & { auth: AuthContext }).auth;
}
