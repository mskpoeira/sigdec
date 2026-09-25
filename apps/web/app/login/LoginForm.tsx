"use client";

import { FormEvent, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_SIGDEC_API_URL ?? "http://localhost:4000";

type MfaState={
 challengeToken:string;
 setupRequired:boolean;
 qrDataUrl?:string;
 manualKey?:string;
};

export default function LoginForm() {
  const [matricula, setMatricula] = useState("");
  const [password, setPassword] = useState("");
  const [mfa,setMfa]=useState<MfaState|null>(null);
  const [mfaCode,setMfaCode]=useState("");
  const [recoveryCodes,setRecoveryCodes]=useState<string[]>([]);
  const [nextUrl,setNextUrl]=useState("/painel");
  const [message, setMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  async function beginMfa(body:any){
    const challengeToken=String(body?.mfa?.challengeToken??"");
    const setupRequired=Boolean(body?.mfa?.setupRequired);
    setNextUrl(body?.user?.mustChangePassword?"/alterar-senha":"/painel");
    if(!challengeToken)throw new Error("Challenge MFA ausente.");
    if(setupRequired){
      const response=await fetch(`${API_URL}/auth/mfa/setup`,{
        method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({challengeToken})
      });
      const setup=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(setup.message??"Não foi possível iniciar o MFA.");
      setMfa({challengeToken,setupRequired:true,qrDataUrl:setup.qrDataUrl,manualKey:setup.manualKey});
      setMessage("Cadastre o SIGDEC no seu aplicativo autenticador e informe o código de 6 dígitos.");
    }else{
      setMfa({challengeToken,setupRequired:false});
      setMessage("Informe o código do aplicativo autenticador ou um código de recuperação.");
    }
    setPassword("");
    setShowPassword(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matricula, password })
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setPassword("");
        setShowPassword(false);
        setMessage(body.message ?? "Não foi possível autenticar.");
        return;
      }

      if(body.mfa?.required){
        await beginMfa(body);
        return;
      }

      window.location.href = body.user?.mustChangePassword ? "/alterar-senha" : "/painel";
    } catch(error) {
      setPassword("");
      setShowPassword(false);
      setMessage(error instanceof Error?error.message:"Falha de comunicação com o servidor.");
    } finally {
      setLoading(false);
    }
  }

  async function submitMfa(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!mfa)return;
    setLoading(true);setMessage("");
    try{
      const endpoint=mfa.setupRequired?"/auth/mfa/confirm-setup":"/auth/mfa/verify";
      const response=await fetch(`${API_URL}${endpoint}`,{
        method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({challengeToken:mfa.challengeToken,code:mfaCode})
      });
      const body=await response.json().catch(()=>({}));
      if(!response.ok){
        setMfaCode("");
        setMessage(body.message??"Código MFA inválido.");
        return;
      }
      const codes=Array.isArray(body.recoveryCodes)?body.recoveryCodes:[];
      if(codes.length){
        setRecoveryCodes(codes);
        setMessage("MFA ativado. Guarde os códigos de recuperação abaixo em local seguro; eles não serão mostrados novamente.");
      }else{
        window.location.href=body.user?.mustChangePassword?"/alterar-senha":"/painel";
      }
    }catch{
      setMessage("Falha de comunicação durante a validação MFA.");
    }finally{setLoading(false)}
  }

  if(recoveryCodes.length){
    return <section className="loginCard">
      <div><span className="eyebrow">MFA ATIVADO</span><h2>Códigos de recuperação</h2></div>
      <p>Guarde estes códigos fora do SIGDEC. Cada código funciona uma única vez.</p>
      <div className="infoCard" style={{fontFamily:"monospace",whiteSpace:"pre-wrap"}}>{recoveryCodes.join("\n")}</div>
      <button type="button" onClick={()=>{window.location.href=nextUrl}}>Já salvei os códigos — continuar</button>
      <small>Não envie estes códigos por mensagem, e-mail ou chamado de suporte.</small>
    </section>;
  }

  if(mfa){
    return <form className="loginCard" onSubmit={submitMfa}>
      <div><span className="eyebrow">{mfa.setupRequired?"ATIVAR MFA":"SEGUNDO FATOR"}</span><h2>{mfa.setupRequired?"Proteja sua conta":"Confirmar acesso"}</h2></div>
      {mfa.setupRequired&&<>
        <p>Leia o QR Code com Microsoft Authenticator, Google Authenticator, 1Password ou outro aplicativo compatível com TOTP.</p>
        {mfa.qrDataUrl?<img src={mfa.qrDataUrl} alt="QR Code para configurar MFA" width={240} height={240} style={{alignSelf:"center",maxWidth:"100%"}}/>:null}
        <label>Chave manual<input readOnly value={mfa.manualKey??""} onFocus={e=>e.currentTarget.select()}/></label>
      </>}
      <label>{mfa.setupRequired?"Código de 6 dígitos":"Código MFA ou recuperação"}
        <input autoFocus autoComplete="one-time-code" inputMode={mfa.setupRequired?"numeric":"text"} value={mfaCode} onChange={e=>setMfaCode(e.target.value)} required minLength={6} maxLength={40}/>
      </label>
      {message&&<p className={message.includes("inválido")?"errorMessage":"formMessage"} role="alert">{message}</p>}
      <button type="submit" disabled={loading}>{loading?"Validando...":mfa.setupRequired?"Ativar e entrar":"Confirmar acesso"}</button>
      <button className="secondaryLink" type="button" onClick={()=>{setMfa(null);setMfaCode("");setMessage("")}}>Voltar</button>
    </form>;
  }

  return (
    <form className="loginCard" onSubmit={submit}>
      <div>
        <span className="eyebrow">ACESSO RESTRITO</span>
        <h2>Entrar no SIGDEC</h2>
      </div>

      <label>
        Matrícula
        <input autoComplete="username" inputMode="numeric" value={matricula}
          onChange={(event) => setMatricula(event.target.value)} placeholder="000.000" required/>
      </label>

      <div className="passwordBlock">
        <label>
          Senha
          <input autoCapitalize="none" autoComplete="current-password" name="password" spellCheck={false}
            type={showPassword ? "text" : "password"} value={password}
            onChange={(event) => setPassword(event.target.value)}
            onFocus={(event) => event.currentTarget.select()} required minLength={8}/>
        </label>
        <button className="passwordToggle" type="button" onClick={() => setShowPassword((current) => !current)}>
          {showPassword ? "Ocultar senha" : "Mostrar senha"}
        </button>
      </div>

      {message && <p className="errorMessage" role="alert">{message}</p>}
      <button type="submit" disabled={loading}>{loading ? "Autenticando..." : "Entrar"}</button>
      <a className="loginLink" href="/esqueci-senha">Esqueci minha senha</a>
      <small>O acesso e as ações realizadas no sistema são registrados para fins de segurança e auditoria.</small>
    </form>
  );
}
