import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateSidecContinuity } from "./sidec-continuity.js";

const policy={enabled:true,rpoMinutes:60,rtoMinutes:30,drillMaxAgeHours:168};

test("continuidade fica conforme com replicação e drill dentro dos objetivos",()=>{
  const now=new Date("2026-09-24T12:00:00.000Z");
  const result=evaluateSidecContinuity(policy,{
    archives:3,replicas:3,missingReplicas:0,maxReplicationDelayMinutes:20,
    replicaRequired:true,
    latestSuccessfulPrimaryDrillAt:new Date("2026-09-23T12:00:00.000Z"),
    latestSuccessfulPrimaryDrillDurationMinutes:5,
    latestSuccessfulReplicaDrillAt:new Date("2026-09-23T12:05:00.000Z"),
    latestSuccessfulReplicaDrillDurationMinutes:6
  },now);
  assert.equal(result.overall,"COMPLIANT");
  assert.equal(result.rpo.state,"COMPLIANT");
  assert.equal(result.rto.state,"COMPLIANT");
  assert.equal(result.drillFreshness.state,"COMPLIANT");
});

test("réplica ausente viola RPO administrativo",()=>{
  const result=evaluateSidecContinuity(policy,{
    archives:4,replicas:3,missingReplicas:1,maxReplicationDelayMinutes:10,
    replicaRequired:true,
    latestSuccessfulPrimaryDrillAt:new Date(),
    latestSuccessfulPrimaryDrillDurationMinutes:2,
    latestSuccessfulReplicaDrillAt:new Date(),
    latestSuccessfulReplicaDrillDurationMinutes:2
  });
  assert.equal(result.overall,"BREACH");
  assert.equal(result.rpo.state,"BREACH");
});

test("drill vencido e duração acima do objetivo violam prontidão",()=>{
  const now=new Date("2026-09-24T12:00:00.000Z");
  const result=evaluateSidecContinuity(policy,{
    archives:1,replicas:1,missingReplicas:0,maxReplicationDelayMinutes:5,
    replicaRequired:true,
    latestSuccessfulPrimaryDrillAt:new Date("2026-09-10T12:00:00.000Z"),
    latestSuccessfulPrimaryDrillDurationMinutes:45,
    latestSuccessfulReplicaDrillAt:new Date("2026-09-10T12:00:00.000Z"),
    latestSuccessfulReplicaDrillDurationMinutes:40
  },now);
  assert.equal(result.overall,"BREACH");
  assert.equal(result.rto.state,"BREACH");
  assert.equal(result.drillFreshness.state,"BREACH");
});

test("sem artefatos e sem drill retorna dados insuficientes",()=>{
  const result=evaluateSidecContinuity(policy,{
    archives:0,replicas:0,missingReplicas:0,maxReplicationDelayMinutes:null,
    replicaRequired:true,
    latestSuccessfulPrimaryDrillAt:null,latestSuccessfulPrimaryDrillDurationMinutes:null,
    latestSuccessfulReplicaDrillAt:null,latestSuccessfulReplicaDrillDurationMinutes:null
  });
  assert.equal(result.overall,"INSUFFICIENT_DATA");
  assert.equal(result.rpo.state,"INSUFFICIENT_DATA");
  assert.equal(result.rto.state,"INSUFFICIENT_DATA");
});
