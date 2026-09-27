export type PhoneKind="LANDLINE"|"MOBILE";
export function phoneDigits(value:string){return value.replace(/\D/g,"").slice(0,11)}
export function detectPhoneKind(value:string):PhoneKind|null{
 const d=phoneDigits(value);if(d.length===10)return "LANDLINE";if(d.length===11)return "MOBILE";return null;
}
export function formatBrPhone(value:string){
 const d=phoneDigits(value);
 if(d.length<=2)return d.length?"("+d:"";
 const ddd=d.slice(0,2),n=d.slice(2);
 if(n.length<=4)return "("+ddd+") "+n;
 if(n.length<=8)return "("+ddd+") "+n.slice(0,4)+"-"+n.slice(4);
 return "("+ddd+") "+n.slice(0,5)+"-"+n.slice(5,9);
}
export function normalizedBrPhone(value:string){const d=phoneDigits(value);return d.length===10||d.length===11?d:null}
