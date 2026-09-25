import assert from "node:assert/strict";
import test from "node:test";
import { incidentProtocolParts } from "./incident-protocol.js";

test("protocolo de ocorrência segue DC-AAAA-MM-DD000000 em Ubatuba", () => {
  const parts = incidentProtocolParts(new Date("2026-09-25T10:30:00Z"));
  assert.equal(parts.year, 2026);
  assert.equal(parts.month, "09");
  assert.equal(parts.day, "25");
  assert.equal(parts.format(1), "DC-2026-09-25000001");
  assert.equal(parts.format(999999), "DC-2026-09-25999999");
});

test("data do protocolo respeita o fuso de Ubatuba", () => {
  const parts = incidentProtocolParts(new Date("2026-09-25T02:30:00Z"));
  assert.equal(parts.format(42), "DC-2026-09-24000042");
});

test("sequência do protocolo deve caber em seis dígitos", () => {
  const parts = incidentProtocolParts(new Date("2026-09-25T12:00:00Z"));
  assert.throws(() => parts.format(0), /Sequência/);
  assert.throws(() => parts.format(1_000_000), /Sequência/);
});
