"use client";
import{FormEvent,useEffect,useState}from"react";
const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";
type Setup={secret:string;otpauthUri:string;qrDataUrl:string;issuer:string;account:string;displayName:string};
export default function ConfigurarMfaPage(){
 const[setup,setSetup]=useState<Setup|null>(null),[code,setCode]=useState(""),[recovery,setRecovery]=useState<string[]>([]),[message,setMessage]=useState("Carregando..."),[busy,setBusy]=useState(false);
 useEffect(()=>{(async()=>{try{
  const me=await fetch(`${API}/auth/me`,{credentials:"include"});if(me.status===401){location.href="/login";return}const body=await me.json();
  if(body.user?.mustChangePassword){location.href="/alterar-senha";return}
  if(body.user?.mfaEnabled){location.href="/painel";return}
  const response=await fetch(`${API}/auth/mfa/setup`,{method:"POST",credentials:"include"});
  const b=await response.json();if(!response.ok)throw new Error(b.message??"Não foi possível iniciar a configuração.");
  setSetup(b);setMessage("");
 }catch(e){setMessage(e instanceof Error?e.message:"Falha ao configurar MFA.")}})()},[]);
 async function verify(e:FormEvent){e.preventDefault();setBusy(true);setMessage("");try{
  const response=await fetch(`${API}/auth/mfa/verify-setup`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({code})});
  const b=await response.json();if(!response.ok)throw new Error(b.message??"Código inválido.");
  setRecovery(b.recoveryCodes??[]);setMessage("Segundo fator habilitado com sucesso.");
 }catch(e){setMessage(e instanceof Error?e.message:"Não foi possível confirmar o código.")}finally{setBusy(false)}}
 if(recovery.length)return <main className="shell moduleShell"><section className="loginCard" style={{maxWidth:720,margin:"30px auto"}}>
  <span className="eyebrow">SEGURANÇA · MFA</span><h1>Segundo fator ativado</h1>
  <p>Guarde estes códigos de recuperação em local seguro. Cada código funciona uma única vez e não será exibido novamente.</p>
  <div className="infoCard"><pre style={{whiteSpace:"pre-wrap",fontSize:"1rem"}}>{recovery.join("\n")}</pre></div>
  <button type="button" onClick={()=>{location.href="/painel"}}>Concluir e abrir o SIGDEC</button>
 </section></main>;
 return <main className="shell moduleShell"><section className="loginCard" style={{maxWidth:720,margin:"30px auto"}}>
  <span className="eyebrow">SEGURANÇA OBRIGATÓRIA</span><h1>Configurar segundo fator</h1>
  <p>Use um aplicativo autenticador compatível com TOTP. Escaneie o QR Code e confirme o código de 6 dígitos.</p>
  {setup&&<><img src={setup.qrDataUrl} alt="QR Code para configurar o segundo fator SIGDEC" width={300} height={300} style={{maxWidth:"100%",height:"auto",alignSelf:"center"}}/>
   <p><strong>Conta:</strong> {setup.account}</p><p><strong>Chave manual:</strong> <code>{setup.secret}</code></p></>}
  <form onSubmit={verify}><label>Código do autenticador<input value={code} onChange={e=>setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required/></label>
   {message&&<p className="formMessage">{message}</p>}<button disabled={busy||!setup}>{busy?"Validando...":"Ativar segundo fator"}</button></form>
  <small>O segredo TOTP é armazenado criptografado no servidor. O QR Code não é gravado no histórico do navegador pelo SIGDEC.</small>
 </section></main>;
}