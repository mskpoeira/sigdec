"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_SIGDEC_API_URL ?? "http://localhost:4000";

type Inspection = {
  id: string;
  inspectionType: string;
  status: string;
  riskLevel: string;
  addressLine: string;
  neighborhood: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  findings: string | null;
  recommendations: string | null;
  protocol: string | null;
  assignedName: string | null;
  requestedByName: string;
  createdAt: string;
  checklist: Array<{ id: string; order: number; label: string; checked: boolean }>;
};

type IncidentOption = {
  id: string;
  protocol: string;
  summary: string;
  addressLine: string | null;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
};

const typeLabels: Record<string, string> = {
  PREVENTIVE: "Preventiva",
  STRUCTURAL: "Risco estrutural",
  TREE: "Árvore",
  SLOPE: "Encosta",
  FLOOD: "Alagamento",
  POST_EVENT: "Pós-evento",
  OTHER: "Outra"
};

const statusLabels: Record<string, string> = {
  SCHEDULED: "Agendada",
  IN_PROGRESS: "Em andamento",
  COMPLETED: "Concluída",
  CANCELLED: "Cancelada"
};

const riskLabels: Record<string, string> = {
  UNASSESSED: "Não avaliado",
  LOW: "Baixo",
  MODERATE: "Moderado",
  HIGH: "Alto",
  CRITICAL: "Crítico"
};

const defaultChecklist = [
  "Confirmar endereço e coordenadas",
  "Registrar condições observadas no local",
  "Verificar risco imediato a pessoas e imóveis",
  "Indicar providências e necessidade de retorno"
];

