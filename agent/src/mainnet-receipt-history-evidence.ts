import evidence from "../../evidence/openbell-receipt-bound-history-observations.json" with { type: "json" };
import baselineEvidence from "../../evidence/openbell-receipt-bound-history-baseline.json" with { type: "json" };
import { keccak256, stringToHex } from "viem";
import { CONNECTED_MAINNET } from "./connected-underwriting.js";
import type { ReadOnlyJsonRpc } from "./confirmed-connected-observer.js";
import { MAINNET_RECEIPT_HISTORY_BASELINE } from "./mainnet-receipt-history-baseline.js";
import { deriveReceiptBoundHistory, type ReceiptBoundHistorySnapshot } from "./receipt-bound-history.js";

interface EvidenceProvider {
  readonly provider: string;
  readonly endpointCommitment: string;
  readonly observationCommitment: string;
  readonly chainId: string;
  readonly head: { readonly number: string; readonly hash: string; readonly timestamp: string };
  readonly observations: EvidenceObservations;
}

interface EvidenceLog {
  readonly address: string;
  readonly blockHash: string;
  readonly blockNumber: string;
  readonly transactionHash: string;
  readonly transactionIndex: string;
  readonly logIndex: string;
  readonly data: string;
  readonly topics: readonly string[];
  readonly removed: boolean;
}

interface EvidenceCall {
  readonly invoiceId: string;
  readonly to: string;
  readonly block: string;
  readonly data: string;
  readonly result: string;
}

interface EvidenceObservations {
  readonly logs: readonly EvidenceLog[];
  readonly calls: readonly EvidenceCall[];
  readonly blocks: readonly { readonly number: string; readonly hash: string; readonly timestamp: string }[];
}

interface ReceiptHistoryEvidence {
  readonly schemaVersion: string;
  readonly capturedAt: string;
  readonly derivation: {
    readonly fromBlock: string;
    readonly throughBlock: string;
    readonly chunkSizeBlocks: number;
    readonly chunksPerProvider: number;
    readonly confirmations: number;
    readonly totalMatchingLogsPerProvider: number;
  };
  readonly providers: readonly EvidenceProvider[];
  readonly claimsNotProven: readonly string[];
}

interface PublicBaselineEvidence {
  readonly schemaVersion: string;
  readonly capturedAt: string;
  readonly derivation: {
    readonly fromBlock: string;
    readonly throughBlock: string;
    readonly chunkSizeBlocks: number;
    readonly chunksPerProvider: number;
    readonly confirmations: number;
    readonly providerAgreementRequired: boolean;
  };
  readonly providers: readonly { readonly provider: string; readonly endpointCommitment: string }[];
  readonly snapshot: unknown;
  readonly claimsNotProven: readonly string[];
}

const ENDPOINT_COMMITMENTS = new Map([
  ["official-xlayer", "0x6dc6837936cfafdb8db23141dc98177dbd4f1c79c1557d49210b9323920fb950"],
  ["official-okx", "0xfa5659df3a429653458dace179429da5792e84e14097e98fc8e5afe67fa1148c"]
]);
const REQUIRED_CONFIRMATIONS = 12;
const REQUIRED_CAPTURED_AT = "2026-08-17T21:28:06Z";
const REQUIRED_BOUNDARY_DISCLOSURES = [
  "Global creditworthiness or liabilities outside this OpenBell contract",
  "Legal validity of any invoice document",
  "A protocol default state; overdue funded invoices are not labelled defaults",
  "Independence of wallet owners"
] as const;

const artifact = evidence as ReceiptHistoryEvidence;
const publicBaselineArtifact = baselineEvidence as PublicBaselineEvidence;
let verification: Promise<ReceiptBoundHistorySnapshot> | undefined;

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const requireExactKeys = (value: unknown, keys: readonly string[], code: string): void => {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) throw new Error(code);
};

