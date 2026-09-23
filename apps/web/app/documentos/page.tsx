"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_SIGDEC_API_URL ?? "http://localhost:4000";

type Template = {
  id: string;
  code: string;
  name: string;
  documentType: string;
  version: number;
  defaultTitle: string;
  defaultContent: string;
  defaultLegalBasis: string | null;
};

type TechnicalDocument = {
  id: string;
  documentType: string;
  number: string;
  title: string;
  subject: string | null;
  status: string;
  revision: number;
  contentHash: string | null;
  recipient: string | null;
  validUntil: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  issuedAt: string | null;
  cancelledAt: string | null;
  protocol: string | null;
  createdByName: string;
  approvedByName: string | null;
};

type Incident = {
  id: string;
  protocol: string;
  summary: string;
};

const typeLabels: Record<string, string> = {
  REPORT: "Relatório técnico",
  OPINION: "Parecer técnico",
  INTERDICTION: "Auto de interdição",
  DECLARATION: "Declaração",
  FORM: "Formulário",
  OTHER: "Outro documento"
};

const statusLabels: Record<string, string> = {
  DRAFT: "Rascunho",
  REVIEW: "Em revisão",
  APPROVED: "Aprovado",
  ISSUED: "Emitido",
  CANCELLED: "Cancelado"
};

