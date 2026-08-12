import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { expectedMainnetEvidence, validateMainnetPublicEvidence } from "./lib/mainnet-public-evidence.mjs";

const clone = (value) => structuredClone(value);
const recordBytes = await readFile(new URL("../evidence/openbell-xlayer-mainnet-verification-record.json", import.meta.url));
const deterministicVerificationBytes = await readFile(new URL("../evidence/openbell-xlayer-mainnet-observation-verification.json", import.meta.url));

test("locks the complete public mainnet evidence and reproducible record hash", () => {
  assert.deepEqual(validateMainnetPublicEvidence({
    evidence: clone(expectedMainnetEvidence),
    exportedEvidence: clone(expectedMainnetEvidence),
    publicRecordBytes: recordBytes,
    deterministicVerificationBytes
  }), { publicRecordHash: "0xd5b69eb5e453fd691e7d9265ed7ce14ef81b2b19fb9ed1bf50dd4ac80670eec8" });
});

test("rejects synchronized drift of every published evidence leaf", () => {
  const paths = [];
  const visit = (value, path = []) => {
    if (value === null || typeof value !== "object") return paths.push(path);
    for (const [key, child] of Object.entries(value)) visit(child, [...path, key]);
  };
  visit(expectedMainnetEvidence);
  for (const path of paths) {
    const left = clone(expectedMainnetEvidence);
    const right = clone(expectedMainnetEvidence);
    let leftCursor = left;
    let rightCursor = right;
    for (const key of path.slice(0, -1)) {
      leftCursor = leftCursor[key];
      rightCursor = rightCursor[key];
    }
    const key = path.at(-1);
    const changed = typeof leftCursor[key] === "boolean" ? !leftCursor[key] : `${leftCursor[key]}-drift`;
    leftCursor[key] = changed;
    rightCursor[key] = changed;
    assert.throws(
      () => validateMainnetPublicEvidence({ evidence: left, exportedEvidence: right, publicRecordBytes: recordBytes, deterministicVerificationBytes }),
      /CANONICAL_DRIFT/,
      path.join(".")
    );
  }
});

test("rejects public-record byte drift and verification-boundary drift", () => {
  const drifted = Buffer.from(recordBytes);
  drifted[drifted.length - 2] = drifted[drifted.length - 2] === 32 ? 10 : 32;
  assert.throws(() => validateMainnetPublicEvidence({
    evidence: clone(expectedMainnetEvidence),
    exportedEvidence: clone(expectedMainnetEvidence),
    publicRecordBytes: drifted,
    deterministicVerificationBytes
  }), /PUBLIC_RECORD_HASH_DRIFT/);
});

test("rejects confirmation claims that are not derived from provider observations", () => {
  const drifted = JSON.parse(deterministicVerificationBytes);
  drifted.minimumObservedConfirmations = "5025";
  assert.throws(() => validateMainnetPublicEvidence({
    evidence: clone(expectedMainnetEvidence),
    exportedEvidence: clone(expectedMainnetEvidence),
    publicRecordBytes: recordBytes,
    deterministicVerificationBytes: Buffer.from(`${JSON.stringify(drifted, null, 2)}\n`)
  }), /DETERMINISTIC_VERIFICATION_HASH_DRIFT/);
});