export const verifyPublicReceiptHistoryBaseline = (input: unknown): void => {
  const candidate = input as PublicBaselineEvidence;
  const expected = {
    schemaVersion: "openbell-receipt-bound-history-baseline-v1",
    capturedAt: REQUIRED_CAPTURED_AT,
    derivation: {
      fromBlock: MAINNET_RECEIPT_HISTORY_BASELINE.fromBlock,
      throughBlock: MAINNET_RECEIPT_HISTORY_BASELINE.throughBlock,
      chunkSizeBlocks: 100,
      chunksPerProvider: 4_660,
      confirmations: REQUIRED_CONFIRMATIONS,
      providerAgreementRequired: true
    },
    providers: [...ENDPOINT_COMMITMENTS].map(([provider, endpointCommitment]) => ({ provider, endpointCommitment })),
    snapshot: MAINNET_RECEIPT_HISTORY_BASELINE,
    claimsNotProven: REQUIRED_BOUNDARY_DISCLOSURES
  };
  if (canonicalJson(candidate) !== canonicalJson(expected)) throw new Error("CONNECTED_RECEIPT_HISTORY_BASELINE_ARTIFACT");
};

const evidenceRpc = (provider: EvidenceProvider): ReadOnlyJsonRpc => ({
  label: provider.provider,
  request: async (method, params) => {
    if (method === "eth_chainId") return provider.chainId;
    if (method === "eth_blockNumber") return provider.head.number;
    if (method === "eth_getBlockByNumber") {
      const tag = String(params[0]).toLowerCase();
      const block = provider.observations.blocks.find((candidate) => candidate.number.toLowerCase() === tag);
      if (!block) throw new Error("RECEIPT_HISTORY_EVIDENCE_BLOCK_NOT_FOUND");
      return block;
    }
    if (method === "eth_getLogs") {
      const filter = params[0] as { address?: unknown; fromBlock?: unknown; toBlock?: unknown };
      if (String(filter.address).toLowerCase() !== CONNECTED_MAINNET.receivables.toLowerCase()) throw new Error("RECEIPT_HISTORY_EVIDENCE_WRONG_FILTER");
      const fromBlock = BigInt(String(filter.fromBlock));
      const toBlock = BigInt(String(filter.toBlock));
      return provider.observations.logs.filter((log) => BigInt(log.blockNumber) >= fromBlock && BigInt(log.blockNumber) <= toBlock);
    }
    if (method === "eth_call") {
      const call = params[0] as { to?: unknown; data?: unknown };
      const block = String(params[1]).toLowerCase();
      const observation = provider.observations.calls.find((candidate) => candidate.to.toLowerCase() === String(call.to).toLowerCase()
        && candidate.data.toLowerCase() === String(call.data).toLowerCase() && candidate.block.toLowerCase() === block);
      if (!observation) throw new Error("RECEIPT_HISTORY_EVIDENCE_CALL_NOT_FOUND");
      return observation.result;
    }
    throw new Error("RECEIPT_HISTORY_EVIDENCE_METHOD_NOT_ALLOWED");
  }
});

