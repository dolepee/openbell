import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { verifyColdFunderObservations } from "./lib/cold-funder-verifier.mjs";

const observations = JSON.parse(await readFile(new URL("../evidence/openbell-independent-cold-funder-observations.json", import.meta.url), "utf8"));
const verification = JSON.parse(await readFile(new URL("../evidence/openbell-independent-cold-funder.json", import.meta.url), "utf8"));

test("verifies independent cold funding across two official providers", () => {
  assert.deepEqual(verifyColdFunderObservations(structuredClone(observations)), verification);
  assert.equal(verification.finalStatus, "FUNDED");
  assert.equal(verification.advanceAmount, "5000");
  assert.equal(verification.testerIndependence, "USER_ATTESTED_NOT_ONCHAIN_VERIFIABLE");
});

test("rejects funding, state, balance and provider drift", () => {
  const changedTransaction = structuredClone(observations);
  changedTransaction.providers[0].funding.transaction.input = "0x00";
  assert.throws(() => verifyColdFunderObservations(changedTransaction), /INPUT/);
  const changedState = structuredClone(observations);
  changedState.providers[0].calls.invoice.result = `0x${"00".repeat(352)}`;
  assert.throws(() => verifyColdFunderObservations(changedState));
  const changedBalance = structuredClone(observations);
  changedBalance.providers[0].calls.supplierAfter.result = `0x${"00".repeat(32)}`;
  assert.throws(() => verifyColdFunderObservations(changedBalance), /EXACT_FUNDING_DELTA/);
  const duplicatedProvider = structuredClone(observations);
  duplicatedProvider.providers[1].provider = duplicatedProvider.providers[0].provider;
  assert.throws(() => verifyColdFunderObservations(duplicatedProvider), /PROVIDERS_NOT_DISTINCT/);
});
