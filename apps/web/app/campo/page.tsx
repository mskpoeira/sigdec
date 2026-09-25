"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_SIGDEC_API_URL ?? "http://localhost:4000";

type FieldIncident = {
  id: string;
  protocol: string;
  status: string;
  priority: string;
  riskToLife: boolean;
  summary: string;
  addressLine: string | null;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
  typeName: string;
  teamCode: string | null;
};

type MonitoringSignal = { id:string; severity:string; title:string; status:string; metric:string; observedValue:number|string; thresholdValue:number|string; unit:string; createdAt:string; stationCode:string; stationName:string; latitude:number; longitude:number; protocolCode:string|null; protocolVersionNo:number|null; };

type Sitrep = { generatedAt:string; activeIncidents:number; p1Incidents:number; p2Incidents:number; openMonitoringEvents:number; emergencyMonitoringEvents:number; publishedAlerts:number; openShelters:number; displacedHouseholds:number; homelessHouseholds:number; activeOperations:number; activeOperationalPeriods:number; };

type FieldPosition = {
  userId: string;
  displayName: string;
  teamCode: string | null;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  recordedAt: string;
};

export default function CampoPage() {
  const [incidents, setIncidents] = useState<FieldIncident[]>([]);
  const [positions, setPositions] = useState<FieldPosition[]>([]);
  const [monitoringEvents, setMonitoringEvents] = useState<MonitoringSignal[]>([]);
  const [sitrep, setSitrep] = useState<Sitrep | null>(null);
  const [historyHours, setHistoryHours] = useState(24);
  const [historyPositions, setHistoryPositions] = useState<FieldPosition[]>([]);
  const [historySignals, setHistorySignals] = useState<MonitoringSignal[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [message, setMessage] = useState("Carregando operação de campo...");
  const [sharing, setSharing] = useState(false);

  async function load() {
    const response = await fetch(`${API_URL}/api/v1/field/map`, { credentials: "include" });
    if (response.status === 401) {
      window.location.href = "/login";
      return;
    }
    if (response.status === 403) {
      const body = await response.json().catch(() => ({}));
      if (body?.error === "PASSWORD_CHANGE_REQUIRED") window.location.href = "/alterar-senha";
      throw new Error(body?.message ?? "Acesso não autorizado.");
    }
    if (!response.ok) throw new Error("Não foi possível carregar o mapa operacional.");
    const body = await response.json();
    setIncidents(body.incidents ?? []);
    setPositions(body.positions ?? []);
    setMonitoringEvents(body.monitoringEvents ?? []);
    const firstLocated = (body.incidents ?? []).find(
      (item: FieldIncident) => item.latitude !== null && item.longitude !== null
    );
    setSelectedId((current) => current || firstLocated?.id || "");
    const sitrepResponse = await fetch(`${API_URL}/api/v1/sco/sitrep`, { credentials: "include" });
    if (sitrepResponse.ok) setSitrep(await sitrepResponse.json());
    setMessage("");
  }

  useEffect(() => {
    void load().catch((error) => {
      setMessage(error instanceof Error ? error.message : "Falha ao carregar.");
    });
  }, []);

  useEffect(() => {
    void fetch(`${API_URL}/api/v1/field/history?hours=${historyHours}`, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Não foi possível carregar o histórico geoespacial.");
        return response.json();
      })
      .then((body) => {
        setHistoryPositions(body.positions ?? []);
        setHistorySignals(body.monitoringEvents ?? []);
      })
      .catch(() => {
        setHistoryPositions([]);
        setHistorySignals([]);
      });
  }, [historyHours]);

  const selected = useMemo(
    () => incidents.find((item) => item.id === selectedId) ?? null,
    [incidents, selectedId]
  );

  const mapUrl = useMemo(() => {
    if (!selected || selected.latitude === null || selected.longitude === null) return "";
    const lat = Number(selected.latitude);
    const lon = Number(selected.longitude);
    const delta = 0.012;
    const bbox = [lon - delta, lat - delta, lon + delta, lat + delta].join(",");
    return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${lat}%2C${lon}`;
  }, [selected]);

  function shareLocation() {
    if (!navigator.geolocation) {
      setMessage("Este aparelho não disponibiliza geolocalização.");
      return;
    }
    setSharing(true);
    setMessage("Obtendo localização do aparelho...");

    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        const response = await fetch(`${API_URL}/api/v1/field/location`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyMeters: position.coords.accuracy,
            recordedAt: new Date(position.timestamp).toISOString()
          })
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message ?? "Não foi possível registrar a localização.");
        setMessage("Localização registrada com segurança.");
        await load();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Falha ao registrar localização.");
      } finally {
        setSharing(false);
      }
    }, (error) => {
      const denied = error.code === error.PERMISSION_DENIED;
      setMessage(denied
        ? "Permissão de localização negada no aparelho."
        : "Não foi possível obter a localização atual.");
      setSharing(false);
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  }

  return (
    <main className="shell moduleShell">
      <header className="listHeader">
        <div>
          <span className="eyebrow">OPERAÇÃO DE CAMPO · v1.38.1</span>
          <h1>Mapa operacional</h1>
          <p>Ocorrências ativas e últimas posições informadas pelas equipes.</p>
        </div>
        <div className="headerActions">
          <label className="secondaryLink">Histórico <select value={historyHours} onChange={(event)=>setHistoryHours(Number(event.target.value))}><option value={6}>6h</option><option value={24}>24h</option><option value={72}>72h</option></select></label>
          <Link className="secondaryLink" href="/painel">Painel</Link>
          <button className="primaryButton" disabled={sharing} onClick={shareLocation}>
            {sharing ? "Localizando..." : "Registrar minha posição"}
          </button>
        </div>
      </header>

      {message && <section className="infoCard">{message}</section>}

      {sitrep && <section className="dataGrid"><article className="card"><h2>{sitrep.activeIncidents}</h2><p>Ocorrências ativas · P1 {sitrep.p1Incidents} · P2 {sitrep.p2Incidents}</p></article><article className="card"><h2>{sitrep.openMonitoringEvents}</h2><p>Eventos ambientais · emergência {sitrep.emergencyMonitoringEvents}</p></article><article className="card"><h2>{sitrep.publishedAlerts}</h2><p>Alertas publicados</p></article><article className="card"><h2>{sitrep.openShelters}</h2><p>Abrigos abertos · desalojadas {sitrep.displacedHouseholds} · desabrigadas {sitrep.homelessHouseholds}</p></article><article className="card"><h2>{sitrep.activeOperations}</h2><p>Operações SCO · períodos ativos {sitrep.activeOperationalPeriods}</p></article></section>}

      <section className="fieldLayout">
        <div className="fieldMap card">
          {mapUrl ? (
            <>
              <iframe
                className="mapFrame"
                src={mapUrl}
                title={`Mapa da ocorrência ${selected?.protocol ?? ""}`}
                loading="lazy"
              />
              <small>
                Mapa © OpenStreetMap. Selecione uma ocorrência para centralizar.
              </small>
            </>
          ) : (
            <div className="mapEmpty">Nenhuma ocorrência ativa possui coordenadas.</div>
          )}
        </div>

        <aside className="fieldSidebar">
          <div>
            <span className="eyebrow">OCORRÊNCIAS ATIVAS</span>
            <h2>{incidents.length} atendimento(s)</h2>
          </div>
          <div className="fieldIncidentList">
            {incidents.map((item) => (
              <button
                className={`fieldIncident ${selectedId === item.id ? "fieldIncidentSelected" : ""}`}
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                type="button"
              >
                <span className={`priorityBadge priority-${item.priority}`}>{item.priority}</span>
                <span>
                  <strong>{item.protocol}</strong>
                  <small>{item.summary}</small>
                  <small>
                    {[item.neighborhood, item.teamCode ? `Equipe ${item.teamCode}` : null]
                      .filter(Boolean).join(" · ") || item.typeName}
                  </small>
                </span>
              </button>
            ))}
          </div>
          <div style={{marginTop:18}}>
            <span className="eyebrow">MONITORAMENTO</span>
            <h2>{monitoringEvents.length} sinal(is)</h2>
            <div className="fieldIncidentList">
              {monitoringEvents.map((signal) => (
                <a
                  className="fieldIncident"
                  key={signal.id}
                  href={`https://www.openstreetmap.org/?mlat=${signal.latitude}&mlon=${signal.longitude}#map=17/${signal.latitude}/${signal.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className={`priorityBadge priority-${signal.severity==="EMERGENCY"?"P1":signal.severity==="WARNING"?"P2":"P3"}`}>{signal.severity}</span>
                  <span>
                    <strong>{signal.stationCode} · {signal.stationName}</strong>
                    <small>{signal.title}</small>
                    <small>{signal.metric}: {signal.observedValue} {signal.unit}{signal.protocolCode?` · ${signal.protocolCode} v${signal.protocolVersionNo}`:""}</small>
                  </span>
                </a>
              ))}
            </div>
          </div>
        </aside>
      </section>

      <section className="detailSection">
        <div><span className="eyebrow">HISTÓRICO GEOESPACIAL</span><h2>Janela de {historyHours} hora(s)</h2></div>
        <div className="dataGrid"><article className="card"><h2>{historyPositions.length}</h2><p>registros de posição de equipes</p></article><article className="card"><h2>{historySignals.length}</h2><p>eventos ambientais georreferenciados</p></article></div>
        <div className="grid">{historySignals.slice(0,12).map((signal)=><article className="card" key={`hist-${signal.id}`}><h2>{signal.stationCode} · {signal.stationName}</h2><p><strong>{signal.severity}</strong> · {signal.title}</p><p>{signal.metric}: {signal.observedValue} {signal.unit}</p><p>{new Date(signal.createdAt).toLocaleString("pt-BR")}</p><a className="secondaryLink" href={`https://www.openstreetmap.org/?mlat=${signal.latitude}&mlon=${signal.longitude}#map=17/${signal.latitude}/${signal.longitude}`} target="_blank" rel="noreferrer">Abrir ponto histórico</a></article>)}</div>
      </section>

      <section className="detailSection">
        <div><span className="eyebrow">EQUIPES</span><h2>Posições nas últimas 24 horas</h2></div>
        {positions.length === 0 && <section className="infoCard">Nenhuma posição recente informada.</section>}
        <div className="grid">
          {positions.map((position) => (
            <article className="card" key={position.userId}>
              <h2>{position.teamCode ? `Equipe ${position.teamCode}` : position.displayName}</h2>
              <p>{position.teamCode ? position.displayName : "Agente em campo"}</p>
              <p>Atualizada em {new Date(position.recordedAt).toLocaleString("pt-BR")}</p>
              <a
                className="secondaryLink"
                href={`https://www.openstreetmap.org/?mlat=${position.latitude}&mlon=${position.longitude}#map=17/${position.latitude}/${position.longitude}`}
                target="_blank"
                rel="noreferrer"
              >
                Abrir posição
              </a>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
