"use client";

import { FormEvent, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_SIGDEC_API_URL ?? "http://localhost:4000";

export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setSuccess(false);

    if (newPassword !== confirmation) {
      setMessage("A confirmação não corresponde à nova senha.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/auth/change-password`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setMessage(body.message ?? "Não foi possível alterar a senha.");
        return;
      }

      setSuccess(true);
      setMessage("Senha alterada. Redirecionando para o painel...");
      window.setTimeout(() => {
        window.location.href = "/painel";
      }, 800);
    } catch {
      setMessage("Falha de comunicação com o servidor.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="authUnified">
      <form className="loginCard" onSubmit={submit}>
        <div>
          <span className="eyebrow">SIGDEC · DEFESA CIVIL · UBATUBA</span>
          <h2>Defina uma nova senha</h2>
        </div>

        <label>
          Senha temporária
          <input
            autoComplete="current-password"
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
            minLength={8}
          />
        </label>

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
          <p className={success ? "" : "errorMessage"} role="status">{message}</p>
        )}

        <button type="submit" disabled={loading || success}>
          {loading ? "Alterando..." : "Alterar senha"}
        </button>

        <small>
          Use ao menos 12 caracteres, incluindo maiúscula, minúscula, número e caractere especial.
        </small>
      </form>
    </main>
  );
}
