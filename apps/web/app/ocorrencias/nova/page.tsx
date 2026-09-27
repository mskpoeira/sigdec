"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_SIGDEC_API_URL ?? "http://localhost:4000";

type PhoneType = "LANDLINE" | "MOBILE";

type IncidentType = {
  id: string;
  name: string;
  groupName: string;
  defaultPriority: string;
};

function formatBrazilPhone(value:string,type:PhoneType){
  const max=type==="MOBILE"?11:10;
  const digits=value.replace(/\D/g,"").slice(0,max);
  if(digits.length<=2)return digits.length?"("+digits:"";
  const ddd=digits.slice(0,2),number=digits.slice(2);
  if(type==="MOBILE"){
    if(number.length<=5)return `(${ddd}) ${number}`;
    return `(${ddd}) ${number.slice(0,5)}-${number.slice(5)}`;
  }
  if(number.length<=4)return `(${ddd}) ${number}`;
  return `(${ddd}) ${number.slice(0,4)}-${number.slice(4)}`;
}

export default function NovaOcorrenciaPage() {
  const [types, setTypes] = useState<IncidentType[]>([]);
  const [typeId, setTypeId] = useState("");
  const [source, setSource] = useState("phone_199");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("");
  const [riskToLife, setRiskToLife] = useState(false);
  const [callerName, setCallerName] = useState("");
  const [callerPhone, setCallerPhone] = useState("");
  const [callerPhoneType, setCallerPhoneType] = useState<PhoneType>("MOBILE");
  const [callerPhoneWhatsapp, setCallerPhoneWhatsapp] = useState(false);
  const [addressLine, setAddressLine] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [referencePoint, setReferencePoint] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [attachments,setAttachments]=useState<File[]>([]);
  const photoInputRef=useRef<HTMLInputElement|null>(null);
  const videoInputRef=useRef<HTMLInputElement|null>(null);
  const filesInputRef=useRef<HTMLInputElement|null>(null);

  function addAttachments(list:FileList|null){
    if(!list)return;
    const accepted=Array.from(list).filter(file=>file.type.startsWith("image/")||file.type.startsWith("video/"));
    setAttachments(current=>{
      const next=[...current];
      for(const file of accepted){
        const duplicate=next.some(item=>item.name===file.name&&item.size===file.size&&item.lastModified===file.lastModified);
        if(!duplicate)next.push(file);
      }
      return next.slice(0,20);
    });
  }

  async function uploadAttachments(incidentId:string){
    const failures:string[]=[];
    for(const file of attachments){
      try{
        const response=await fetch(`${API_URL}/api/v1/incidents/${incidentId}/attachments`,{
          method:"POST",credentials:"include",
          headers:{"Content-Type":file.type||"application/octet-stream","X-File-Name":encodeURIComponent(file.name)},
          body:file
        });
        if(!response.ok){
          const body=await response.json().catch(()=>({}));
          failures.push(`${file.name}: ${body.message??"falha no envio"}`);
        }
      }catch{failures.push(`${file.name}: falha de comunicação`)}
    }
    return failures;
  }

  useEffect(() => {
    fetch(`${API_URL}/api/v1/incident-types`, { credentials: "include" })
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
        const loaded = body.items ?? [];
        setTypes(loaded);
        if (loaded[0]?.id) setTypeId(loaded[0].id);
      })
      .catch(() => setMessage("Não foi possível carregar os tipos de ocorrência."));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      const response = await fetch(`${API_URL}/api/v1/incidents`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          typeId,
          source,
          summary,
          description: description || undefined,
          priority: priority || undefined,
          riskToLife,
          callerName: callerName || undefined,
          callerPhone: callerPhone || undefined,
          callerPhoneType: callerPhone ? callerPhoneType : undefined,
          callerPhoneWhatsapp: callerPhone ? (source==="whatsapp" || callerPhoneWhatsapp) : false,
          addressLine: addressLine || undefined,
          neighborhood: neighborhood || undefined,
          referencePoint: referencePoint || undefined
        })
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(body.message ?? "Não foi possível registrar a ocorrência.");
        return;
      }

      const failures=attachments.length?await uploadAttachments(body.incident.id):[];
      if(failures.length){
        setMessage(`Ocorrência ${body.incident.protocol} registrada. Alguns anexos não foram enviados: ${failures.join(" | ")}`);
        setSaving(false);
        return;
      }
      setMessage(`Ocorrência ${body.incident.protocol} registrada${attachments.length?` com ${attachments.length} anexo(s)`:""} com sucesso. ${body.incident.georeferenced?"Localização georreferenciada e disponível no mapa.":"Endereço salvo; localização no mapa ficou pendente de coordenadas."}`);
      setAttachments([]);
      window.setTimeout(()=>{window.location.href=`/ocorrencias/${body.incident.id}`},450);
    } catch {
      setMessage("Falha de comunicação com o servidor.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="shell moduleShell">
      <header className="listHeader">
        <div>
          <span className="eyebrow">SIGDEC · DEFESA CIVIL · UBATUBA</span>
          <h1>Nova ocorrência</h1>
          <p>Registro inicial rápido; o atendimento pode ser complementado durante a operação.</p>
        </div>
        <Link className="secondaryLink" href="/ocorrencias">Voltar</Link>
      </header>

      <form className="incidentForm" onSubmit={submit}>
        <div className="formGrid">
          <label>
            Tipo de ocorrência
            <select value={typeId} onChange={(e) => setTypeId(e.target.value)} required>
              {types.map((type) => (
                <option value={type.id} key={type.id}>
                  {type.groupName} · {type.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Origem
            <select value={source} onChange={(e) => {
              const next=e.target.value;
              setSource(next);
              if(next==="whatsapp"&&callerPhone)setCallerPhoneWhatsapp(true);
            }}>
              <option value="phone_199">199</option>
              <option value="phone_admin">Telefone administrativo</option>
              <option value="radio">Rádio</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="portal">Portal</option>
              <option value="walk_in">Presencial</option>
              <option value="internal">Interno</option>
              <option value="other">Outro</option>
            </select>
          </label>

          <label>
            Prioridade
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="">Automática pelo tipo</option>
              <option value="P1">P1 · Crítica</option>
              <option value="P2">P2 · Muito alta</option>
              <option value="P3">P3 · Alta</option>
              <option value="P4">P4 · Normal</option>
              <option value="P5">P5 · Programada</option>
            </select>
          </label>

          <label className="checkLabel">
            <input
              type="checkbox"
              checked={riskToLife}
              onChange={(e) => setRiskToLife(e.target.checked)}
            />
            Risco à vida
          </label>
        </div>

        <label>
          Resumo da ocorrência
          <input value={summary} onChange={(e) => setSummary(e.target.value)} minLength={5} maxLength={240} required />
        </label>

        <label>
          Descrição
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
        </label>

        <fieldset>
          <legend>Contato do solicitante</legend>
          <div className="formGrid">
            <label>
              Solicitante
              <input value={callerName} onChange={(e) => setCallerName(e.target.value)} />
            </label>
            <label>
              Tipo do telefone
              <select value={callerPhoneType} onChange={(e) => {
                const next=e.target.value as PhoneType;
                setCallerPhoneType(next);
                setCallerPhone(formatBrazilPhone(callerPhone,next));
              }}>
                <option value="MOBILE">Celular</option>
                <option value="LANDLINE">Telefone fixo</option>
              </select>
            </label>
            <label>
              Telefone
              <input
                value={callerPhone}
                inputMode="tel"
                autoComplete="tel"
                placeholder={callerPhoneType==="MOBILE"?"(12) 99999-9999":"(12) 3333-4444"}
                onChange={(e) => {
                  const next=formatBrazilPhone(e.target.value,callerPhoneType);
                  setCallerPhone(next);
                  if(!next)setCallerPhoneWhatsapp(false);
                  else if(source==="whatsapp")setCallerPhoneWhatsapp(true);
                }}
              />
              <small>{callerPhoneType==="MOBILE"?"Informe DDD + 9 dígitos.":"Informe DDD + 8 dígitos."}</small>
            </label>
            <label className="checkLabel">
              <input
                type="checkbox"
                checked={source==="whatsapp"&&callerPhone ? true : callerPhoneWhatsapp}
                disabled={!callerPhone || source==="whatsapp"}
                onChange={(e) => setCallerPhoneWhatsapp(e.target.checked)}
              />
              Este número possui WhatsApp
            </label>
          </div>
        </fieldset>

        <label>
          Endereço
          <input value={addressLine} onChange={(e) => setAddressLine(e.target.value)} />
        </label>

        <div className="formGrid">
          <label>
            Bairro
            <input value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} />
          </label>
          <label>
            Ponto de referência
            <input value={referencePoint} onChange={(e) => setReferencePoint(e.target.value)} />
          </label>
        </div>

        <fieldset className="incidentMediaFieldset">
          <legend>Fotos e vídeos da ocorrência</legend>
          <p className="mediaHelp">Registre evidências diretamente pela câmera do celular ou selecione arquivos já existentes no celular ou computador.</p>
          <div className="incidentMediaActions">
            <button type="button" className="sigdecButton blue" onClick={()=>photoInputRef.current?.click()}>📷 Tirar foto</button>
            <button type="button" className="sigdecButton orange" onClick={()=>videoInputRef.current?.click()}>🎥 Gravar vídeo</button>
            <button type="button" className="secondaryButton" onClick={()=>filesInputRef.current?.click()}>📁 Buscar no dispositivo</button>
          </div>
          <input ref={photoInputRef} className="mediaHiddenInput" type="file" accept="image/*" capture="environment" multiple onChange={e=>{addAttachments(e.target.files);e.currentTarget.value=""}}/>
          <input ref={videoInputRef} className="mediaHiddenInput" type="file" accept="video/*" capture="environment" onChange={e=>{addAttachments(e.target.files);e.currentTarget.value=""}}/>
          <input ref={filesInputRef} className="mediaHiddenInput" type="file" accept="image/*,video/*" multiple onChange={e=>{addAttachments(e.target.files);e.currentTarget.value=""}}/>
          {attachments.length>0&&<div className="mediaQueue">
            {attachments.map((file,index)=><div className="mediaQueueItem" key={`${file.name}-${file.size}-${index}`}>
              <span>{file.type.startsWith("video/")?"🎥":"📷"}</span>
              <div><strong>{file.name}</strong><small>{(file.size/1024/1024).toLocaleString("pt-BR",{maximumFractionDigits:1})} MB</small></div>
              <button type="button" aria-label={`Remover ${file.name}`} onClick={()=>setAttachments(current=>current.filter((_,i)=>i!==index))}>×</button>
            </div>)}
          </div>}
          <small>Até 20 anexos por registro. Fotos: até 20 MB cada. Vídeos: até 120 MB cada.</small>
        </fieldset>

        {message && <p className="formMessage">{message}</p>}

        <div className="formActions">
          <button className="primaryButton" type="submit" disabled={saving || !typeId}>
            {saving ? "Registrando..." : "Registrar ocorrência"}
          </button>
          <Link className="secondaryLink" href="/ocorrencias">Ver ocorrências</Link>
        </div>
      </form>
    </main>
  );
}
