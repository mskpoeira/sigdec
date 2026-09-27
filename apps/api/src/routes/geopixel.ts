import type {FastifyInstance} from "fastify";
import {z} from "zod";
import {authFrom,requirePermission} from "../auth.js";
import {db} from "../db.js";
import {encryptApplicationSecret} from "../lib/app-secrets.js";
import {connectionBaseUrls,geoPixelHttp,loadConnection,loadLayer,syncGeoPixelLayer} from "../lib/geopixel.js";

const uuid=z.string().uuid();
const connectionInput=z.object({
 name:z.string().trim().min(3).max(160),
 portalUrl:z.string().url().max(2000).optional().or(z.literal("")),
 apiBaseUrl:z.string().url().max(2000).optional().or(z.literal("")),
 wmsUrl:z.string().url().max(2000).optional().or(z.literal("")),
 wfsUrl:z.string().url().max(2000).optional().or(z.literal("")),
 authType:z.enum(["NONE","API_KEY","BEARER","BASIC"]).default("NONE"),
 username:z.string().trim().max(200).optional().default(""),
 secret:z.string().max(4000).optional().default(""),
 apiKeyHeader:z.string().trim().min(1).max(100).default("x-api-key"),
 active:z.boolean().default(true),
 syncIntervalMinutes:z.number().int().min(5).max(10080).default(60),
 config:z.record(z.string(),z.union([z.string(),z.number(),z.boolean(),z.null()])).default({})
}).refine(v=>Boolean(v.apiBaseUrl||v.wfsUrl||v.wmsUrl||v.portalUrl),{message:"Informe ao menos uma URL GeoPixel."});

const layerInput=z.object({
 connectionId:z.string().uuid(),
 code:z.string().trim().min(2).max(120),
 title:z.string().trim().min(2).max(240),
 sourceType:z.enum(["REST_GEOJSON","WFS","WMS_REFERENCE"]),
 remoteLayerName:z.string().trim().max(300).optional().default(""),
 resourcePath:z.string().trim().max(2000).optional().default(""),
 category:z.enum(["CADASTRAL","ZONING","URBANISM","HOUSING","ENVIRONMENT","APP","RISK","HYDROGRAPHY","DRAINAGE","ROAD","INFRASTRUCTURE","BUILDING","LAND_USE","VEGETATION","MONITORING","OTHER"]).default("OTHER"),
 direction:z.enum(["IMPORT","EXPORT","BIDIRECTIONAL","REFERENCE"]).default("IMPORT"),
 localTarget:z.enum(["REFERENCE_ONLY","RISK_AREA","CRITICAL_INFRASTRUCTURE","WARNING_ASSET","SHELTER"]).default("REFERENCE_ONLY"),
 attributeMap:z.record(z.string(),z.string()).default({}),
 requestParams:z.record(z.string(),z.union([z.string(),z.number(),z.boolean()])).default({}),
 exportMethod:z.enum(["POST","PUT","PATCH"]).default("POST"),
 remoteIdProperty:z.string().trim().min(1).max(120).default("id"),
 active:z.boolean().default(true)
}).superRefine((v,ctx)=>{
 if(v.sourceType==="REST_GEOJSON"&&!v.resourcePath)ctx.addIssue({code:z.ZodIssueCode.custom,path:["resourcePath"],message:"Informe o recurso REST/GeoJSON."});
 if((v.sourceType==="WFS"||v.sourceType==="WMS_REFERENCE")&&!v.remoteLayerName)ctx.addIssue({code:z.ZodIssueCode.custom,path:["remoteLayerName"],message:"Informe o nome remoto da camada."});
});
const activeInput=z.object({active:z.boolean()});

