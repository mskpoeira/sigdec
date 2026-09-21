"use client";

import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_SIGDEC_API_URL ?? "http://localhost:4000";

type SessionUser = {
  id: string;
  matricula: string;
  displayName: string;
  email: string | null;
  jobTitle: string | null;
  department: string | null;
  roles: string[];
  permissions: string[];
  mustChangePassword: boolean;
  mfaRequired: boolean;
  mfaEnabled: boolean;
};

export default function PainelPage() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState("Carregando sessão...");

  useEffect(() => {
    fetch(`${API_URL}/auth/me`, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((body) => {
        setUser(body.user);
        setStatus("");
      })
      .catch(() => {
        window.location.href = "/login";
      });
  }, []);

  async function logout() {
    await fetch(`${API_URL}/auth/logout`, {
      method: "POST",
      credentials: "include"
    });
    window.location.href = "/login";
  }

  if (!user) {
    return <main className="shell"><p>{status}</p></main>;
  }

  return (
    <main className="shell">
      <header className="panelHeader">
        <div>
          <span className="eyebrow">SIGDEC</span>
          <h1>Painel</h1>
          <p>
            {user.displayName} · matrícula {user.matricula}
            {user.jobTitle ? ` · ${user.jobTitle}` : ""}
          </p>
        </div>
        <button className="secondaryButton" onClick={logout}>Sair</button>
      </header>

      {(user.mustChangePassword || (user.mfaRequired && !user.mfaEnabled)) && (
        <section className="warningCard">
          <strong>Configuração de segurança pendente</strong>
          <p>
            {user.mustChangePassword ? "A senha inicial deverá ser alterada. " : ""}
            {user.mfaRequired && !user.mfaEnabled ? "A autenticação multifator deverá ser ativada." : ""}
          </p>
        </section>
      )}

      <section className="grid">
        {[
          "Central Operacional",
          "Ocorrências",
          "Despacho",
          "Monitoramento",
          "Vistorias",
          "SCO / Desastres",
          "Assistência Humanitária",
          "Voluntariado",
          "Documentos",
          "Administração"
        ].map((module) => (
          <article className="card" key={module}>
            <h2>{module}</h2>
            <p>Estrutura prevista para as próximas fases.</p>
          </article>
        ))}
      </section>
    </main>
  );
}
