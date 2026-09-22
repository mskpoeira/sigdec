"use client";

import { FormEvent, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_SIGDEC_API_URL ?? "http://localhost:4000";

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${API_URL}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier })
      });
      const body = await response.json().catch(() => ({}));
      setMessage(
        body.message ??
        "Se houver uma conta ativa com e-mail cadastrado, enviaremos as instruções."
      );
    } catch {
      setMessage("Falha de comunicação com o servidor.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="loginShell">
      <section className="loginBrand">
        <span className="eyebrow">SIGDEC</span>
        <h1>Recuperação de acesso</h1>
        <p>O link de redefinição é individual, temporário e enviado ao e-mail cadastrado.</p>
      </section>

      <form className="loginCard" onSubmit={submit}>
        <div>
          <span className="eyebrow">ESQUECI MINHA SENHA</span>
          <h2>Solicitar novo acesso</h2>
        </div>

        <label>
          Matrícula ou e-mail
          <input
            autoComplete="username"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            required
            autoFocus
          />
        </label>

        {message && <p className="formMessage" role="status">{message}</p>}

        <button type="submit" disabled={loading}>
          {loading ? "Enviando..." : "Enviar link de redefinição"}
        </button>

        <a className="loginLink" href="/login">Voltar para o login</a>
      </form>
    </main>
  );
}
