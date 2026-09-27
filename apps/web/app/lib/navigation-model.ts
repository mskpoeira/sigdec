export type SigdecNavItem={icon:string;label:string;href:string;feature?:string;admin?:boolean};
export type SigdecNavGroup={icon:string;label:string;href:string;items:SigdecNavItem[]};

export const sigdecDirectNav:SigdecNavItem[]=[
 {icon:"⌂",label:"Início",href:"/painel"},
 {icon:"⚠",label:"Ocorrências",href:"/ocorrencias",feature:"incidents"},
 {icon:"♥",label:"Assistência Humanitária",href:"/assistencia",feature:"humanitarian"},
 {icon:"☂",label:"Voluntariado",href:"/voluntarios",feature:"volunteers"},
 {icon:"☊",label:"Comunicações",href:"/comunicacoes",feature:"communications"}
];

export const sigdecNavGroups:SigdecNavGroup[]=[
 {icon:"✦",label:"Inteligência SIGDEC",href:"/inteligencia",items:[
  {icon:"✦",label:"Inteligência e IA",href:"/inteligencia"},
  {icon:"◇",label:"Central de IA",href:"/inteligencia/provedores"},
  {icon:"▤",label:"Documentos",href:"/documentos",feature:"documents"}
 ]},
 {icon:"▥",label:"Centro de Gestão",href:"/gestao",items:[
  {icon:"▥",label:"Centro de Gestão",href:"/gestao"},
  {icon:"◎",label:"SCO / Sala de Emergência",href:"/sco",feature:"sco"}
 ]},
 {icon:"▦",label:"PLANCON e Gestão do Risco",href:"/planejamento",items:[
  {icon:"▦",label:"Planejamento e Contingência",href:"/planejamento"},
  {icon:"▶",label:"Operação PLANCON",href:"/planejamento/operacao"},
  {icon:"△",label:"Gestão do Risco",href:"/gestao-riscos",feature:"risks"},
  {icon:"◉",label:"Monitoramento Ambiental",href:"/monitoramento",feature:"monitoring"},
  {icon:"◆",label:"Resiliência",href:"/resiliencia"}
 ]},
 {icon:"⚙",label:"Administração",href:"/administracao",items:[
  {icon:"⚙",label:"Visão geral",href:"/administracao",admin:true},
  {icon:"♟",label:"Usuários",href:"/administracao/usuarios",admin:true},
  {icon:"▦",label:"Cadastros",href:"/administracao/cadastros",admin:true},
  {icon:"⇄",label:"Integrações",href:"/administracao/integracoes",admin:true},
  {icon:"☷",label:"Auditoria",href:"/administracao/auditoria",admin:true},
  {icon:"♡",label:"Saúde do Sistema",href:"/administracao/saude",admin:true},
  {icon:"§",label:"Base legal",href:"/administracao/base-legal",admin:true},
  {icon:"✓",label:"Apresentação",href:"/administracao/apresentacao",admin:true}
 ]}
];

export function navPathMatches(pathname:string,href:string){
 if(pathname===href)return true;
 if(href==="/")return pathname==="/";
 return pathname.startsWith(href+"/");
}

export function groupForPath(pathname:string){
 return sigdecNavGroups.find(group=>group.items.some(item=>navPathMatches(pathname,item.href)))??null;
}
