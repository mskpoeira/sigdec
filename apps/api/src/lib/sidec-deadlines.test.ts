import assert from "node:assert/strict";
import test from "node:test";
import { isSidecDeadlineOverdue,sidecDueAt,sidecPendingState,type SidecDeadlinePolicy } from "./sidec-deadlines.js";

const policies:SidecDeadlinePolicy[]=[
 {pendingStatus:"PACKAGE_READY",warningAfterHours:24,severity:"WATCH",enabled:true},
 {pendingStatus:"AWAITING_PROTOCOL",warningAfterHours:24,severity:"WARNING",enabled:true},
 {pendingStatus:"AWAITING_RETURN",warningAfterHours:72,severity:"WARNING",enabled:true},
 {pendingStatus:"REJECTED",warningAfterHours:8,severity:"EMERGENCY",enabled:true}
];

test("estado pendente usa marco temporal correto",()=>{
 assert.equal(sidecPendingState({status:"READY",createdAt:"2026-09-23T10:00:00Z"})?.pendingStatus,"PACKAGE_READY");
 assert.equal(sidecPendingState({status:"EXPORTED",exportedAt:"2026-09-23T11:00:00Z"})?.pendingStatus,"AWAITING_PROTOCOL");
 assert.equal(sidecPendingState({status:"SUBMITTED",submittedAt:"2026-09-23T12:00:00Z"})?.pendingStatus,"AWAITING_RETURN");
 assert.equal(sidecPendingState({status:"ACKNOWLEDGED"}),null);
});

test("calcula vencimento pelo SLA configurado",()=>{
 const due=sidecDueAt({status:"EXPORTED",exportedAt:"2026-09-23T10:00:00Z"},policies);
 assert.equal(due?.dueAt.toISOString(),"2026-09-24T10:00:00.000Z");
 assert.equal(due?.severity,"WARNING");
});

test("identifica prazo vencido",()=>{
 assert.equal(isSidecDeadlineOverdue(new Date("2026-09-23T10:00:00Z"),new Date("2026-09-23T10:00:01Z")),true);
 assert.equal(isSidecDeadlineOverdue(new Date("2026-09-23T10:00:00Z"),new Date("2026-09-23T09:59:59Z")),false);
});
