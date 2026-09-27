import {createHash} from "node:crypto";
import {lookup} from "node:dns/promises";
import {request as httpRequest} from "node:http";
import {request as httpsRequest} from "node:https";
import {isIP} from "node:net";
import {db} from "../db.js";
import {decryptApplicationSecret} from "./app-secrets.js";
import {publicWebhookAddress} from "./webhooks.js";

export type GeoPixelConnection={
 id:string;organizationId:string;name:string;portalUrl:string|null;apiBaseUrl:string|null;
 wmsUrl:string|null;wfsUrl:string|null;authType:"NONE"|"API_KEY"|"BEARER"|"BASIC";
 username:string|null;secretCiphertext:string|null;apiKeyHeader:string;config:Record<string,unknown>;
};
export type GeoPixelLayer={
 id:string;organizationId:string;connectionId:string;code:string;title:string;
 sourceType:"REST_GEOJSON"|"WFS"|"WMS_REFERENCE";remoteLayerName:string|null;resourcePath:string|null;
 category:string;direction:"IMPORT"|"EXPORT"|"BIDIRECTIONAL"|"REFERENCE";localTarget:string;
 attributeMap:Record<string,string>;requestParams:Record<string,string|number|boolean>;exportMethod:"POST"|"PUT"|"PATCH";
 remoteIdProperty:string;
};

function allowPrivate(){return process.env.GEOPIXEL_ALLOW_PRIVATE_NETWORK==="true"}

async function resolveSafe(value:string){
 const url=new URL(value);
 if(url.username||url.password)throw new Error("Credenciais na URL não são permitidas.");
 const localDev=process.env.NODE_ENV!=="production"&&["localhost","127.0.0.1","[::1]"].includes(url.hostname);
 if(!["https:","http:"].includes(url.protocol))throw new Error("Protocolo remoto não suportado.");
 if(url.protocol==="http:"&&!localDev&&!allowPrivate())throw new Error("Integrações GeoPixel remotas devem utilizar HTTPS.");
 const hostname=url.hostname.replace(/^\[|\]$/g,"");
 const addresses=await lookup(hostname,{all:true,verbatim:true});
 if(!addresses.length)throw new Error("Não foi possível resolver o host GeoPixel.");
 if(!allowPrivate()&&!localDev&&addresses.some(x=>!publicWebhookAddress(x.address)))throw new Error("Endpoint GeoPixel aponta para rede privada/local não autorizada.");
 return {url,address:addresses[0]!.address,family:addresses[0]!.family};
}

function authHeaders(connection:GeoPixelConnection){
 const headers:Record<string,string>={"accept":"application/json, application/geo+json, application/xml, text/xml;q=0.9, */*;q=0.5","user-agent":"SIGDEC-GeoPixel/1.71"};
 const secret=connection.secretCiphertext?decryptApplicationSecret(connection.secretCiphertext):"";
 if(connection.authType==="BEARER"&&secret)headers.authorization="Bearer "+secret;
 if(connection.authType==="API_KEY"&&secret)headers[connection.apiKeyHeader||"x-api-key"]=secret;
 if(connection.authType==="BASIC"&&connection.username&&secret)headers.authorization="Basic "+Buffer.from(connection.username+":"+secret).toString("base64");
 return headers;
}

export async function geoPixelHttp(connection:GeoPixelConnection,urlValue:string,options:{method?:string;body?:string;headers?:Record<string,string>;maxBytes?:number;redirects?:number}={}){
 const resolved=await resolveSafe(urlValue);
 const method=options.method??"GET",body=options.body;
 const headers={...authHeaders(connection),...(options.headers??{})};
 if(body){headers["content-length"]=String(Buffer.byteLength(body));if(!headers["content-type"])headers["content-type"]="application/json"}
 const maxBytes=options.maxBytes??30*1024*1024;
 return new Promise<{status:number;contentType:string;body:Buffer;headers:Record<string,string|string[]|undefined>}>((resolve,reject)=>{
  const req=(resolved.url.protocol==="https:"?httpsRequest:httpRequest)(resolved.url,{
   method,headers,lookup:(_hostname,_options,callback)=>callback(null,resolved.address,resolved.family),signal:AbortSignal.timeout(30000)
  },res=>{
   const status=res.statusCode??0;
   if(status>=300&&status<400&&res.headers.location&&(options.redirects??0)<3){
    const target=new URL(res.headers.location,resolved.url).toString();res.resume();
    void geoPixelHttp(connection,target,{...options,redirects:(options.redirects??0)+1}).then(resolve,reject);return;
   }
   const chunks:Buffer[]=[];let total=0;
   res.on("data",(chunk:Buffer)=>{total+=chunk.length;if(total>maxBytes){req.destroy(new Error("Resposta GeoPixel excedeu o limite permitido."));return}chunks.push(chunk)});
   res.on("end",()=>resolve({status,contentType:String(res.headers["content-type"]??""),body:Buffer.concat(chunks),headers:res.headers as Record<string,string|string[]|undefined>}));
   res.on("error",reject);
  });
  req.on("error",reject);
  if(body)req.write(body);req.end();
 });
}

