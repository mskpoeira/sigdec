"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_SIGDEC_API_URL ?? "http://localhost:4000";

type Incident = {
  id: string;
  protocol: string;
  status: string;
  priority: string;
  risk_to_life: boolean;
  summary: string;
  description: string | null;
  source: string;
  caller_name: string | null;
  caller_phone: string | null;
  address_line: string | null;
  neighborhood: string | null;
  reference_point: string | null;
  latitude: number | null;
  longitude: number | null;
  type_name: string;
  type_group: string;
  team_code: string | null;
  vehicle_code: string | null;
  created_at: string;
  updated_at: string;
};

type TimelineItem = {
  id: string;
  occurredAt: string;
  eventType: string;
  note: string | null;
  metadata: Record<string, unknown>;
  actorName: string | null;
  actorMatricula: string | null;
};

type Dispatch = {
  id: string;
  status: string;
  notes: string | null;
  dispatchedAt: string;
  acknowledgedAt: string | null;
  enrouteAt: string | null;
  arrivedAt: string | null;
  releasedAt: string | null;
  teamCode: string;
  teamName: string;
  vehicleCode: string | null;
  vehicleDescription: string | null;
};

type Resource = {
  id: string;
  code: string;
  name?: string;
  description?: string;
  plate?: string | null;
  status: string;
};

type DetailResponse = {
  incident: Incident;
  timeline: TimelineItem[];
  dispatches: Dispatch[];
  allowedTransitions: string[];
};

const statusLabels: Record<string, string> = {
  RECEIVED: "Recebida",
  TRIAGE: "Em triagem",
  WAITING_DISPATCH: "Aguardando despacho",
  DISPATCHED: "Despachada",
  EN_ROUTE: "Em deslocamento",
  ON_SCENE: "No local",
  IN_SERVICE: "Em atendimento",
  WAITING_SUPPORT: "Aguardando apoio",
  INSPECTION: "Em vistoria",
  MONITORING: "Em monitoramento",
  COMPLETED: "Concluída",
  CLOSED: "Encerrada",
  CANCELLED: "Cancelada",
  DUPLICATE: "Duplicada",
  ACKNOWLEDGED: "Ciente",
  RELEASED: "Liberada"
};

const eventLabels: Record<string, string> = {
  "incident.created": "Ocorrência registrada",
  "incident.status_changed": "Situação atualizada",
  "dispatch.created": "Equipe despachada",
  "dispatch.status_changed": "Despacho atualizado"
};

const dispatchNext: Record<string, string[]> = {
  DISPATCHED: ["ACKNOWLEDGED", "CANCELLED"],
  ACKNOWLEDGED: ["EN_ROUTE", "CANCELLED"],
  EN_ROUTE: ["ON_SCENE", "CANCELLED"],
  ON_SCENE: ["RELEASED"]
};

