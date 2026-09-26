"use client";
import { formatDateTimeBR } from "../../lib/datetime";
import Link from "next/link";
import {FormEvent,useCallback,useEffect,useState} from "react";

const API=process.env.NEXT_PUBLIC_SIGDEC_API_URL??"http://localhost:4000";
type User={id:string;matricula:string;displayName:string;email:string|null;phone:string|null;jobTitle:string|null;department:string|null;active:boolean;mustChangePassword:boolean;mfaEnabled:boolean;roleIds:string[];roles:string[];lastLoginAt:string|null};
type Role={id:string;code:string;name:string;level:number;systemRole:boolean;permissionCodes:string[]};
type Permission={code:string;description:string};
type Item={id:string;code:string;name:string;unit:string;category:string;active:boolean;balance:number;movementCount:number};
type MenuItem={id:string;label:string;path:string;permissionCode:string|null;sortOrder:number;active:boolean};
type Report={overview:{total:number;active:number;inactive:number;pendingPasswordChange:number;mfaEnabled:number};roles:{code:string;name:string;total:number;active:number}[]};
type Tab="users"|"roles"|"items"|"menus"|"reports"|"database";
const paths=["/painel","/ocorrencias","/ocorrencias/nova","/campo","/monitoramento","/assistencia","/voluntarios","/vistorias","/comunicacoes","/sco","/documentos","/gestao","/continuidade","/administracao","/administracao/auditoria"];
const blankUser={matricula:"",displayName:"",email:"",phone:"",jobTitle:"",department:"",roleIds:[] as string[],active:true};
const blankItem={code:"",name:"",unit:"un",category:"Geral",active:true};
const blankMenu={label:"",path:"/painel",permissionCode:"",sortOrder:100,active:true};
const fmt=(value:string|null)=>value?formatDateTimeBR(value):"Nunca";
const dbCell=(key:string,value:unknown)=>{
 if(value===null||value===undefined)return "—";
 if(typeof value==="object")return JSON.stringify(value);
 if(typeof value==="string"&&/(?:_at|At|timestamp)$/i.test(key))return formatDateTimeBR(value);
 return String(value);
};