export async function loadConnection(id:string,organizationId:string){
 const r=await db.query(`SELECT id,organization_id AS "organizationId",name,portal_url AS "portalUrl",api_base_url AS "apiBaseUrl",
   wms_url AS "wmsUrl",wfs_url AS "wfsUrl",auth_type AS "authType",username,secret_ciphertext AS "secretCiphertext",
   api_key_header AS "apiKeyHeader",config
   FROM geopixel_connections WHERE id=$1 AND organization_id=$2 AND active=true`,[id,organizationId]);
 return r.rows[0] as GeoPixelConnection|undefined;
}

export async function loadLayer(id:string,organizationId:string){
 const r=await db.query(`SELECT id,organization_id AS "organizationId",connection_id AS "connectionId",code,title,
   source_type AS "sourceType",remote_layer_name AS "remoteLayerName",resource_path AS "resourcePath",category,direction,
   local_target AS "localTarget",attribute_map AS "attributeMap",request_params AS "requestParams",
   export_method AS "exportMethod",remote_id_property AS "remoteIdProperty"
   FROM geopixel_layers WHERE id=$1 AND organization_id=$2 AND active=true`,[id,organizationId]);
 return r.rows[0] as GeoPixelLayer|undefined;
}

function featureArray(value:any){
 if(value?.type==="FeatureCollection"&&Array.isArray(value.features))return value.features;
 if(value?.type==="Feature")return [value];
 if(Array.isArray(value))return value.map(item=>item?.type==="Feature"?item:{type:"Feature",properties:item,geometry:item?.geometry??null,id:item?.id});
 if(Array.isArray(value?.items))return value.items.map((item:any)=>item?.type==="Feature"?item:{type:"Feature",properties:item,geometry:item?.geometry??null,id:item?.id});
 if(Array.isArray(value?.data))return value.data.map((item:any)=>item?.type==="Feature"?item:{type:"Feature",properties:item,geometry:item?.geometry??null,id:item?.id});
 return [];
}

function layerUrl(connection:GeoPixelConnection,layer:GeoPixelLayer){
 if(layer.sourceType==="WFS"){
  if(!connection.wfsUrl)throw new Error("URL WFS não configurada.");
  const u=new URL(connection.wfsUrl);
  const params=new URLSearchParams({service:"WFS",version:"2.0.0",request:"GetFeature",typeNames:layer.remoteLayerName??layer.code,outputFormat:"application/json"});
  for(const [k,v] of Object.entries(layer.requestParams??{}))params.set(k,String(v));
  u.search=params.toString();return u.toString();
 }
 if(layer.sourceType==="REST_GEOJSON"){
  if(!connection.apiBaseUrl&&!layer.resourcePath)throw new Error("API base/resource da camada não configurado.");
  const u=new URL(layer.resourcePath??"",connection.apiBaseUrl??undefined);
  for(const [k,v] of Object.entries(layer.requestParams??{}))u.searchParams.set(k,String(v));
  return u.toString();
 }
 throw new Error("Camada WMS é referência visual e não possui sincronização de feições.");
}

function prop(properties:Record<string,any>,map:Record<string,string>,key:string,...fallback:string[]){
 const candidates=[map[key],...fallback,key].filter(Boolean) as string[];
 for(const candidate of candidates){const value=properties[candidate];if(value!==undefined&&value!==null&&String(value).trim()!=="")return value}
 return undefined;
}
function normalizedStatus(value:any,allowed:string[],fallback:string){
 const upper=String(value??"").trim().toUpperCase().replace(/\s+/g,"_");
 return allowed.includes(upper)?upper:fallback;
}
function n(value:any,fallback=0){const result=Number(String(value??"").replace(",","."));return Number.isFinite(result)?result:fallback}

