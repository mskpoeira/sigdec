"use client";
import { formatDateTimeBR } from "../lib/datetime";

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
  createdByMatricula: string | null;
  createdByName: string | null;
};

const priorityLabel: Record<string, string> = {
  P1: "Crítica",
  P2: "Muito alta",
  P3: "Alta",
  P4: "Normal",
  P5: "Programada"
};

const statusLabel: Record<string,string> = {
  RECEIVED:"Recebida",TRIAGE:"Em triagem",WAITING_DISPATCH:"Aguardando despacho",DISPATCHED:"Despachada",
  EN_ROUTE:"Em deslocamento",ON_SCENE:"No local",IN_SERVICE:"Em atendimento",WAITING_SUPPORT:"Aguardando apoio",
  INSPECTION:"Em vistoria",MONITORING:"Em monitoramento",COMPLETED:"Concluída",CLOSED:"Encerrada",
  CANCELLED:"Cancelada",DUPLICATE:"Duplicada"
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
    <main className="shell moduleShell">
      <header className="listHeader">
        <div>
          <span className="eyebrow">SIGDEC · DEFESA CIVIL · UBATUBA</span>
          <h1>Ocorrências e Monitoramento</h1>
          <p>Ocorrências, riscos, mapas, alertas, vistorias e acompanhamento operacional em um único contexto.</p>
        </div>
        <div className="headerActions">
          <Link className="secondaryLink" href="/painel">Painel</Link>
          <Link className="primaryLink" href="/ocorrencias/nova">Nova ocorrência</Link>
        </div>
      </header>

      {message && <section className="infoCard">{message}</section>}

      <section className="dataGrid">
        <article className="card"><h2>Nova ocorrência</h2><p>Registro operacional com protocolo, prioridade, localização e despacho.</p><Link className="primaryButton" href="/ocorrencias/nova">Registrar ocorrência</Link></article>
        <article className="card"><h2>Riscos e Mapas</h2><p>Mapa operacional, pontos de risco, posições de campo e dados georreferenciados.</p><Link className="secondaryLink" href="/campo">Abrir mapa e riscos</Link></article>
        <article className="card"><h2>Alertas e Monitoramento</h2><p>Estações, leituras, limiares, eventos operacionais, protocolos e rascunhos de alerta.</p><Link className="secondaryLink" href="/monitoramento">Abrir monitoramento</Link></article>
        <article className="card"><h2>Vistorias</h2><p>Vistorias preventivas/emergenciais, evidências e histórico de campo.</p><Link className="secondaryLink" href="/vistorias">Abrir vistorias</Link></article>
      </section>

      {!message && items.length === 0 && (
        <section className="infoCard">Nenhuma ocorrência cadastrada.</section>
      )}

      <section className="infoCard">
        <strong>Prioridade de atendimento</strong>
        <div className="priorityLegend" style={{marginTop:10}}>
          <span><i className="p1"/>P1 · Crítica · Vermelho</span>
          <span><i className="p2"/>P2 · Muito alta · Laranja</span>
          <span><i className="p3"/>P3 · Alta · Amarelo</span>
          <span><i className="p4"/>P4 · Normal · Verde</span>
          <span><i className="p5"/>P5 · Programada · Azul</span>
        </div>
      </section>

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
              <span className="statusTag">{statusLabel[item.status] ?? item.status}</span>
              <time>{formatDateTimeBR(item.createdAt)}</time><small>Matrícula {item.createdByMatricula??"—"}</small>
            </div>
          </Link>
        ))}
      </section>
    </main>
  );
}
