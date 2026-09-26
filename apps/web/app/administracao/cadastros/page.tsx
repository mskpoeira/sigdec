"use client";

import Link from "next/link";
import {FormEvent,useCallback,useEffect,useMemo,useState} from "react";
import {SIGDEC_VERSION_LABEL} from "../../lib/release";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";

type Team={id:string;code:string;name:string;status:string;active:boolean;memberCount:number};
type Vehicle={id:string;code:string;plate:string|null;description:string;status:string;active:boolean;odometerKm:number|null};
type IncidentType={id:string;code:string;name:string;groupName:string;cobradeCode:string|null;defaultPriority:string;active:boolean;systemType:boolean};
type Item={id:string;code:string;name:string;unit:string;category:string;active:boolean;balance:number;movementCount:number};
type User={id:string;matricula:string;displayName:string;jobTitle:string|null;active:boolean};
type Member={userId:string;matricula:string;displayName:string;jobTitle:string|null;roleName:string|null};

const teamStatuses=["AVAILABLE","DISPATCHED","EN_ROUTE","ON_SCENE","RETURNING","UNAVAILABLE"];
const vehicleStatuses=["AVAILABLE","DISPATCHED","EN_ROUTE","ON_SCENE","RETURNING","MAINTENANCE","UNAVAILABLE"];
const statusPt:Record<string,string>={AVAILABLE:"Disponível",DISPATCHED:"Despachado",EN_ROUTE:"Em deslocamento",ON_SCENE:"No local",RETURNING:"Retornando",UNAVAILABLE:"Indisponível",MAINTENANCE:"Manutenção"};

