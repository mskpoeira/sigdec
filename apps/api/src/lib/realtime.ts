import {randomUUID} from "node:crypto";
import type {FastifyReply} from "fastify";
import {db} from "../db.js";

type RealtimeClient={
 organizationId:string|null;
 raw:FastifyReply["raw"];
 heartbeat:NodeJS.Timeout;
};

type RealtimeEvent={
 organizationId:string|null;
 method:string;
 path:string;
 entityId?:string|null;
 at?:string;
};

type RealtimeEnvelope={source:string;event:RealtimeEvent};

const clients=new Set<RealtimeClient>();
const instanceId=randomUUID();
const channel="sigdec_realtime";
let bridgeClient:Awaited<ReturnType<typeof db.connect>>|null=null;
let bridgeActive=false;
let reconnectTimer:NodeJS.Timeout|null=null;
let bridgeLastError:string|null=null;
let bridgeLastMessageAt:string|null=null;

function broadcast(event:RealtimeEvent){
 const payload=JSON.stringify({...event,at:event.at??new Date().toISOString()});
 for(const client of clients){
  if(client.organizationId!==event.organizationId)continue;
  try{client.raw.write(`event: change\ndata: ${payload}\n\n`)}
  catch{clearInterval(client.heartbeat);clients.delete(client);}
 }
}

function scheduleReconnect(){
 if(reconnectTimer)return;
 reconnectTimer=setTimeout(()=>{
  reconnectTimer=null;
  void connectBridge();
 },5000);
 reconnectTimer.unref();
}

async function connectBridge(){
 if(bridgeActive||bridgeClient)return;
 try{
  const client=await db.connect();
  bridgeClient=client;
  client.on("notification",message=>{
   if(message.channel!==channel||!message.payload)return;
   try{
    const envelope=JSON.parse(message.payload) as RealtimeEnvelope;
    if(!envelope?.event||envelope.source===instanceId)return;
    bridgeLastMessageAt=new Date().toISOString();
    broadcast(envelope.event);
   }catch{}
  });
  client.on("error",error=>{
   bridgeLastError=error instanceof Error?error.message:String(error);
   bridgeActive=false;
   const current=bridgeClient;
   bridgeClient=null;
   try{current?.release(true)}catch{}
   scheduleReconnect();
  });
  await client.query(`LISTEN ${channel}`);
  bridgeActive=true;
  bridgeLastError=null;
 }catch(error){
  bridgeLastError=error instanceof Error?error.message:String(error);
  const current=bridgeClient;
  bridgeClient=null;
  try{current?.release(true)}catch{}
  bridgeActive=false;
  scheduleReconnect();
 }
}

export async function initializeRealtimeBridge(){
 await connectBridge();
 return realtimeBridgeStatus();
}

export function addRealtimeClient(organizationId:string|null,reply:FastifyReply){
 reply.hijack();
 const raw=reply.raw;
 raw.writeHead(200,{
  "Content-Type":"text/event-stream; charset=utf-8",
  "Cache-Control":"no-cache, no-transform",
  "Connection":"keep-alive",
  "X-Accel-Buffering":"no"
 });
 raw.write(`event: ready\ndata: ${JSON.stringify({at:new Date().toISOString(),instanceId})}\n\n`);
 const heartbeat=setInterval(()=>{
  try{raw.write(`: ping ${Date.now()}\n\n`)}catch{}
 },20000);
 heartbeat.unref();
 const client:RealtimeClient={organizationId,raw,heartbeat};
 clients.add(client);
 const cleanup=()=>{clearInterval(heartbeat);clients.delete(client);};
 raw.on("close",cleanup);
 raw.on("error",cleanup);
 return cleanup;
}

export function publishRealtimeEvent(event:RealtimeEvent){
 const normalized={...event,at:event.at??new Date().toISOString()};
 broadcast(normalized);
 const envelope:RealtimeEnvelope={source:instanceId,event:normalized};
 void db.query("SELECT pg_notify($1,$2)",[channel,JSON.stringify(envelope)]).catch(error=>{
  bridgeLastError=error instanceof Error?error.message:String(error);
 });
}

export function realtimeClientCount(){return clients.size;}

export function realtimeBridgeStatus(){
 return {
  transport:"sse",
  distribution:"postgres-listen-notify",
  instanceId,
  bridgeActive,
  localConnections:clients.size,
  lastRemoteMessageAt:bridgeLastMessageAt,
  lastError:bridgeLastError
 };
}
