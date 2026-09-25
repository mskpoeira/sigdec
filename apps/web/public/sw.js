const CACHE="sigdec-shell-v1.41";
const SHELL=["/offline","/manifest.webmanifest"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",event=>{
 const req=event.request;const url=new URL(req.url);
 if(req.method!=="GET"||url.origin!==self.location.origin)return;
 if(url.pathname.startsWith("/api/")||url.pathname.startsWith("/auth/"))return;
 if(url.pathname.startsWith("/_next/static/")){
  event.respondWith(caches.open(CACHE).then(async cache=>{const hit=await cache.match(req);if(hit)return hit;const res=await fetch(req);if(res.ok)cache.put(req,res.clone());return res}));
  return;
 }
 if(req.mode==="navigate"){
  event.respondWith(fetch(req).catch(()=>caches.match("/offline")));return;
 }
});
