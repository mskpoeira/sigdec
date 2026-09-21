import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="loginShell">
      <section className="loginBrand">
        <span className="eyebrow">SIGDEC</span>
        <h1>Sistema Integrado de Gestão da Defesa Civil</h1>
        <p>
          Acesso institucional para operadores, agentes, técnicos,
          administrativos e gestores.
        </p>
      </section>
      <LoginForm />
    </main>
  );
}