function org(request:any){
 const value=authFrom(request).organizationId;
 if(!value)throw Object.assign(new Error("Organização ausente."),{statusCode:409});
 return value;
}
function xmlNames(xml:string,featureType:boolean){
 const pattern=featureType?/<(?:\w+:)?FeatureType\b[\s\S]*?<(?:(?:\w+:)?Name)>([^<]+)<\/(?:\w+:)?Name>/gi:/<(?:\w+:)?Layer\b[\s\S]*?<(?:(?:\w+:)?Name)>([^<]+)<\/(?:\w+:)?Name>/gi;
 const found:string[]=[];for(const match of xml.matchAll(pattern)){const name=String(match[1]??"").trim();if(name&&!found.includes(name))found.push(name)}
 return found.slice(0,1000);
}
function relativeRemoteUrl(base:string|null,path:string|null){
 if(!path)throw new Error("Caminho remoto de exportação não configurado.");
 return new URL(path,base??undefined).toString();
}

async function localEntity(orgId:string,target:string,id:string){
 if(target==="RISK_AREA"){
  const r=await db.query(`SELECT id,code,name,neighborhood,hazard_type AS "hazardType",risk_level AS "riskLevel",status,
    exposed_buildings AS "exposedBuildings",exposed_people AS "exposedPeople",latitude,longitude,boundary_geojson AS "boundaryGeojson",notes
    FROM territorial_risk_areas WHERE organization_id=$1 AND id=$2`,[orgId,id]);
  return r.rows[0];
 }
 if(target==="CRITICAL_INFRASTRUCTURE"){
  const r=await db.query(`SELECT id,code,name,category,owner_name AS "ownerName",responsible_name AS "responsibleName",
    responsible_phone AS "responsiblePhone",address_line AS "addressLine",neighborhood,operational_status AS "operationalStatus",
    criticality,redundancy,backup_power AS "backupPower",autonomy_hours::float8 AS "autonomyHours",latitude,longitude,notes
    FROM critical_infrastructures WHERE organization_id=$1 AND id=$2`,[orgId,id]);return r.rows[0];
 }
 if(target==="WARNING_ASSET"){
  const r=await db.query(`SELECT id,code,name,asset_type AS "assetType",status,address_line AS "addressLine",neighborhood,
    battery_percent::float8 AS "batteryPercent",responsible_name AS "responsibleName",responsible_phone AS "responsiblePhone",
    last_tested_at AS "lastTestedAt",next_test_at AS "nextTestAt",latitude,longitude,notes
    FROM warning_assets WHERE organization_id=$1 AND id=$2`,[orgId,id]);return r.rows[0];
 }
 if(target==="SHELTER"){
  const r=await db.query(`SELECT id,name,address_line AS "addressLine",neighborhood,capacity_people AS "capacityPeople",status,
    responsible_name AS "responsibleName",contact_phone AS "contactPhone",accessible,kitchen_available AS "kitchenAvailable",
    generator_available AS "generatorAvailable",pet_area_available AS "petAreaAvailable",latitude,longitude,readiness_notes AS "readinessNotes"
    FROM shelters WHERE organization_id=$1 AND id=$2`,[orgId,id]);return r.rows[0];
 }
 return undefined;
}
function asGeoJsonFeature(entity:any,target:string){
 const properties={...entity,entityType:target,sourceSystem:"SIGDEC"};delete properties.latitude;delete properties.longitude;delete properties.boundaryGeojson;
 const geometry=entity.boundaryGeojson??(entity.latitude!=null&&entity.longitude!=null?{type:"Point",coordinates:[Number(entity.longitude),Number(entity.latitude)]}:null);
 return {type:"Feature",id:entity.id,geometry,properties};
}

