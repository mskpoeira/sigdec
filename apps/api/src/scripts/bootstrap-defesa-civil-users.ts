import "dotenv/config";
import {randomBytes} from "node:crypto";
import argon2 from "argon2";
import {db} from "../db.js";
import {normalizeMatricula} from "../auth.js";

type RosterUser={
  matricula:string;
  displayName:string;
  warName:string;
  jobTitle:string;
  roleCode:"CAMPO"|"COORDENACAO";
};

const roster:RosterUser[]=[
  {matricula:"917257",displayName:"Everton Calixto dos Santos",warName:"Everton",jobTitle:"1344-AGENTE OPERACIONAL DE DEFESA CIVIL",roleCode:"CAMPO"},
  {matricula:"919273",displayName:"Edmir Henrique dos Santos Silva",warName:"Edmir",jobTitle:"1725-ASSESSOR DA DIRETORIA DE GESTAO DE DEFESA CIVIL",roleCode:"COORDENACAO"},
  {matricula:"919700",displayName:"Angelica Silva Evangelista",warName:"Angelica",jobTitle:"1774-AGENTE DE DEFESA CIVIL",roleCode:"CAMPO"},
  {matricula:"919701",displayName:"Cristiane Rodrigues",warName:"Cristiane",jobTitle:"1774-AGENTE DE DEFESA CIVIL",roleCode:"CAMPO"},
  {matricula:"919702",displayName:"Giovane Pretto de Souza",warName:"Giovane",jobTitle:"1774-AGENTE DE DEFESA CIVIL",roleCode:"CAMPO"},
  {matricula:"919703",displayName:"Thiago Rodrigo de Oliveira",warName:"Thiago",jobTitle:"1774-AGENTE DE DEFESA CIVIL",roleCode:"CAMPO"},
  {matricula:"919704",displayName:"Rosemeire Alves Viana",warName:"Rosemeire",jobTitle:"1774-AGENTE DE DEFESA CIVIL",roleCode:"CAMPO"},
  {matricula:"920085",displayName:"Alexandre Napoli",warName:"Alexandre",jobTitle:"1722-DIRETOR DE GESTAO DE DEFESA CIVIL",roleCode:"COORDENACAO"},
  {matricula:"920546",displayName:"Junior Gabriel Rodrigues dos Santos",warName:"Junior",jobTitle:"1774-AGENTE DE DEFESA CIVIL",roleCode:"CAMPO"},
  {matricula:"920547",displayName:"Leonardo Aparecido Ribeiro",warName:"Leonardo",jobTitle:"1774-AGENTE DE DEFESA CIVIL",roleCode:"CAMPO"},
  {matricula:"920548",displayName:"Leon Rodrigues da Silva",warName:"Leon",jobTitle:"1774-AGENTE DE DEFESA CIVIL",roleCode:"CAMPO"},
  {matricula:"920549",displayName:"Vanderlucio Cardoso",warName:"Vanderlucio",jobTitle:"1774-AGENTE DE DEFESA CIVIL",roleCode:"CAMPO"},
  {matricula:"920550",displayName:"Maicon Amaro dos Santos",warName:"Maicon",jobTitle:"1774-AGENTE DE DEFESA CIVIL",roleCode:"CAMPO"}
];

function required(name:string){
  const value=process.env[name]?.trim();
  if(!value)throw new Error(`${name} não configurada.`);
  return value;
}

const orgSlug=required("SIGDEC_ORG_SLUG").toLowerCase();
const client=await db.connect();

try{
  await client.query("BEGIN");

  const org=await client.query<{id:string}>("SELECT id FROM organizations WHERE slug=$1 LIMIT 1",[orgSlug]);
  const organizationId=org.rows[0]?.id;
  if(!organizationId)throw new Error("Organização SIGDEC não localizada para provisionar o efetivo.");

  const roleRows=await client.query<{id:string;code:string}>("SELECT id,code FROM roles WHERE code=ANY($1::text[])",[["CAMPO","COORDENACAO"]]);
  const roleByCode=new Map(roleRows.rows.map(x=>[x.code,x.id]));
  for(const code of ["CAMPO","COORDENACAO"]){
    if(!roleByCode.has(code))throw new Error(`Perfil ${code} não encontrado.`);
  }

  const masterRole=await client.query<{id:string}>("SELECT id FROM roles WHERE code='MASTER' LIMIT 1");
  const masterRoleId=masterRole.rows[0]?.id;
  let created=0,updated=0;

  for(const person of roster){
    const matricula=normalizeMatricula(person.matricula);
    if(!matricula)throw new Error(`Matrícula inválida no efetivo: ${person.matricula}`);

    const existing=await client.query<{id:string}>(
      "SELECT id FROM users WHERE organization_id=$1 AND matricula=$2 LIMIT 1",
      [organizationId,matricula]
    );

    let userId=existing.rows[0]?.id;
    if(!userId){
      const inaccessibleInitialPassword=randomBytes(48).toString("base64url");
      const passwordHash=await argon2.hash(inaccessibleInitialPassword,{type:argon2.argon2id});
      const result=await client.query<{id:string}>(
        `INSERT INTO users
         (organization_id,matricula,display_name,war_name,email,phone,job_title,department,
          password_hash,active,must_change_password,mfa_required)
         VALUES($1,$2,$3,$4,NULL,NULL,$5,'Defesa Civil',$6,true,true,false)
         RETURNING id`,
        [organizationId,matricula,person.displayName,person.warName,person.jobTitle,passwordHash]
      );
      userId=result.rows[0]?.id;
      created++;
    }else{
      await client.query(
        `UPDATE users
            SET display_name=$2,
                war_name=$3,
                job_title=$4,
                department='Defesa Civil',
                active=true,
                updated_at=now()
          WHERE id=$1`,
        [userId,person.displayName,person.warName,person.jobTitle]
      );
      updated++;
    }

    if(!userId)throw new Error(`Falha ao provisionar matrícula ${matricula}.`);

    if(masterRoleId){
      await client.query("DELETE FROM user_roles WHERE user_id=$1 AND role_id=$2",[userId,masterRoleId]);
    }

    const desiredRoleId=roleByCode.get(person.roleCode)!;
    await client.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [userId,desiredRoleId]
    );

    await client.query(
      `INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
       VALUES(NULL,'SYSTEM_ROSTER_PROVISION','user',$1,$2::jsonb)`,
      [userId,JSON.stringify({
        matricula,
        displayName:person.displayName,
        jobTitle:person.jobTitle,
        department:"Defesa Civil",
        roleCode:person.roleCode,
        source:"defesa_civil_roster_2026-09-28"
      })]
    );
  }

  await client.query("COMMIT");
  console.log(`Efetivo da Defesa Civil provisionado: ${roster.length} usuário(s), ${created} criado(s), ${updated} atualizado(s).`);
  console.log("Senhas não foram exibidas. Para liberar acesso, use 'Redefinir senha' na Administração do SIGDEC.");
}catch(error){
  await client.query("ROLLBACK");
  throw error;
}finally{
  client.release();
  await db.end();
}
