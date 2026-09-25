"use client";

import { FormEvent, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_SIGDEC_API_URL ?? "http://localhost:4000";

export default function LoginForm() {
  const [matricula, setMatricula] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mfaRequired,setMfaRequired]=useState(false);
  const [mfaCode,setMfaCode]=useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matricula, password, ...(mfaRequired&&mfaCode?{mfaCode}:{}) })
      });

      const body = await response.json().catch(() => ({}));

      if (response.status===202&&body.mfaRequired) {
        setMfaRequired(true);
        setMfaCode("");
        setMessage(body.message??"Informe o segundo fator.");
        return;
      }

      if (!response.ok) {
        if(!mfaRequired)setPassword("");
        setMfaCode("");
        setShowPassword(false);
        setMessage(body.message ?? "Não foi possível autenticar.");
        return;
      }

      window.location.href = body.user?.mustChangePassword
        ? "/alterar-senha"
        : body.user?.mfaRequired&&!body.user?.mfaEnabled
          ? "/configurar-mfa"
          : "/painel";
    } catch {
      setPassword("");
      setShowPassword(false);
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

      <div className="passwordBlock">
        <label>
          Senha
          <input
            autoCapitalize="none"
            autoComplete="current-password"
            name="password"
            spellCheck={false}
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            required
            minLength={8}
          />
        </label>
        <button
          className="passwordToggle"
          type="button"
          onClick={() => setShowPassword((current) => !current)}
        >
          {showPassword ? "Ocultar senha" : "Mostrar senha"}
        </button>
      </div>

      {mfaRequired&&<label>
        Segundo fator
        <input
          autoComplete="one-time-code"
          inputMode="numeric"
          value={mfaCode}
          onChange={(event)=>setMfaCode(event.target.value)}
          placeholder="000000 ou código de recuperação"
          required
          autoFocus
        />
      </label>}

      {message && <p className="errorMessage" role="alert">{message}</p>}

      <button type="submit" disabled={loading}>
        {loading ? "Autenticando..." : mfaRequired ? "Validar segundo fator" : "Entrar"}
      </button>

      <a className="loginLink" href="/esqueci-senha">Esqueci minha senha</a>

      <small>
        O acesso e as ações realizadas no sistema são registrados para fins de segurança e auditoria.
      </small>
    </form>
  );
}
