"use client";
import {SIGDEC_VERSION_LABEL} from "../lib/release";
import { formatDateTimeBR } from "../lib/datetime";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

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
  vehicleCode: string | null;
  vehicleDescription: string | null;
  vehiclePlate: string | null;
  createdAt: string;
  updatedAt: string;
};

type MonitoringSignal = { id:string; severity:string; title:string; status:string; metric:string; observedValue:number|string; thresholdValue:number|string; unit:string; createdAt:string; stationCode:string; stationName:string; latitude:number; longitude:number; protocolCode:string|null; protocolVersionNo:number|null; };

type Sitrep = { generatedAt:string; activeIncidents:number; p1Incidents:number; p2Incidents:number; openMonitoringEvents:number; emergencyMonitoringEvents:number; publishedAlerts:number; openShelters:number; displacedHouseholds:number; homelessHouseholds:number; activeOperations:number; activeOperationalPeriods:number; };

type FieldPosition = {
  userId: string;
  displayName: string;
  matricula: string;
  teamCode: string | null;
  vehicleCode: string | null;
  vehicleDescription: string | null;
  vehiclePlate: string | null;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  speedMps?: number | null;
  headingDegrees?: number | null;
  trackingSessionId?: string | null;
  recordedAt: string;
  capturedAt?: string | null;
};
type TrailPoint={userId:string;displayName:string;matricula:string;teamCode:string|null;latitude:number;longitude:number;speedMps?:number|null;headingDegrees?:number|null;trackingSessionId?:string|null;recordedAt:string};
type MapPoint={id:string;title:string;description:string;latitude:number;longitude:number;createdAt:string;createdBy:string};
type MonitoringReading={id:number;stationId:string;stationCode:string;stationName:string;stationType:string;latitude:number|null;longitude:number|null;metric:string;value:number;unit:string;measuredAt:string};
type RiskAreaLayer={id:string;code:string;name:string;neighborhood:string|null;hazardType:string;riskLevel:string;status:string;exposedBuildings:number;exposedPeople:number;latitude:number|null;longitude:number|null;boundaryGeojson:any};
type WarningAssetLayer={id:string;code:string;name:string;assetType:string;status:string;neighborhood:string|null;latitude:number;longitude:number;batteryPercent:number|null;lastTestedAt:string|null};
type CriticalInfrastructureLayer={id:string;code:string;name:string;category:string;operationalStatus:string;criticality:string;neighborhood:string|null;latitude:number;longitude:number;backupPower:boolean;autonomyHours:number|null};
type ShelterLayer={id:string;name:string;status:string;neighborhood:string|null;capacityPeople:number;currentPeople:number;latitude:number;longitude:number;accessible:boolean;generatorAvailable:boolean;petAreaAvailable:boolean};
type EvacuationRouteLayer={id:string;code:string;name:string;status:string;accessible:boolean;routeGeojson:any;originText:string|null;destinationText:string;riskAreaCode:string|null;riskAreaName:string|null};
type ActiveWarningLayer={id:string;severity:string;title:string;message:string;instruction:string|null;status:string;channels:string[];publishedAt:string|null;riskAreaCode:string|null;riskAreaName:string|null;latitude:number|null;longitude:number|null};
type GeoPixelFeatureLayer={id:string;remoteId:string;layerCode:string;layerTitle:string;category:string;properties:Record<string,any>;geometry:any};

