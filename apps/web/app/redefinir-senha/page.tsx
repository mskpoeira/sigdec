"use client";

import { FormEvent, useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_SIGDEC_API_URL ?? "http://localhost:4000";

export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") ?? "");
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setSuccess(false);

    if (!token) {
      setMessage("O link de redefinição está incompleto.");
      return;
    }
    if (newPassword !== confirmation) {
      setMessage("A confirmação não corresponde à nova senha.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword })
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setMessage(body.message ?? "Não foi possível redefinir a senha.");
        return;
      }

      setSuccess(true);
      setMessage("Senha redefinida. Redirecionando para o login...");
      window.setTimeout(() => {
        window.location.href = "/login";
      }, 900);
    } catch {
      setMessage("Falha de comunicação com o servidor.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="loginShell authUnified">
      <section className="loginBrand">
        <span className="eyebrow">SIGDEC · DEFESA CIVIL · UBATUBA</span>
        <h1>Nova senha</h1>
        <p>Escolha uma credencial forte e exclusiva para o sistema.</p>
      </section>

      <form className="loginCard" onSubmit={submit}>
        <div>
          <span className="eyebrow">REDEFINIÇÃO SEGURA</span>
          <h2>Criar nova senha</h2>
        </div>

        <label>
          Nova senha
          <input
            autoComplete="new-password"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
            minLength={12}
          />
        </label>

        <label>
          Confirmar nova senha
          <input
            autoComplete="new-password"
            type="password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
            minLength={12}
          />
        </label>

        {message && (
          <p className={success ? "formMessage" : "errorMessage"} role="status">
            {message}
          </p>
        )}

        <button type="submit" disabled={loading || success || !token}>
          {loading ? "Redefinindo..." : "Redefinir senha"}
        </button>

        <small>
          Use ao menos 12 caracteres, com maiúscula, minúscula, número e caractere especial.
        </small>
      </form>
    </main>
  );
}
