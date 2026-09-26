"use client";

import {useEffect,useRef} from "react";

export function useRealtimeRefresh(callback:()=>void|Promise<void>,enabled=true,minIntervalMs=0){
 const callbackRef=useRef(callback);
 const lastRunRef=useRef(0);
 useEffect(()=>{callbackRef.current=callback},[callback]);

 useEffect(()=>{
  if(!enabled)return;
  let running=false;
  const run=async(force=false)=>{
   const now=Date.now();
   if(running||document.visibilityState!=="visible"||!navigator.onLine)return;
   if(!force&&minIntervalMs>0&&now-lastRunRef.current<minIntervalMs)return;
   running=true;lastRunRef.current=now;
   try{await callbackRef.current()}finally{running=false}
  };
  const onTick=()=>{void run()};
  const onVisibility=()=>{if(document.visibilityState==="visible")void run(true)};
  const onOnline=()=>{void run(true)};
  window.addEventListener("sigdec:realtime-tick",onTick);
  document.addEventListener("visibilitychange",onVisibility);
  window.addEventListener("online",onOnline);
  return()=>{
   window.removeEventListener("sigdec:realtime-tick",onTick);
   document.removeEventListener("visibilitychange",onVisibility);
   window.removeEventListener("online",onOnline);
  };
 },[enabled,minIntervalMs]);
}
