import { createHash } from "node:crypto";
import { decodeFunctionResult, encodeFunctionData, getAddress, keccak256, toHex } from "viem";

export const MAINNET_CHAIN_ID = 196n;
export const DEPLOYMENT_TX = "0x328c80d5c4e5a7a13c3143f1f3c5667f83823c3ebdfbd3ca1d9c07b7f3af413e";
export const DEPLOYER = "0x950d3A417dbBA923b775f2BFd146163961842Bd4";
export const CONTRACT = "0xc4Ef249b80a6a034198C226278c51b0a903840dd";
export const DEPLOYMENT_BLOCK = 67_764_503n;
export const DEPLOYMENT_BLOCK_HASH = "0x67cf875f763a6916059440eda93ad0fe93e9d173299c48df6b490e33c344ce8a";
export const INITCODE_HASH = "0x68375ec447e855253481f40d20ddf3eec94bba204f3037c3304109669f5d370f";
export const RUNTIME_HASH = "0x3aa05fd1a2f966e99324c8c24dc3ee67e2f4c11a4f3c8de0da25fc1f7e8a9798";
export const TEMPLATE_HASH = "0x544f9e4fcad1f9ebf4e80b46ea130a52a35b63ca8b1c028394c86219ecda7cb3";
export const MINIMUM_CONFIRMATIONS = 12n;
export const OFFICIAL_ENDPOINT_COMMITMENTS = Object.freeze({
  "official-xlayer": "0x6dc6837936cfafdb8db23141dc98177dbd4f1c79c1557d49210b9323920fb950",
  "official-okx": "0xfa5659df3a429653458dace179429da5792e84e14097e98fc8e5afe67fa1148c"
});
export const OFFICIAL_PROVIDER_PAYLOAD_COMMITMENTS = Object.freeze({
  "official-xlayer": "0xfb070a0738e55afcc85895ea5e4119b71497a741fa890fe2e21e75dcd20118d5",
  "official-okx": "0x7072b30659a6197ca02380f8a4240a8720aba755f0633284d805e44e6e880ac2"
});

const lower = (value) => String(value).toLowerCase();
const quantity = (value) => BigInt(value);
const requireTrue = (condition, code) => { if (!condition) throw new Error(code); };
const sha256 = (value) => `0x${createHash("sha256").update(value).digest("hex")}`;
const canonical = (value) => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const canonicalSha256 = (value) => sha256(JSON.stringify(canonical(value)));
const requireExactKeys = (value, keys, code) => {
  requireTrue(value !== null && typeof value === "object" && !Array.isArray(value), code);
  requireTrue(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()), code);
};

const providerKeys = ["provider", "endpointCommitment", "chainId", "headBefore", "headAfter", "transaction", "receipt", "deploymentBlock", "deploymentBlockByHash", "runtimeCode", "calls"];
const headKeys = ["number", "block"];
const headBlockKeys = ["number", "hash"];
const transactionKeys = ["hash", "from", "to", "nonce", "value", "input", "blockNumber", "blockHash", "transactionIndex"];
const receiptKeys = ["transactionHash", "contractAddress", "from", "to", "status", "blockNumber", "blockHash", "transactionIndex", "gasUsed", "effectiveGasPrice"];
const blockKeys = ["number", "hash", "transactions"];
const callKeys = ["data", "result"];

