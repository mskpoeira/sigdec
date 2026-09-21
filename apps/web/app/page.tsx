const modules = [
  "Central Operacional", "Ocorrências", "Despacho", "Vistorias",
  "Monitoramento", "Gestão de Riscos", "SCO / Desastres",
  "Assistência Humanitária", "Fundo Social e Doações", "Voluntariado",
  "Recursos e Logística", "Comunicações", "Documentos e Laudos",
  "S2iD / COBRADE", "Relatórios e BI", "Administração e Auditoria"
];

export default function Home() {
  return (
    <main className="shell">
      <header className="hero">
        <span className="eyebrow">SIGDEC</span>
        <h1>Sistema Integrado de Gestão da Defesa Civil</h1>
        <p>Plataforma municipal modular para operação cotidiana e gestão de grandes desastres.</p>
      </header>
      <section className="status">
        <strong>Fundação v0.1.0</strong><span>Ambiente inicial do projeto</span>
      </section>
      <section className="grid">
        {modules.map((module) => (
          <article className="card" key={module}>
            <h2>{module}</h2>
            <p>Módulo previsto no Documento Mestre de Requisitos.</p>
          </article>
        ))}
      </section>
    </main>
  );
}