async function mirrorFeature(layer:GeoPixelLayer,featureId:string,properties:Record<string,any>,lon:number|null,lat:number|null,actorId:string){
 if(layer.localTarget==="REFERENCE_ONLY")return null;
 const m=layer.attributeMap??{};
 if(layer.localTarget==="RISK_AREA"){
  const code=String(prop(properties,m,"code","codigo","código")??layer.code+"-"+featureId.slice(0,8));
  const name=String(prop(properties,m,"name","nome","descricao","descrição")??code);
  const riskLevel=normalizedStatus(prop(properties,m,"riskLevel","grau_risco","risco"),["R1","R2","R3","R4"],"R2");
  const status=normalizedStatus(prop(properties,m,"status","situacao","situação"),["ACTIVE","MITIGATED","MONITORING","INACTIVE"],"ACTIVE");
  const hazardType=String(prop(properties,m,"hazardType","tipo_risco","ameaca","ameaça")??"GeoPixel");
  const r=await db.query(`INSERT INTO territorial_risk_areas(organization_id,code,name,neighborhood,hazard_type,risk_level,status,exposed_buildings,exposed_people,latitude,longitude,boundary_geojson,notes,last_reviewed_at,created_by)
   SELECT organization_id,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,ST_AsGeoJSON(geometry)::jsonb,$12,now(),$13 FROM geopixel_features WHERE id=$14
   ON CONFLICT(organization_id,code) DO UPDATE SET name=EXCLUDED.name,neighborhood=EXCLUDED.neighborhood,hazard_type=EXCLUDED.hazard_type,risk_level=EXCLUDED.risk_level,status=EXCLUDED.status,
   exposed_buildings=EXCLUDED.exposed_buildings,exposed_people=EXCLUDED.exposed_people,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,boundary_geojson=EXCLUDED.boundary_geojson,notes=EXCLUDED.notes,last_reviewed_at=now(),updated_at=now()
   RETURNING id`,[layer.organizationId,code,name,prop(properties,m,"neighborhood","bairro")??null,hazardType,riskLevel,status,Math.round(n(prop(properties,m,"exposedBuildings","imoveis_expostos"),0)),Math.round(n(prop(properties,m,"exposedPeople","pessoas_expostas"),0)),lat,lon,String(prop(properties,m,"notes","observacao","observações")??"Origem: GeoPixel"),actorId,featureId]);
  return r.rows[0]?.id??null;
 }
 if(layer.localTarget==="CRITICAL_INFRASTRUCTURE"){
  const code=String(prop(properties,m,"code","codigo")??layer.code+"-"+featureId.slice(0,8)),name=String(prop(properties,m,"name","nome")??code);
  const category=normalizedStatus(prop(properties,m,"category","categoria","tipo"),["WATER","ENERGY","TELECOM","HEALTH","EDUCATION","ROAD","BRIDGE","DRAINAGE","FUEL","PUBLIC_SAFETY","SHELTER","OTHER"],"OTHER");
  const criticality=normalizedStatus(prop(properties,m,"criticality","criticidade"),["LOW","MEDIUM","HIGH","CRITICAL"],"HIGH");
  const r=await db.query(`INSERT INTO critical_infrastructures(organization_id,code,name,category,owner_name,responsible_name,responsible_phone,address_line,neighborhood,latitude,longitude,criticality,redundancy,backup_power,autonomy_hours,notes,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
   ON CONFLICT(organization_id,code) DO UPDATE SET name=EXCLUDED.name,category=EXCLUDED.category,owner_name=EXCLUDED.owner_name,responsible_name=EXCLUDED.responsible_name,
   responsible_phone=EXCLUDED.responsible_phone,address_line=EXCLUDED.address_line,neighborhood=EXCLUDED.neighborhood,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,
   criticality=EXCLUDED.criticality,redundancy=EXCLUDED.redundancy,backup_power=EXCLUDED.backup_power,autonomy_hours=EXCLUDED.autonomy_hours,notes=EXCLUDED.notes,updated_at=now()
   RETURNING id`,[layer.organizationId,code,name,category,prop(properties,m,"ownerName","orgao","órgão")??null,prop(properties,m,"responsibleName","responsavel","responsável")??null,
   prop(properties,m,"responsiblePhone","telefone")??null,prop(properties,m,"addressLine","endereco","endereço")??null,prop(properties,m,"neighborhood","bairro")??null,lat,lon,criticality,
   prop(properties,m,"redundancy","redundancia","redundância")??null,Boolean(prop(properties,m,"backupPower","gerador")??false),n(prop(properties,m,"autonomyHours","autonomia"),0)||null,"Origem: GeoPixel",actorId]);
  return r.rows[0]?.id??null;
 }
 if(layer.localTarget==="WARNING_ASSET"){
  const code=String(prop(properties,m,"code","codigo")??layer.code+"-"+featureId.slice(0,8)),name=String(prop(properties,m,"name","nome")??code);
  const assetType=normalizedStatus(prop(properties,m,"assetType","tipo"),["SIREN","LOUDSPEAKER","RADIO_BASE","CELL_BROADCAST","SMS","OTHER"],"OTHER");
  const r=await db.query(`INSERT INTO warning_assets(organization_id,code,name,asset_type,status,address_line,neighborhood,latitude,longitude,battery_percent,responsible_name,responsible_phone,notes,created_by)
   VALUES($1,$2,$3,$4,'OPERATIONAL',$5,$6,$7,$8,$9,$10,$11,'Origem: GeoPixel',$12)
   ON CONFLICT(organization_id,code) DO UPDATE SET name=EXCLUDED.name,asset_type=EXCLUDED.asset_type,address_line=EXCLUDED.address_line,neighborhood=EXCLUDED.neighborhood,
   latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,battery_percent=EXCLUDED.battery_percent,responsible_name=EXCLUDED.responsible_name,responsible_phone=EXCLUDED.responsible_phone,updated_at=now()
   RETURNING id`,[layer.organizationId,code,name,assetType,prop(properties,m,"addressLine","endereco","endereço")??null,prop(properties,m,"neighborhood","bairro")??null,lat,lon,
   n(prop(properties,m,"batteryPercent","bateria"),0)||null,prop(properties,m,"responsibleName","responsavel","responsável")??null,prop(properties,m,"responsiblePhone","telefone")??null,actorId]);
  return r.rows[0]?.id??null;
 }
 if(layer.localTarget==="SHELTER"){
  const name=String(prop(properties,m,"name","nome")??layer.title+" "+featureId.slice(0,8));
  const address=prop(properties,m,"addressLine","endereco","endereço")??null,neighborhood=prop(properties,m,"neighborhood","bairro")??null;
  const existing=await db.query("SELECT id FROM shelters WHERE organization_id=$1 AND lower(name)=lower($2) LIMIT 1",[layer.organizationId,name]);
  if(existing.rows[0]){
   await db.query(`UPDATE shelters SET address_line=$3,neighborhood=$4,capacity_people=$5,latitude=$6,longitude=$7,readiness_notes=$8 WHERE id=$1 AND organization_id=$2`,
    [existing.rows[0].id,layer.organizationId,address,neighborhood,Math.max(0,Math.round(n(prop(properties,m,"capacityPeople","capacidade"),0))),lat,lon,"Origem/atualização: GeoPixel"]);
   return existing.rows[0].id;
  }
  const r=await db.query(`INSERT INTO shelters(organization_id,name,address_line,neighborhood,capacity_people,status,notes,latitude,longitude,readiness_notes)
   VALUES($1,$2,$3,$4,$5,'STANDBY','Importado da GeoPixel',$6,$7,'Origem: GeoPixel') RETURNING id`,
   [layer.organizationId,name,address,neighborhood,Math.max(0,Math.round(n(prop(properties,m,"capacityPeople","capacidade"),0))),lat,lon]);
  return r.rows[0]?.id??null;
 }
 return null;
}

