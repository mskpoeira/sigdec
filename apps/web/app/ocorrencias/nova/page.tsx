"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_SIGDEC_API_URL ?? "http://localhost:4000";

type IncidentType = {
  id: string;
  name: string;
  groupName: string;
  defaultPriority: string;
};

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
  const [addressLine, setAddressLine] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [referencePoint, setReferencePoint] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

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

      setMessage(`Ocorrência ${body.incident.protocol} registrada com sucesso.`);
      setSummary("");
      setDescription("");
      setCallerName("");
      setCallerPhone("");
      setAddressLine("");
      setNeighborhood("");
      setReferencePoint("");
      setPriority("");
      setRiskToLife(false);
    } catch {
      setMessage("Falha de comunicação com o servidor.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="shell">
      <header className="listHeader">
        <div>
          <span className="eyebrow">CENTRAL OPERACIONAL</span>
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
            <select value={source} onChange={(e) => setSource(e.target.value)}>
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

        <div className="formGrid">
          <label>
            Solicitante
            <input value={callerName} onChange={(e) => setCallerName(e.target.value)} />
          </label>
          <label>
            Telefone
            <input value={callerPhone} onChange={(e) => setCallerPhone(e.target.value)} />
          </label>
        </div>

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
