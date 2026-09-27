const CACHE="sigdec-shell-v1.73.1";
const SHELL=["/offline","/manifest.webmanifest"];

self.addEventListener("install",event=>{
  event.waitUntil(
    caches.open(CACHE)
      .then(cache=>cache.addAll(SHELL))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch",event=>{
  const req=event.request;
  const url=new URL(req.url);
  if(req.method!=="GET"||url.origin!==self.location.origin)return;
  if(url.pathname.startsWith("/api/")||url.pathname.startsWith("/auth/"))return;

  // Assets do Next são versionados pelo build. Em homologação, sempre buscar
  // a versão corrente para impedir mistura de chunks de releases diferentes.
  if(url.pathname.startsWith("/_next/static/")){
    event.respondWith(fetch(req));
    return;
  }

  if(req.mode==="navigate"){
    event.respondWith(fetch(req).catch(()=>caches.match("/offline")));
  }
});