export default function UsersAdministrationPage(){
 const[tab,setTab]=useState<Tab>("users"),[users,setUsers]=useState<User[]>([]),[roles,setRoles]=useState<Role[]>([]),[permissions,setPermissions]=useState<Permission[]>([]),
  [items,setItems]=useState<Item[]>([]),[menus,setMenus]=useState<MenuItem[]>([]),[report,setReport]=useState<Report|null>(null),
  [userId,setUserId]=useState<string|null>(null),[userDraft,setUserDraft]=useState(blankUser),
  [roleId,setRoleId]=useState<string|null>(null),[roleDraft,setRoleDraft]=useState({code:"",name:"",permissionCodes:[] as string[]}),
  [itemId,setItemId]=useState<string|null>(null),[itemDraft,setItemDraft]=useState(blankItem),
  [menuId,setMenuId]=useState<string|null>(null),[menuDraft,setMenuDraft]=useState(blankMenu),
  [dbView,setDbView]=useState("audit"),[dbRows,setDbRows]=useState<Record<string,unknown>[]>([]),
  [message,setMessage]=useState(""),[temporary,setTemporary]=useState(""),[busy,setBusy]=useState(false);
 const request=useCallback(async(path:string,init?:RequestInit)=>{
  const r=await fetch(`${API}${path}`,{credentials:"include",cache:"no-store",...init,headers:{"content-type":"application/json",...(init?.headers??{})}});
  if(r.status===401){location.href="/login";throw new Error("Sessão expirada.")}
  const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.message??body.error??"Falha na operação.");return body;
 },[]);
 const load=useCallback(async()=>{
  try{
   const [u,r,i,n,report]=await Promise.all([request("/api/v1/admin/users"),request("/api/v1/admin/roles"),
    request("/api/v1/admin/items"),request("/api/v1/admin/navigation"),request("/api/v1/admin/reports/users")]);
   setUsers(u.items??[]);setRoles(r.items??[]);setPermissions(r.permissions??[]);setItems(i.items??[]);setMenus(n.items??[]);setReport(report);
  }catch(error){setMessage(error instanceof Error?error.message:"Falha ao carregar a administração.")}
 },[request]);
 useEffect(()=>{void load()},[load]);
 async function perform(fn:()=>Promise<void>){setBusy(true);setMessage("");try{await fn();await load()}catch(error){setMessage(error instanceof Error?error.message:"Falha na operação.")}finally{setBusy(false)}}
 async function saveUser(e:FormEvent){e.preventDefault();await perform(async()=>{
  const result=await request(userId?`/api/v1/admin/users/${userId}`:"/api/v1/admin/users",{method:userId?"PUT":"POST",body:JSON.stringify(userDraft)});
  if(result.temporaryPassword)setTemporary(`Matrícula ${userDraft.matricula}: ${result.temporaryPassword}`);
  setMessage(userId?"Usuário atualizado. As sessões anteriores foram encerradas.":"Usuário cadastrado.");setUserId(null);setUserDraft(blankUser);
 })}
 async function resetPassword(u:User){if(!window.confirm(`Gerar nova senha temporária para ${u.displayName} e encerrar as sessões atuais?`))return;
  await perform(async()=>{const r=await request(`/api/v1/admin/users/${u.id}/reset-password`,{method:"POST"});setTemporary(`Matrícula ${u.matricula}: ${r.temporaryPassword}`);setMessage("Senha redefinida; troca obrigatória no próximo acesso.")})}
 async function toggleUser(u:User){if(!window.confirm(`${u.active?"Desativar":"Ativar"} ${u.displayName}?`))return;
  await perform(async()=>{await request(`/api/v1/admin/users/${u.id}`,{method:"PUT",body:JSON.stringify({...u,email:u.email??"",phone:u.phone??"",jobTitle:u.jobTitle??"",department:u.department??"",active:!u.active})});setMessage(`Usuário ${!u.active?"ativado":"desativado"}.`)})}
 async function saveRole(e:FormEvent){e.preventDefault();await perform(async()=>{
  await request(roleId?`/api/v1/admin/roles/${roleId}`:"/api/v1/admin/roles",{method:roleId?"PUT":"POST",body:JSON.stringify(roleDraft)});
  setRoleId(null);setRoleDraft({code:"",name:"",permissionCodes:[]});setMessage("Perfil e permissões salvos.")})}
 async function saveItem(e:FormEvent){e.preventDefault();await perform(async()=>{
  await request(itemId?`/api/v1/admin/items/${itemId}`:"/api/v1/admin/items",{method:itemId?"PUT":"POST",body:JSON.stringify(itemDraft)});
  setItemId(null);setItemDraft(blankItem);setMessage("Item salvo.")})}
 async function deactivateItem(item:Item){if(!window.confirm(`Desativar ${item.name}? O histórico de movimentações será preservado.`))return;
  await perform(async()=>{await request(`/api/v1/admin/items/${item.id}`,{method:"DELETE"});setMessage("Item desativado com histórico preservado.")})}
 async function saveMenu(e:FormEvent){e.preventDefault();await perform(async()=>{
  await request(menuId?`/api/v1/admin/navigation/${menuId}`:"/api/v1/admin/navigation",{method:menuId?"PUT":"POST",body:JSON.stringify({...menuDraft,permissionCode:menuDraft.permissionCode||null})});
  setMenuId(null);setMenuDraft(blankMenu);setMessage("Item do menu salvo.")})}
 async function removeMenu(item:MenuItem){if(!window.confirm(`Excluir o atalho ${item.label}?`))return;
  await perform(async()=>{await request(`/api/v1/admin/navigation/${item.id}`,{method:"DELETE"});setMessage("Atalho excluído.")})}
 async function openDatabase(view=dbView){setDbView(view);try{const r=await request(`/api/v1/admin/database?view=${encodeURIComponent(view)}&limit=50`);setDbRows(r.items??[])}catch(error){setMessage(error instanceof Error?error.message:"Falha na consulta.")}}
 const tabs:[Tab,string][]=[["users","Usuários"],["roles","Perfis e permissões"],["items","Itens de estoque"],["menus","Itens do menu"],["reports","Relatórios"],["database","Banco e auditoria"]];
 return <main className="shell moduleShell adminWorkspace">
  <header className="listHeader"><div><span className="eyebrow">SIGDEC · ADMINISTRAÇÃO · v1.49</span><h1>Usuários e dados do sistema</h1><p>Cadastros, acessos, itens, relatórios e consulta protegida.</p></div><div className="headerActions"><Link className="secondaryLink" href="/administracao">Administração</Link><Link className="secondaryLink" href="/painel">Painel</Link></div></header>
  <nav className="adminTabs" aria-label="Áreas de administração">{tabs.map(([id,label])=><button type="button" key={id} className={tab===id?"active":""} onClick={()=>{setTab(id);setMessage("");if(id==="database")void openDatabase()}}>{label}</button>)}</nav>
  {message&&<p className="infoCard" role="status">{message}</p>}
  {temporary&&<section className="warningCard" role="status"><strong>Senha temporária: copie agora</strong><p className="temporarySecret">{temporary}</p><p>Ela não será exibida novamente. Entregue ao usuário por canal seguro; a troca será exigida no primeiro acesso.</p><button type="button" onClick={()=>setTemporary("")}>Já copiei</button></section>}

  {tab==="users"&&<section><h2>{userId?"Editar usuário":"Cadastrar usuário"}</h2><form className="incidentForm compactForm" onSubmit={saveUser}>
   <div className="formGrid"><label>Matrícula<input required value={userDraft.matricula} onChange={e=>setUserDraft(v=>({...v,matricula:e.target.value}))}/></label><label>Nome completo<input required value={userDraft.displayName} onChange={e=>setUserDraft(v=>({...v,displayName:e.target.value}))}/></label>
   <label>E-mail<input type="email" value={userDraft.email} onChange={e=>setUserDraft(v=>({...v,email:e.target.value}))}/></label><label>Telefone<input value={userDraft.phone} onChange={e=>setUserDraft(v=>({...v,phone:e.target.value}))}/></label>
   <label>Cargo<input value={userDraft.jobTitle} onChange={e=>setUserDraft(v=>({...v,jobTitle:e.target.value}))}/></label><label>Setor<input value={userDraft.department} onChange={e=>setUserDraft(v=>({...v,department:e.target.value}))}/></label></div>
   <fieldset><legend>Perfis de acesso</legend><div className="adminChoices">{roles.map(r=><label key={r.id}><input type="checkbox" checked={userDraft.roleIds.includes(r.id)} onChange={e=>setUserDraft(v=>({...v,roleIds:e.target.checked?[...v.roleIds,r.id]:v.roleIds.filter(x=>x!==r.id)}))}/>{r.name} <small>({r.code})</small></label>)}</div></fieldset>
   <label className="checkLabel"><input type="checkbox" checked={userDraft.active} onChange={e=>setUserDraft(v=>({...v,active:e.target.checked}))}/>Ativo</label>
   <div className="headerActions"><button className="primaryButton" disabled={busy||userDraft.roleIds.length===0}>{userId?"Salvar alterações":"Cadastrar usuário"}</button>{userId&&<button type="button" className="secondaryLink" onClick={()=>{setUserId(null);setUserDraft(blankUser)}}>Cancelar</button>}</div></form>
   <h2>Usuários cadastrados</h2><div className="dataGrid">{users.map(u=><article className={u.active?"card":"warningCard"} key={u.id}><h3>{u.displayName}</h3><p><b>Matrícula {u.matricula}</b> · {u.active?"Ativo":"Desativado"}</p><p>{u.email??"Sem e-mail"} · {u.department??"Sem setor"}</p><p>Perfis: {u.roles.join(", ")||"Nenhum"} · MFA {u.mfaEnabled?"ativo":"pendente"}</p><p>Último acesso: {fmt(u.lastLoginAt)}{u.mustChangePassword?" · Troca de senha pendente":""}</p><div className="headerActions"><button type="button" className="secondaryLink" disabled={busy} onClick={()=>{setUserId(u.id);setUserDraft({matricula:u.matricula,displayName:u.displayName,email:u.email??"",phone:u.phone??"",jobTitle:u.jobTitle??"",department:u.department??"",roleIds:u.roleIds,active:u.active});window.scrollTo({top:0,behavior:"smooth"})}}>Editar</button><button type="button" className="secondaryLink" disabled={busy} onClick={()=>void toggleUser(u)}>{u.active?"Desativar":"Ativar"}</button><button type="button" className="secondaryLink" disabled={busy} onClick={()=>void resetPassword(u)}>Redefinir senha</button></div></article>)}</div></section>}

  {tab==="roles"&&<section><h2>{roleId?"Editar perfil":"Criar perfil"}</h2><form className="incidentForm compactForm" onSubmit={saveRole}><div className="formGrid"><label>Código<input required value={roleDraft.code} onChange={e=>setRoleDraft(v=>({...v,code:e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g,"")}))} placeholder="EX.: FISCAL"/></label><label>Nome<input required value={roleDraft.name} onChange={e=>setRoleDraft(v=>({...v,name:e.target.value}))}/></label></div><fieldset><legend>Permissões concedidas</legend><div className="adminChoices permissions">{permissions.filter(p=>p.code!=="system.master").map(p=><label key={p.code}><input type="checkbox" checked={roleDraft.permissionCodes.includes(p.code)} onChange={e=>setRoleDraft(v=>({...v,permissionCodes:e.target.checked?[...v.permissionCodes,p.code]:v.permissionCodes.filter(x=>x!==p.code)}))}/><span><b>{p.code}</b><small>{p.description}</small></span></label>)}</div></fieldset><div className="headerActions"><button className="primaryButton" disabled={busy}>Salvar perfil</button>{roleId&&<button type="button" className="secondaryLink" onClick={()=>{setRoleId(null);setRoleDraft({code:"",name:"",permissionCodes:[]})}}>Cancelar</button>}</div></form><div className="dataGrid">{roles.map(r=><article className="card" key={r.id}><h3>{r.name}</h3><p>{r.code} · nível {r.level} · {r.permissionCodes.length} permissões</p><p>{r.permissionCodes.slice(0,8).join(", ")}{r.permissionCodes.length>8?"…":""}</p>{!r.systemRole&&<button type="button" className="secondaryLink" onClick={()=>{setRoleId(r.id);setRoleDraft({code:r.code,name:r.name,permissionCodes:r.permissionCodes});window.scrollTo({top:0,behavior:"smooth"})}}>Editar</button>}</article>)}</div></section>}

  {tab==="items"&&<section><h2>{itemId?"Editar item":"Cadastrar item de estoque"}</h2><form className="incidentForm compactForm" onSubmit={saveItem}><div className="formGrid"><label>Código<input required value={itemDraft.code} onChange={e=>setItemDraft(v=>({...v,code:e.target.value}))}/></label><label>Descrição<input required value={itemDraft.name} onChange={e=>setItemDraft(v=>({...v,name:e.target.value}))}/></label><label>Unidade<input required value={itemDraft.unit} onChange={e=>setItemDraft(v=>({...v,unit:e.target.value}))}/></label><label>Categoria<input required value={itemDraft.category} onChange={e=>setItemDraft(v=>({...v,category:e.target.value}))}/></label></div><label className="checkLabel"><input type="checkbox" checked={itemDraft.active} onChange={e=>setItemDraft(v=>({...v,active:e.target.checked}))}/>Ativo</label><div className="headerActions"><button className="primaryButton" disabled={busy}>Salvar item</button>{itemId&&<button type="button" className="secondaryLink" onClick={()=>{setItemId(null);setItemDraft(blankItem)}}>Cancelar</button>}</div></form><p>Desativar retira o item da operação e preserva entregas e movimentações. A unidade de um item movimentado fica bloqueada para manter o histórico correto.</p><div className="dataGrid">{items.map(i=><article className={i.active?"card":"warningCard"} key={i.id}><h3>{i.name}</h3><p>{i.code} · {i.category} · {i.active?"Ativo":"Desativado"}</p><p>Saldo: {Number(i.balance).toLocaleString("pt-BR")} {i.unit} · {i.movementCount} movimentações</p><div className="headerActions"><button type="button" className="secondaryLink" onClick={()=>{setItemId(i.id);setItemDraft({code:i.code,name:i.name,unit:i.unit,category:i.category,active:i.active});window.scrollTo({top:0,behavior:"smooth"})}}>Editar</button>{i.active&&<button type="button" className="secondaryLink" disabled={busy} onClick={()=>void deactivateItem(i)}>Desativar</button>}</div></article>)}</div></section>}

  {tab==="menus"&&<section><h2>{menuId?"Editar atalho":"Criar item de menu"}</h2><p>Os atalhos levam somente a páginas internas do SIGDEC. As permissões das páginas continuam sendo verificadas na API.</p><form className="incidentForm compactForm" onSubmit={saveMenu}><div className="formGrid"><label>Nome<input required value={menuDraft.label} onChange={e=>setMenuDraft(v=>({...v,label:e.target.value}))}/></label><label>Página<select value={menuDraft.path} onChange={e=>setMenuDraft(v=>({...v,path:e.target.value}))}>{paths.map(p=><option key={p} value={p}>{p}</option>)}</select></label><label>Permissão exigida<select value={menuDraft.permissionCode} onChange={e=>setMenuDraft(v=>({...v,permissionCode:e.target.value}))}><option value="">Sem filtro adicional</option>{permissions.map(p=><option key={p.code} value={p.code}>{p.code}</option>)}</select></label><label>Ordem<input type="number" min="0" max="1000" value={menuDraft.sortOrder} onChange={e=>setMenuDraft(v=>({...v,sortOrder:Number(e.target.value)}))}/></label></div><label className="checkLabel"><input type="checkbox" checked={menuDraft.active} onChange={e=>setMenuDraft(v=>({...v,active:e.target.checked}))}/>Visível</label><div className="headerActions"><button className="primaryButton" disabled={busy}>Salvar atalho</button>{menuId&&<button type="button" className="secondaryLink" onClick={()=>{setMenuId(null);setMenuDraft(blankMenu)}}>Cancelar</button>}</div></form><div className="dataGrid">{menus.map(m=><article className={m.active?"card":"warningCard"} key={m.id}><h3>{m.label}</h3><p>{m.path} · {m.active?"Visível":"Oculto"} · ordem {m.sortOrder}</p><p>Permissão: {m.permissionCode??"sem filtro adicional"}</p><div className="headerActions"><button type="button" className="secondaryLink" onClick={()=>{setMenuId(m.id);setMenuDraft({label:m.label,path:m.path,permissionCode:m.permissionCode??"",sortOrder:m.sortOrder,active:m.active});window.scrollTo({top:0,behavior:"smooth"})}}>Editar</button><button type="button" className="secondaryLink" disabled={busy} onClick={()=>void removeMenu(m)}>Excluir</button></div></article>)}</div></section>}

  {tab==="reports"&&<section><h2>Relatórios de usuários</h2><p>Indicadores atuais e exportação para conferência. O relatório contém dados funcionais; compartilhe apenas com pessoas autorizadas.</p><div className="dataGrid">{report&&Object.entries(report.overview).map(([key,value])=><article className="card" key={key}><h3>{({total:"Total",active:"Ativos",inactive:"Desativados",pendingPasswordChange:"Troca de senha pendente",mfaEnabled:"MFA ativo"} as Record<string,string>)[key]??key}</h3><p className="adminNumber">{value}</p></article>)}</div><a className="primaryButton" href={`${API}/api/v1/admin/reports/users.csv`}>Baixar relatório CSV</a><h3>Por perfil</h3><div className="dataGrid">{report?.roles.map(r=><article className="card" key={r.code}><h3>{r.name}</h3><p>{r.active} ativo(s) de {r.total} usuário(s)</p></article>)}</div></section>}

  {tab==="database"&&<section><h2>{dbView==="audit"?"Auditoria de atividades":"Consulta ao banco de dados"}</h2><p>{dbView==="audit"?"Toda inclusão, alteração e exclusão autenticada registra horário oficial do servidor e matrícula funcional do responsável.":"Visões de leitura com campos selecionados. Dados de autenticação, segredos e informações pessoais de assistência não são expostos nesta consulta."}</p><div className="headerActions"><select aria-label="Visão do banco" value={dbView} onChange={e=>void openDatabase(e.target.value)}>{["users","inventory","incidents","navigation","audit"].map(v=><option key={v} value={v}>{({users:"Usuários",inventory:"Estoque",incidents:"Ocorrências",navigation:"Menu",audit:"Auditoria"} as Record<string,string>)[v]}</option>)}</select><button className="secondaryLink" type="button" onClick={()=>void openDatabase()}>Atualizar</button></div><div className="adminTableWrap"><table><thead><tr>{Object.keys(dbRows[0]??{}).map(k=><th key={k}>{k}</th>)}</tr></thead><tbody>{dbRows.map((r,index)=><tr key={index}>{Object.entries(r).map(([k,v],j)=><td key={j}>{dbCell(k,v)}</td>)}</tr>)}</tbody></table>{dbRows.length===0&&<p>Nenhum registro nesta visão.</p>}</div></section>}
 </main>;
}
