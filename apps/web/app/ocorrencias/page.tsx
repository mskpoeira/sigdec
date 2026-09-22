"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_SIGDEC_API_URL ?? "http://localhost:4000";

type Incident = {
  id: string;
  protocol: string;
  status: string;
  priority: string;
  riskToLife: boolean;
  summary: string;
  typeName: string;
  neighborhood: string | null;
  teamCode: string | null;
  vehicleCode: string | null;
  createdAt: string;
};

const priorityLabel: Record<string, string> = {
  P1: "Crítica",
  P2: "Muito alta",
  P3: "Alta",
  P4: "Normal",
  P5: "Programada"
};

export default function OcorrenciasPage() {
  const [items, setItems] = useState<Incident[]>([]);
  const [message, setMessage] = useState("Carregando ocorrências...");

  useEffect(() => {
    fetch(`${API_URL}/api/v1/incidents?limit=100`, { credentials: "include" })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.href = "/login";
          return null;
        }
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((body) => {
        if (!body) return;
        setItems(body.items ?? []);
        setMessage("");
      })
      .catch(() => setMessage("Não foi possível carregar as ocorrências."));
  }, []);

  return (
    <main className="shell">
      <header className="listHeader">
        <div>
          <span className="eyebrow">CENTRAL OPERACIONAL</span>
          <h1>Ocorrências</h1>
          <p>Fila operacional ordenada por prioridade e horário.</p>
        </div>
        <div className="headerActions">
          <Link className="secondaryLink" href="/painel">Painel</Link>
          <Link className="primaryLink" href="/ocorrencias/nova">Nova ocorrência</Link>
        </div>
      </header>

      {message && <section className="infoCard">{message}</section>}

      {!message && items.length === 0 && (
        <section className="infoCard">Nenhuma ocorrência cadastrada.</section>
      )}

      <section className="incidentList">
        {items.map((item) => (
          <Link className="incidentRow" href={`/ocorrencias/${item.id}`} key={item.id}>
            <div className={`priorityBadge priority-${item.priority}`}>
              {item.priority}
            </div>
            <div className="incidentMain">
              <div className="incidentTitleLine">
                <strong>{item.protocol}</strong>
                <span>{priorityLabel[item.priority] ?? item.priority}</span>
                {item.riskToLife && <span className="lifeRisk">RISCO À VIDA</span>}
              </div>
              <h2>{item.summary}</h2>
              <p>
                {item.typeName}
                {item.neighborhood ? ` · ${item.neighborhood}` : ""}
                {item.teamCode ? ` · Equipe ${item.teamCode}` : ""}
                {item.vehicleCode ? ` · ${item.vehicleCode}` : ""}
              </p>
            </div>
            <div className="incidentSide">
              <span className="statusTag">{item.status}</span>
              <time>{new Date(item.createdAt).toLocaleString("pt-BR")}</time>
            </div>
          </Link>
        ))}
      </section>
    </main>
  );
}
