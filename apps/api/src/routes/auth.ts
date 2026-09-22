import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { z } from "zod";
import {
  authFrom,
  clearSessionCookie,
  createSession,
  loadAccess,
  normalizeMatricula,
  requireAuth,
  setSessionCookie
} from "../auth.js";
import { db } from "../db.js";

const loginSchema = z.object({
  matricula: z.string().min(1).max(32),
  password: z.string().min(8).max(256)
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(256),
  newPassword: z.string()
    .min(12)
    .max(256)
    .regex(/[a-z]/, "A nova senha deve conter letra minúscula.")
    .regex(/[A-Z]/, "A nova senha deve conter letra maiúscula.")
    .regex(/[0-9]/, "A nova senha deve conter número.")
    .regex(/[^A-Za-z0-9]/, "A nova senha deve conter caractere especial.")
}).refine(
  (data) => data.currentPassword !== data.newPassword,
  { message: "A nova senha deve ser diferente da senha temporária.", path: ["newPassword"] }
);

async function audit(params: {
  userId?: string | null;
  action: string;
  entityId?: string | null;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}) {
  await db.query(
    `INSERT INTO audit_logs
       (actor_user_id, action, entity_type, entity_id, ip, user_agent, metadata)
     VALUES ($1, $2, 'auth', $3, $4, $5, $6::jsonb)`,
    [
      params.userId ?? null,
      params.action,
      params.entityId ?? null,
      params.ip ?? null,
      params.userAgent ?? null,
      JSON.stringify(params.metadata ?? {})
    ]
  );
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } }
  }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_INPUT", message: "Matrícula ou senha inválida." });
    }

    const matricula = normalizeMatricula(parsed.data.matricula);
    const result = await db.query<{
      id: string;
      organization_id: string | null;
      matricula: string;
      display_name: string;
      email: string | null;
      job_title: string | null;
      department: string | null;
      password_hash: string;
      active: boolean;
      failed_login_attempts: number;
      locked_until: Date | null;
      must_change_password: boolean;
      mfa_required: boolean;
      mfa_enabled: boolean;
    }>(
      `SELECT id, organization_id, matricula, display_name, email, job_title, department,
              password_hash, active, failed_login_attempts, locked_until, must_change_password,
              mfa_required, mfa_enabled
         FROM users
        WHERE matricula = $1
        ORDER BY created_at ASC
        LIMIT 1`,
      [matricula]
    );

    const user = result.rows[0];
    const genericFailure = {
      error: "INVALID_CREDENTIALS",
      message: "Matrícula ou senha incorreta."
    };

    if (!user || !user.active) {
      await audit({
        action: "auth.login_failed",
        ip: request.ip,
        userAgent: request.headers["user-agent"],
        metadata: { reason: "invalid_credentials", matricula }
      });
      return reply.code(401).send(genericFailure);
    }

    if (user.locked_until && user.locked_until.getTime() > Date.now()) {
      await audit({
        userId: user.id,
        action: "auth.login_blocked",
        entityId: user.id,
        ip: request.ip,
        userAgent: request.headers["user-agent"]
      });
      return reply.code(423).send({
        error: "ACCOUNT_LOCKED",
        message: "Conta temporariamente bloqueada por tentativas inválidas."
      });
    }

    const passwordOk = await argon2.verify(user.password_hash, parsed.data.password);

    if (!passwordOk) {
      const nextAttempts = user.failed_login_attempts + 1;
      await db.query(
        `UPDATE users
            SET failed_login_attempts = $2,
                locked_until = CASE WHEN $2 >= 5 THEN now() + interval '15 minutes' ELSE NULL END,
                updated_at = now()
          WHERE id = $1`,
        [user.id, nextAttempts]
      );

      await audit({
        userId: user.id,
        action: "auth.login_failed",
        entityId: user.id,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
        metadata: { attempts: nextAttempts }
      });

      return reply.code(401).send(genericFailure);
    }

    await db.query(
      `UPDATE users
          SET failed_login_attempts = 0,
              locked_until = NULL,
              last_login_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [user.id]
    );

    const access = await loadAccess(user.id);
    const session = await createSession({
      userId: user.id,
      organizationId: user.organization_id,
      roles: access.roles,
      permissions: access.permissions,
      ip: request.ip,
      userAgent: request.headers["user-agent"]
    });

    setSessionCookie(reply, session.token, session.expiresAt);

    await audit({
      userId: user.id,
      action: "auth.login_success",
      entityId: user.id,
      ip: request.ip,
      userAgent: request.headers["user-agent"],
      metadata: { sessionId: session.sessionId }
    });

    return {
      user: {
        id: user.id,
        matricula: user.matricula,
        displayName: user.display_name,
        email: user.email,
        jobTitle: user.job_title,
        department: user.department,
        roles: access.roles,
        permissions: access.permissions,
        mustChangePassword: user.must_change_password,
        mfaRequired: user.mfa_required,
        mfaEnabled: user.mfa_enabled
      }
    };
  });

  app.post("/auth/change-password", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "INVALID_INPUT",
        message: "A nova senha deve ter ao menos 12 caracteres, com maiúscula, minúscula, número e caractere especial.",
        details: parsed.error.flatten()
      });
    }

    const auth = authFrom(request);
    const result = await db.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id = $1 AND active = true",
      [auth.userId]
    );
    const user = result.rows[0];

    if (!user || !(await argon2.verify(user.password_hash, parsed.data.currentPassword))) {
      await audit({
        userId: auth.userId,
        action: "auth.password_change_failed",
        entityId: auth.userId,
        ip: request.ip,
        userAgent: request.headers["user-agent"]
      });
      return reply.code(401).send({
        error: "INVALID_CURRENT_PASSWORD",
        message: "A senha atual está incorreta."
      });
    }

    const passwordHash = await argon2.hash(parsed.data.newPassword, { type: argon2.argon2id });
    await db.query(
      `UPDATE users
          SET password_hash = $2,
              must_change_password = false,
              failed_login_attempts = 0,
              locked_until = NULL,
              updated_at = now()
        WHERE id = $1`,
      [auth.userId, passwordHash]
    );
    await db.query(
      `UPDATE auth_sessions
          SET revoked_at = now()
        WHERE user_id = $1
          AND id <> $2
          AND revoked_at IS NULL`,
      [auth.userId, auth.sessionId]
    );

    await audit({
      userId: auth.userId,
      action: "auth.password_changed",
      entityId: auth.userId,
      ip: request.ip,
      userAgent: request.headers["user-agent"],
      metadata: { forced: true }
    });

    return { ok: true };
  });

  app.get("/auth/me", { preHandler: requireAuth }, async (request, reply) => {
    const auth = authFrom(request);
    const result = await db.query<{
      id: string;
      matricula: string;
      display_name: string;
      email: string | null;
      job_title: string | null;
      department: string | null;
      must_change_password: boolean;
      mfa_required: boolean;
      mfa_enabled: boolean;
    }>(
      `SELECT id, matricula, display_name, email, job_title, department,
              must_change_password, mfa_required, mfa_enabled
         FROM users
        WHERE id = $1 AND active = true`,
      [auth.userId]
    );

    const user = result.rows[0];
    if (!user) {
      clearSessionCookie(reply);
      return reply.code(401).send({ error: "UNAUTHENTICATED" });
    }

    return {
      user: {
        id: user.id,
        matricula: user.matricula,
        displayName: user.display_name,
        email: user.email,
        jobTitle: user.job_title,
        department: user.department,
        roles: auth.roles,
        permissions: auth.permissions,
        mustChangePassword: user.must_change_password,
        mfaRequired: user.mfa_required,
        mfaEnabled: user.mfa_enabled
      }
    };
  });

  app.post("/auth/logout", { preHandler: requireAuth }, async (request, reply) => {
    const auth = authFrom(request);
    await db.query(
      `UPDATE auth_sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2`,
      [auth.sessionId, auth.userId]
    );

    await audit({
      userId: auth.userId,
      action: "auth.logout",
      entityId: auth.userId,
      ip: request.ip,
      userAgent: request.headers["user-agent"],
      metadata: { sessionId: auth.sessionId }
    });

    clearSessionCookie(reply);
    return { ok: true };
  });
}
