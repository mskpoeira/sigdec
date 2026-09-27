import nodemailer from "nodemailer";

type PasswordResetMessage = {
  to: string;
  displayName: string;
  resetUrl: string;
  expiresMinutes: number;
};

type TrustedDeviceAlertMessage = {
  to: string;
  displayName: string;
  deviceLabel: string;
  ip?: string | null;
  securityUrl: string;
  expiresAt: Date;
};

export function isMailConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASSWORD
  );
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[character] ?? character
  );
}

export async function sendPasswordResetEmail(message: PasswordResetMessage) {
  if (!isMailConfigured()) {
    throw new Error("Serviço de e-mail não configurado.");
  }

  const port = Number(process.env.SMTP_PORT ?? 587);
  const secure = (process.env.SMTP_SECURE ?? String(port === 465)) === "true";
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    }
  });

  const from = process.env.SIGDEC_MAIL_FROM ?? `SIGDEC <${process.env.SMTP_USER}>`;
  const name = escapeHtml(message.displayName);
  const url = escapeHtml(message.resetUrl);

  await transporter.sendMail({
    from,
    to: message.to,
    subject: "Redefinição de senha do SIGDEC",
    text: [
      `Olá, ${message.displayName}.`,
      "",
      "Recebemos uma solicitação para redefinir sua senha do SIGDEC.",
      `Acesse o link abaixo em até ${message.expiresMinutes} minutos:`,
      message.resetUrl,
      "",
      "Se você não fez essa solicitação, ignore este e-mail. Sua senha continuará válida."
    ].join("\n"),
    html: `
      <p>Olá, ${name}.</p>
      <p>Recebemos uma solicitação para redefinir sua senha do SIGDEC.</p>
      <p>
        <a href="${url}">Redefinir minha senha</a>
      </p>
      <p>O link expira em ${message.expiresMinutes} minutos e só pode ser usado uma vez.</p>
      <p>Se você não fez essa solicitação, ignore este e-mail. Sua senha continuará válida.</p>
    `
  });
}


export async function sendTrustedDeviceAlertEmail(message: TrustedDeviceAlertMessage) {
  if (!isMailConfigured()) {
    throw new Error("Serviço de e-mail não configurado.");
  }

  const port = Number(process.env.SMTP_PORT ?? 587);
  const secure = (process.env.SMTP_SECURE ?? String(port === 465)) === "true";
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    }
  });

  const from = process.env.SIGDEC_MAIL_FROM ?? `SIGDEC <${process.env.SMTP_USER}>`;
  const name = escapeHtml(message.displayName);
  const device = escapeHtml(message.deviceLabel);
  const ip = escapeHtml(message.ip ?? "não identificado");
  const securityUrl = escapeHtml(message.securityUrl);
  const expiry = message.expiresAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

  await transporter.sendMail({
    from,
    to: message.to,
    subject: "Novo navegador confiável no SIGDEC",
    text: [
      `Olá, ${message.displayName}.`,
      "",
      "Um novo navegador/dispositivo foi validado com 2FA e marcado como confiável no SIGDEC.",
      `Dispositivo: ${message.deviceLabel}`,
      `IP registrado: ${message.ip ?? "não identificado"}`,
      `Confiança válida até: ${expiry}`,
      "",
      "Se foi você, nenhuma ação é necessária.",
      "Se não reconhece este acesso, entre imediatamente na área de Segurança do SIGDEC e revogue o dispositivo e as sessões ativas:",
      message.securityUrl
    ].join("\n"),
    html: `
      <p>Olá, ${name}.</p>
      <p>Um novo navegador/dispositivo foi validado com <strong>2FA</strong> e marcado como confiável no SIGDEC.</p>
      <p><strong>Dispositivo:</strong> ${device}<br/>
      <strong>IP registrado:</strong> ${ip}<br/>
      <strong>Confiança válida até:</strong> ${escapeHtml(expiry)}</p>
      <p>Se foi você, nenhuma ação é necessária.</p>
      <p>Se não reconhece este acesso, acesse imediatamente a área de Segurança do SIGDEC e revogue o dispositivo e as sessões ativas.</p>
      <p><a href="${securityUrl}">Abrir Segurança da Conta</a></p>
    `
  });
}