export const getterSpecs = [
  ["settlementToken", [{ type: "address" }]],
  ["owner", [{ type: "address" }]],
  ["pendingOwner", [{ type: "address" }]],
  ["underwriter", [{ type: "address" }]],
  ["paused", [{ type: "bool" }]],
  ["BPS", [{ type: "uint16" }]],
  ["maxAdvanceBps", [{ type: "uint16" }]],
  ["maxFeeBps", [{ type: "uint16" }]],
  ["maxRiskAge", [{ type: "uint64" }]],
  ["maxInvoiceAge", [{ type: "uint64" }]],
  ["maxInvoiceTenor", [{ type: "uint64" }]],
  ["INVOICE_TYPEHASH", [{ type: "bytes32" }]],
  ["APPROVAL_TYPEHASH", [{ type: "bytes32" }]],
  ["REJECTION_TYPEHASH", [{ type: "bytes32" }]],
  ["eip712Domain", [
    { name: "fields", type: "bytes1" }, { name: "name", type: "string" },
    { name: "version", type: "string" }, { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" }, { name: "salt", type: "bytes32" },
    { name: "extensions", type: "uint256[]" }
  ]]
];

export const getterAbi = (name, outputs) => [{ type: "function", name, stateMutability: "view", inputs: [], outputs }];

const plain = (value) => typeof value === "bigint" ? value.toString() : Array.isArray(value) ? value.map(plain) : value;

const expectedGetters = {
  settlementToken: "0x4ae46a509F6b1D9056937BA4500cb143933D2dc8",
  owner: "0xFc2426CDbe672B0D92aC8399a16E88422AC5b737",
  pendingOwner: "0x0000000000000000000000000000000000000000",
  underwriter: "0x0eeC6255E87c3a8A1E251D94Ae3394FdD118cEE5",
  paused: false,
  BPS: 10_000,
  maxAdvanceBps: 8_000,
  maxFeeBps: 2_000,
  maxRiskAge: "3600",
  maxInvoiceAge: "604800",
  maxInvoiceTenor: "7776000",
  INVOICE_TYPEHASH: "0x3fa7362141ca2043801d61b9efee211fcbc943d3c40221f3ef30e1c50e933686",
  APPROVAL_TYPEHASH: "0x0237a21cd055f0c6cd3ddb0b019ef5b9df26dcd8f5ddeaa837de0477b1d7be2f",
  REJECTION_TYPEHASH: "0xc37ca47ab045a2d5cbd3c6754a2261ef43266e00880b7d707bc3daef81dd9a65",
  eip712Domain: ["0x0f", "OpenBell Receivables", "1", "196", CONTRACT, `0x${"00".repeat(32)}`, []]
};

const normalizeRuntime = (runtime, immutableReferences) => {
  const bytes = Buffer.from(runtime.slice(2), "hex");
  for (const ranges of Object.values(immutableReferences)) {
    for (const { start, length } of ranges) bytes.fill(0, start, start + length);
  }
  return toHex(bytes);
};

export const verifyMainnetObservations = ({ observations, artifact }) => {
  requireExactKeys(observations, ["schemaVersion", "providers"], "UNKNOWN_OBSERVATION_FIELD");
  requireTrue(observations?.schemaVersion === "openbell-xlayer-mainnet-observations-v1", "WRONG_OBSERVATION_SCHEMA");
  requireTrue(Array.isArray(observations.providers) && observations.providers.length === 2, "TWO_PROVIDERS_REQUIRED");
  for (const observation of observations.providers) {
    requireExactKeys(observation, providerKeys, `${observation.provider ?? "unknown"}:UNKNOWN_PROVIDER_FIELD`);
    requireExactKeys(observation.headBefore, headKeys, `${observation.provider}:UNKNOWN_HEAD_BEFORE_FIELD`);
    requireExactKeys(observation.headAfter, headKeys, `${observation.provider}:UNKNOWN_HEAD_AFTER_FIELD`);
    requireExactKeys(observation.headBefore.block, headBlockKeys, `${observation.provider}:UNKNOWN_HEAD_BEFORE_BLOCK_FIELD`);
    requireExactKeys(observation.headAfter.block, headBlockKeys, `${observation.provider}:UNKNOWN_HEAD_AFTER_BLOCK_FIELD`);
    requireExactKeys(observation.transaction, transactionKeys, `${observation.provider}:UNKNOWN_TRANSACTION_FIELD`);
    requireExactKeys(observation.receipt, receiptKeys, `${observation.provider}:UNKNOWN_RECEIPT_FIELD`);
    requireExactKeys(observation.deploymentBlock, blockKeys, `${observation.provider}:UNKNOWN_DEPLOYMENT_BLOCK_FIELD`);
    requireExactKeys(observation.deploymentBlockByHash, blockKeys, `${observation.provider}:UNKNOWN_DEPLOYMENT_BLOCK_BY_HASH_FIELD`);
    requireExactKeys(observation.calls, getterSpecs.map(([name]) => name), `${observation.provider}:UNKNOWN_CALL_FIELD`);
    for (const [name] of getterSpecs) requireExactKeys(observation.calls[name], callKeys, `${observation.provider}:${name}:UNKNOWN_CALL_RESULT_FIELD`);
  }
  requireTrue(new Set(observations.providers.map(({ provider }) => provider)).size === 2, "PROVIDERS_NOT_DISTINCT");
  requireTrue(observations.providers.every(({ provider, endpointCommitment }) => OFFICIAL_ENDPOINT_COMMITMENTS[provider] === endpointCommitment), "ENDPOINT_COMMITMENT_MISMATCH");
  requireTrue(new Set(observations.providers.map(({ endpointCommitment }) => endpointCommitment)).size === 2, "ENDPOINTS_NOT_DISTINCT");
  requireTrue(artifact?.deployedBytecode?.object?.startsWith("0x"), "ARTIFACT_RUNTIME_REQUIRED");
  const normalizedArtifactRuntime = normalizeRuntime(artifact.deployedBytecode.object, artifact.deployedBytecode.immutableReferences);
  requireTrue(keccak256(normalizedArtifactRuntime) === TEMPLATE_HASH, "ARTIFACT_RUNTIME_TEMPLATE_DRIFT");
  const results = [];
  for (const observation of observations.providers) {
    requireTrue(!("url" in observation) && !JSON.stringify(observation).includes("rpc.xlayer"), "RPC_ENDPOINT_NOT_SANITIZED");
    requireTrue(quantity(observation.chainId) === MAINNET_CHAIN_ID, `${observation.provider}:WRONG_CHAIN`);
    requireTrue(quantity(observation.headAfter.number) >= quantity(observation.headBefore.number), `${observation.provider}:TIP_REGRESSION`);
    requireTrue(quantity(observation.headAfter.number) - DEPLOYMENT_BLOCK + 1n >= MINIMUM_CONFIRMATIONS, `${observation.provider}:LOW_CONFIRMATIONS`);
    requireTrue(quantity(observation.headAfter.block.number) === quantity(observation.headAfter.number), `${observation.provider}:HEAD_BLOCK_NUMBER`);
    const tx = observation.transaction;
    requireTrue(lower(tx.hash) === lower(DEPLOYMENT_TX) && getAddress(tx.from) === DEPLOYER && tx.to === null, `${observation.provider}:TX_ENVELOPE`);
    requireTrue(quantity(tx.nonce) === 0n && quantity(tx.value) === 0n && keccak256(tx.input) === INITCODE_HASH, `${observation.provider}:TX_INPUT`);
    requireTrue(quantity(tx.blockNumber) === DEPLOYMENT_BLOCK && lower(tx.blockHash) === lower(DEPLOYMENT_BLOCK_HASH) && quantity(tx.transactionIndex) === 20n, `${observation.provider}:TX_BLOCK`);
    const receipt = observation.receipt;
    requireTrue(lower(receipt.transactionHash) === lower(DEPLOYMENT_TX) && getAddress(receipt.contractAddress) === CONTRACT, `${observation.provider}:RECEIPT_IDENTITY`);
    requireTrue(getAddress(receipt.from) === DEPLOYER && receipt.to === null && quantity(receipt.status) === 1n, `${observation.provider}:RECEIPT_STATUS`);
    requireTrue(quantity(receipt.blockNumber) === DEPLOYMENT_BLOCK && lower(receipt.blockHash) === lower(DEPLOYMENT_BLOCK_HASH) && quantity(receipt.transactionIndex) === 20n, `${observation.provider}:RECEIPT_BLOCK`);
    requireTrue(quantity(receipt.gasUsed) === 2_936_662n && quantity(receipt.effectiveGasPrice) === 20_000_000n, `${observation.provider}:RECEIPT_GAS`);
    const block = observation.deploymentBlock;
    requireTrue(quantity(block.number) === DEPLOYMENT_BLOCK && lower(block.hash) === lower(DEPLOYMENT_BLOCK_HASH), `${observation.provider}:BLOCK_IDENTITY`);
    requireTrue(lower(block.transactions[20]) === lower(DEPLOYMENT_TX) && quantity(observation.deploymentBlockByHash.number) === DEPLOYMENT_BLOCK && lower(observation.deploymentBlockByHash.hash) === lower(DEPLOYMENT_BLOCK_HASH), `${observation.provider}:BLOCK_INCLUSION`);
    requireTrue((observation.runtimeCode.length - 2) / 2 === 13_027 && keccak256(observation.runtimeCode) === RUNTIME_HASH, `${observation.provider}:RUNTIME`);
    const normalizedObservedRuntime = normalizeRuntime(observation.runtimeCode, artifact.deployedBytecode.immutableReferences);
    requireTrue(normalizedObservedRuntime === normalizedArtifactRuntime && keccak256(normalizedObservedRuntime) === TEMPLATE_HASH, `${observation.provider}:RUNTIME_TEMPLATE`);
    const decoded = {};
    for (const [name, outputs] of getterSpecs) {
      const abi = getterAbi(name, outputs);
      const expectedCall = encodeFunctionData({ abi, functionName: name });
      requireTrue(observation.calls[name]?.data === expectedCall, `${observation.provider}:${name}:CALLDATA`);
      decoded[name] = plain(decodeFunctionResult({ abi, functionName: name, data: observation.calls[name].result }));
      requireTrue(JSON.stringify(decoded[name]) === JSON.stringify(expectedGetters[name]), `${observation.provider}:${name}:RESULT`);
    }
    results.push({ provider: observation.provider, head: observation.headAfter.number, headHash: observation.headAfter.block.hash, confirmations: (quantity(observation.headAfter.number) - DEPLOYMENT_BLOCK + 1n).toString(), decodedGetters: decoded });
  }
  const payloadCommitments = observations.providers.map(({ provider, endpointCommitment: _endpoint, ...payload }) => {
    const commitment = canonicalSha256(payload);
    requireTrue(OFFICIAL_PROVIDER_PAYLOAD_COMMITMENTS[provider] === commitment, `${provider}:PROVIDER_PAYLOAD_COMMITMENT_MISMATCH`);
    return commitment;
  });
  requireTrue(new Set(payloadCommitments).size === 2, "PROVIDER_PAYLOADS_DUPLICATED");
  requireTrue(JSON.stringify(results[0].decodedGetters) === JSON.stringify(results[1].decodedGetters), "PROVIDER_GETTER_DISAGREEMENT");
  const minimumObservedConfirmations = results.reduce((minimum, result) => {
    const value = quantity(result.confirmations);
    return minimum === undefined || value < minimum ? value : minimum;
  }, undefined);
  return {
    schemaVersion: "openbell-xlayer-mainnet-observation-verification-v1",
    observationsSha256: sha256(`${JSON.stringify(observations, null, 2)}\n`),
    providerResults: results.map(({ decodedGetters: _ignored, ...result }) => result),
    endpointCommitments: observations.providers.map(({ provider, endpointCommitment }) => ({ provider, endpointCommitment })),
    minimumObservedConfirmations: minimumObservedConfirmations.toString(),
    chainId: MAINNET_CHAIN_ID.toString(),
    transactionHash: DEPLOYMENT_TX,
    contract: CONTRACT,
    blockNumber: DEPLOYMENT_BLOCK.toString(),
    blockHash: DEPLOYMENT_BLOCK_HASH,
    runtimeHash: RUNTIME_HASH,
    runtimeTemplateHash: TEMPLATE_HASH,
    configuration: expectedGetters,
    transactionReceiptCanonical: true,
    runtimeArtifactCompatible: true,
    configurationAndDomainVerified: true,
    endpointProvenanceCommitted: true,
    endpointProvenanceIndependentlyAttested: false,
    independentlyVerified: false,
    explorerSourceVerified: false
  };
};
