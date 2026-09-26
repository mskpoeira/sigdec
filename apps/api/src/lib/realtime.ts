import type {FastifyReply} from "fastify";

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

const clients=new Set<RealtimeClient>();

export function addRealtimeClient(organizationId:string|null,reply:FastifyReply){
 reply.hijack();
 const raw=reply.raw;
 raw.writeHead(200,{
  "Content-Type":"text/event-stream; charset=utf-8",
  "Cache-Control":"no-cache, no-transform",
  "Connection":"keep-alive",
  "X-Accel-Buffering":"no"
 });
 raw.write(`event: ready\ndata: ${JSON.stringify({at:new Date().toISOString()})}\n\n`);
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
 const payload=JSON.stringify({...event,at:event.at??new Date().toISOString()});
 for(const client of clients){
  if(client.organizationId!==event.organizationId)continue;
  try{client.raw.write(`event: change\ndata: ${payload}\n\n`)}
  catch{clearInterval(client.heartbeat);clients.delete(client);}
 }
}

export function realtimeClientCount(){return clients.size;}
