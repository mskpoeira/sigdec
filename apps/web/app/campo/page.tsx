"use client";
import {SIGDEC_VERSION_LABEL} from "../lib/release";
import { formatDateTimeBR } from "../lib/datetime";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_SIGDEC_API_URL ?? "http://localhost:4000";
const PENDING_LOCATION_KEY="sigdec.field.pending-location.v1";

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
  matricula: string;
  teamCode: string | null;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  recordedAt: string;
  capturedAt?: string | null;
};
type MapPoint={id:string;title:string;description:string;latitude:number;longitude:number;createdAt:string;createdBy:string};

export default function CampoPage() {
  const [incidents, setIncidents] = useState<FieldIncident[]>([]);
  const [positions, setPositions] = useState<FieldPosition[]>([]);
  const [monitoringEvents, setMonitoringEvents] = useState<MonitoringSignal[]>([]);
  const [sitrep, setSitrep] = useState<Sitrep | null>(null);
  const [historyHours, setHistoryHours] = useState(24);
  const [historyPositions, setHistoryPositions] = useState<FieldPosition[]>([]);
  const [historySignals, setHistorySignals] = useState<MonitoringSignal[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [points,setPoints]=useState<MapPoint[]>([]);
  const [pointTitle,setPointTitle]=useState("");
  const [pointDescription,setPointDescription]=useState("");
  const [pointLatitude,setPointLatitude]=useState("");
  const [pointLongitude,setPointLongitude]=useState("");
  const [savingPoint,setSavingPoint]=useState(false);
  const [message, setMessage] = useState("Carregando operação de campo...");
  const [sharing, setSharing] = useState(false);
  const [online,setOnline]=useState(true);

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
    const pointResponse=await fetch(`${API_URL}/api/v1/field/map-points`,{credentials:"include"});
    if(pointResponse.ok){const pointBody=await pointResponse.json();setPoints(pointBody.items??[]);}
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

  useEffect(()=>{
    const update=()=>setOnline(navigator.onLine);
    update();
    const syncPending=async()=>{
      update();
      if(!navigator.onLine)return;
      const raw=sessionStorage.getItem(PENDING_LOCATION_KEY);
      if(!raw)return;
      try{
        const payload=JSON.parse(raw);
        const response=await fetch(`${API_URL}/api/v1/field/location`,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
        if(response.ok){sessionStorage.removeItem(PENDING_LOCATION_KEY);setMessage("Posição pendente sincronizada com o servidor.");await load();}
      }catch{}
    };
    window.addEventListener("online",syncPending);window.addEventListener("offline",update);
    void syncPending();
    return()=>{window.removeEventListener("online",syncPending);window.removeEventListener("offline",update)};
  },[]);

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
  const selectedPoint=useMemo(()=>points.find(item=>`point:${item.id}`===selectedId)??null,[points,selectedId]);

  const mapUrl = useMemo(() => {
    const target=selectedPoint??selected;
    if (!target || target.latitude === null || target.longitude === null) return "";
    const lat = Number(target.latitude);
    const lon = Number(target.longitude);
    const delta = 0.012;
    const bbox = [lon - delta, lat - delta, lon + delta, lat + delta].join(",");
    return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${lat}%2C${lon}`;
  }, [selected,selectedPoint]);

  async function savePoint(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();setSavingPoint(true);
    try{
      const response=await fetch(`${API_URL}/api/v1/field/map-points`,{method:"POST",credentials:"include",
        headers:{"Content-Type":"application/json"},body:JSON.stringify({title:pointTitle,description:pointDescription,
          latitude:Number(pointLatitude),longitude:Number(pointLongitude)})});
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.message??"Confira o nome e as coordenadas do ponto.");
      setSelectedId(`point:${body.id}`);setPointTitle("");setPointDescription("");setPointLatitude("");setPointLongitude("");
      await load();setMessage("Ponto registrado e disponível no mapa operacional e na exportação para o My Maps.");
    }catch(error){setMessage(error instanceof Error?error.message:"Falha ao registrar ponto.");}
    finally{setSavingPoint(false);}
  }
  function useCurrentCoordinates(){
    if(!navigator.geolocation){setMessage("Este aparelho não disponibiliza geolocalização.");return;}
    navigator.geolocation.getCurrentPosition(p=>{
      setPointLatitude(String(p.coords.latitude));setPointLongitude(String(p.coords.longitude));
    },()=>setMessage("Não foi possível obter as coordenadas do aparelho."),{enableHighAccuracy:true,timeout:15000});
  }
  async function downloadExport(format:"kml"|"csv"){
    try{
      const response=await fetch(`${API_URL}/api/v1/field/map-points.${format}`,{credentials:"include"});
      if(!response.ok)throw new Error("Não foi possível gerar a exportação.");
      const url=URL.createObjectURL(await response.blob());const anchor=document.createElement("a");
      anchor.href=url;anchor.download=`sigdec-pontos.${format}`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(error){setMessage(error instanceof Error?error.message:"Falha na exportação.");}
  }

  function shareLocation() {
    if (!navigator.geolocation) {
      setMessage("Este aparelho não disponibiliza geolocalização.");
      return;
    }
    setSharing(true);
    setMessage("Obtendo localização do aparelho...");

    navigator.geolocation.getCurrentPosition(async (position) => {
      const payload={
        latitude:position.coords.latitude,
        longitude:position.coords.longitude,
        accuracyMeters:position.coords.accuracy,
        capturedAt:new Date(position.timestamp).toISOString()
      };
      if(!navigator.onLine){
        sessionStorage.setItem(PENDING_LOCATION_KEY,JSON.stringify(payload));
        setMessage("Sem conexão: posição mantida apenas nesta sessão e será enviada quando a rede voltar.");
        setSharing(false);return;
      }
      try {
        const response = await fetch(`${API_URL}/api/v1/field/location`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message ?? "Não foi possível registrar a localização.");
        sessionStorage.removeItem(PENDING_LOCATION_KEY);
        setMessage("Localização registrada com segurança.");
        await load();
      } catch (error) {
        sessionStorage.setItem(PENDING_LOCATION_KEY,JSON.stringify(payload));
        setMessage("Falha de rede: posição mantida apenas nesta sessão para nova tentativa automática.");
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
          <span className="eyebrow">OPERAÇÃO DE CAMPO · {SIGDEC_VERSION_LABEL}</span>
          <h1>Mapa operacional</h1>
          <p>Ocorrências, pontos registrados e últimas posições informadas pelas equipes.</p>
        </div>
        <div className="headerActions">
          <span className={online?"secondaryLink":"warningCard"}>{online?"Online":"Offline"}</span>
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
                title={`Mapa de ${selectedPoint?.title??selected?.protocol??"Ubatuba"}`}
                loading="lazy"
              />
              <small>
                Mapa © OpenStreetMap. Selecione um ponto ou ocorrência para centralizar.
              </small>
            </>
          ) : (
            <div className="mapEmpty">Nenhum ponto ou ocorrência ativa possui coordenadas.</div>
          )}
        </div>

        <aside className="fieldSidebar">
          <div className="card fieldPointCard">
            <span className="eyebrow">PONTOS DO MAPA</span>
            <h2>Registrar ponto</h2>
            <form onSubmit={savePoint} className="fieldPointForm">
              <label>Nome <input required minLength={3} maxLength={160} value={pointTitle} onChange={e=>setPointTitle(e.target.value)} placeholder="Ex.: Área alagada"/></label>
              <label>Descrição <textarea maxLength={2000} value={pointDescription} onChange={e=>setPointDescription(e.target.value)} placeholder="Referência operacional"/></label>
              <div className="fieldPointCoords"><label>Latitude <input type="number" required min={-90} max={90} step="any" value={pointLatitude} onChange={e=>setPointLatitude(e.target.value)}/></label>
              <label>Longitude <input type="number" required min={-180} max={180} step="any" value={pointLongitude} onChange={e=>setPointLongitude(e.target.value)}/></label></div>
              <button type="button" className="secondaryLink" onClick={useCurrentCoordinates}>Usar minha localização</button>
              <button className="primaryButton" disabled={savingPoint}>{savingPoint?"Registrando...":"Registrar no mapa"}</button>
            </form>
            <div className="fieldExportActions"><button type="button" className="secondaryLink" onClick={()=>void downloadExport("kml")}>Baixar KML</button><button type="button" className="secondaryLink" onClick={()=>void downloadExport("csv")}>Baixar CSV</button></div>
            <p>Para visualizar no Google My Maps, importe o arquivo KML ou CSV em um mapa seu. Inclui pontos e ocorrências ativas com coordenadas.</p>
            <a href="https://www.google.com/maps/d/" target="_blank" rel="noreferrer">Abrir Google My Maps ↗</a>
            <h3>{points.length} ponto(s) registrado(s)</h3>
            <div className="fieldIncidentList">{points.map(point=><button type="button" className={`fieldIncident ${selectedId===`point:${point.id}`?"fieldIncidentSelected":""}`} key={point.id} onClick={()=>setSelectedId(`point:${point.id}`)}><span className="priorityBadge">●</span><span><strong>{point.title}</strong><small>{point.description||`${point.latitude}, ${point.longitude}`}</small><small>{formatDateTimeBR(point.createdAt)}</small></span></button>)}</div>
          </div>
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
        <div className="grid">{historySignals.slice(0,12).map((signal)=><article className="card" key={`hist-${signal.id}`}><h2>{signal.stationCode} · {signal.stationName}</h2><p><strong>{signal.severity}</strong> · {signal.title}</p><p>{signal.metric}: {signal.observedValue} {signal.unit}</p><p>{formatDateTimeBR(signal.createdAt)}</p><a className="secondaryLink" href={`https://www.openstreetmap.org/?mlat=${signal.latitude}&mlon=${signal.longitude}#map=17/${signal.latitude}/${signal.longitude}`} target="_blank" rel="noreferrer">Abrir ponto histórico</a></article>)}</div>
      </section>

      <section className="detailSection">
        <div><span className="eyebrow">EQUIPES</span><h2>Posições nas últimas 24 horas</h2></div>
        {positions.length === 0 && <section className="infoCard">Nenhuma posição recente informada.</section>}
        <div className="grid">
          {positions.map((position) => (
            <article className="card" key={position.userId}>
              <h2>{position.teamCode ? `Equipe ${position.teamCode}` : position.displayName}</h2>
              <p>{position.teamCode ? position.displayName : "Agente em campo"} · matrícula {position.matricula}</p>
              <p><strong>Registrada no SIGDEC em:</strong> {formatDateTimeBR(position.recordedAt)}</p>
              {position.capturedAt&&<p><small>Coletada pelo dispositivo em {formatDateTimeBR(position.capturedAt)}</small></p>}
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