export async function syncGeoPixelLayer(layer:GeoPixelLayer,connection:GeoPixelConnection,actorId:string){
 const run=await db.query<{id:string;started_at:Date}>(`INSERT INTO geopixel_sync_runs(organization_id,connection_id,layer_id,direction,status,triggered_by)
  VALUES($1,$2,$3,'IMPORT','RUNNING',$4) RETURNING id,started_at`,[layer.organizationId,connection.id,layer.id,actorId]);
 const runId=run.rows[0]!.id,startedAt=run.rows[0]!.started_at;
 let received=0,inserted=0,updated=0,mirrored=0;
 try{
  const response=await geoPixelHttp(connection,layerUrl(connection,layer));
  if(response.status<200||response.status>=300)throw Object.assign(new Error("GeoPixel respondeu HTTP "+response.status),{httpStatus:response.status});
  const raw=response.body.toString("utf8");
  const parsed=JSON.parse(raw);const features=featureArray(parsed);received=features.length;
  for(let index=0;index<features.length;index++){
   const feature=features[index]??{},properties=(feature.properties??feature.attributes??{}) as Record<string,any>;
   const remoteRaw=feature.id??properties[layer.remoteIdProperty]??properties.id??properties.objectid??properties.fid;
   const remoteId=String(remoteRaw??createHash("sha256").update(JSON.stringify([feature.geometry,properties,index])).digest("hex"));
   const geometry=feature.geometry&&typeof feature.geometry==="object"?JSON.stringify(feature.geometry):null;
   const hash=createHash("sha256").update(JSON.stringify({geometry:feature.geometry??null,properties})).digest("hex");
   const existing=await db.query("SELECT id,content_hash FROM geopixel_features WHERE layer_id=$1 AND remote_id=$2",[layer.id,remoteId]);
   const saved=await db.query(`INSERT INTO geopixel_features(organization_id,layer_id,remote_id,geometry,properties,content_hash,last_seen_at,synced_at,active)
    VALUES($1,$2,$3,CASE WHEN $4::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($4),4326) END,$5::jsonb,$6,now(),now(),true)
    ON CONFLICT(layer_id,remote_id) DO UPDATE SET geometry=EXCLUDED.geometry,properties=EXCLUDED.properties,content_hash=EXCLUDED.content_hash,last_seen_at=now(),synced_at=now(),active=true
    RETURNING id,CASE WHEN geometry IS NULL THEN NULL ELSE ST_X(ST_PointOnSurface(geometry)) END AS longitude,
      CASE WHEN geometry IS NULL THEN NULL ELSE ST_Y(ST_PointOnSurface(geometry)) END AS latitude`,
    [layer.organizationId,layer.id,remoteId,geometry,JSON.stringify(properties),hash]);
   if(!existing.rows[0])inserted++;else if(existing.rows[0].content_hash!==hash)updated++;
   const localId=await mirrorFeature(layer,String(saved.rows[0].id),properties,saved.rows[0].longitude==null?null:Number(saved.rows[0].longitude),saved.rows[0].latitude==null?null:Number(saved.rows[0].latitude),actorId);
   if(localId){
    mirrored++;
    const entityType=layer.localTarget.toLowerCase();
    await db.query(`INSERT INTO geopixel_entity_links(organization_id,feature_id,entity_type,entity_id,link_type,created_by)
      VALUES($1,$2,$3,$4,'MIRROR',$5) ON CONFLICT(feature_id,entity_type,entity_id) DO NOTHING`,[layer.organizationId,saved.rows[0].id,entityType,localId,actorId]);
   }
  }
  const deactivated=await db.query(`UPDATE geopixel_features SET active=false
    WHERE layer_id=$1 AND active=true AND last_seen_at<$2 RETURNING id`,[layer.id,startedAt]);
  await db.query(`UPDATE geopixel_layers SET last_sync_at=now(),last_sync_status='SUCCEEDED',last_sync_message=$2,updated_at=now() WHERE id=$1`,[layer.id,received+" feições recebidas; "+mirrored+" espelhadas."]);
  await db.query(`UPDATE geopixel_connections SET last_sync_at=now(),last_sync_status='SUCCEEDED',updated_at=now() WHERE id=$1`,[connection.id]);
  await db.query(`UPDATE geopixel_sync_runs SET status='SUCCEEDED',finished_at=now(),features_received=$2,features_inserted=$3,features_updated=$4,features_deactivated=$5,
    http_status=$6,message=$7,details=$8::jsonb WHERE id=$1`,[runId,received,inserted,updated,deactivated.rowCount??0,response.status,"Sincronização concluída.",JSON.stringify({mirrored})]);
  return {runId,status:"SUCCEEDED",received,inserted,updated,deactivated:deactivated.rowCount??0,mirrored};
 }catch(error:any){
  const message=error instanceof Error?error.message:String(error);
  await db.query("UPDATE geopixel_layers SET last_sync_at=now(),last_sync_status='FAILED',last_sync_message=$2,updated_at=now() WHERE id=$1",[layer.id,message]).catch(()=>{});
  await db.query("UPDATE geopixel_connections SET last_sync_at=now(),last_sync_status='FAILED',updated_at=now() WHERE id=$1",[connection.id]).catch(()=>{});
  await db.query(`UPDATE geopixel_sync_runs SET status='FAILED',finished_at=now(),features_received=$2,features_inserted=$3,features_updated=$4,http_status=$5,message=$6 WHERE id=$1`,
   [runId,received,inserted,updated,error?.httpStatus??null,message]).catch(()=>{});
  throw error;
 }
}

export function connectionBaseUrls(connection:GeoPixelConnection){
 return [connection.apiBaseUrl,connection.wfsUrl,connection.wmsUrl,connection.portalUrl].filter(Boolean) as string[];
}