export default function CampoPage() {
  const [monitorMode,setMonitorMode]=useState(false);
  const [incidents, setIncidents] = useState<FieldIncident[]>([]);
  const [positions, setPositions] = useState<FieldPosition[]>([]);
  const [positionTrail,setPositionTrail]=useState<TrailPoint[]>([]);
  const [monitoringEvents, setMonitoringEvents] = useState<MonitoringSignal[]>([]);
  const [latestReadings,setLatestReadings]=useState<MonitoringReading[]>([]);
  const [riskAreas,setRiskAreas]=useState<RiskAreaLayer[]>([]);
  const [warningAssets,setWarningAssets]=useState<WarningAssetLayer[]>([]);
  const [criticalInfrastructures,setCriticalInfrastructures]=useState<CriticalInfrastructureLayer[]>([]);
  const [shelterLayers,setShelterLayers]=useState<ShelterLayer[]>([]);
  const [evacuationRoutes,setEvacuationRoutes]=useState<EvacuationRouteLayer[]>([]);
  const [activeWarnings,setActiveWarnings]=useState<ActiveWarningLayer[]>([]);
  const [geopixelFeatures,setGeopixelFeatures]=useState<GeoPixelFeatureLayer[]>([]);
  const [mapLayers,setMapLayers]=useState({incidents:true,teams:true,monitoring:true,risks:true,warnings:true,infrastructure:true,shelters:true,routes:true,geopixel:true});
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
  const [tracking,setTracking]=useState(false);
  const trackingWatchRef=useRef<number|null>(null);
  const lastTrackRef=useRef<{at:number;lat:number;lon:number}|null>(null);
  const trackingSessionRef=useRef<string|null>(null);
  const [online,setOnline]=useState(true);
  const [clock,setClock]=useState(new Date());
  const [soundEnabled,setSoundEnabled]=useState(false);
  const [criticalNotice,setCriticalNotice]=useState("");
  const seenP1Ref=useRef<Set<string>|null>(null);
  const audioContextRef=useRef<AudioContext|null>(null);
  useEffect(()=>{setMonitorMode(new URLSearchParams(window.location.search).get("monitor")==="1")},[]);
  useEffect(()=>{const timer=window.setInterval(()=>setClock(new Date()),1000);return()=>window.clearInterval(timer)},[]);

  function playCriticalTone(){
    const context=audioContextRef.current;
    if(!context||context.state!=="running")return;
    const now=context.currentTime;
    [0,.24,.48].forEach((offset,index)=>{
      const oscillator=context.createOscillator(),gain=context.createGain();
      oscillator.type="square";oscillator.frequency.value=index===1?880:740;
      gain.gain.setValueAtTime(.0001,now+offset);
      gain.gain.exponentialRampToValueAtTime(.15,now+offset+.02);
      gain.gain.exponentialRampToValueAtTime(.0001,now+offset+.17);
      oscillator.connect(gain);gain.connect(context.destination);
      oscillator.start(now+offset);oscillator.stop(now+offset+.2);
    });
  }

  async function enableCriticalSound(){
    try{
      const AudioCtor=window.AudioContext||(window as typeof window & {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
      if(!AudioCtor)throw new Error();
      const context=audioContextRef.current??new AudioCtor();
      audioContextRef.current=context;
      if(context.state==="suspended")await context.resume();
      setSoundEnabled(true);
      playCriticalTone();
    }catch{setMessage("O navegador não permitiu ativar o alerta sonoro.")}
  }

  function elapsedLabel(createdAt:string){
    const seconds=Math.max(0,Math.floor((clock.getTime()-new Date(createdAt).getTime())/1000));
    const days=Math.floor(seconds/86400),hours=Math.floor((seconds%86400)/3600),minutes=Math.floor((seconds%3600)/60);
    if(days>0)return days+"d "+hours+"h";
    if(hours>0)return hours+"h "+minutes+"min";
    return minutes+"min";
  }

  function distanceMeters(lat1:number,lon1:number,lat2:number,lon2:number){
    const rad=(value:number)=>value*Math.PI/180,R=6371000;
    const dLat=rad(lat2-lat1),dLon=rad(lon2-lon1);
    const a=Math.sin(dLat/2)**2+Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLon/2)**2;
    return 2*R*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  }

  function statusLabel(status:string){
    const labels:Record<string,string>={
      RECEIVED:"Recebida",TRIAGE:"Triagem",WAITING_DISPATCH:"Aguardando despacho",DISPATCHED:"Despachada",
      EN_ROUTE:"Em deslocamento",ON_SCENE:"No local",IN_SERVICE:"Em atendimento",WAITING_SUPPORT:"Aguardando apoio",
      INSPECTION:"Vistoria",MONITORING:"Monitoramento",COMPLETED:"Concluída"
    };
    return labels[status]??status;
  }

  function etaForIncident(item:FieldIncident){
    if(!item.teamCode||item.latitude===null||item.longitude===null)return null;
    if(item.status==="ON_SCENE"||item.status==="IN_SERVICE")return {label:"No local",distanceKm:0};
    if(!["DISPATCHED","EN_ROUTE"].includes(item.status))return null;
    const position=positions.find(p=>p.teamCode===item.teamCode);
    if(!position)return null;
    const distanceKm=distanceMeters(position.latitude,position.longitude,Number(item.latitude),Number(item.longitude))/1000;
    const speedKmh=Number(position.speedMps??0)>1.5?Number(position.speedMps)*3.6:30;
    const minutes=Math.max(1,Math.ceil((distanceKm*1.25/speedKmh)*60));
    return {label:"ETA aprox. "+minutes+" min",distanceKm};
  }

  function positionAgeMinutes(position:FieldPosition){
    return Math.max(0,Math.floor((clock.getTime()-new Date(position.recordedAt).getTime())/60000));
  }

  const trailGroups=useMemo(()=>{
    const groups=new Map<string,TrailPoint[]>();
    for(const point of positionTrail){
      const key=point.trackingSessionId??point.userId;
      const list=groups.get(key)??[];
      list.push(point);groups.set(key,list);
    }
    return [...groups.entries()].map(([key,points])=>({key,points:points.slice(-100)})).filter(group=>group.points.length>1);
  },[positionTrail]);

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
    setPositionTrail(body.positionTrail ?? []);
    setMonitoringEvents(body.monitoringEvents ?? []);
    setLatestReadings(body.latestReadings ?? []);
    setRiskAreas(body.riskAreas ?? []);
    setWarningAssets(body.warningAssets ?? []);
    setCriticalInfrastructures(body.criticalInfrastructures ?? []);
    setShelterLayers(body.shelters ?? []);
    setEvacuationRoutes(body.evacuationRoutes ?? []);
    setActiveWarnings(body.activeWarnings ?? []);
    setGeopixelFeatures(body.geopixelFeatures ?? []);
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
    const refresh=()=>void load().catch((error) => {
      setMessage(error instanceof Error ? error.message : "Falha ao carregar.");
    });
    refresh();
    const timer=window.setInterval(()=>{if(document.visibilityState==="visible"&&navigator.onLine)refresh()},5000);
    const onRealtime=()=>refresh();
    window.addEventListener("sigdec:realtime-tick",onRealtime);
    return()=>{window.clearInterval(timer);window.removeEventListener("sigdec:realtime-tick",onRealtime)};
  }, []);

  useEffect(()=>{
    if(!monitorMode)return;
    const current=new Set(incidents.filter(item=>item.priority==="P1").map(item=>item.id));
    if(seenP1Ref.current===null){seenP1Ref.current=current;return}
    const fresh=incidents.filter(item=>item.priority==="P1"&&!seenP1Ref.current?.has(item.id));
    seenP1Ref.current=current;
    if(!fresh.length)return;
    const incident=fresh[0];
    if(!incident)return;
    setCriticalNotice("NOVA P1 · "+incident.protocol+" · "+incident.summary);
    if(soundEnabled)playCriticalTone();
    const timer=window.setTimeout(()=>setCriticalNotice(""),12000);
    return()=>window.clearTimeout(timer);
  },[incidents,monitorMode,soundEnabled]);

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

  const mapBounds={north:-23.18,south:-23.68,west:-45.38,east:-44.68};
  const locatedIncidents=useMemo(()=>incidents.filter(item=>item.latitude!==null&&item.longitude!==null&&Number.isFinite(Number(item.latitude))&&Number.isFinite(Number(item.longitude))),[incidents]);
  const mapPercent=(latitude:number|string|null,longitude:number|string|null)=>{
    const lat=Number(latitude),lon=Number(longitude);
    const x=Math.max(2,Math.min(98,((lon-mapBounds.west)/(mapBounds.east-mapBounds.west))*100));
    const y=Math.max(2,Math.min(98,((mapBounds.north-lat)/(mapBounds.north-mapBounds.south))*100));
    return {x,y};
  };
  const mapPosition=(latitude:number|string|null,longitude:number|string|null)=>{
    const {x,y}=mapPercent(latitude,longitude);
    return {left:x+"%",top:y+"%"};
  };
  const geoJsonLine=(value:any):Array<[number,number]>=>{
    if(!value||typeof value!=="object")return[];
    const geometry=value.type==="Feature"?value.geometry:value;
    if(!geometry||!Array.isArray(geometry.coordinates))return[];
    if(geometry.type==="LineString")return geometry.coordinates.filter((p:any)=>Array.isArray(p)&&p.length>=2).map((p:any)=>[Number(p[0]),Number(p[1])]);
    if(geometry.type==="Polygon")return (geometry.coordinates[0]??[]).filter((p:any)=>Array.isArray(p)&&p.length>=2).map((p:any)=>[Number(p[0]),Number(p[1])]);
    return[];
  };
  const geoJsonSvgPoints=(value:any)=>geoJsonLine(value).filter(([lon,lat])=>Number.isFinite(lon)&&Number.isFinite(lat)).map(([lon,lat])=>{const p=mapPercent(lat,lon);return p.x+","+p.y}).join(" ");
  const toggleLayer=(key:keyof typeof mapLayers)=>setMapLayers(current=>({...current,[key]:!current[key]}));
  const pinPosition=(item:FieldIncident)=>mapPosition(item.latitude,item.longitude);
  const mapUrl = useMemo(() => {
    if(monitorMode)return "https://www.openstreetmap.org/export/embed.html?bbox=-45.38%2C-23.68%2C-44.68%2C-23.18&layer=mapnik";
    const target=selectedPoint??selected;
    if (!target || target.latitude === null || target.longitude === null) return "";
    const lat = Number(target.latitude);
    const lon = Number(target.longitude);
    const delta = 0.012;
    const bbox = [lon - delta, lat - delta, lon + delta, lat + delta].join(",");
    return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${lat}%2C${lon}`;
  }, [selected,selectedPoint,monitorMode]);

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

  async function toggleFullscreen(){
    try{
      if(!document.fullscreenElement)await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    }catch{setMessage("Não foi possível alterar o modo de tela cheia neste dispositivo.")}
  }

  async function postTrackedPosition(position:GeolocationPosition,trackingSessionId?:string){
    const payload={
      latitude:position.coords.latitude,
      longitude:position.coords.longitude,
      accuracyMeters:position.coords.accuracy,
      ...(position.coords.speed!==null&&Number.isFinite(position.coords.speed)?{speedMps:position.coords.speed}:{}),
      ...(position.coords.heading!==null&&Number.isFinite(position.coords.heading)?{headingDegrees:position.coords.heading}:{}),
      ...(trackingSessionId?{trackingSessionId}:{}),
      capturedAt:new Date(position.timestamp).toISOString()
    };
    const response=await fetch(`${API_URL}/api/v1/field/location`,{
      method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)
    });
    if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.message??"Falha ao transmitir localização.")}
  }

  async function startTracking(){
    if(!navigator.geolocation){setMessage("Este aparelho não disponibiliza geolocalização.");return}
    if(trackingWatchRef.current!==null)return;
    const sessionId=crypto.randomUUID();
    trackingSessionRef.current=sessionId;lastTrackRef.current=null;setTracking(true);
    setMessage("Rastreamento contínuo iniciado. A posição será atualizada durante o deslocamento.");
    trackingWatchRef.current=navigator.geolocation.watchPosition(async position=>{
      const now=Date.now(),previous=lastTrackRef.current;
      const moved=previous?distanceMeters(previous.lat,previous.lon,position.coords.latitude,position.coords.longitude):Infinity;
      if(previous&&now-previous.at<15000&&moved<30)return;
      lastTrackRef.current={at:now,lat:position.coords.latitude,lon:position.coords.longitude};
      if(!navigator.onLine)return;
      try{await postTrackedPosition(position,sessionId)}
      catch(error){setMessage(error instanceof Error?error.message:"Falha no rastreamento em tempo real.")}
    },error=>{
      setMessage(error.code===error.PERMISSION_DENIED?"Permissão de localização negada.":"Sinal de localização indisponível.");
      stopTracking();
    },{enableHighAccuracy:true,maximumAge:5000,timeout:20000});
  }

  function stopTracking(){
    if(trackingWatchRef.current!==null)navigator.geolocation.clearWatch(trackingWatchRef.current);
    trackingWatchRef.current=null;trackingSessionRef.current=null;lastTrackRef.current=null;setTracking(false);
  }

  useEffect(()=>()=>{if(trackingWatchRef.current!==null)navigator.geolocation.clearWatch(trackingWatchRef.current)},[]);

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

  if(monitorMode){
    const priorityCount=(priority:string)=>incidents.filter(item=>item.priority===priority).length;
    const criticalSignals=monitoringEvents.filter(item=>item.severity==="EMERGENCY"||item.severity==="WARNING");
    const recentPositions=positions.filter(item=>Date.now()-new Date(item.recordedAt).getTime()<=30*60*1000);
    const activeVehiclePositions=recentPositions.filter(item=>item.vehicleCode);
    const stalePositions=recentPositions.filter(item=>positionAgeMinutes(item)>=5);
    const liveTrackingPositions=recentPositions.filter(item=>item.trackingSessionId&&positionAgeMinutes(item)<=2);
    const rainfallReadings=latestReadings.filter(item=>item.stationType==="RAIN_GAUGE"||/rain|chuva|precip|pluv/i.test(item.metric));
    const weatherReadings=latestReadings.filter(item=>item.stationType==="WEATHER"||/temp|humid|umid|wind|vento|press/i.test(item.metric));
    const environmentReadings=[...rainfallReadings,...weatherReadings.filter(item=>!rainfallReadings.some(r=>r.id===item.id))].slice(0,10);
    return <main className="situationRoomMonitor">
      {criticalNotice&&<div className="criticalIncidentBanner"><strong>⚠ {criticalNotice}</strong><span>Prioridade máxima — verificar despacho e resposta.</span></div>}
      <header className="situationRoomHeader">
        <div className="situationRoomBrand">
          <span className="eyebrow">SIGDEC · DEFESA CIVIL · UBATUBA · {SIGDEC_VERSION_LABEL}</span>
          <h1>Sala de Situação — Monitor em Tempo Real</h1>
          <p>Ocorrências, equipes, alertas ambientais e resposta operacional em uma única tela.</p>
        </div>
        <div className="situationRoomHeaderStatus">
          <div className={online?"monitorConnection online":"monitorConnection offline"}><span>●</span>{online?"ONLINE":"OFFLINE"}</div>
          <div className="monitorClock"><strong>{clock.toLocaleTimeString("pt-BR")}</strong><small>{clock.toLocaleDateString("pt-BR")}</small></div>
          <button type="button" className={soundEnabled?"monitorSoundButton enabled":"monitorSoundButton"} onClick={()=>void enableCriticalSound()}>{soundEnabled?"🔊 Alerta P1 ativo":"🔇 Ativar som P1"}</button>
          <button type="button" className="monitorFullscreenButton" onClick={()=>void toggleFullscreen()}>⛶ Tela cheia</button>
          <Link className="monitorExitButton" href="/campo">Sair do monitor</Link>
        </div>
      </header>

      <section className="situationRoomKpis">
        <article className="monitorKpi danger"><strong>{sitrep?.activeIncidents??incidents.length}</strong><span>Ocorrências ativas</span><small>P1 {priorityCount("P1")} · P2 {priorityCount("P2")}</small></article>
        <article className="monitorKpi warning"><strong>{sitrep?.openMonitoringEvents??monitoringEvents.length}</strong><span>Eventos ambientais</span><small>{criticalSignals.length} crítico(s)/alerta</small></article>
        <article className="monitorKpi blue"><strong>{activeVehiclePositions.length}/{recentPositions.length}</strong><span>Viaturas / agentes</span><small>{liveTrackingPositions.length} rastreando · {stalePositions.length} sem atualização &gt; 5 min</small></article>
        <article className="monitorKpi green"><strong>{sitrep?.openShelters??0}</strong><span>Abrigos abertos</span><small>{sitrep?.displacedHouseholds??0} desaloj. · {sitrep?.homelessHouseholds??0} desabrig.</small></article>
        <article className="monitorKpi navy"><strong>{sitrep?.activeOperations??0}</strong><span>Operações SCO</span><small>{sitrep?.activeOperationalPeriods??0} período(s) ativo(s)</small></article>
      </section>

      <section className="situationRoomBody">
        <div className="situationRoomMap">
          <iframe className="mapFrame" src={mapUrl} title="Mapa operacional de Ubatuba em tempo real"/>
          <svg className="monitorTrailLayer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {trailGroups.map(group=><polyline key={group.key} points={group.points.map(point=>{const p=mapPercent(point.latitude,point.longitude);return p.x+","+p.y}).join(" ")} />)}
          </svg>
          {stalePositions.length>0&&<div className="stalePositionWarning">⚠ {stalePositions.length} posição(ões) sem atualização há mais de 5 min</div>}
          {locatedIncidents.map(item=><Link
            href={"/ocorrencias/"+item.id} target="_blank" rel="noreferrer"
            className={"monitorIncidentPin priorityMap-"+item.priority+(item.priority==="P1"?" criticalPulse":"")}
            style={mapPosition(item.latitude,item.longitude)} key={"monitor-inc-"+item.id}
            title={item.protocol+" · "+item.summary+" · "+(item.neighborhood??"localização georreferenciada")}>
            <span>{item.priority}</span>
          </Link>)}
          {recentPositions.map(position=><a
            href={"https://www.openstreetmap.org/?mlat="+position.latitude+"&mlon="+position.longitude+"#map=17/"+position.latitude+"/"+position.longitude}
            target="_blank" rel="noreferrer" className={(position.vehicleCode?"monitorTeamPin vehicle":"monitorTeamPin")+(positionAgeMinutes(position)>=5?" stale":"")} style={mapPosition(position.latitude,position.longitude)}
            key={"monitor-team-"+position.userId} title={(position.vehicleCode?position.vehicleCode+" · ":"")+(position.teamCode??position.displayName)+" · "+position.displayName+" · atualização há "+positionAgeMinutes(position)+" min"}>
            <span>{position.vehicleCode?"🚙":"◆"}</span>
          </a>)}
          {monitoringEvents.filter(signal=>Number.isFinite(Number(signal.latitude))&&Number.isFinite(Number(signal.longitude))).map(signal=><a
            href={"https://www.openstreetmap.org/?mlat="+signal.latitude+"&mlon="+signal.longitude+"#map=17/"+signal.latitude+"/"+signal.longitude}
            target="_blank" rel="noreferrer"
            className={"monitorSignalPin "+(signal.severity==="EMERGENCY"?"emergency":signal.severity==="WARNING"?"warning":"")}
            style={mapPosition(signal.latitude,signal.longitude)} key={"monitor-signal-"+signal.id}
            title={signal.stationCode+" · "+signal.title}><span>▲</span></a>)}
          <div className="situationRoomLegend">
            <span><i className="legendIncident"/> Ocorrência</span>
            <span><i className="legendTeam"/> Equipe/agente/viatura</span>
            <span><i className="legendSignal"/> Monitoramento</span>
            <strong>Atualização contínua</strong>
          </div>
        </div>

        <aside className="situationRoomFeed">
          <section className="monitorFeedSection">
            <header><div><span className="eyebrow">OCORRÊNCIAS</span><h2>Atendimentos ativos</h2></div><strong>{incidents.length}</strong></header>
            <div className="monitorFeedList">
              {incidents.slice().sort((a,b)=>a.priority.localeCompare(b.priority)).slice(0,12).map(item=>{
                const eta=etaForIncident(item);
                return <Link href={"/ocorrencias/"+item.id} target="_blank" className={"monitorFeedItem priority-"+item.priority} key={item.id}>
                  <span className={"priorityBadge priority-"+item.priority}>{item.priority}</span>
                  <span><strong>{item.protocol}</strong><small>{item.summary}</small>
                    <small>{[item.neighborhood,item.teamCode?"Equipe "+item.teamCode:null,item.vehicleCode?"Viatura "+item.vehicleCode:null].filter(Boolean).join(" · ")||item.typeName}</small>
                    <small><b className={"monitorStatus status-"+item.status.toLowerCase()}>{statusLabel(item.status)}</b> · aberta há {elapsedLabel(item.createdAt)}{eta?" · "+eta.label+(eta.distanceKm>0?" · "+eta.distanceKm.toFixed(1)+" km":""):""}</small>
                  </span>
                </Link>
              })}
              {incidents.length===0&&<div className="monitorEmpty">Nenhuma ocorrência ativa.</div>}
            </div>
          </section>

          <section className="monitorFeedSection environmentSection">
            <header><div><span className="eyebrow">PLUVIOMETRIA / CLIMA</span><h2>Leituras mais recentes</h2></div><strong>{environmentReadings.length}</strong></header>
            <div className="environmentReadingGrid">
              {environmentReadings.slice(0,8).map(reading=><article className="environmentReading" key={"reading-"+reading.id}>
                <span>{reading.stationType==="RAIN_GAUGE"?"🌧️":/temp/i.test(reading.metric)?"🌡️":/wind|vento/i.test(reading.metric)?"💨":"◉"}</span>
                <div><strong>{reading.value} {reading.unit}</strong><small>{reading.stationCode} · {reading.metric}</small><small>{formatDateTimeBR(reading.measuredAt)}</small></div>
              </article>)}
              {environmentReadings.length===0&&<div className="monitorEmpty">Sem leituras meteorológicas/pluviométricas recentes cadastradas.</div>}
            </div>
          </section>

          <section className="monitorFeedSection">
            <header><div><span className="eyebrow">ALERTAS</span><h2>Eventos ambientais</h2></div><strong>{monitoringEvents.length}</strong></header>
            <div className="monitorFeedList compact">
              {monitoringEvents.slice(0,6).map(signal=><article className={"monitorFeedItem signal-"+signal.severity.toLowerCase()} key={signal.id}>
                <span className="signalIcon">▲</span><span><strong>{signal.stationCode} · {signal.stationName}</strong><small>{signal.title}</small><small>{signal.metric}: {signal.observedValue} {signal.unit}</small></span>
              </article>)}
              {monitoringEvents.length===0&&<div className="monitorEmpty">Nenhum evento ambiental em aberto.</div>}
            </div>
          </section>
        </aside>
      </section>

      <footer className="situationRoomFooter">
        <span><strong>Legenda:</strong> P1 crítica · P2 muito alta · P3 alta · P4 normal · P5 programada · 🚙 viatura em posição recente</span>
        <span>Mapa © OpenStreetMap · Dados operacionais SIGDEC</span>
      </footer>
    </main>;
  }
  return (
    <main className={`shell moduleShell ${monitorMode?"realtimeMonitorMode":""}`}>
      <header className="listHeader">
        <div>
          <span className="eyebrow">OPERAÇÃO DE CAMPO · {SIGDEC_VERSION_LABEL} {monitorMode?"· MONITOR TEMPO REAL":""}</span>
          <h1>{monitorMode?"Monitor de ocorrências em tempo real":"Mapa operacional"}</h1>
          <p>{monitorMode?"Painel contínuo para sala de situação e monitor dedicado. Atualização automática a cada 5 segundos.":"Ocorrências, pontos registrados e últimas posições informadas pelas equipes."}</p>
        </div>
        <div className="headerActions">
          <span className={online?"secondaryLink":"warningCard"}>{online?"Online":"Offline"}</span>
          <label className="secondaryLink">Histórico <select value={historyHours} onChange={(event)=>setHistoryHours(Number(event.target.value))}><option value={6}>6h</option><option value={24}>24h</option><option value={72}>72h</option></select></label>
          <Link className="secondaryLink" href="/painel">Painel</Link>
          {tracking
            ?<button type="button" className="sigdecButton red" onClick={stopTracking}>⏹ Parar rastreamento</button>
            :<button type="button" className="sigdecButton green" onClick={()=>void startTracking()}>📡 Iniciar rastreamento</button>}
          <button className="primaryButton" disabled={sharing||tracking} onClick={shareLocation}>
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
              <div className={monitorMode?"monitorMapWrap":""}>
                <iframe
                  className="mapFrame"
                  src={mapUrl}
                  title={monitorMode?"Mapa de ocorrências ativas em tempo real":`Mapa de ${selectedPoint?.title??selected?.protocol??"Ubatuba"}`}
                  loading="lazy"
                />
                {monitorMode&&locatedIncidents.map(item=><Link
                  href={`/ocorrencias/${item.id}`} target="_blank" rel="noreferrer"
                  className={`mapIncidentPin priorityMap-${item.priority}`} style={pinPosition(item)}
                  key={`live-${item.id}`} title={`${item.protocol} · ${item.summary} · ${item.neighborhood??"localização georreferenciada"}`}>
                  <span>!</span>
                </Link>)}
              </div>
              <small>
                {monitorMode?`Tempo real · ${locatedIncidents.length} ocorrência(s) georreferenciada(s) · atualização a cada 5 s`:"Mapa © OpenStreetMap. Selecione um ponto ou ocorrência para centralizar."}
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
                    {[item.neighborhood, item.teamCode ? `Equipe ${item.teamCode}` : null, item.vehicleCode ? `Viatura ${item.vehicleCode}` : null]
                      .filter(Boolean).join(" · ") || item.typeName}
                  </small>
                  <small>Aberta há {elapsedLabel(item.createdAt)}</small>
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
              {position.vehicleCode&&<p><strong>Viatura:</strong> {position.vehicleCode}{position.vehiclePlate?` · ${position.vehiclePlate}`:""}{position.vehicleDescription?` · ${position.vehicleDescription}`:""}</p>}
              <p><strong>Registrada no SIGDEC em:</strong> {formatDateTimeBR(position.recordedAt)} · há {positionAgeMinutes(position)} min</p>
              {position.speedMps!==null&&position.speedMps!==undefined&&<p><strong>Velocidade:</strong> {(position.speedMps*3.6).toLocaleString("pt-BR",{maximumFractionDigits:1})} km/h{position.headingDegrees!==null&&position.headingDegrees!==undefined?` · rumo ${Math.round(position.headingDegrees)}°`:""}</p>}
              {position.trackingSessionId&&<p><small>📡 Sessão de rastreamento contínuo</small></p>}
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