export async function geoPixelRoutes(app:FastifyInstance){
 app.get("/api/v1/geopixel/status",{preHandler:requirePermission("geopixel.read")},async request=>{
  const o=org(request);
  const [connections,layers,features,runs]=await Promise.all([
   db.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE active)::int AS active,
    count(*) FILTER(WHERE last_test_ok=true)::int AS "testedOk" FROM geopixel_connections WHERE organization_id=$1`,[o]),
   db.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE active)::int AS active,
    count(*) FILTER(WHERE last_sync_status='SUCCEEDED')::int AS synced FROM geopixel_layers WHERE organization_id=$1`,[o]),
   db.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE active)::int AS active FROM geopixel_features WHERE organization_id=$1",[o]),
   db.query(`SELECT count(*) FILTER(WHERE status='FAILED' AND started_at>=now()-interval '24 hours')::int AS "failed24h",
    max(started_at) AS "lastRunAt" FROM geopixel_sync_runs WHERE organization_id=$1`,[o])
  ]);
  return {connections:connections.rows[0],layers:layers.rows[0],features:features.rows[0],sync:runs.rows[0],
    capabilities:["REST_GEOJSON","WFS_IMPORT","WMS_REFERENCE","POSTGIS_CONTEXT","LOCAL_MIRROR","REST_GEOJSON_EXPORT","AUDIT_LOG"]};
 });

 app.get("/api/v1/geopixel/connections",{preHandler:requirePermission("geopixel.read")},async request=>{
  const o=org(request),r=await db.query(`SELECT id,name,portal_url AS "portalUrl",api_base_url AS "apiBaseUrl",wms_url AS "wmsUrl",wfs_url AS "wfsUrl",
   auth_type AS "authType",username,(secret_ciphertext IS NOT NULL) AS "secretConfigured",api_key_header AS "apiKeyHeader",active,
   sync_interval_minutes AS "syncIntervalMinutes",config,last_test_at AS "lastTestAt",last_test_ok AS "lastTestOk",last_test_message AS "lastTestMessage",
   last_sync_at AS "lastSyncAt",last_sync_status AS "lastSyncStatus",created_at AS "createdAt",updated_at AS "updatedAt"
   FROM geopixel_connections WHERE organization_id=$1 ORDER BY name`,[o]);return {items:r.rows};
 });

 app.post("/api/v1/geopixel/connections",{preHandler:requirePermission("geopixel.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),p=connectionInput.safeParse(request.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const v=p.data,secret=v.secret?encryptApplicationSecret(v.secret):null;
  const r=await db.query(`INSERT INTO geopixel_connections(organization_id,name,portal_url,api_base_url,wms_url,wfs_url,auth_type,username,secret_ciphertext,api_key_header,active,sync_interval_minutes,config,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)
   RETURNING id,name,active,(secret_ciphertext IS NOT NULL) AS "secretConfigured"`,
   [o,v.name,v.portalUrl||null,v.apiBaseUrl||null,v.wmsUrl||null,v.wfsUrl||null,v.authType,v.username||null,secret,v.apiKeyHeader,v.active,v.syncIntervalMinutes,JSON.stringify(v.config),a.userId]);
  return reply.code(201).send(r.rows[0]);
 });

 app.put("/api/v1/geopixel/connections/:id",{preHandler:requirePermission("geopixel.manage")},async(request,reply)=>{
  const o=org(request),{id}=request.params as {id:string},p=connectionInput.safeParse(request.body);
  if(!uuid.safeParse(id).success||!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.success?undefined:p.error.flatten()});
  const v=p.data,secret=v.secret?encryptApplicationSecret(v.secret):null;
  const r=await db.query(`UPDATE geopixel_connections SET name=$3,portal_url=$4,api_base_url=$5,wms_url=$6,wfs_url=$7,auth_type=$8,username=$9,
   secret_ciphertext=CASE WHEN $10::text IS NULL THEN secret_ciphertext ELSE $10 END,api_key_header=$11,active=$12,sync_interval_minutes=$13,config=$14::jsonb,updated_at=now()
   WHERE id=$1 AND organization_id=$2 RETURNING id,name,active,(secret_ciphertext IS NOT NULL) AS "secretConfigured"`,
   [id,o,v.name,v.portalUrl||null,v.apiBaseUrl||null,v.wmsUrl||null,v.wfsUrl||null,v.authType,v.username||null,secret,v.apiKeyHeader,v.active,v.syncIntervalMinutes,JSON.stringify(v.config)]);
  if(!r.rows[0])return reply.code(404).send({error:"NOT_FOUND"});return r.rows[0];
 });

 app.post("/api/v1/geopixel/connections/:id/test",{preHandler:requirePermission("geopixel.manage")},async(request,reply)=>{
  const o=org(request),{id}=request.params as {id:string};if(!uuid.safeParse(id).success)return reply.code(400).send({error:"INVALID_ID"});
  const connection=await loadConnection(id,o);if(!connection)return reply.code(404).send({error:"NOT_FOUND"});
  const results:any[]=[];
  try{
   for(const raw of connectionBaseUrls(connection)){
    const u=new URL(raw);
    if(raw===connection.wfsUrl){u.searchParams.set("service","WFS");u.searchParams.set("request","GetCapabilities")}
    if(raw===connection.wmsUrl){u.searchParams.set("service","WMS");u.searchParams.set("request","GetCapabilities")}
    const r=await geoPixelHttp(connection,u.toString(),{maxBytes:5*1024*1024});
    results.push({url:u.toString(),status:r.status,contentType:r.contentType,ok:r.status>=200&&r.status<400});
   }
   const ok=results.some(x=>x.ok),message=ok?"Conexão GeoPixel respondeu com sucesso.":"Nenhum endpoint GeoPixel retornou sucesso.";
   await db.query("UPDATE geopixel_connections SET last_test_at=now(),last_test_ok=$3,last_test_message=$4,updated_at=now() WHERE id=$1 AND organization_id=$2",[id,o,ok,message]);
   return {ok,message,results};
  }catch(error){
   const message=error instanceof Error?error.message:String(error);
   await db.query("UPDATE geopixel_connections SET last_test_at=now(),last_test_ok=false,last_test_message=$3,updated_at=now() WHERE id=$1 AND organization_id=$2",[id,o,message]);
   return reply.code(502).send({error:"GEOPIXEL_TEST_FAILED",message,results});
  }
 });

 app.get("/api/v1/geopixel/connections/:id/discover",{preHandler:requirePermission("geopixel.manage")},async(request,reply)=>{
  const o=org(request),{id}=request.params as {id:string};if(!uuid.safeParse(id).success)return reply.code(400).send({error:"INVALID_ID"});
  const connection=await loadConnection(id,o);if(!connection)return reply.code(404).send({error:"NOT_FOUND"});
  const result:{wfs:string[];wms:string[];notes:string[]}={wfs:[],wms:[],notes:[]};
  if(connection.wfsUrl){
   try{const u=new URL(connection.wfsUrl);u.searchParams.set("service","WFS");u.searchParams.set("request","GetCapabilities");
    const r=await geoPixelHttp(connection,u.toString(),{headers:{accept:"application/xml,text/xml,*/*"},maxBytes:10*1024*1024});
    if(r.status>=200&&r.status<400)result.wfs=xmlNames(r.body.toString("utf8"),true);else result.notes.push("WFS HTTP "+r.status);
   }catch(e){result.notes.push("WFS: "+(e instanceof Error?e.message:String(e)))}
  }
  if(connection.wmsUrl){
   try{const u=new URL(connection.wmsUrl);u.searchParams.set("service","WMS");u.searchParams.set("request","GetCapabilities");
    const r=await geoPixelHttp(connection,u.toString(),{headers:{accept:"application/xml,text/xml,*/*"},maxBytes:10*1024*1024});
    if(r.status>=200&&r.status<400)result.wms=xmlNames(r.body.toString("utf8"),false);else result.notes.push("WMS HTTP "+r.status);
   }catch(e){result.notes.push("WMS: "+(e instanceof Error?e.message:String(e)))}
  }
  if(connection.apiBaseUrl)result.notes.push("API REST configurada. A descoberta de recursos proprietários depende do contrato/documentação disponibilizados pela GeoPixel.");
  return result;
 });

 app.get("/api/v1/geopixel/layers",{preHandler:requirePermission("geopixel.read")},async request=>{
  const o=org(request),r=await db.query(`SELECT l.id,l.connection_id AS "connectionId",c.name AS "connectionName",l.code,l.title,l.source_type AS "sourceType",
   l.remote_layer_name AS "remoteLayerName",l.resource_path AS "resourcePath",l.category,l.direction,l.local_target AS "localTarget",
   l.attribute_map AS "attributeMap",l.request_params AS "requestParams",l.export_method AS "exportMethod",l.remote_id_property AS "remoteIdProperty",l.active,
   l.last_sync_at AS "lastSyncAt",l.last_sync_status AS "lastSyncStatus",l.last_sync_message AS "lastSyncMessage",
   (SELECT count(*)::int FROM geopixel_features f WHERE f.layer_id=l.id AND f.active=true) AS "featureCount"
   FROM geopixel_layers l JOIN geopixel_connections c ON c.id=l.connection_id WHERE l.organization_id=$1 ORDER BY c.name,l.title`,[o]);return {items:r.rows};
 });

 app.post("/api/v1/geopixel/layers",{preHandler:requirePermission("geopixel.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),p=layerInput.safeParse(request.body);if(!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.error.flatten()});
  const v=p.data;const conn=await db.query("SELECT 1 FROM geopixel_connections WHERE id=$1 AND organization_id=$2",[v.connectionId,o]);if(!conn.rows[0])return reply.code(400).send({error:"INVALID_CONNECTION"});
  const r=await db.query(`INSERT INTO geopixel_layers(organization_id,connection_id,code,title,source_type,remote_layer_name,resource_path,category,direction,local_target,attribute_map,request_params,export_method,remote_id_property,active,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16) RETURNING id,code,title`,
   [o,v.connectionId,v.code,v.title,v.sourceType,v.remoteLayerName||null,v.resourcePath||null,v.category,v.direction,v.localTarget,JSON.stringify(v.attributeMap),JSON.stringify(v.requestParams),v.exportMethod,v.remoteIdProperty,v.active,a.userId]);
  return reply.code(201).send(r.rows[0]);
 });

 app.put("/api/v1/geopixel/layers/:id",{preHandler:requirePermission("geopixel.manage")},async(request,reply)=>{
  const o=org(request),{id}=request.params as {id:string},p=layerInput.safeParse(request.body);
  if(!uuid.safeParse(id).success||!p.success)return reply.code(400).send({error:"INVALID_INPUT",details:p.success?undefined:p.error.flatten()});
  const v=p.data,r=await db.query(`UPDATE geopixel_layers SET connection_id=$3,code=$4,title=$5,source_type=$6,remote_layer_name=$7,resource_path=$8,
   category=$9,direction=$10,local_target=$11,attribute_map=$12::jsonb,request_params=$13::jsonb,export_method=$14,remote_id_property=$15,active=$16,updated_at=now()
   WHERE id=$1 AND organization_id=$2 RETURNING id,code,title`,
   [id,o,v.connectionId,v.code,v.title,v.sourceType,v.remoteLayerName||null,v.resourcePath||null,v.category,v.direction,v.localTarget,JSON.stringify(v.attributeMap),JSON.stringify(v.requestParams),v.exportMethod,v.remoteIdProperty,v.active]);
  if(!r.rows[0])return reply.code(404).send({error:"NOT_FOUND"});return r.rows[0];
 });

 app.patch("/api/v1/geopixel/layers/:id/status",{preHandler:requirePermission("geopixel.manage")},async(request,reply)=>{
  const o=org(request),{id}=request.params as {id:string},p=activeInput.safeParse(request.body);
  if(!uuid.safeParse(id).success||!p.success)return reply.code(400).send({error:"INVALID_INPUT"});
  const r=await db.query("UPDATE geopixel_layers SET active=$3,updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING id,active",[id,o,p.data.active]);
  if(!r.rows[0])return reply.code(404).send({error:"NOT_FOUND"});return r.rows[0];
 });

 app.post("/api/v1/geopixel/layers/:id/sync",{preHandler:requirePermission("geopixel.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),{id}=request.params as {id:string};if(!uuid.safeParse(id).success)return reply.code(400).send({error:"INVALID_ID"});
  const layer=await loadLayer(id,o);if(!layer)return reply.code(404).send({error:"LAYER_NOT_FOUND"});
  if(!["IMPORT","BIDIRECTIONAL"].includes(layer.direction)||layer.sourceType==="WMS_REFERENCE")return reply.code(409).send({error:"LAYER_NOT_IMPORTABLE",message:"A camada não está configurada para importação de feições."});
  const connection=await loadConnection(layer.connectionId,o);if(!connection)return reply.code(404).send({error:"CONNECTION_NOT_FOUND"});
  try{return await syncGeoPixelLayer(layer,connection,a.userId)}catch(error){return reply.code(502).send({error:"GEOPIXEL_SYNC_FAILED",message:error instanceof Error?error.message:String(error)})}
 });

 app.post("/api/v1/geopixel/sync-all",{preHandler:requirePermission("geopixel.manage")},async request=>{
  const a=authFrom(request),o=org(request);
  const layers=await db.query<{id:string}>(`SELECT id FROM geopixel_layers WHERE organization_id=$1 AND active=true AND source_type<>'WMS_REFERENCE' AND direction IN('IMPORT','BIDIRECTIONAL') ORDER BY created_at`,[o]);
  const results:any[]=[];
  for(const row of layers.rows){
   const layer=await loadLayer(row.id,o);if(!layer)continue;const connection=await loadConnection(layer.connectionId,o);if(!connection)continue;
   try{results.push({layerId:row.id,...await syncGeoPixelLayer(layer,connection,a.userId)})}catch(error){results.push({layerId:row.id,status:"FAILED",message:error instanceof Error?error.message:String(error)})}
  }
  return {items:results};
 });

 app.get("/api/v1/geopixel/features",{preHandler:requirePermission("geopixel.read")},async request=>{
  const o=org(request),q=request.query as {layerId?:string;category?:string;active?:string;limit?:string};
  const limit=Math.max(1,Math.min(5000,Number(q.limit??1500)));
  const params:any[]=[o];let where="f.organization_id=$1";
  if(q.layerId&&uuid.safeParse(q.layerId).success){params.push(q.layerId);where+=` AND f.layer_id=$${params.length}`}
  if(q.category){params.push(q.category);where+=` AND l.category=$${params.length}`}
  if(q.active!=="false")where+=" AND f.active=true";
  params.push(limit);
  const r=await db.query(`SELECT f.id,f.remote_id AS "remoteId",l.id AS "layerId",l.code AS "layerCode",l.title AS "layerTitle",l.category,l.local_target AS "localTarget",
   f.properties,CASE WHEN f.geometry IS NULL THEN NULL ELSE ST_AsGeoJSON(f.geometry)::jsonb END AS geometry,
   f.source_updated_at AS "sourceUpdatedAt",f.synced_at AS "syncedAt"
   FROM geopixel_features f JOIN geopixel_layers l ON l.id=f.layer_id
   WHERE ${where} ORDER BY l.title,f.last_seen_at DESC LIMIT $${params.length}`,params);
  return {type:"FeatureCollection",features:r.rows.map(x=>({type:"Feature",id:x.id,geometry:x.geometry,properties:{...x.properties,_sigdec:{remoteId:x.remoteId,layerId:x.layerId,layerCode:x.layerCode,layerTitle:x.layerTitle,category:x.category,localTarget:x.localTarget,syncedAt:x.syncedAt}}}))};
 });

 app.get("/api/v1/geopixel/context/incident/:id",{preHandler:requirePermission("incidents.read")},async(request,reply)=>{
  const o=org(request),{id}=request.params as {id:string};if(!uuid.safeParse(id).success)return reply.code(400).send({error:"INVALID_ID"});
  const incident=await db.query("SELECT id,protocol,latitude,longitude FROM incidents WHERE id=$1 AND organization_id=$2",[id,o]);
  const item=incident.rows[0];if(!item)return reply.code(404).send({error:"NOT_FOUND"});
  if(item.latitude==null||item.longitude==null)return {georeferenced:false,features:[]};
  const r=await db.query(`SELECT f.id,f.remote_id AS "remoteId",l.code AS "layerCode",l.title AS "layerTitle",l.category,f.properties,
    CASE WHEN ST_Intersects(f.geometry,ST_SetSRID(ST_MakePoint($2,$3),4326)) THEN 0
         ELSE round(ST_Distance(f.geometry::geography,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography))::int END AS "distanceMeters",
    CASE WHEN f.geometry IS NULL THEN NULL ELSE ST_AsGeoJSON(f.geometry)::jsonb END AS geometry
   FROM geopixel_features f JOIN geopixel_layers l ON l.id=f.layer_id
   WHERE f.organization_id=$1 AND f.active=true AND f.geometry IS NOT NULL
    AND ST_DWithin(f.geometry::geography,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,10000)
   ORDER BY "distanceMeters",l.category,l.title LIMIT 100`,[o,Number(item.longitude),Number(item.latitude)]);
  return {georeferenced:true,incident:{id:item.id,protocol:item.protocol},features:r.rows};
 });

 app.get("/api/v1/geopixel/sync-runs",{preHandler:requirePermission("geopixel.read")},async request=>{
  const o=org(request),r=await db.query(`SELECT r.id,r.direction,r.status,r.started_at AS "startedAt",r.finished_at AS "finishedAt",
   r.features_received AS "featuresReceived",r.features_inserted AS "featuresInserted",r.features_updated AS "featuresUpdated",
   r.features_deactivated AS "featuresDeactivated",r.exported_count AS "exportedCount",r.http_status AS "httpStatus",r.message,r.details,
   c.name AS "connectionName",l.title AS "layerTitle"
   FROM geopixel_sync_runs r JOIN geopixel_connections c ON c.id=r.connection_id LEFT JOIN geopixel_layers l ON l.id=r.layer_id
   WHERE r.organization_id=$1 ORDER BY r.started_at DESC LIMIT 100`,[o]);return {items:r.rows};
 });

 app.post("/api/v1/geopixel/layers/:id/export/:entityId",{preHandler:requirePermission("geopixel.manage")},async(request,reply)=>{
  const a=authFrom(request),o=org(request),{id,entityId}=request.params as {id:string;entityId:string};
  if(!uuid.safeParse(id).success||!uuid.safeParse(entityId).success)return reply.code(400).send({error:"INVALID_ID"});
  const layer=await loadLayer(id,o);if(!layer)return reply.code(404).send({error:"LAYER_NOT_FOUND"});
  if(!["EXPORT","BIDIRECTIONAL"].includes(layer.direction)||layer.sourceType!=="REST_GEOJSON")return reply.code(409).send({error:"LAYER_NOT_EXPORTABLE",message:"Exportação exige camada REST_GEOJSON configurada como EXPORT/BIDIRECTIONAL."});
  const connection=await loadConnection(layer.connectionId,o);if(!connection)return reply.code(404).send({error:"CONNECTION_NOT_FOUND"});
  const entity=await localEntity(o,layer.localTarget,entityId);if(!entity)return reply.code(404).send({error:"ENTITY_NOT_FOUND"});
  const feature=asGeoJsonFeature(entity,layer.localTarget),url=relativeRemoteUrl(connection.apiBaseUrl,layer.resourcePath);
  const run=await db.query<{id:string}>(`INSERT INTO geopixel_sync_runs(organization_id,connection_id,layer_id,direction,status,triggered_by) VALUES($1,$2,$3,'EXPORT','RUNNING',$4) RETURNING id`,[o,connection.id,layer.id,a.userId]);
  try{
   const remote=await geoPixelHttp(connection,url,{method:layer.exportMethod,body:JSON.stringify(feature),headers:{"content-type":"application/geo+json"},maxBytes:5*1024*1024});
   const ok=remote.status>=200&&remote.status<300;
   await db.query(`UPDATE geopixel_sync_runs SET status=$2,finished_at=now(),exported_count=CASE WHEN $2='SUCCEEDED' THEN 1 ELSE 0 END,http_status=$3,message=$4 WHERE id=$1`,
    [run.rows[0]!.id,ok?"SUCCEEDED":"FAILED",remote.status,ok?"Feição exportada para GeoPixel.":"GeoPixel respondeu HTTP "+remote.status]);
   if(!ok)return reply.code(502).send({error:"GEOPIXEL_EXPORT_FAILED",status:remote.status,body:remote.body.toString("utf8").slice(0,1000)});
   return {ok:true,status:remote.status,runId:run.rows[0]!.id};
  }catch(error){
   const message=error instanceof Error?error.message:String(error);await db.query("UPDATE geopixel_sync_runs SET status='FAILED',finished_at=now(),message=$2 WHERE id=$1",[run.rows[0]!.id,message]).catch(()=>{});
   return reply.code(502).send({error:"GEOPIXEL_EXPORT_FAILED",message});
  }
 });
}
