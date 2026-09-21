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

export async function createSession(params: {
  userId: string;
  organizationId: string | null;
  roles: string[];
  permissions: string[];
  ip?: string;
  userAgent?: string;
}) {
  const sessionId = randomUUID();
  const sessionHours = Math.max(1, Math.min(24, Number(process.env.SESSION_HOURS ?? 8)));
  const expiresAt = new Date(Date.now() + sessionHours * 60 * 60 * 1000);

  await db.query(
    `INSERT INTO auth_sessions
       (id, user_id, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [sessionId, params.userId, expiresAt, params.ip ?? null, params.userAgent ?? null]
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

  const active = await db.query(
    `SELECT 1
       FROM auth_sessions
      WHERE id = $1
        AND user_id = $2
        AND revoked_at IS NULL
        AND expires_at > now()`,
    [payload.sid, payload.sub]
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