export const verifyReceiptHistoryEvidenceArtifact = async (input: unknown): Promise<ReceiptBoundHistorySnapshot> => {
  verifyPublicReceiptHistoryBaseline(publicBaselineArtifact);
  const candidate = input as ReceiptHistoryEvidence;
  requireExactKeys(candidate, ["schemaVersion", "capturedAt", "derivation", "providers", "claimsNotProven"], "CONNECTED_RECEIPT_HISTORY_EVIDENCE_SHAPE");
  requireExactKeys(candidate.derivation, ["fromBlock", "throughBlock", "chunkSizeBlocks", "chunksPerProvider", "confirmations", "totalMatchingLogsPerProvider"], "CONNECTED_RECEIPT_HISTORY_EVIDENCE_SHAPE");
  if (candidate?.schemaVersion !== "openbell-receipt-bound-history-observations-v1") throw new Error("CONNECTED_RECEIPT_HISTORY_EVIDENCE_SCHEMA");
  if (candidate.capturedAt !== REQUIRED_CAPTURED_AT
    || canonicalJson(candidate.claimsNotProven) !== canonicalJson(REQUIRED_BOUNDARY_DISCLOSURES)) throw new Error("CONNECTED_RECEIPT_HISTORY_EVIDENCE_BOUNDARY");
  if (candidate.providers.length !== 2 || new Set(candidate.providers.map(({ provider }) => provider)).size !== 2) throw new Error("CONNECTED_RECEIPT_HISTORY_EVIDENCE_PROVIDERS");
  for (const provider of candidate.providers) {
    requireExactKeys(provider, ["provider", "endpointCommitment", "observationCommitment", "chainId", "head", "observations"], "CONNECTED_RECEIPT_HISTORY_EVIDENCE_SHAPE");
    requireExactKeys(provider.head, ["number", "hash", "timestamp"], "CONNECTED_RECEIPT_HISTORY_EVIDENCE_SHAPE");
    requireExactKeys(provider.observations, ["logs", "calls", "blocks"], "CONNECTED_RECEIPT_HISTORY_EVIDENCE_SHAPE");
    for (const log of provider.observations.logs) requireExactKeys(log, ["address", "blockHash", "blockNumber", "transactionHash", "transactionIndex", "logIndex", "data", "topics", "removed"], "CONNECTED_RECEIPT_HISTORY_EVIDENCE_SHAPE");
    for (const call of provider.observations.calls) requireExactKeys(call, ["invoiceId", "to", "block", "data", "result"], "CONNECTED_RECEIPT_HISTORY_EVIDENCE_SHAPE");
    for (const block of provider.observations.blocks) requireExactKeys(block, ["number", "hash", "timestamp"], "CONNECTED_RECEIPT_HISTORY_EVIDENCE_SHAPE");
    if (provider.chainId !== "0xc4" || ENDPOINT_COMMITMENTS.get(provider.provider) !== provider.endpointCommitment) throw new Error("CONNECTED_RECEIPT_HISTORY_EVIDENCE_PROVENANCE");
    if (provider.observationCommitment !== keccak256(stringToHex(canonicalJson(provider.observations)))) throw new Error("CONNECTED_RECEIPT_HISTORY_EVIDENCE_OBSERVATION_COMMITMENT");
    if (provider.head.number !== `0x${(BigInt(candidate.derivation.throughBlock) + BigInt(REQUIRED_CONFIRMATIONS) - 1n).toString(16)}`) throw new Error("CONNECTED_RECEIPT_HISTORY_EVIDENCE_HEAD");
  }
  if (canonicalJson(candidate.providers[0]?.head) !== canonicalJson(candidate.providers[1]?.head)) throw new Error("CONNECTED_RECEIPT_HISTORY_EVIDENCE_PROVIDER_DISAGREEMENT");
  if (canonicalJson(candidate.providers[0]?.observations) !== canonicalJson(candidate.providers[1]?.observations)) throw new Error("CONNECTED_RECEIPT_HISTORY_EVIDENCE_PROVIDER_DISAGREEMENT");
  const expectedChunks = Math.ceil((Number(BigInt(candidate.derivation.throughBlock) - BigInt(candidate.derivation.fromBlock) + 1n)) / candidate.derivation.chunkSizeBlocks);
  if (candidate.derivation.confirmations !== REQUIRED_CONFIRMATIONS || candidate.derivation.chunkSizeBlocks !== 100 || candidate.derivation.chunksPerProvider !== expectedChunks
    || candidate.providers.some((provider) => candidate.derivation.totalMatchingLogsPerProvider !== provider.observations.logs.length)) throw new Error("CONNECTED_RECEIPT_HISTORY_EVIDENCE_SCAN");

  const snapshot = await deriveReceiptBoundHistory(
    candidate.providers.map(evidenceRpc) as unknown as readonly [ReadOnlyJsonRpc, ReadOnlyJsonRpc],
    MAINNET_RECEIPT_HISTORY_BASELINE.payer,
    {
      fromBlock: BigInt(candidate.derivation.fromBlock),
      throughBlock: BigInt(candidate.derivation.throughBlock),
      confirmations: BigInt(REQUIRED_CONFIRMATIONS),
      chunkBlocks: BigInt(candidate.derivation.chunkSizeBlocks)
    }
  );
  if (canonicalJson(snapshot) !== canonicalJson(MAINNET_RECEIPT_HISTORY_BASELINE)) throw new Error("CONNECTED_RECEIPT_HISTORY_EVIDENCE_MISMATCH");
  return snapshot;
};

export const verifyMainnetReceiptHistoryEvidence = (): Promise<ReceiptBoundHistorySnapshot> => {
  verification ??= verifyReceiptHistoryEvidenceArtifact(artifact);
  return verification;
};
