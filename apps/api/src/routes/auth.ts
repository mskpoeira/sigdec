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
import { challengeHash, decryptTotpSecret, encryptTotpSecret, generateTotpSecret, newChallengeToken, recoveryCode, recoveryCodeHash, verifyTotp } from "../lib/mfa.js";

const loginSchema = z.object({
  matricula: z.string().min(1).max(32),
  password: z.string().min(8).max(256)
});

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

const mfaChallengeSchema=z.object({challengeToken:z.string().min(40).max(256)});
const mfaCodeSchema=z.object({
 challengeToken:z.string().min(40).max(256),
 code:z.string().trim().min(6).max(40)
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

async function issueMfaChallenge(input:{userId:string;purpose:"SETUP"|"LOGIN";ip?:string;userAgent?:string}){
 const token=newChallengeToken();
 const expiresAt=new Date(Date.now()+10*60*1000);
 await db.query(`UPDATE mfa_login_challenges SET used_at=now()
  WHERE user_id=$1 AND used_at IS NULL`,[input.userId]);
 await db.query(`INSERT INTO mfa_login_challenges(user_id,token_hash,purpose,expires_at,requested_ip,user_agent)
  VALUES($1,$2,$3,$4,$5,$6)`,[
  input.userId,challengeHash(token),input.purpose,expiresAt,input.ip??null,input.userAgent??null
 ]);
 return {token,expiresAt};
}

async function loadMfaChallenge(token:string,purpose:"SETUP"|"LOGIN"){
 const result=await db.query(`SELECT c.id,c.user_id AS "userId",c.purpose,c.attempts,c.expires_at AS "expiresAt",
   u.organization_id AS "organizationId",u.matricula,u.display_name AS "displayName",u.email,
   u.job_title AS "jobTitle",u.department,u.must_change_password AS "mustChangePassword",
   u.mfa_required AS "mfaRequired",u.mfa_enabled AS "mfaEnabled",
   m.secret_ciphertext AS "secretCiphertext",m.verified_at AS "mfaVerifiedAt"
  FROM mfa_login_challenges c
  JOIN users u ON u.id=c.user_id AND u.active=true
  LEFT JOIN mfa_totp_credentials m ON m.user_id=u.id
  WHERE c.token_hash=$1 AND c.purpose=$2 AND c.used_at IS NULL AND c.expires_at>now()
  LIMIT 1`,[challengeHash(token),purpose]);
 return result.rows[0] as any??null;
}

async function failMfaChallenge(id:string){
 await db.query(`UPDATE mfa_login_challenges
  SET attempts=attempts+1,used_at=CASE WHEN attempts+1>=5 THEN now() ELSE used_at END
  WHERE id=$1`,[id]);
}

async function finalizeMfaLogin(input:{challenge:any;request:any;reply:any;recoveryCodes?:string[]}){
 const access=await loadAccess(String(input.challenge.userId));
 const session=await createSession({
  userId:String(input.challenge.userId),organizationId:input.challenge.organizationId??null,
  roles:access.roles,permissions:access.permissions,ip:input.request.ip,
  userAgent:input.request.headers["user-agent"],mfaVerified:true
 });
 setSessionCookie(input.reply,session.token,session.expiresAt);
 await audit({
  userId:String(input.challenge.userId),action:"auth.login_success",entityId:String(input.challenge.userId),
  ip:input.request.ip,userAgent:input.request.headers["user-agent"],
  metadata:{sessionId:session.sessionId,mfa:true}
 });
 return {
  user:{
   id:input.challenge.userId,matricula:input.challenge.matricula,displayName:input.challenge.displayName,
   email:input.challenge.email,jobTitle:input.challenge.jobTitle,department:input.challenge.department,
   roles:access.roles,permissions:access.permissions,mustChangePassword:Boolean(input.challenge.mustChangePassword),
   mfaRequired:true,mfaEnabled:true
  },
  recoveryCodes:input.recoveryCodes
 };
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
    const mfaRequired=user.mfa_required||user.mfa_enabled||access.roles.includes("MASTER");
    if(mfaRequired){
      if(!user.mfa_required)await db.query("UPDATE users SET mfa_required=true,updated_at=now() WHERE id=$1",[user.id]);
      const challenge=await issueMfaChallenge({
        userId:user.id,purpose:user.mfa_enabled?"LOGIN":"SETUP",
        ip:request.ip,userAgent:request.headers["user-agent"]
      });
      await audit({
        userId:user.id,action:"auth.mfa_challenge_issued",entityId:user.id,ip:request.ip,
        userAgent:request.headers["user-agent"],metadata:{purpose:user.mfa_enabled?"LOGIN":"SETUP"}
      });
      return reply.code(202).send({
        mfa:{
          required:true,setupRequired:!user.mfa_enabled,
          challengeToken:challenge.token,expiresAt:challenge.expiresAt
        },
        user:{
          id:user.id,matricula:user.matricula,displayName:user.display_name,
          mustChangePassword:user.must_change_password,mfaRequired:true,mfaEnabled:user.mfa_enabled
        }
      });
    }

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
      metadata: { sessionId: session.sessionId, mfa:false }
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
    config:{rateLimit:{max:10,timeWindow:"10 minutes"}}
  }, async(request,reply)=>{
    const parsed=mfaChallengeSchema.safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT"});
    const challenge=await loadMfaChallenge(parsed.data.challengeToken,"SETUP");
    if(!challenge)return reply.code(401).send({error:"INVALID_OR_EXPIRED_MFA_CHALLENGE",message:"A solicitação de MFA expirou. Entre novamente."});
    let secret:string;
    if(challenge.secretCiphertext&&!challenge.mfaVerifiedAt)secret=decryptTotpSecret(String(challenge.secretCiphertext));
    else{
      secret=generateTotpSecret();
      await db.query(`INSERT INTO mfa_totp_credentials(user_id,secret_ciphertext,created_at,verified_at)
        VALUES($1,$2,now(),NULL)
        ON CONFLICT(user_id) DO UPDATE SET secret_ciphertext=EXCLUDED.secret_ciphertext,created_at=now(),verified_at=NULL`,[
        challenge.userId,encryptTotpSecret(secret)
      ]);
    }
    const issuer="SIGDEC";
    const label=encodeURIComponent(`${issuer}:${challenge.matricula}`);
    const uri=`otpauth://totp/${label}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
    const qrDataUrl=await QRCode.toDataURL(uri,{margin:1,width:240,errorCorrectionLevel:"M"});
    await audit({userId:String(challenge.userId),action:"auth.mfa_setup_started",entityId:String(challenge.userId),ip:request.ip,userAgent:request.headers["user-agent"]});
    return {manualKey:secret,otpauthUri:uri,qrDataUrl};
  });

  app.post("/auth/mfa/confirm-setup", {
    config:{rateLimit:{max:10,timeWindow:"10 minutes"}}
  }, async(request,reply)=>{
    const parsed=mfaCodeSchema.safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT"});
    const challenge=await loadMfaChallenge(parsed.data.challengeToken,"SETUP");
    if(!challenge?.secretCiphertext)return reply.code(401).send({error:"INVALID_OR_EXPIRED_MFA_CHALLENGE"});
    const secret=decryptTotpSecret(String(challenge.secretCiphertext));
    if(!verifyTotp(secret,parsed.data.code)){
      await failMfaChallenge(String(challenge.id));
      await audit({userId:String(challenge.userId),action:"auth.mfa_setup_failed",entityId:String(challenge.userId),ip:request.ip,userAgent:request.headers["user-agent"]});
      return reply.code(401).send({error:"INVALID_MFA_CODE",message:"Código do autenticador inválido."});
    }
    const codes=Array.from({length:10},()=>recoveryCode());
    const client=await db.connect();
    try{
      await client.query("BEGIN");
      await client.query("UPDATE mfa_totp_credentials SET verified_at=now() WHERE user_id=$1",[challenge.userId]);
      await client.query("UPDATE users SET mfa_enabled=true,mfa_required=true,updated_at=now() WHERE id=$1",[challenge.userId]);
      await client.query("DELETE FROM recovery_codes WHERE user_id=$1",[challenge.userId]);
      for(const code of codes)await client.query("INSERT INTO recovery_codes(user_id,code_hash) VALUES($1,$2)",[challenge.userId,recoveryCodeHash(code)]);
      await client.query("UPDATE mfa_login_challenges SET used_at=now() WHERE id=$1",[challenge.id]);
      await client.query("UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",[challenge.userId]);
      await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}
    await audit({userId:String(challenge.userId),action:"auth.mfa_enabled",entityId:String(challenge.userId),ip:request.ip,userAgent:request.headers["user-agent"]});
    return finalizeMfaLogin({challenge:{...challenge,mfaEnabled:true},request,reply,recoveryCodes:codes});
  });

  app.post("/auth/mfa/verify", {
    config:{rateLimit:{max:10,timeWindow:"10 minutes"}}
  }, async(request,reply)=>{
    const parsed=mfaCodeSchema.safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:"INVALID_INPUT"});
    const challenge=await loadMfaChallenge(parsed.data.challengeToken,"LOGIN");
    if(!challenge?.secretCiphertext||!challenge.mfaVerifiedAt)return reply.code(401).send({error:"INVALID_OR_EXPIRED_MFA_CHALLENGE"});
    let valid=verifyTotp(decryptTotpSecret(String(challenge.secretCiphertext)),parsed.data.code);
    let recoveryId:string|null=null;
    if(!valid){
      const hash=recoveryCodeHash(parsed.data.code);
      const recovery=await db.query<{id:string}>("SELECT id FROM recovery_codes WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL LIMIT 1",[challenge.userId,hash]);
      recoveryId=recovery.rows[0]?.id??null;
      valid=Boolean(recoveryId);
    }
    if(!valid){
      await failMfaChallenge(String(challenge.id));
      await audit({userId:String(challenge.userId),action:"auth.mfa_failed",entityId:String(challenge.userId),ip:request.ip,userAgent:request.headers["user-agent"]});
      return reply.code(401).send({error:"INVALID_MFA_CODE",message:"Código MFA inválido."});
    }
    const client=await db.connect();
    try{
      await client.query("BEGIN");
      await client.query("UPDATE mfa_login_challenges SET used_at=now() WHERE id=$1",[challenge.id]);
      if(recoveryId)await client.query("UPDATE recovery_codes SET used_at=now() WHERE id=$1",[recoveryId]);
      await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}
    await audit({userId:String(challenge.userId),action:recoveryId?"auth.mfa_recovery_used":"auth.mfa_verified",entityId:String(challenge.userId),ip:request.ip,userAgent:request.headers["user-agent"]});
    return finalizeMfaLogin({challenge,request,reply});
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