export default function DocumentosPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [items, setItems] = useState<TechnicalDocument[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [message, setMessage] = useState("Carregando documentos...");
  const [busy, setBusy] = useState(false);

  const [templateId, setTemplateId] = useState("");
  const [documentType, setDocumentType] = useState("REPORT");
  const [incidentId, setIncidentId] = useState("");
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [recipient, setRecipient] = useState("");
  const [legalBasis, setLegalBasis] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [documentContent, setDocumentContent] = useState("");

  const load = useCallback(async () => {
    const [documentsResponse, templatesResponse, incidentsResponse] = await Promise.all([
      fetch(`${API}/api/v1/technical-documents`, { credentials: "include" }),
      fetch(`${API}/api/v1/technical-documents/templates`, { credentials: "include" }),
      fetch(`${API}/api/v1/incidents?limit=100`, { credentials: "include" })
    ]);

    if (documentsResponse.status === 401) {
      window.location.href = "/login";
      return;
    }
    if (documentsResponse.status === 403) {
      const body = await documentsResponse.json().catch(() => ({}));
      if (body?.error === "PASSWORD_CHANGE_REQUIRED") window.location.href = "/alterar-senha";
      throw new Error(body?.message ?? "Acesso não autorizado.");
    }
    if (!documentsResponse.ok || !templatesResponse.ok) {
      throw new Error("Não foi possível carregar o módulo documental.");
    }

    const [documentsBody, templatesBody] = await Promise.all([
      documentsResponse.json(),
      templatesResponse.json()
    ]);
    setItems(documentsBody.items ?? []);
    setTemplates(templatesBody.items ?? []);

    if (incidentsResponse.ok) {
      const incidentsBody = await incidentsResponse.json();
      setIncidents(incidentsBody.items ?? []);
    }
    setMessage("");
  }, []);

  useEffect(() => {
    void load().catch((error) => {
      setMessage(error instanceof Error ? error.message : "Falha ao carregar documentos.");
    });
  }, [load]);

  function applyTemplate(id: string) {
    setTemplateId(id);
    const template = templates.find((item) => item.id === id);
    if (!template) return;
    setDocumentType(template.documentType);
    setTitle(template.defaultTitle);
    setDocumentContent(template.defaultContent);
    setLegalBasis(template.defaultLegalBasis ?? "");
  }

  async function generateSitrep(){
    setBusy(true);setMessage("");
    try{
      const response=await fetch(`${API}/api/v1/technical-documents/sitrep-draft`,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:"{}"});
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.message??"Não foi possível gerar o SITREP.");
      setMessage(`SITREP ${body.document?.number??""} criado como rascunho oficial.`);
      await load();
    }catch(error){setMessage(error instanceof Error?error.message:"Falha ao gerar SITREP.");}
    finally{setBusy(false)}
  }

  async function createDocument(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${API}/api/v1/technical-documents`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: templateId || undefined,
          incidentId: incidentId || undefined,
          documentType,
          title,
          subject: subject || undefined,
          content: documentContent,
          legalBasis: legalBasis || undefined,
          recipient: recipient || undefined,
          validUntil: validUntil ? `${validUntil}T12:00:00.000Z` : undefined
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "Não foi possível criar o documento.");

      setTemplateId("");
      setDocumentType("REPORT");
      setIncidentId("");
      setTitle("");
      setSubject("");
      setRecipient("");
      setLegalBasis("");
      setValidUntil("");
      setDocumentContent("");
      setMessage(`Documento ${body.document?.number ?? ""} criado como rascunho.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao criar documento.");
    } finally {
      setBusy(false);
    }
  }

  async function runAction(item: TechnicalDocument, action: string) {
    const notes: Record<string, string> = {
      submit: "Encaminhar este documento para revisão?",
      approve: "Aprovar e assinar eletronicamente este documento?",
      issue: "Emitir e assinar eletronicamente este documento?",
      return: "Informe o motivo da devolução para correção:",
      cancel: "Informe o motivo do cancelamento:"
    };

    let note: string | undefined;
    if (action === "return" || action === "cancel") {
      note = window.prompt(notes[action])?.trim();
      if (!note) return;
    } else if (!window.confirm(notes[action])) {
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `${API}/api/v1/technical-documents/${item.id}/${action}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note })
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "Operação não autorizada ou inválida.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao atualizar o documento.");
    } finally {
      setBusy(false);
    }
  }

  async function editDocument(item: TechnicalDocument) {
    setBusy(true);
    setMessage("");
    try {
      const detailResponse = await fetch(
        `${API}/api/v1/technical-documents/${item.id}`,
        { credentials: "include" }
      );
      if (!detailResponse.ok) throw new Error("Não foi possível abrir o documento.");
      const detail = await detailResponse.json();
      const current = detail.document;

      const editedTitle = window.prompt("Título:", current.title)?.trim();
      if (!editedTitle) return;
      const editedContent = window.prompt(
        "Conteúdo técnico:",
        current.contentText ?? ""
      )?.trim();
      if (!editedContent) return;
      const changeSummary = window.prompt("Descreva objetivamente o que foi alterado:")?.trim();
      if (!changeSummary) return;

      const response = await fetch(
        `${API}/api/v1/technical-documents/${item.id}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: editedTitle,
            content: editedContent,
            changeSummary
          })
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "Não foi possível salvar a revisão.");
      setMessage(`Revisão ${body.revision} registrada com hash de integridade.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao editar documento.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell moduleShell">
      <header className="listHeader">
        <div>
          <span className="eyebrow">SIGDEC · DOCUMENTOS OFICIAIS · v1.11</span>
          <h1>Documentos técnicos</h1>
          <p>Elaboração, revisão, aprovação, emissão, integridade e PDF.</p>
        </div>
        <div className="headerActions"><button className="primaryButton" disabled={busy} onClick={()=>void generateSitrep()} type="button">Gerar SITREP atual</button><Link className="secondaryLink" href="/painel">Painel</Link></div>
      </header>

      {message && <section className="infoCard">{message}</section>}

      <section className="documentLayout">
        <form className="incidentForm documentForm" onSubmit={createDocument}>
          <div>
            <span className="eyebrow">NOVO DOCUMENTO</span>
            <h2>Elaborar minuta</h2>
          </div>

          <label>
            Modelo institucional
            <select value={templateId} onChange={(event) => applyTemplate(event.target.value)}>
              <option value="">Iniciar sem modelo</option>
              {templates.map((template) => (
                <option value={template.id} key={template.id}>
                  {template.name} · versão {template.version}
                </option>
              ))}
            </select>
          </label>

          <label>
            Tipo
            <select value={documentType} onChange={(event) => setDocumentType(event.target.value)}>
              {Object.entries(typeLabels).map(([value, label]) => (
                <option value={value} key={value}>{label}</option>
              ))}
            </select>
          </label>

          <label>
            Ocorrência vinculada
            <select value={incidentId} onChange={(event) => setIncidentId(event.target.value)}>
              <option value="">Sem vínculo</option>
              {incidents.map((incident) => (
                <option value={incident.id} key={incident.id}>
                  {incident.protocol} · {incident.summary}
                </option>
              ))}
            </select>
          </label>

          <label>
            Título
            <input required value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>

          <label>
            Assunto
            <input value={subject} onChange={(event) => setSubject(event.target.value)} />
          </label>

          <label>
            Destinatário
            <input value={recipient} onChange={(event) => setRecipient(event.target.value)} />
          </label>

          <label>
            Conteúdo técnico
            <textarea
              className="documentEditor"
              required
              value={documentContent}
              onChange={(event) => setDocumentContent(event.target.value)}
            />
          </label>

          <label>
            Fundamentação
            <textarea value={legalBasis} onChange={(event) => setLegalBasis(event.target.value)} />
          </label>

          <label>
            Validade, quando aplicável
            <input type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} />
          </label>

          <button className="primaryButton" disabled={busy} type="submit">
            {busy ? "Registrando..." : "Criar rascunho numerado"}
          </button>
        </form>

        <section className="documentList">
          {items.length === 0 && <section className="infoCard">Nenhum documento registrado.</section>}
          {items.map((item) => (
            <article className="card documentCard" key={item.id}>
              <div className="documentCardHeader">
                <div>
                  <span className="eyebrow">{item.number}</span>
                  <h2>{item.title}</h2>
                </div>
                <span className={`statusTag documentStatus-${item.status}`}>
                  {statusLabels[item.status] ?? item.status}
                </span>
              </div>
              <p>
                {typeLabels[item.documentType] ?? item.documentType}
                {item.protocol ? ` · ${item.protocol}` : ""}
              </p>
              <p>Revisão {item.revision} · elaborado por {item.createdByName}</p>
              {item.approvedByName && <p>Aprovado por {item.approvedByName}</p>}
              {item.contentHash && (
                <code className="documentHash">SHA-256 {item.contentHash}</code>
              )}

              <div className="documentActions">
                <a
                  className="secondaryLink"
                  href={`${API}/api/v1/technical-documents/${item.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Abrir PDF
                </a>
                {item.status === "DRAFT" && (
                  <>
                    <button disabled={busy} onClick={() => void editDocument(item)} type="button">
                      Editar
                    </button>
                    <button disabled={busy} onClick={() => void runAction(item, "submit")} type="button">
                      Enviar para revisão
                    </button>
                  </>
                )}
                {item.status === "REVIEW" && (
                  <>
                    <button disabled={busy} onClick={() => void runAction(item, "approve")} type="button">
                      Aprovar
                    </button>
                    <button className="secondaryButton" disabled={busy} onClick={() => void runAction(item, "return")} type="button">
                      Devolver
                    </button>
                  </>
                )}
                {item.status === "APPROVED" && (
                  <>
                    <button disabled={busy} onClick={() => void runAction(item, "issue")} type="button">
                      Emitir
                    </button>
                    <button className="secondaryButton" disabled={busy} onClick={() => void runAction(item, "return")} type="button">
                      Reabrir
                    </button>
                  </>
                )}
                {item.status === "ISSUED" && (
                  <button className="secondaryButton" disabled={busy} onClick={() => void runAction(item, "cancel")} type="button">
                    Cancelar
                  </button>
                )}
              </div>
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}
