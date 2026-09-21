"use client";

import Link from "next/link";
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

const modules = [
  { name: "Central Operacional", href: "/ocorrencias", description: "Ocorrências abertas e prioridades." },
  { name: "Nova ocorrência", href: "/ocorrencias/nova", description: "Registro rápido de atendimento." },
  { name: "Despacho", href: "/ocorrencias", description: "Equipes, viaturas e empenho." },
  { name: "Monitoramento", href: "#", description: "Integração ambiental prevista." },
  { name: "Vistorias", href: "#", description: "Próxima fase de campo." },
  { name: "SCO / Desastres", href: "#", description: "Gestão ampliada de incidentes." },
  { name: "Assistência Humanitária", href: "#", description: "Famílias, abrigos e entregas." },
  { name: "Voluntariado", href: "#", description: "Competências e mobilização." },
  { name: "Documentos", href: "#", description: "Relatórios, laudos e declarações." },
  { name: "Administração", href: "#", description: "Usuários, perfis e auditoria." }
];

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

  if (!user) return <main className="shell"><p>{status}</p></main>;

  return (
    <main className="shell">
      <header className="panelHeader">
        <div>
          <span className="eyebrow">SIGDEC · v0.3</span>
          <h1>Painel Operacional</h1>
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
        {modules.map((module) => (
          <Link className="card cardLink" href={module.href} key={module.name}>
            <h2>{module.name}</h2>
            <p>{module.description}</p>
          </Link>
        ))}
      </section>
    </main>
  );
}
