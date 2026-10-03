import LoginForm from "./LoginForm";

const UBATUBA_CREST="https://www.ubatuba.sp.gov.br/wp-content/uploads/sites/2/2015/02/brasao.png";
const DEFESA_CIVIL_LOGO="/branding/defesa-civil-ubatuba.webp";

export default function LoginPage(){
 return <main className="friendlyLogin">
  <section className="loginIdentity">
   <div className="loginInstitutionalMarks" aria-label="Identidade institucional">
    <figure className="institutionalMark"><img src={UBATUBA_CREST} alt="Brasão do Município de Ubatuba"/></figure>
    <figure className="institutionalMark"><img src={DEFESA_CIVIL_LOGO} alt="Logo da Defesa Civil de Ubatuba"/></figure>
    <div className="loginInstitutionalText"><strong>Prefeitura Municipal de Ubatuba</strong><span>Defesa Civil · Ubatuba · SP</span></div>
   </div>
   <div className="loginProduct">
    <span className="eyebrow">DEFESA CIVIL · COORDENAÇÃO MUNICIPAL</span>
    <h1>SIGDEC</h1>
    <h2>Sistema Integrado de Gestão de Defesa Civil</h2>
    <p>Prevenção, preparação, resposta e recuperação em uma plataforma integrada para proteger vidas.</p>
   </div>
   <div className="loginSignature"><span>Ubatuba</span><strong>Nossa gente. Nossa natureza.<br/>Mais segura sempre.</strong></div>
  </section>
  <section className="loginAccess">
   <div className="loginWelcome"><span className="eyebrow">ACESSO INSTITUCIONAL</span><h2>Bem-vindo ao SIGDEC</h2><p>Entre com sua matrícula funcional para acessar seu ambiente de trabalho.</p></div>
   <LoginForm/>
   <footer>Prefeitura Municipal de Ubatuba · Defesa Civil<br/><strong>Prevenir é preservar vidas.</strong></footer>
  </section>
 </main>
}