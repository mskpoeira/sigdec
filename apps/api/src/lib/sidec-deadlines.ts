export type SidecDeadlinePolicy={
 pendingStatus:"PACKAGE_READY"|"AWAITING_PROTOCOL"|"AWAITING_RETURN"|"REJECTED";
 warningAfterHours:number;
 severity:"WATCH"|"WARNING"|"EMERGENCY";
 enabled:boolean;
};

export type SidecExportDeadlineSource={
 status:string;
 createdAt?:string|Date|null;
 updatedAt?:string|Date|null;
 exportedAt?:string|Date|null;
 submittedAt?:string|Date|null;
 rejectedAt?:string|Date|null;
};

export function sidecPendingState(source:SidecExportDeadlineSource){
 if(source.status==="READY")return {pendingStatus:"PACKAGE_READY" as const,since:source.createdAt??source.updatedAt??null};
 if(source.status==="EXPORTED")return {pendingStatus:"AWAITING_PROTOCOL" as const,since:source.exportedAt??source.updatedAt??null};
 if(source.status==="SUBMITTED")return {pendingStatus:"AWAITING_RETURN" as const,since:source.submittedAt??source.updatedAt??null};
 if(source.status==="REJECTED")return {pendingStatus:"REJECTED" as const,since:source.rejectedAt??source.updatedAt??null};
 return null;
}

export function sidecDueAt(source:SidecExportDeadlineSource,policies:SidecDeadlinePolicy[]){
 const state=sidecPendingState(source);
 if(!state?.since)return null;
 const policy=policies.find(x=>x.enabled&&x.pendingStatus===state.pendingStatus);
 if(!policy)return null;
 const since=new Date(state.since);
 if(Number.isNaN(since.getTime()))return null;
 return {
  ...state,
  severity:policy.severity,
  warningAfterHours:policy.warningAfterHours,
  dueAt:new Date(since.getTime()+policy.warningAfterHours*60*60*1000)
 };
}

export function isSidecDeadlineOverdue(dueAt:Date,now=new Date()){
 return dueAt.getTime()<=now.getTime();
}