export default function CadastrosOperacionaisPage(){
 const[teams,setTeams]=useState<Team[]>([]),[vehicles,setVehicles]=useState<Vehicle[]>([]),[types,setTypes]=useState<IncidentType[]>([]),[items,setItems]=useState<Item[]>([]),[users,setUsers]=useState<User[]>([]);
 const[selectedTeam,setSelectedTeam]=useState<Team|null>(null),[members,setMembers]=useState<Member[]>([]);
 const[message,setMessage]=useState(""),[busy,setBusy]=useState(false);

 const request=useCallback(async(path:string,init?:RequestInit)=>{
  const r=await fetch(API+path,{credentials:"include",cache:"no-store",...init,headers:{"content-type":"application/json",...(init?.headers??{})}});
  if(r.status===401){location.href="/login";throw new Error("Sessão expirada.");}
  const body=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(body.message??body.error??"Falha na operação.");
  return body;
 },[]);

 const load=useCallback(async()=>{
  const [t,v,ty,i,u]=await Promise.all([
   request("/api/v1/admin/resources/teams"),request("/api/v1/admin/resources/vehicles"),
   request("/api/v1/admin/resources/incident-types"),request("/api/v1/admin/items"),request("/api/v1/admin/users")
  ]);
  setTeams(t.items??[]);setVehicles(v.items??[]);setTypes(ty.items??[]);setItems(i.items??[]);setUsers(u.items??[]);
 },[request]);
 useEffect(()=>{void load().catch(e=>setMessage(e instanceof Error?e.message:"Falha ao carregar cadastros."))},[load]);

 async function perform(fn:()=>Promise<void>){
  setBusy(true);setMessage("");
  try{await fn();await load();if(selectedTeam)await openMembers(selectedTeam)}
  catch(e){setMessage(e instanceof Error?e.message:"Falha na operação.")}
  finally{setBusy(false)}
 }

 async function openMembers(team:Team){
  setSelectedTeam(team);
  const body=await request("/api/v1/admin/resources/teams/"+team.id+"/members");
  setMembers(body.items??[]);
 }

 async function createTeam(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const form=e.currentTarget,d=new FormData(form);
  await perform(async()=>{await request("/api/v1/admin/resources/teams",{method:"POST",body:JSON.stringify({
   code:String(d.get("code")??""),name:String(d.get("name")??""),status:String(d.get("status")??"AVAILABLE"),active:true
  })});form.reset();setMessage("Equipe cadastrada.");});
 }

 async function editTeam(team:Team){
  const name=window.prompt("Nome da equipe:",team.name)?.trim();if(!name)return;
  const status=window.prompt("Status: "+teamStatuses.join(", "),team.status)?.trim().toUpperCase();if(!status||!teamStatuses.includes(status))return;
  await perform(async()=>{await request("/api/v1/admin/resources/teams/"+team.id,{method:"PUT",body:JSON.stringify({code:team.code,name,status,active:team.active})});});
 }

 async function deactivateTeam(team:Team){
  if(!window.confirm("Desativar a equipe "+team.code+"?"))return;
  await perform(async()=>{await request("/api/v1/admin/resources/teams/"+team.id,{method:"DELETE"});});
 }

 async function addMember(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!selectedTeam)return;const form=e.currentTarget,d=new FormData(form);
  await perform(async()=>{await request("/api/v1/admin/resources/teams/"+selectedTeam.id+"/members",{method:"POST",body:JSON.stringify({
   userId:String(d.get("userId")??""),roleName:String(d.get("roleName")??"")
  })});form.reset();setMessage("Integrante vinculado à equipe.");});
 }

 async function removeMember(member:Member){
  if(!selectedTeam||!window.confirm("Remover "+member.displayName+" desta equipe?"))return;
  await perform(async()=>{await request("/api/v1/admin/resources/teams/"+selectedTeam.id+"/members/"+member.userId,{method:"DELETE"});});
 }

 async function createVehicle(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const form=e.currentTarget,d=new FormData(form),odo=String(d.get("odometerKm")??"").trim();
  await perform(async()=>{await request("/api/v1/admin/resources/vehicles",{method:"POST",body:JSON.stringify({
   code:String(d.get("code")??""),plate:String(d.get("plate")??""),description:String(d.get("description")??""),
   status:String(d.get("status")??"AVAILABLE"),odometerKm:odo?Number(odo):null,active:true
  })});form.reset();setMessage("Viatura cadastrada.");});
 }

 async function editVehicle(v:Vehicle){
  const description=window.prompt("Descrição:",v.description)?.trim();if(!description)return;
  const status=window.prompt("Status: "+vehicleStatuses.join(", "),v.status)?.trim().toUpperCase();if(!status||!vehicleStatuses.includes(status))return;
  const plate=window.prompt("Placa:",v.plate??"")??"";
  const odoRaw=window.prompt("Hodômetro (km):",v.odometerKm?.toString()??"")??"";
  await perform(async()=>{await request("/api/v1/admin/resources/vehicles/"+v.id,{method:"PUT",body:JSON.stringify({
   code:v.code,plate,description,status,odometerKm:odoRaw.trim()?Number(odoRaw.replace(",",".")):null,active:v.active
  })});});
 }

 async function deactivateVehicle(v:Vehicle){
  if(!window.confirm("Desativar a viatura "+v.code+"?"))return;
  await perform(async()=>{await request("/api/v1/admin/resources/vehicles/"+v.id,{method:"DELETE"});});
 }

 async function createType(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const form=e.currentTarget,d=new FormData(form);
  await perform(async()=>{await request("/api/v1/admin/resources/incident-types",{method:"POST",body:JSON.stringify({
   code:String(d.get("code")??""),name:String(d.get("name")??""),groupName:String(d.get("groupName")??""),
   cobradeCode:String(d.get("cobradeCode")??""),defaultPriority:String(d.get("defaultPriority")??"P3"),active:true
  })});form.reset();setMessage("Tipo municipal de ocorrência cadastrado.");});
 }

 async function deactivateType(t:IncidentType){
  if(t.systemType)return;if(!window.confirm("Desativar o tipo "+t.code+"?"))return;
  await perform(async()=>{await request("/api/v1/admin/resources/incident-types/"+t.id,{method:"DELETE"});});
 }

 async function createItem(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const form=e.currentTarget,d=new FormData(form);
  await perform(async()=>{await request("/api/v1/admin/items",{method:"POST",body:JSON.stringify({
   code:String(d.get("code")??""),name:String(d.get("name")??""),unit:String(d.get("unit")??"un"),category:String(d.get("category")??"Geral"),active:true
  })});form.reset();setMessage("Item de estoque cadastrado.");});
 }

 const activeUsers=useMemo(()=>users.filter(x=>x.active),[users]);

 return <main className="shell moduleShell">
  <header className="listHeader">
   <div><span className="eyebrow">SIGDEC · ADMINISTRAÇÃO · CADASTROS · {SIGDEC_VERSION_LABEL}</span><h1>Cadastros Operacionais</h1>
    <p>Equipes, integrantes, viaturas, tipos de ocorrência e itens que alimentam a operação diária.</p></div>
   <div className="headerActions"><Link className="secondaryLink" href="/administracao">Administração</Link><Link className="secondaryLink" href="/painel">Painel</Link></div>
  </header>

  {message&&<section className="infoCard">{message}</section>}

  <section className="dataGrid">
   <article className="card"><h2>Equipes</h2><p className="adminNumber">{teams.filter(x=>x.active).length}</p><p>equipes ativas</p></article>
   <article className="card"><h2>Viaturas</h2><p className="adminNumber">{vehicles.filter(x=>x.active).length}</p><p>viaturas ativas</p></article>
   <article className="card"><h2>Tipos de ocorrência</h2><p className="adminNumber">{types.filter(x=>x.active).length}</p><p>sistema + municipais</p></article>
   <article className="card"><h2>Itens humanitários</h2><p className="adminNumber">{items.filter(x=>x.active).length}</p><p>itens ativos</p></article>
  </section>

  <section style={{marginTop:22}}>
   <h2>Equipes e funções operacionais</h2>
   <form className="incidentForm compactForm" onSubmit={createTeam}><div className="formGrid">
    <label>Código<input name="code" required placeholder="EQ-01"/></label><label>Nome<input name="name" required placeholder="Equipe Alfa"/></label>
    <label>Status<select name="status">{teamStatuses.map(x=><option key={x} value={x}>{statusPt[x]??x}</option>)}</select></label>
   </div><button className="primaryButton" disabled={busy}>Cadastrar equipe</button></form>
   <div className="dataGrid">{teams.map(x=><article className={x.active?"card":"warningCard"} key={x.id}>
    <h3>{x.code} · {x.name}</h3><p><strong>{statusPt[x.status]??x.status}</strong> · {x.memberCount} integrante(s) · {x.active?"ativa":"desativada"}</p>
    <div className="headerActions"><button type="button" className="secondaryLink" onClick={()=>void openMembers(x)}>Integrantes/Funções</button><button type="button" className="secondaryLink" onClick={()=>void editTeam(x)}>Editar</button>{x.active&&<button type="button" className="secondaryLink" onClick={()=>void deactivateTeam(x)}>Desativar</button>}</div>
   </article>)}</div>
  </section>

  {selectedTeam&&<section className="infoCard" style={{marginTop:18}}>
   <div className="listHeader"><div><h2>{selectedTeam.code} · Integrantes e funções</h2><p>A função operacional é específica desta equipe e não altera o perfil de acesso do usuário.</p></div><button type="button" className="secondaryLink" onClick={()=>{setSelectedTeam(null);setMembers([])}}>Fechar</button></div>
   <form className="incidentForm compactForm" onSubmit={addMember}><div className="formGrid">
    <label>Servidor<select name="userId" required><option value="">Selecione</option>{activeUsers.map(u=><option key={u.id} value={u.id}>{u.matricula} · {u.displayName}{u.jobTitle?" · "+u.jobTitle:""}</option>)}</select></label>
    <label>Função na equipe<input name="roleName" placeholder="Chefe de equipe, motorista, vistoriador..."/></label>
   </div><button className="primaryButton" disabled={busy}>Vincular integrante</button></form>
   <div className="adminTableWrap"><table><thead><tr><th>Matrícula</th><th>Servidor</th><th>Função</th><th></th></tr></thead><tbody>{members.map(m=><tr key={m.userId}><td>{m.matricula}</td><td>{m.displayName}<br/><small>{m.jobTitle??"Sem cargo informado"}</small></td><td>{m.roleName??"—"}</td><td><button type="button" className="secondaryLink" onClick={()=>void removeMember(m)}>Remover</button></td></tr>)}</tbody></table></div>
  </section>}

  <section style={{marginTop:24}}>
   <h2>Viaturas</h2>
   <form className="incidentForm compactForm" onSubmit={createVehicle}><div className="formGrid">
    <label>Código<input name="code" required placeholder="VTR-01"/></label><label>Placa<input name="plate"/></label><label>Descrição<input name="description" required placeholder="Fiat Strada 4x4"/></label>
    <label>Status<select name="status">{vehicleStatuses.map(x=><option key={x} value={x}>{statusPt[x]??x}</option>)}</select></label><label>Hodômetro<input name="odometerKm" type="number" min="0" step="0.1"/></label>
   </div><button className="primaryButton" disabled={busy}>Cadastrar viatura</button></form>
   <div className="dataGrid">{vehicles.map(v=><article className={v.active?"card":"warningCard"} key={v.id}><h3>{v.code} · {v.description}</h3><p>{v.plate??"Sem placa"} · <strong>{statusPt[v.status]??v.status}</strong></p><p>{v.odometerKm!=null?Number(v.odometerKm).toLocaleString("pt-BR")+" km":"Hodômetro não informado"} · {v.active?"ativa":"desativada"}</p><div className="headerActions"><button type="button" className="secondaryLink" onClick={()=>void editVehicle(v)}>Editar</button>{v.active&&<button type="button" className="secondaryLink" onClick={()=>void deactivateVehicle(v)}>Desativar</button>}</div></article>)}</div>
  </section>

  <section style={{marginTop:24}}>
   <h2>Tipos de ocorrência</h2>
   <form className="incidentForm compactForm" onSubmit={createType}><div className="formGrid">
    <label>Código<input name="code" required placeholder="MAR_AGITADO"/></label><label>Nome<input name="name" required/></label><label>Grupo<input name="groupName" required placeholder="Costeiro"/></label>
    <label>COBRADE<input name="cobradeCode"/></label><label>Prioridade padrão<select name="defaultPriority">{["P1","P2","P3","P4","P5"].map(x=><option key={x} value={x}>{x}</option>)}</select></label>
   </div><button className="primaryButton" disabled={busy}>Cadastrar tipo municipal</button></form>
   <div className="adminTableWrap"><table><thead><tr><th>Código</th><th>Nome</th><th>Grupo</th><th>COBRADE</th><th>Prioridade</th><th>Origem</th><th></th></tr></thead><tbody>{types.map(t=><tr key={t.id}><td><code>{t.code}</code></td><td>{t.name}</td><td>{t.groupName}</td><td>{t.cobradeCode??"—"}</td><td>{t.defaultPriority}</td><td>{t.systemType?"Sistema":"Municipal"}</td><td>{!t.systemType&&t.active&&<button type="button" className="secondaryLink" onClick={()=>void deactivateType(t)}>Desativar</button>}</td></tr>)}</tbody></table></div>
  </section>

  <section style={{marginTop:24}}>
   <h2>Itens humanitários</h2>
   <form className="incidentForm compactForm" onSubmit={createItem}><div className="formGrid">
    <label>Código<input name="code" required/></label><label>Descrição<input name="name" required/></label><label>Unidade<input name="unit" defaultValue="un" required/></label><label>Categoria<input name="category" defaultValue="Geral" required/></label>
   </div><button className="primaryButton" disabled={busy}>Cadastrar item</button></form>
   <div className="dataGrid">{items.map(i=><article className={i.active?"card":"warningCard"} key={i.id}><h3>{i.name}</h3><p>{i.code} · {i.category}</p><p><strong>{Number(i.balance).toLocaleString("pt-BR")} {i.unit}</strong> · {i.movementCount} movimentação(ões)</p></article>)}</div>
  </section>

  <section className="dataGrid" style={{marginTop:24}}>
   <article className="card"><h2>Comunicações</h2><p>Rádios, estações base e ativos de comunicação.</p><Link className="secondaryLink" href="/comunicacoes">Gerenciar ativos</Link></article>
   <article className="card"><h2>Monitoramento</h2><p>Pluviômetros, estações, conectores e limiares.</p><Link className="secondaryLink" href="/monitoramento">Gerenciar monitoramento</Link></article>
   <article className="card"><h2>Usuários, perfis e permissões</h2><p>Cargos, perfis, permissões e credenciais de acesso.</p><Link className="secondaryLink" href="/administracao/usuarios">Gerenciar usuários</Link></article>
  </section>
 </main>;
}
