import { z } from "zod";

const genericSchema=z.object({
 measuredAt:z.coerce.date(),
 metric:z.string().trim().min(1).max(50),
 value:z.number().finite(),
 unit:z.string().trim().min(1).max(30)
});

const geopixelBridgeSchema=z.object({
 timestamp:z.coerce.date(),
 metric:z.string().trim().min(1).max(50),
 reading:z.number().finite(),
 unit:z.string().trim().min(1).max(30),
 externalStationId:z.string().trim().max(200).optional()
});

export type NormalizedMonitoringReading={
 measuredAt:Date;
 metric:string;
 value:number;
 unit:string;
 externalStationId?:string;
 adapter:string;
};

export function normalizeMonitoringPayload(adapter:string|undefined,body:unknown):NormalizedMonitoringReading{
 const code=(adapter??"SIGDEC_GENERIC_V1").trim().toUpperCase();
 if(code==="SIGDEC_GENERIC_V1"){
  const p=genericSchema.parse(body);
  return {...p,adapter:code};
 }
 if(code==="GEOPIXEL_BRIDGE_V1"){
  const p=geopixelBridgeSchema.parse(body);
  return {measuredAt:p.timestamp,metric:p.metric,value:p.reading,unit:p.unit,externalStationId:p.externalStationId,adapter:code};
 }
 throw new Error("UNSUPPORTED_MONITORING_ADAPTER");
}

export const supportedMonitoringAdapters=["SIGDEC_GENERIC_V1","GEOPIXEL_BRIDGE_V1"] as const;
