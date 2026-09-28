"use client";
import { formatDateTimeBR } from "../lib/datetime";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {useRealtimeRefresh} from "../lib/use-realtime-refresh";

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

  const load=useCallback(async()=>{
    try{
      const response=await fetch(`${API_URL}/api/v1/incidents?limit=100`,{credentials:"include",cache:"no-store"});
      if(response.status===401){window.location.href="/login";return}
      if(!response.ok)throw new Error();
      const body=await response.json();
      setItems(body.items??[]);setMessage("");
    }catch{setMessage("Não foi possível carregar as ocorrências.")}
  },[]);
  useEffect(()=>{void load()},[load]);
  useRealtimeRefresh(load);

  return (
    <main className="shell moduleShell">
      <header className="listHeader">
        <div>
          <span className="eyebrow">SIGDEC · DEFESA CIVIL · UBATUBA</span>
          <h1>Ocorrências</h1>
          <p>Registro, triagem, despacho, acompanhamento operacional, mapa de campo e vistorias.</p>
        </div>
        <div className="headerActions">
          <Link className="secondaryLink" href="/painel">Painel</Link>
        </div>
      </header>

      {message && <section className="infoCard">{message}</section>}

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
