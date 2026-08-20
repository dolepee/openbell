import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { keccak256, stringToHex } from "viem";
import { scanPublicText } from "./check-public-boundary.mjs";
import { verifyMainnetLifecycleObservations } from "./lib/mainnet-lifecycle-verifier.mjs";

const observations = JSON.parse(await readFile(new URL("../evidence/openbell-xlayer-mainnet-lifecycle-observations.json", import.meta.url), "utf8"));
const verification = JSON.parse(await readFile(new URL("../evidence/openbell-xlayer-mainnet-lifecycle-verification.json", import.meta.url), "utf8"));

const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

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

test("publishes the settled pilot's complete rejection commitment preimage", async () => {
  const [source, exported] = await Promise.all([
    readFile(new URL("../evidence/openbell-settled-pilot-rejection.json", import.meta.url), "utf8"),
    readFile(new URL("../web/data/openbell-settled-pilot-rejection.json", import.meta.url), "utf8")
  ]);
  assert.equal(exported, source);
  const artifact = JSON.parse(source);
  const { artifactHash, ...commitmentPreimage } = artifact;
  assert.equal(keccak256(stringToHex(canonicalJson(commitmentPreimage))), artifactHash);
  assert.equal(artifactHash, verification.rejectedArtifactHash);
  assert.equal(artifact.decision.invoiceId, verification.invoiceId);
  assert.equal(artifact.observation.invoiceId, verification.invoiceId);
  assert.equal(artifact.decision.verdict, "REJECT");

  const envelope = JSON.parse(artifact.modelEvidence.rawResponse);
  const rawDecision = JSON.parse(envelope.choices[0].message.content);
  assert.equal(keccak256(stringToHex(artifact.modelEvidence.rawResponse)), artifact.modelEvidence.responseHash);
  assert.equal(envelope.id, artifact.modelEvidence.providerResponseId);
  assert.equal(envelope.model, artifact.modelEvidence.returnedModel);
  assert.deepEqual(rawDecision, artifact.modelEvidence.decision);
  assert.equal(rawDecision.verdict, "REJECT");

  const forbiddenKeys = new Set([
    "apikey", "authorization", "bearer", "calldata", "invoicetext", "mnemonic", "privatekey",
    "rawtransaction", "requestbody", "requestjson", "secret", "signature", "signedtransaction",
    "supplierauthorization", "transactioninput", "underwritersignature"
  ]);
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key.toLowerCase()), false, `forbidden public key: ${key}`);
      walk(entry);
    }
  };
  walk(artifact);
  walk(envelope);
  assert.deepEqual(scanPublicText({
    path: "evidence/openbell-settled-pilot-rejection.json#decoded-provider-response",
    text: JSON.stringify(envelope)
  }), []);
  assert.throws(() => walk({ signature: `0x${"ab".repeat(65)}` }), /forbidden public key: signature/);
  assert.doesNotMatch(source, /BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY|https?:\/\/[^\s"']+:[^\s"']+@/i);
});
