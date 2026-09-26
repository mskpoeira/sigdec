"use client";

import {useEffect,useRef} from "react";

export function useRealtimeRefresh(callback:()=>void|Promise<void>,enabled=true){
 const callbackRef=useRef(callback);
 useEffect(()=>{callbackRef.current=callback},[callback]);

 useEffect(()=>{
  if(!enabled)return;
  let running=false;
  const run=async()=>{
   if(running||document.visibilityState!=="visible"||!navigator.onLine)return;
   running=true;
   try{await callbackRef.current()}finally{running=false}
  };
  const onTick=()=>{void run()};
  const onVisibility=()=>{if(document.visibilityState==="visible")void run()};
  const onOnline=()=>{void run()};
  window.addEventListener("sigdec:realtime-tick",onTick);
  document.addEventListener("visibilitychange",onVisibility);
  window.addEventListener("online",onOnline);
  return()=>{
   window.removeEventListener("sigdec:realtime-tick",onTick);
   document.removeEventListener("visibilitychange",onVisibility);
   window.removeEventListener("online",onOnline);
  };
 },[enabled]);
}