export default function VistoriasPage() {
  const [items, setItems] = useState<Inspection[]>([]);
  const [incidents, setIncidents] = useState<IncidentOption[]>([]);
  const [message, setMessage] = useState("Carregando vistorias...");
  const [busy, setBusy] = useState(false);
  const [incidentId, setIncidentId] = useState("");
  const [inspectionType, setInspectionType] = useState("PREVENTIVE");
  const [addressLine, setAddressLine] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [referencePoint, setReferencePoint] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [notes, setNotes] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");

  const load = useCallback(async () => {
    const [inspectionResponse, incidentResponse] = await Promise.all([
      fetch(`${API_URL}/api/v1/inspections`, { credentials: "include" }),
      fetch(`${API_URL}/api/v1/incidents?limit=100`, { credentials: "include" })
    ]);

    if (inspectionResponse.status === 401) {
      window.location.href = "/login";
      return;
    }
    if (inspectionResponse.status === 403) {
      const body = await inspectionResponse.json().catch(() => ({}));
      if (body?.error === "PASSWORD_CHANGE_REQUIRED") window.location.href = "/alterar-senha";
      throw new Error(body?.message ?? "Acesso não autorizado.");
    }
    if (!inspectionResponse.ok) throw new Error("Não foi possível carregar as vistorias.");

    const inspectionBody = await inspectionResponse.json();
    setItems(inspectionBody.items ?? []);

    if (incidentResponse.ok) {
      const incidentBody = await incidentResponse.json();
      setIncidents(incidentBody.items ?? []);
    }
    setMessage("");
  }, []);

  useEffect(() => {
    void load().catch((error) => {
      setMessage(error instanceof Error ? error.message : "Falha ao carregar.");
    });
  }, [load]);

  function selectIncident(value: string) {
    setIncidentId(value);
    const incident = incidents.find((item) => item.id === value);
    if (!incident) return;
    setAddressLine(incident.addressLine ?? "");
    setNeighborhood(incident.neighborhood ?? "");
    setLatitude(incident.latitude === null ? "" : String(incident.latitude));
    setLongitude(incident.longitude === null ? "" : String(incident.longitude));
  }

  async function createInspection(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const hasCoordinates = latitude !== "" && longitude !== "";
      const response = await fetch(`${API_URL}/api/v1/inspections`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incidentId: incidentId || undefined,
          inspectionType,
          addressLine,
          neighborhood: neighborhood || undefined,
          referencePoint: referencePoint || undefined,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
          notes: notes || undefined,
          latitude: hasCoordinates ? Number(latitude) : undefined,
          longitude: hasCoordinates ? Number(longitude) : undefined,
          checklist: defaultChecklist
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "Não foi possível criar a vistoria.");

      setIncidentId("");
      setAddressLine("");
      setNeighborhood("");
      setReferencePoint("");
      setScheduledAt("");
      setNotes("");
      setLatitude("");
      setLongitude("");
      setMessage("Vistoria criada e registrada na auditoria.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao criar vistoria.");
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(item: Inspection, status: "IN_PROGRESS" | "COMPLETED" | "CANCELLED") {
    let findings: string | undefined;
    let recommendations: string | undefined;
    let riskLevel: string | undefined;

    if (status === "COMPLETED") {
      findings = window.prompt("Informe a conclusão técnica da vistoria:")?.trim();
      if (!findings) return;
      recommendations = window.prompt("Informe as providências recomendadas (opcional):")?.trim() || undefined;
      riskLevel = window.prompt(
        "Nível de risco: LOW, MODERATE, HIGH ou CRITICAL",
        item.riskLevel === "UNASSESSED" ? "MODERATE" : item.riskLevel
      )?.trim().toUpperCase();
      if (!["LOW", "MODERATE", "HIGH", "CRITICAL"].includes(riskLevel ?? "")) {
        setMessage("Nível de risco inválido.");
        return;
      }
    }

    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${API_URL}/api/v1/inspections/${item.id}/status`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, findings, recommendations, riskLevel })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "Não foi possível atualizar a vistoria.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao atualizar vistoria.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <header className="listHeader">
        <div>
          <span className="eyebrow">VISTORIAS · v0.8</span>
          <h1>Operação técnica em campo</h1>
          <p>Planejamento, execução, conclusão e vínculo com ocorrências.</p>
        </div>
        <div className="headerActions">
          <Link className="secondaryLink" href="/campo">Mapa</Link>
          <Link className="secondaryLink" href="/painel">Painel</Link>
        </div>
      </header>

      {message && <section className="infoCard">{message}</section>}

      <section className="inspectionLayout">
        <form className="incidentForm inspectionForm" onSubmit={createInspection}>
          <div><span className="eyebrow">NOVA VISTORIA</span><h2>Programar atendimento</h2></div>

          <label>
            Ocorrência vinculada
            <select value={incidentId} onChange={(event) => selectIncident(event.target.value)}>
              <option value="">Sem vínculo</option>
              {incidents.map((incident) => (
                <option value={incident.id} key={incident.id}>
                  {incident.protocol} · {incident.summary}
                </option>
              ))}
            </select>
          </label>

          <label>
            Tipo
            <select value={inspectionType} onChange={(event) => setInspectionType(event.target.value)}>
              {Object.entries(typeLabels).map(([value, label]) => (
                <option value={value} key={value}>{label}</option>
              ))}
            </select>
          </label>

          <label>
            Endereço
            <input required value={addressLine} onChange={(event) => setAddressLine(event.target.value)} />
          </label>

          <div className="formGrid">
            <label>
              Bairro
              <input value={neighborhood} onChange={(event) => setNeighborhood(event.target.value)} />
            </label>
            <label>
              Agendamento
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
              />
            </label>
            <label>
              Latitude
              <input inputMode="decimal" value={latitude} onChange={(event) => setLatitude(event.target.value)} />
            </label>
            <label>
              Longitude
              <input inputMode="decimal" value={longitude} onChange={(event) => setLongitude(event.target.value)} />
            </label>
          </div>

          <label>
            Ponto de referência
            <input value={referencePoint} onChange={(event) => setReferencePoint(event.target.value)} />
          </label>

          <label>
            Orientações
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>

          <button disabled={busy} type="submit">{busy ? "Registrando..." : "Criar vistoria"}</button>
        </form>

        <div className="inspectionList">
          {items.length === 0 && <section className="infoCard">Nenhuma vistoria cadastrada.</section>}
          {items.map((item) => (
            <article className="card inspectionCard" key={item.id}>
              <div className="inspectionHeader">
                <div>
                  <span className="eyebrow">{item.protocol || "VISTORIA AVULSA"}</span>
                  <h2>{typeLabels[item.inspectionType] ?? item.inspectionType}</h2>
                </div>
                <span className="statusTag">{statusLabels[item.status] ?? item.status}</span>
              </div>
              <p><strong>{item.addressLine}</strong>{item.neighborhood ? ` · ${item.neighborhood}` : ""}</p>
              <p>Risco: {riskLabels[item.riskLevel] ?? item.riskLevel}</p>
              <p>
                Solicitada por {item.requestedByName}
                {item.assignedName ? ` · Responsável: ${item.assignedName}` : ""}
              </p>
              <p>
                {item.scheduledAt
                  ? `Agendada para ${new Date(item.scheduledAt).toLocaleString("pt-BR")}`
                  : `Criada em ${new Date(item.createdAt).toLocaleString("pt-BR")}`}
              </p>
              {item.findings && <p><strong>Conclusão:</strong> {item.findings}</p>}
              {item.recommendations && <p><strong>Providências:</strong> {item.recommendations}</p>}
              <div className="dispatchActions">
                {item.status === "SCHEDULED" && (
                  <button disabled={busy} onClick={() => void updateStatus(item, "IN_PROGRESS")} type="button">
                    Iniciar vistoria
                  </button>
                )}
                {item.status === "IN_PROGRESS" && (
                  <button disabled={busy} onClick={() => void updateStatus(item, "COMPLETED")} type="button">
                    Concluir vistoria
                  </button>
                )}
                {(item.status === "SCHEDULED" || item.status === "IN_PROGRESS") && (
                  <button
                    className="secondaryButton"
                    disabled={busy}
                    onClick={() => void updateStatus(item, "CANCELLED")}
                    type="button"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
