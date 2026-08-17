import { readFileSync } from "node:fs";
import { keccak256, stringToHex } from "viem";
import { expect, test } from "vitest";
import { MAINNET_RECEIPT_HISTORY_BASELINE } from "../src/mainnet-receipt-history-baseline.js";
import { verifyReceiptHistoryEvidenceArtifact } from "../src/mainnet-receipt-history-evidence.js";

const loadArtifact = (): Record<string, any> => JSON.parse(readFileSync(
  new URL("../../evidence/openbell-receipt-bound-history-observations.json", import.meta.url), "utf8"
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