export default function OcorrenciaDetalhePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [teams, setTeams] = useState<Resource[]>([]);
  const [vehicles, setVehicles] = useState<Resource[]>([]);
  const [message, setMessage] = useState("Carregando ocorrência...");
  const [busy, setBusy] = useState(false);
  const [nextStatus, setNextStatus] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const [teamId, setTeamId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [dispatchNote, setDispatchNote] = useState("");

  const handleAuth = useCallback((response: Response) => {
    if (response.status === 401) {
      window.location.href = "/login";
      return false;
    }
    if (response.status === 403) {
      return response.clone().json().then((body) => {
        if (body?.error === "PASSWORD_CHANGE_REQUIRED") {
          window.location.href = "/alterar-senha";
        }
        return false;
      });
    }
    return true;
  }, []);

  const load = useCallback(async () => {
    try {
      const [detailResponse, teamsResponse, vehiclesResponse] = await Promise.all([
        fetch(`${API_URL}/api/v1/incidents/${id}`, { credentials: "include" }),
        fetch(`${API_URL}/api/v1/teams`, { credentials: "include" }),
        fetch(`${API_URL}/api/v1/vehicles`, { credentials: "include" })
      ]);

      if (!(await handleAuth(detailResponse))) return;
      if (!detailResponse.ok) throw new Error("Não foi possível carregar a ocorrência.");

      const body = await detailResponse.json();
      setDetail(body);
      setNextStatus(body.allowedTransitions?.[0] ?? "");

      if (teamsResponse.ok) {
        const teamsBody = await teamsResponse.json();
        setTeams(teamsBody.items ?? []);
      }
      if (vehiclesResponse.ok) {
        const vehiclesBody = await vehiclesResponse.json();
        setVehicles(vehiclesBody.items ?? []);
      }
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao carregar dados.");
    }
  }, [handleAuth, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateIncidentStatus(event: FormEvent) {
    event.preventDefault();
    if (!nextStatus) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${API_URL}/api/v1/incidents/${id}/status`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, note: statusNote || undefined })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "Não foi possível atualizar a situação.");
      setStatusNote("");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao atualizar.");
    } finally {
      setBusy(false);
    }
  }

  async function createDispatch(event: FormEvent) {
    event.preventDefault();
    if (!teamId) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${API_URL}/api/v1/incidents/${id}/dispatch`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId,
          vehicleId: vehicleId || undefined,
          notes: dispatchNote || undefined
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "Não foi possível realizar o despacho.");
      setTeamId("");
      setVehicleId("");
      setDispatchNote("");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha no despacho.");
    } finally {
      setBusy(false);
    }
  }

  async function updateDispatch(dispatchId: string, status: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${API_URL}/api/v1/dispatches/${dispatchId}/status`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "Não foi possível atualizar o despacho.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao atualizar despacho.");
    } finally {
      setBusy(false);
    }
  }

  if (!detail) {
    return <main className="shell moduleShell"><section className="infoCard">{message}</section></main>;
  }

  const incident = detail.incident;
  const availableTeams = teams.filter((item) => item.status === "AVAILABLE");
  const availableVehicles = vehicles.filter((item) => item.status === "AVAILABLE");

  return (
    <main className="shell moduleShell">
      <header className="listHeader">
        <div>
          <span className="eyebrow">OCORRÊNCIA {incident.protocol}</span>
          <h1>{incident.summary}</h1>
          <p>{incident.type_group} · {incident.type_name}</p>
        </div>
        <div className="headerActions">
          <Link className="secondaryLink" href="/ocorrencias">Voltar</Link>
          <span className={`statusTag priority-${incident.priority}`}>
            {incident.priority} · {statusLabels[incident.status] ?? incident.status}
          </span>
        </div>
      </header>

      {message && <section className="warningCard">{message}</section>}

      <section className="detailGrid">
        <article className="card detailCard">
          <h2>Dados do atendimento</h2>
          <dl className="detailList">
            <div><dt>Situação</dt><dd>{statusLabels[incident.status] ?? incident.status}</dd></div>
            <div><dt>Risco à vida</dt><dd>{incident.risk_to_life ? "Sim" : "Não"}</dd></div>
            <div><dt>Origem</dt><dd>{incident.source}</dd></div>
            <div><dt>Aberta em</dt><dd>{new Date(incident.created_at).toLocaleString("pt-BR")}</dd></div>
            <div><dt>Solicitante</dt><dd>{incident.caller_name || "Não informado"}</dd></div>
            <div><dt>Telefone</dt><dd>{incident.caller_phone || "Não informado"}</dd></div>
            <div className="detailWide"><dt>Descrição</dt><dd>{incident.description || "Sem descrição complementar."}</dd></div>
          </dl>
        </article>

        <article className="card detailCard">
          <h2>Local</h2>
          <p>
            {[incident.address_line, incident.neighborhood].filter(Boolean).join(" · ") || "Endereço não informado"}
          </p>
          {incident.reference_point && <p>Referência: {incident.reference_point}</p>}
          {incident.latitude !== null && incident.longitude !== null && (
            <a
              className="secondaryLink"
              href={`https://www.openstreetmap.org/?mlat=${incident.latitude}&mlon=${incident.longitude}#map=17/${incident.latitude}/${incident.longitude}`}
              target="_blank"
              rel="noreferrer"
            >
              Abrir localização no mapa
            </a>
          )}
        </article>
      </section>

      <section className="operationsGrid">
        <form className="incidentForm compactForm" onSubmit={updateIncidentStatus}>
          <div><span className="eyebrow">FLUXO</span><h2>Atualizar situação</h2></div>
          {detail.allowedTransitions.length ? (
            <>
              <label>
                Próxima situação
                <select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)}>
                  {detail.allowedTransitions.map((status) => (
                    <option value={status} key={status}>{statusLabels[status] ?? status}</option>
                  ))}
                </select>
              </label>
              <label>
                Observação
                <textarea value={statusNote} onChange={(event) => setStatusNote(event.target.value)} />
              </label>
              <button disabled={busy} type="submit">Registrar situação</button>
            </>
          ) : <p>Não há transições disponíveis para esta ocorrência.</p>}
        </form>

        <form className="incidentForm compactForm" onSubmit={createDispatch}>
          <div><span className="eyebrow">DESPACHO</span><h2>Empenhar recursos</h2></div>
          <label>
            Equipe
            <select required value={teamId} onChange={(event) => setTeamId(event.target.value)}>
              <option value="">Selecione</option>
              {availableTeams.map((team) => (
                <option value={team.id} key={team.id}>{team.code} · {team.name}</option>
              ))}
            </select>
          </label>
          <label>
            Viatura
            <select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}>
              <option value="">Sem viatura</option>
              {availableVehicles.map((vehicle) => (
                <option value={vehicle.id} key={vehicle.id}>
                  {vehicle.code} · {vehicle.description}{vehicle.plate ? ` · ${vehicle.plate}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Orientações
            <textarea value={dispatchNote} onChange={(event) => setDispatchNote(event.target.value)} />
          </label>
          <button disabled={busy || !teamId} type="submit">Despachar</button>
        </form>
      </section>

      <section className="detailSection">
        <div><span className="eyebrow">RECURSOS</span><h2>Despachos</h2></div>
        {detail.dispatches.length === 0 && <section className="infoCard">Nenhum recurso despachado.</section>}
        <div className="dispatchList">
          {detail.dispatches.map((dispatch) => (
            <article className="card dispatchCard" key={dispatch.id}>
              <div>
                <strong>{dispatch.teamCode} · {dispatch.teamName}</strong>
                <p>{dispatch.vehicleCode ? `${dispatch.vehicleCode} · ${dispatch.vehicleDescription}` : "Sem viatura"}</p>
                {dispatch.notes && <p>{dispatch.notes}</p>}
              </div>
              <div>
                <span className="statusTag">{statusLabels[dispatch.status] ?? dispatch.status}</span>
                <time>{new Date(dispatch.dispatchedAt).toLocaleString("pt-BR")}</time>
              </div>
              <div className="dispatchActions">
                {(dispatchNext[dispatch.status] ?? []).map((status) => (
                  <button
                    className={status === "CANCELLED" ? "secondaryButton" : ""}
                    disabled={busy}
                    key={status}
                    onClick={() => void updateDispatch(dispatch.id, status)}
                    type="button"
                  >
                    {statusLabels[status] ?? status}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="detailSection">
        <div><span className="eyebrow">HISTÓRICO</span><h2>Linha do tempo</h2></div>
        <div className="timeline">
          {detail.timeline.map((item) => (
            <article className="timelineItem" key={item.id}>
              <span className="timelineDot" />
              <div>
                <strong>{eventLabels[item.eventType] ?? item.eventType}</strong>
                <p>{item.note || "Registro automático do sistema."}</p>
                <small>
                  {new Date(item.occurredAt).toLocaleString("pt-BR")}
                  {item.actorName ? ` · ${item.actorName}` : ""}
                </small>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
