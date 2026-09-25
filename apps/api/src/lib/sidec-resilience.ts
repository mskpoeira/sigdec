export function resilienceBackoffMinutes(attempts:number,baseMinutes=15,maxMinutes=1440){
 const safeAttempts=Math.max(0,Math.min(20,Math.trunc(attempts)));
 const base=Math.max(1,Math.trunc(baseMinutes));
 const cap=Math.max(base,Math.trunc(maxMinutes));
 return Math.min(cap,base*(2**safeAttempts));
}

export function nextResilienceRetryAt(attempts:number,now=new Date(),baseMinutes=15,maxMinutes=1440){
 return new Date(now.getTime()+resilienceBackoffMinutes(attempts,baseMinutes,maxMinutes)*60*1000);
}

export function hasZipSignature(data:Buffer){
 if(data.length<4)return false;
 const sig=data.subarray(0,4).toString("hex");
 return sig==="504b0304"||sig==="504b0506"||sig==="504b0708";
}

export function hasPdfSignature(data:Buffer){
 return data.length>=5&&data.subarray(0,5).toString("ascii")==="%PDF-";
}

export function shouldAlertResilience(firstDetectedAt:Date,thresholdHours:number,now=new Date()){
 const hours=Math.max(1,Math.min(8760,thresholdHours));
 return now.getTime()-firstDetectedAt.getTime()>=hours*60*60*1000;
}
