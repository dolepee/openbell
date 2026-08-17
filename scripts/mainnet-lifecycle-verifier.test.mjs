import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { verifyMainnetLifecycleObservations } from "./lib/mainnet-lifecycle-verifier.mjs";

const observations = JSON.parse(await readFile(new URL("../evidence/openbell-xlayer-mainnet-lifecycle-observations.json", import.meta.url), "utf8"));
const verification = JSON.parse(await readFile(new URL("../evidence/openbell-xlayer-mainnet-lifecycle-verification.json", import.meta.url), "utf8"));

test("verifies the complete canonical-USDG mainnet lifecycle across two providers", () => {
  assert.deepEqual(verifyMainnetLifecycleObservations(structuredClone(observations)), verification);
  assert.equal(verification.finalStatus, "SETTLED");
  assert.equal(verification.advanceAmount, "25000");
  assert.equal(verification.repaymentAmount, "25250");
  assert.equal(verification.transactionHashes.length, 5);
  assert.equal(verification.escalationCommitmentVerified, true);
});

test("rejects transaction, state, balance and provider drift", () => {
  const changedTransaction = structuredClone(observations);
  changedTransaction.providers[0].transactions[2].transaction.inputKeccak256 = "0x00";
  assert.throws(() => verifyMainnetLifecycleObservations(changedTransaction), /FUND_INVOICE:SANITIZED_INPUT_COMMITMENT/);
  const leakedInput = structuredClone(observations);
  leakedInput.providers[0].transactions[2].transaction.input = "0x00";
  assert.throws(() => verifyMainnetLifecycleObservations(leakedInput), /FUND_INVOICE:SANITIZED_INPUT_COMMITMENT/);
  const changedState = structuredClone(observations);
  changedState.providers[0].calls.invoice.result = `0x${"00".repeat(352)}`;
  assert.throws(() => verifyMainnetLifecycleObservations(changedState));
  const changedBalance = structuredClone(observations);
  changedBalance.providers[0].calls.supplierAfterFunding.result = `0x${"00".repeat(32)}`;
  assert.throws(() => verifyMainnetLifecycleObservations(changedBalance), /SUPPLIER_DELTA/);
  const duplicatedProvider = structuredClone(observations);
  duplicatedProvider.providers[1].provider = duplicatedProvider.providers[0].provider;
  assert.throws(() => verifyMainnetLifecycleObservations(duplicatedProvider), /PROVIDERS_NOT_DISTINCT/);
});
