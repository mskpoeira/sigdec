"use client";
import{useEffect}from"react";

const RECOVERY_KEY="sigdec_chunk_recovery";

async function clearSigdecCaches(){
 if(!("caches"in window))return;
 const keys=await caches.keys();
 await Promise.all(keys.filter(key=>key.startsWith("sigdec-")).map(key=>caches.delete(key)));
}

export default function PwaRegister(){
 useEffect(()=>{
  if("serviceWorker"in navigator){
   void navigator.serviceWorker.register("/sw.js?v=1.73.1",{scope:"/",updateViaCache:"none"})
    .then(registration=>registration.update())
    .catch(()=>undefined);
  }

  const recover=async()=>{
   if(sessionStorage.getItem(RECOVERY_KEY)==="1")return;
   sessionStorage.setItem(RECOVERY_KEY,"1");
   await clearSigdecCaches().catch(()=>undefined);
   if("serviceWorker"in navigator){
    const registrations=await navigator.serviceWorker.getRegistrations().catch(()=>[]);
    await Promise.all(registrations.map(registration=>registration.update().catch(()=>undefined)));
   }
   window.location.reload();
  };

  const onError=(event:ErrorEvent)=>{
   const message=String(event.message??event.error?.message??"");
   if(/ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(message)){
    event.preventDefault();
    void recover();
   }
  };
  const onRejection=(event:PromiseRejectionEvent)=>{
   const message=String((event.reason as any)?.message??event.reason??"");
   if(/ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(message)){
    event.preventDefault();
    void recover();
   }
  };

  window.addEventListener("error",onError);
  window.addEventListener("unhandledrejection",onRejection);
  const clearRecovery=window.setTimeout(()=>sessionStorage.removeItem(RECOVERY_KEY),15000);
  return()=>{
   window.removeEventListener("error",onError);
   window.removeEventListener("unhandledrejection",onRejection);
   window.clearTimeout(clearRecovery);
  };
 },[]);
 return null;
}
