"use client";

import { FormEvent, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_SIGDEC_API_URL ?? "http://localhost:4000";

export default function LoginForm() {
  const [matricula, setMatricula] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matricula, password })
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setMessage(body.message ?? "Não foi possível autenticar.");
        return;
      }

      window.location.href = "/painel";
    } catch {
      setMessage("Falha de comunicação com o servidor.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="loginCard" onSubmit={submit}>
      <div>
        <span className="eyebrow">ACESSO RESTRITO</span>
        <h2>Entrar no SIGDEC</h2>
      </div>

      <label>
        Matrícula
        <input
          autoComplete="username"
          inputMode="numeric"
          value={matricula}
          onChange={(event) => setMatricula(event.target.value)}
          placeholder="000.000"
          required
        />
      </label>

      <label>
        Senha
        <input
          autoComplete="current-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          minLength={8}
        />
      </label>

      {message && <p className="errorMessage" role="alert">{message}</p>}

      <button type="submit" disabled={loading}>
        {loading ? "Autenticando..." : "Entrar"}
      </button>

      <small>
        O acesso e as ações realizadas no sistema são registrados para fins de segurança e auditoria.
      </small>
    </form>
  );
}
