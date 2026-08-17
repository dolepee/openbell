import { readFileSync } from "node:fs";
import { keccak256, stringToHex } from "viem";
import { expect, test } from "vitest";
import { MAINNET_RECEIPT_HISTORY_BASELINE } from "../src/mainnet-receipt-history-baseline.js";
import { verifyPublicReceiptHistoryBaseline, verifyReceiptHistoryEvidenceArtifact } from "../src/mainnet-receipt-history-evidence.js";

const loadArtifact = (): Record<string, any> => JSON.parse(readFileSync(
  new URL("../../evidence/openbell-receipt-bound-history-observations.json", import.meta.url), "utf8"
));
const loadBaseline = (): Record<string, any> => JSON.parse(readFileSync(
  new URL("../../evidence/openbell-receipt-bound-history-baseline.json", import.meta.url), "utf8"
));

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const recommit = (artifact: Record<string, any>): void => {
  for (const provider of artifact.providers) {
    provider.observationCommitment = keccak256(stringToHex(canonicalJson(provider.observations)));
  }
};

test("checked-in provider observations deterministically reproduce the underwriting baseline", async () => {
  await expect(verifyReceiptHistoryEvidenceArtifact(loadArtifact())).resolves.toEqual(MAINNET_RECEIPT_HISTORY_BASELINE);
});

test("provider provenance and agreement are mandatory", async () => {
  const provenance = loadArtifact();
  provenance.providers[1].endpointCommitment = provenance.providers[0].endpointCommitment;
  await expect(verifyReceiptHistoryEvidenceArtifact(provenance)).rejects.toThrow("CONNECTED_RECEIPT_HISTORY_EVIDENCE_PROVENANCE");

  const disagreement = loadArtifact();
  disagreement.providers[1].head.hash = `0x${"ff".repeat(32)}`;
  await expect(verifyReceiptHistoryEvidenceArtifact(disagreement)).rejects.toThrow("CONNECTED_RECEIPT_HISTORY_EVIDENCE_PROVIDER_DISAGREEMENT");
});

test("tampered economic state fails even when the observation commitment is recomputed", async () => {
  const artifact = loadArtifact();
  for (const provider of artifact.providers) {
    provider.observations.calls[0].result = provider.observations.calls[0].result.replace(
      "00000000000000000000000000000000000000000000000000000000000061a8",
      "00000000000000000000000000000000000000000000000000000000000061a9"
    );
  }
  recommit(artifact);
  await expect(verifyReceiptHistoryEvidenceArtifact(artifact)).rejects.toThrow("RECEIPT_HISTORY_FUNDING_STATE_MISMATCH");
});

test("tampered scan completeness fails before economic derivation", async () => {
  const artifact = loadArtifact();
  artifact.derivation.chunksPerProvider -= 1;
  await expect(verifyReceiptHistoryEvidenceArtifact(artifact)).rejects.toThrow("CONNECTED_RECEIPT_HISTORY_EVIDENCE_SCAN");
});

test("evidence boundary disclosures are immutable", async () => {
  const removed = loadArtifact();
  removed.claimsNotProven.pop();
  await expect(verifyReceiptHistoryEvidenceArtifact(removed)).rejects.toThrow("CONNECTED_RECEIPT_HISTORY_EVIDENCE_BOUNDARY");

  const rewritten = loadArtifact();
  rewritten.claimsNotProven[1] = "Invoice documents are valid.";
  await expect(verifyReceiptHistoryEvidenceArtifact(rewritten)).rejects.toThrow("CONNECTED_RECEIPT_HISTORY_EVIDENCE_BOUNDARY");
});

test("confirmation depth is pinned to twelve rather than trusted from artifact metadata", async () => {
  const artifact = loadArtifact();
  artifact.derivation.confirmations = 1;
  for (const provider of artifact.providers) provider.head.number = `0x${BigInt(artifact.derivation.throughBlock).toString(16)}`;
  await expect(verifyReceiptHistoryEvidenceArtifact(artifact)).rejects.toThrow("CONNECTED_RECEIPT_HISTORY_EVIDENCE_HEAD");
});

test("the separately published baseline cannot drift from the same disclosure boundary", () => {
  expect(() => verifyPublicReceiptHistoryBaseline(loadBaseline())).not.toThrow();

  const removed = loadBaseline();
  removed.claimsNotProven.pop();
  expect(() => verifyPublicReceiptHistoryBaseline(removed)).toThrow("CONNECTED_RECEIPT_HISTORY_BASELINE_BOUNDARY");

  const rewritten = loadBaseline();
  rewritten.claimsNotProven[0] = "Complete global creditworthiness is proven.";
  expect(() => verifyPublicReceiptHistoryBaseline(rewritten)).toThrow("CONNECTED_RECEIPT_HISTORY_BASELINE_BOUNDARY");
});

test("the public baseline derivation and snapshot are pinned", () => {
  const shallow = loadBaseline();
  shallow.derivation.confirmations = 1;
  expect(() => verifyPublicReceiptHistoryBaseline(shallow)).toThrow("CONNECTED_RECEIPT_HISTORY_BASELINE_DERIVATION");

  const economicDrift = loadBaseline();
  economicDrift.snapshot.completedSettlements = 2;
  expect(() => verifyPublicReceiptHistoryBaseline(economicDrift)).toThrow("CONNECTED_RECEIPT_HISTORY_BASELINE_SNAPSHOT");
});
