import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import QRCode from "qrcode";
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
import { isMailConfigured, sendPasswordResetEmail } from "../mail.js";
import {
  buildTotpUri,
  decryptMfaSecret,
  encryptMfaSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  verifyTotp
} from "../lib/mfa.js";

const loginSchema = z.object({
  matricula: z.string().min(1).max(32),
  password: z.string().min(8).max(256),
  mfaCode: z.string().trim().min(6).max(64).optional()
});
const mfaVerifySchema=z.object({code:z.string().trim().min(6).max(64)});

const strongPasswordSchema = z.string()
  .min(12)
  .max(256)
  .regex(/[a-z]/, "A nova senha deve conter letra minúscula.")
  .regex(/[A-Z]/, "A nova senha deve conter letra maiúscula.")
  .regex(/[0-9]/, "A nova senha deve conter número.")
  .regex(/[^A-Za-z0-9]/, "A nova senha deve conter caractere especial.");

const changePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(256),
  newPassword: strongPasswordSchema
}).refine(
  (data) => data.currentPassword !== data.newPassword,
  { message: "A nova senha deve ser diferente da senha temporária.", path: ["newPassword"] }
);

const forgotPasswordSchema = z.object({
  identifier: z.string().trim().min(1).max(254)
});

const resetPasswordSchema = z.object({
  token: z.string().min(40).max(256),
  newPassword: strongPasswordSchema
});

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
  app.post("/auth/forgot-password", {
    config: { rateLimit: { max: 5, timeWindow: "15 minutes" } }
  }, async (request, reply) => {
    const parsed = forgotPasswordSchema.safeParse(request.body);
    const genericResponse = {
      ok: true,
      message: "Se houver uma conta ativa com e-mail cadastrado, enviaremos as instruções de redefinição."
    };

    if (!parsed.success) {
      return reply.code(200).send(genericResponse);
    }

    const identifier = parsed.data.identifier;
    const byEmail = identifier.includes("@");
    const result = byEmail
      ? await db.query<{
          id: string;
          email: string | null;
          display_name: string;
        }>(
          `SELECT id, email, display_name
             FROM users
            WHERE lower(email) = lower($1)
              AND active = true
            ORDER BY created_at ASC
            LIMIT 1`,
          [identifier]
        )
      : await db.query<{
          id: string;
          email: string | null;
          display_name: string;
        }>(
          `SELECT id, email, display_name
             FROM users
            WHERE matricula = $1
              AND active = true
            ORDER BY created_at ASC
            LIMIT 1`,
          [normalizeMatricula(identifier)]
        );

    const user = result.rows[0];
    if (!user?.email || !isMailConfigured()) {
      await audit({
        userId: user?.id ?? null,
        action: "auth.password_reset_requested",
        entityId: user?.id ?? null,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
        metadata: {
          delivery: user?.email ? "mail_not_configured" : "account_or_email_unavailable"
        }
      });
      return reply.code(200).send(genericResponse);
    }

    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresMinutes = Math.max(
      10,
      Math.min(120, Number(process.env.PASSWORD_RESET_MINUTES ?? 30))
    );
    const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000);

    await db.query(
      `UPDATE password_reset_tokens
          SET used_at = now()
        WHERE user_id = $1
          AND used_at IS NULL`,
      [user.id]
    );

    const inserted = await db.query<{ id: string }>(
      `INSERT INTO password_reset_tokens
         (user_id, token_hash, expires_at, requested_ip, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        user.id,
        tokenHash,
        expiresAt,
        request.ip,
        request.headers["user-agent"] ?? null
      ]
    );

    const resetUrl = `${process.env.SIGDEC_PUBLIC_URL ?? "http://localhost:3000"}/redefinir-senha?token=${encodeURIComponent(token)}`;

    try {
      await sendPasswordResetEmail({
        to: user.email,
        displayName: user.display_name,
        resetUrl,
        expiresMinutes
      });
      await audit({
        userId: user.id,
        action: "auth.password_reset_requested",
        entityId: user.id,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
        metadata: { delivery: "email_sent", expiresMinutes }
      });
    } catch (error) {
      await db.query(
        "DELETE FROM password_reset_tokens WHERE id = $1",
        [inserted.rows[0]?.id]
      );
      request.log.error(
        { err: error, userId: user.id },
        "Falha ao enviar e-mail de redefinição de senha"
      );
      await audit({
        userId: user.id,
        action: "auth.password_reset_delivery_failed",
        entityId: user.id,
        ip: request.ip,
        userAgent: request.headers["user-agent"]
      });
    }

    return reply.code(200).send(genericResponse);
  });

  app.post("/auth/reset-password", {
    config: { rateLimit: { max: 5, timeWindow: "15 minutes" } }
  }, async (request, reply) => {
    const parsed = resetPasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "INVALID_INPUT",
        message: "Token ou nova senha inválidos.",
        details: parsed.error.flatten()
      });
    }

    const tokenHash = createHash("sha256")
      .update(parsed.data.token)
      .digest("hex");
    const client = await db.connect();

    try {
      await client.query("BEGIN");
      const tokenResult = await client.query<{
        id: string;
        user_id: string;
      }>(
        `SELECT prt.id, prt.user_id
           FROM password_reset_tokens prt
           JOIN users u ON u.id = prt.user_id
          WHERE prt.token_hash = $1
            AND prt.used_at IS NULL
            AND prt.expires_at > now()
            AND u.active = true
          FOR UPDATE OF prt`,
        [tokenHash]
      );

      const resetToken = tokenResult.rows[0];
      if (!resetToken) {
        await client.query("ROLLBACK");
        return reply.code(400).send({
          error: "INVALID_OR_EXPIRED_TOKEN",
          message: "Este link é inválido, já foi utilizado ou expirou."
        });
      }

      const passwordHash = await argon2.hash(parsed.data.newPassword, {
        type: argon2.argon2id
      });

      await client.query(
        `UPDATE users
            SET password_hash = $2,
                must_change_password = false,
                failed_login_attempts = 0,
                locked_until = NULL,
                updated_at = now()
          WHERE id = $1`,
        [resetToken.user_id, passwordHash]
      );
      await client.query(
        `UPDATE password_reset_tokens
            SET used_at = now()
          WHERE user_id = $1
            AND used_at IS NULL`,
        [resetToken.user_id]
      );
      await client.query(
        `UPDATE auth_sessions
            SET revoked_at = now()
          WHERE user_id = $1
            AND revoked_at IS NULL`,
        [resetToken.user_id]
      );
      await client.query("COMMIT");

      await audit({
        userId: resetToken.user_id,
        action: "auth.password_reset_completed",
        entityId: resetToken.user_id,
        ip: request.ip,
        userAgent: request.headers["user-agent"]
      });

      return { ok: true, message: "Senha redefinida com sucesso." };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/auth/login", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } }
  }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_INPUT", message: "Matrícula, senha ou segundo fator inválidos." });
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

    let mfaVerified=false;
    if(user.mfa_enabled){
      if(!parsed.data.mfaCode){
        return reply.code(202).send({
          mfaRequired:true,
          message:"Informe o código do aplicativo autenticador ou um código de recuperação."
        });
      }

      const credential=await db.query<{secret_ciphertext:string}>(
        `SELECT secret_ciphertext FROM mfa_totp_credentials
          WHERE user_id=$1 AND verified_at IS NOT NULL`,
        [user.id]
      );
      const encrypted=credential.rows[0]?.secret_ciphertext;
      if(!encrypted){
        await audit({
          userId:user.id,action:"auth.mfa_failed",entityId:user.id,ip:request.ip,
          userAgent:request.headers["user-agent"],metadata:{reason:"credential_missing"}
        });
        return reply.code(403).send({error:"MFA_CREDENTIAL_MISSING",message:"A credencial MFA precisa ser reconfigurada."});
      }

      let valid=false,recoveryCodeUsed=false;
      const code=parsed.data.mfaCode.trim();
      if(/^\d{6}$/.test(code)){
        try{valid=verifyTotp(decryptMfaSecret(encrypted),code)}catch{valid=false}
      }else{
        const recoveryHash=hashRecoveryCode(code);
        const client=await db.connect();
        try{
          await client.query("BEGIN");
          const recovery=await client.query<{id:string}>(
            `SELECT id FROM recovery_codes
              WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL
              ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
            [user.id,recoveryHash]
          );
          if(recovery.rows[0]){
            await client.query("UPDATE recovery_codes SET used_at=now() WHERE id=$1",[recovery.rows[0].id]);
            valid=true;recoveryCodeUsed=true;
          }
          await client.query("COMMIT");
        }catch(error){
          await client.query("ROLLBACK");throw error;
        }finally{client.release();}
      }

      if(!valid){
        const nextAttempts=user.failed_login_attempts+1;
        await db.query(
          `UPDATE users SET failed_login_attempts=$2,
             locked_until=CASE WHEN $2>=5 THEN now()+interval '15 minutes' ELSE NULL END,
             updated_at=now() WHERE id=$1`,
          [user.id,nextAttempts]
        );
        await audit({
          userId:user.id,action:"auth.mfa_failed",entityId:user.id,ip:request.ip,
          userAgent:request.headers["user-agent"],metadata:{attempts:nextAttempts}
        });
        return reply.code(401).send({error:"INVALID_MFA",message:"Código de autenticação inválido."});
      }
      mfaVerified=true;
      await audit({
        userId:user.id,action:"auth.mfa_verified",entityId:user.id,ip:request.ip,
        userAgent:request.headers["user-agent"],metadata:{recoveryCodeUsed}
      });
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
      userAgent: request.headers["user-agent"],
      mfaVerified
    });

    setSessionCookie(reply, session.token, session.expiresAt);

    await audit({
      userId: user.id,
      action: "auth.login_success",
      entityId: user.id,
      ip: request.ip,
      userAgent: request.headers["user-agent"],
      metadata: { sessionId: session.sessionId, mfaVerified }
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

  app.post("/auth/mfa/setup", {
    preHandler: requireAuth,
    config: { rateLimit: { max: 5, timeWindow: "15 minutes" } }
  }, async (request, reply) => {
    const auth=authFrom(request);
    const userResult=await db.query<{
      matricula:string;display_name:string;must_change_password:boolean;mfa_enabled:boolean
    }>(
      `SELECT matricula,display_name,must_change_password,mfa_enabled
         FROM users WHERE id=$1 AND active=true`,
      [auth.userId]
    );
    const user=userResult.rows[0];
    if(!user)return reply.code(401).send({error:"UNAUTHENTICATED"});
    if(user.must_change_password)return reply.code(403).send({
      error:"PASSWORD_CHANGE_REQUIRED",message:"Altere a senha temporária antes de configurar o MFA."
    });
    if(user.mfa_enabled)return reply.code(409).send({
      error:"MFA_ALREADY_ENABLED",message:"O segundo fator já está habilitado para esta conta."
    });

    const secret=generateTotpSecret();
    const encrypted=encryptMfaSecret(secret);
    await db.query(
      `INSERT INTO mfa_totp_credentials(user_id,secret_ciphertext,created_at,verified_at)
       VALUES($1,$2,now(),NULL)
       ON CONFLICT(user_id) DO UPDATE SET secret_ciphertext=EXCLUDED.secret_ciphertext,created_at=now(),verified_at=NULL`,
      [auth.userId,encrypted]
    );
    const otpauthUri=buildTotpUri({secret,account:user.matricula});
    const qrDataUrl=await QRCode.toDataURL(otpauthUri,{errorCorrectionLevel:"M",margin:2,width:300});
    await audit({
      userId:auth.userId,action:"auth.mfa_setup_started",entityId:auth.userId,ip:request.ip,
      userAgent:request.headers["user-agent"]
    });
    return {
      secret,
      otpauthUri,
      qrDataUrl,
      issuer:"SIGDEC",
      account:user.matricula,
      displayName:user.display_name
    };
  });

  app.post("/auth/mfa/verify-setup", {
    preHandler: requireAuth,
    config: { rateLimit: { max: 10, timeWindow: "15 minutes" } }
  }, async (request, reply) => {
    const auth=authFrom(request),parsed=mfaVerifySchema.safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT",message:"Informe o código de 6 dígitos."});
    const client=await db.connect();
    let recoveryCodes:string[]=[];
    try{
      await client.query("BEGIN");
      const credential=await client.query<{secret_ciphertext:string}>(
        `SELECT secret_ciphertext FROM mfa_totp_credentials WHERE user_id=$1 FOR UPDATE`,
        [auth.userId]
      );
      const encrypted=credential.rows[0]?.secret_ciphertext;
      if(!encrypted){
        await client.query("ROLLBACK");
        return reply.code(409).send({error:"MFA_SETUP_NOT_STARTED",message:"Inicie a configuração do segundo fator."});
      }
      let valid=false;
      try{valid=verifyTotp(decryptMfaSecret(encrypted),parsed.data.code)}catch{valid=false}
      if(!valid){
        await client.query("ROLLBACK");
        await audit({
          userId:auth.userId,action:"auth.mfa_setup_failed",entityId:auth.userId,ip:request.ip,
          userAgent:request.headers["user-agent"]
        });
        return reply.code(400).send({error:"INVALID_MFA",message:"Código inválido. Confira o horário do aparelho autenticador."});
      }
      recoveryCodes=generateRecoveryCodes(10);
      await client.query("UPDATE mfa_totp_credentials SET verified_at=now() WHERE user_id=$1",[auth.userId]);
      await client.query("UPDATE users SET mfa_enabled=true,updated_at=now() WHERE id=$1",[auth.userId]);
      await client.query("DELETE FROM recovery_codes WHERE user_id=$1",[auth.userId]);
      for(const code of recoveryCodes){
        await client.query("INSERT INTO recovery_codes(user_id,code_hash) VALUES($1,$2)",[auth.userId,hashRecoveryCode(code)]);
      }
      await client.query(
        `UPDATE auth_sessions SET revoked_at=CASE WHEN id<>$2 THEN now() ELSE revoked_at END,
            mfa_verified_at=CASE WHEN id=$2 THEN now() ELSE mfa_verified_at END
          WHERE user_id=$1 AND revoked_at IS NULL`,
        [auth.userId,auth.sessionId]
      );
      await client.query("COMMIT");
    }catch(error){
      await client.query("ROLLBACK");throw error;
    }finally{client.release();}

    await audit({
      userId:auth.userId,action:"auth.mfa_enabled",entityId:auth.userId,ip:request.ip,
      userAgent:request.headers["user-agent"],metadata:{recoveryCodesIssued:recoveryCodes.length}
    });
    return {
      ok:true,
      recoveryCodes,
      message:"Segundo fator habilitado. Guarde os códigos de recuperação em local seguro."
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
