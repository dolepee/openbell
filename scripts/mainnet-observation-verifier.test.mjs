import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { verifyMainnetObservations } from "./lib/mainnet-observation-verifier.mjs";

const observations = JSON.parse(await readFile(new URL("../evidence/openbell-xlayer-mainnet-observations.json", import.meta.url), "utf8"));
const artifact = JSON.parse(await readFile(new URL("../out/OpenBellReceivables.sol/OpenBellReceivables.json", import.meta.url), "utf8"));
const clone = () => structuredClone(observations);

test("derives canonical deployment, runtime, configuration, and two-provider confirmation claims", () => {
  const result = verifyMainnetObservations({ observations: clone(), artifact });
  assert.equal(result.observationsSha256, "0xe8e750a45a206664b0e85db3496482232556f4b2d0a23db9073c8f4e71b77dd9");
  assert.equal(result.providerResults.length, 2);
  assert.equal(result.endpointCommitments.length, 2);
  assert.equal(result.endpointProvenanceCommitted, true);
  assert.equal(result.endpointProvenanceIndependentlyAttested, false);
  assert.ok(result.providerResults.every(({ confirmations }) => BigInt(confirmations) >= 12n));
  assert.equal(result.minimumObservedConfirmations, "5026");
  assert.equal(result.runtimeHash, "0x3aa05fd1a2f966e99324c8c24dc3ee67e2f4c11a4f3c8de0da25fc1f7e8a9798");
  assert.equal(result.configuration.settlementToken, "0x4ae46a509F6b1D9056937BA4500cb143933D2dc8");
  assert.equal(result.independentlyVerified, false);
  assert.equal(result.explorerSourceVerified, false);
});

for (const [name, mutate, error] of [
  ["transaction input", (value) => { value.providers[0].transaction.input = "0x00"; }, /TX_INPUT/],
  ["receipt status", (value) => { value.providers[0].receipt.status = "0x0"; }, /RECEIPT_STATUS/],
  ["canonical block", (value) => { value.providers[1].deploymentBlock.hash = `0x${"11".repeat(32)}`; }, /BLOCK_IDENTITY/],
  ["runtime", (value) => { value.providers[0].runtimeCode = `${value.providers[0].runtimeCode.slice(0, -2)}00`; }, /RUNTIME/],
  ["getter", (value) => { value.providers[1].calls.owner.result = `0x${"00".repeat(32)}`; }, /owner:RESULT/],
  ["confirmation depth", (value) => {
    value.providers[0].headBefore.number = "0x40a0117";
    value.providers[0].headBefore.block.number = "0x40a0117";
    value.providers[0].headAfter.number = "0x40a0117";
    value.providers[0].headAfter.block.number = "0x40a0117";
  }, /LOW_CONFIRMATIONS/]
]) {
  test(`rejects ${name} drift`, () => {
    const value = clone();
    mutate(value);
    assert.throws(() => verifyMainnetObservations({ observations: value, artifact }), error);
  });
}

test("rejects an unrelated artifact even with copied immutable offsets", () => {
  const unrelated = structuredClone(artifact);
  unrelated.deployedBytecode.object = `0x${"00".repeat(13_027)}`;
  assert.throws(() => verifyMainnetObservations({ observations: clone(), artifact: unrelated }), /ARTIFACT_RUNTIME_TEMPLATE_DRIFT/);
});

test("rejects mutable provider labels, endpoint commitment drift, and duplicated provider payloads", () => {
  const wrongEndpoint = clone();
  wrongEndpoint.providers[1].endpointCommitment = wrongEndpoint.providers[0].endpointCommitment;
  assert.throws(() => verifyMainnetObservations({ observations: wrongEndpoint, artifact }), /ENDPOINT_COMMITMENT_MISMATCH/);

  const duplicate = clone();
  const copied = structuredClone(duplicate.providers[0]);
  copied.provider = duplicate.providers[1].provider;
  copied.endpointCommitment = duplicate.providers[1].endpointCommitment;
  duplicate.providers[1] = copied;
  assert.throws(() => verifyMainnetObservations({ observations: duplicate, artifact }), /PROVIDER_PAYLOAD_COMMITMENT_MISMATCH/);
});

test("rejects ignored-field and semantically forged provider payload bypasses", () => {
  const ignoredField = clone();
  ignoredField.providers[1].ignored = "payload-distinguishing-noise";
  assert.throws(() => verifyMainnetObservations({ observations: ignoredField, artifact }), /UNKNOWN_PROVIDER_FIELD/);

  const forgedHeadHash = clone();
  const copied = structuredClone(forgedHeadHash.providers[0]);
  copied.provider = forgedHeadHash.providers[1].provider;
  copied.endpointCommitment = forgedHeadHash.providers[1].endpointCommitment;
  copied.headAfter.block.hash = `0x${"ab".repeat(32)}`;
  forgedHeadHash.providers[1] = copied;
  assert.throws(() => verifyMainnetObservations({ observations: forgedHeadHash, artifact }), /PROVIDER_PAYLOAD_COMMITMENT_MISMATCH/);
});
