import nodemailer from "nodemailer";

type PasswordResetMessage = {
  to: string;
  displayName: string;
  resetUrl: string;
  expiresMinutes: number;
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
