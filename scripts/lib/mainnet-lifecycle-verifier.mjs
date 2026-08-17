import { createHash } from "node:crypto";
import { decodeFunctionData, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, getAddress, hashTypedData, keccak256, parseAbi, parseAbiParameters } from "viem";

export const CHAIN_ID = 196n;
export const CONTRACT = "0xc4Ef249b80a6a034198C226278c51b0a903840dd";
export const USDG = "0x4ae46a509F6b1D9056937BA4500cb143933D2dc8";
export const INVOICE_ID = "0x97b5a9424799a02e456e73bad442e65545334cad44ee6b24f73c437d35767d88";
export const INVOICE_DIGEST = "0x8e9b5664af51c14523594a47326899f8efc2da711741ee6455d69cc62672d2ce";
export const DECISION_DIGEST = "0x3c93b26994011b6884928f65168190c009f5b536aff99b4825fe77bbc908ddb6";
export const REJECTED_ARTIFACT_HASH = "0x5d437f0fb6ee5e611c63eedc12b82e5b28c0cde498f41529416762ff2c868277";
export const SUPPLIER = "0x2Ef3530496b22B2E87F1E5702e4D1FD6b3D05244";
export const PAYER = "0xbad35FA6e368e90fC4faf63507F2D0A2Fdf94BAF";
export const FUNDER = "0x950d3A417dbBA923b775f2BFd146163961842Bd4";
export const FACE_VALUE = 100_000n;
export const ADVANCE_AMOUNT = 25_000n;
export const REPAYMENT_AMOUNT = 25_250n;
export const DUE_DATE = 1_787_270_399n;
export const REQUESTED_ADVANCE = 50_000n;
export const RISK_TIMESTAMP = 1_786_980_872n;
export const EXPIRES_AT = 1_786_982_672n;
export const ESCALATION_POLICY = "HUMAN_REVIEW_AFTER_MODEL_REJECTION_V1";
export const ESCALATION_MAX_FACE_BPS = 2_500n;
export const ESCALATION_MAX_REQUEST_BPS = 5_000n;
export const ESCALATION_FEE_BPS = 100n;
export const MINIMUM_CONFIRMATIONS = 12n;

export const OFFICIAL_ENDPOINT_COMMITMENTS = Object.freeze({
  "official-xlayer": "0x6dc6837936cfafdb8db23141dc98177dbd4f1c79c1557d49210b9323920fb950",
  "official-okx": "0xfa5659df3a429653458dace179429da5792e84e14097e98fc8e5afe67fa1148c"
});

export const TRANSACTIONS = Object.freeze([
  { action: "REGISTER_INVOICE", hash: "0x4d33630813698f2bbdee3e6adf386128efa6c7aee9d775edc83c22c0b7667948", from: SUPPLIER, to: CONTRACT, nonce: 2n, block: 68_207_307n, blockHash: "0x8af4d377eb8dafbcf4b71f667a9d859dadd4f9ad208b0bb8f541afedee80cce2", index: 19n, gasUsed: 280_146n, gasPrice: 28_600_000n, inputHash: "0xc7a1c1f17ccfb0d418b2a4947b52e0db43dbca1141870cb9a6e57aa557902267", logs: 1 },
  { action: "APPROVE_FUNDING", hash: "0x822b0fa4ddf74c77e9b6beb31d3c0ebe5955568c1f33426a8558ef47e934412f", from: FUNDER, to: USDG, nonce: 1n, block: 68_212_029n, blockHash: "0x1c50a7d4a227aec06c0c67de45179733215836e8967a4b9c67e6d4c3db4cf13e", index: 7n, gasUsed: 57_969n, gasPrice: 20_000_001n, inputHash: "0x610883ba30068155d6f5d6924478eef265131fafb50b2c0359a0f2eb8ffcea84", logs: 1 },
  { action: "FUND_INVOICE", hash: "0xf17ef4753d4e89f6b25e62978e3e46600850b7457a7af4383618c0dbc1eab35a", from: FUNDER, to: CONTRACT, nonce: 2n, block: 68_212_034n, blockHash: "0x80cc31e423a47d2ff8da06747976afcbc983c621505b570828f01697656f198e", index: 15n, gasUsed: 191_702n, gasPrice: 20_000_001n, inputHash: "0xcc4b878e0830d083bd3e52e6d712d9bbf25b5fdd07fa8adde521b62b0e2ce2cd", logs: 2 },
  { action: "APPROVE_SETTLEMENT", hash: "0x8fda8d63338694e5705ce537991d7be410f209b076300ae515006408d77de6fb", from: PAYER, to: USDG, nonce: 28n, block: 68_212_389n, blockHash: "0xb4e725c8cb6043a85e58bdf0547c81cefb9661ed2431b86d60560a1e2cea8cca", index: 1n, gasUsed: 57_969n, gasPrice: 28_600_000n, inputHash: "0xbe927be1b166b717744586b1543fbf9e0823e12c3ea7645b1848e168ac15caf9", logs: 1 },
  { action: "SETTLE_INVOICE", hash: "0xdd8e682a7cc7342f11e355567ccb8c99e32b926287f85ed111cbfa8d273658e5", from: PAYER, to: CONTRACT, nonce: 29n, block: 68_212_422n, blockHash: "0x4931069da1824f601533a3fda513bf5c02a982b5d88c6af8aa65ea1805a7ce12", index: 15n, gasUsed: 77_545n, gasPrice: 28_600_000n, inputHash: "0x9c53685e31e6a71806d68bd74ea87c054f05316a68fec2cc09796579ca6ddcb2", logs: 2 }
]);

export const tokenAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)"
]);

export const invoiceAbi = [{
  type: "function", name: "invoices", stateMutability: "view",
  inputs: [{ name: "invoiceId", type: "bytes32" }],
  outputs: [
    { name: "status", type: "uint8" }, { name: "supplier", type: "address" },
    { name: "payer", type: "address" }, { name: "funder", type: "address" },
    { name: "faceValue", type: "uint128" }, { name: "advanceAmount", type: "uint128" },
    { name: "repaymentAmount", type: "uint128" }, { name: "dueDate", type: "uint64" },
    { name: "documentHash", type: "bytes32" }, { name: "invoiceDigest", type: "bytes32" },
    { name: "decisionDigest", type: "bytes32" }
  ]
}];

export const approvalTypes = Object.freeze({
  RiskApproval: [
    { name: "invoiceId", type: "bytes32" }, { name: "invoiceDigest", type: "bytes32" },
    { name: "funder", type: "address" }, { name: "advanceAmount", type: "uint128" },
    { name: "repaymentAmount", type: "uint128" }, { name: "riskTimestamp", type: "uint64" },
    { name: "expiresAt", type: "uint64" }, { name: "riskReasonsHash", type: "bytes32" },
    { name: "modelHash", type: "bytes32" }, { name: "nonce", type: "uint256" }
  ]
});

export const fundAbi = parseAbi([
  "function fund((bytes32 invoiceId,bytes32 invoiceDigest,address funder,uint128 advanceAmount,uint128 repaymentAmount,uint64 riskTimestamp,uint64 expiresAt,bytes32 riskReasonsHash,bytes32 modelHash,uint256 nonce) approval,bytes underwriterSignature) returns (bytes32 decisionDigest)"
]);

export const expectedEscalationApproval = (() => {
  const riskReasonsHash = keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32 rejectedArtifactHash,string policy,uint16 maxFaceBps,uint16 maxRequestBps,uint16 feeBps,uint128 requestedAdvance,uint128 advanceAmount,uint128 repaymentAmount"),
    [REJECTED_ARTIFACT_HASH, ESCALATION_POLICY, Number(ESCALATION_MAX_FACE_BPS), Number(ESCALATION_MAX_REQUEST_BPS), Number(ESCALATION_FEE_BPS), REQUESTED_ADVANCE, ADVANCE_AMOUNT, REPAYMENT_AMOUNT]
  ));
  const nonce = BigInt(keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32 rejectedArtifactHash,address funder,uint128 advanceAmount,uint128 repaymentAmount,uint64 riskTimestamp"),
    [REJECTED_ARTIFACT_HASH, FUNDER, ADVANCE_AMOUNT, REPAYMENT_AMOUNT, RISK_TIMESTAMP]
  )));
  return Object.freeze({
    invoiceId: INVOICE_ID, invoiceDigest: INVOICE_DIGEST, funder: FUNDER,
    advanceAmount: ADVANCE_AMOUNT, repaymentAmount: REPAYMENT_AMOUNT,
    riskTimestamp: RISK_TIMESTAMP, expiresAt: EXPIRES_AT, riskReasonsHash,
    modelHash: REJECTED_ARTIFACT_HASH, nonce
  });
})();

const expectedDecisionDigest = hashTypedData({
  domain: { name: "OpenBell Receivables", version: "1", chainId: CHAIN_ID, verifyingContract: CONTRACT },
  types: approvalTypes,
  primaryType: "RiskApproval",
  message: expectedEscalationApproval
});

export const lifecycleCalls = Object.freeze({
  invoice: { to: CONTRACT, block: TRANSACTIONS[4].block, data: encodeFunctionData({ abi: invoiceAbi, functionName: "invoices", args: [INVOICE_ID] }) },
  supplierBeforeFunding: { to: USDG, block: TRANSACTIONS[2].block - 1n, data: encodeFunctionData({ abi: tokenAbi, functionName: "balanceOf", args: [SUPPLIER] }) },
  supplierAfterFunding: { to: USDG, block: TRANSACTIONS[2].block, data: encodeFunctionData({ abi: tokenAbi, functionName: "balanceOf", args: [SUPPLIER] }) },
  funderBeforeFunding: { to: USDG, block: TRANSACTIONS[2].block - 1n, data: encodeFunctionData({ abi: tokenAbi, functionName: "balanceOf", args: [FUNDER] }) },
  funderAfterFunding: { to: USDG, block: TRANSACTIONS[2].block, data: encodeFunctionData({ abi: tokenAbi, functionName: "balanceOf", args: [FUNDER] }) },
  payerBeforeSettlement: { to: USDG, block: TRANSACTIONS[4].block - 1n, data: encodeFunctionData({ abi: tokenAbi, functionName: "balanceOf", args: [PAYER] }) },
  payerAfterSettlement: { to: USDG, block: TRANSACTIONS[4].block, data: encodeFunctionData({ abi: tokenAbi, functionName: "balanceOf", args: [PAYER] }) },
  funderBeforeSettlement: { to: USDG, block: TRANSACTIONS[4].block - 1n, data: encodeFunctionData({ abi: tokenAbi, functionName: "balanceOf", args: [FUNDER] }) },
  funderAfterSettlement: { to: USDG, block: TRANSACTIONS[4].block, data: encodeFunctionData({ abi: tokenAbi, functionName: "balanceOf", args: [FUNDER] }) },
  funderAllowanceAfter: { to: USDG, block: TRANSACTIONS[4].block, data: encodeFunctionData({ abi: tokenAbi, functionName: "allowance", args: [FUNDER, CONTRACT] }) },
  payerAllowanceAfter: { to: USDG, block: TRANSACTIONS[4].block, data: encodeFunctionData({ abi: tokenAbi, functionName: "allowance", args: [PAYER, CONTRACT] }) }
});

const lower = (value) => String(value).toLowerCase();
const quantity = (value) => BigInt(value);
const requireTrue = (condition, code) => { if (!condition) throw new Error(code); };
const sha256 = (value) => `0x${createHash("sha256").update(value).digest("hex")}`;
const decodeUint = (result, functionName = "balanceOf") => BigInt(decodeFunctionResult({ abi: tokenAbi, functionName, data: result }));

export const verifyMainnetLifecycleObservations = (observations) => {
  requireTrue(observations?.schemaVersion === "openbell-xlayer-mainnet-lifecycle-observations-v1", "WRONG_LIFECYCLE_SCHEMA");
  requireTrue(Array.isArray(observations.providers) && observations.providers.length === 2, "TWO_PROVIDERS_REQUIRED");
  requireTrue(new Set(observations.providers.map(({ provider }) => provider)).size === 2, "PROVIDERS_NOT_DISTINCT");
  requireTrue(expectedDecisionDigest === DECISION_DIGEST, "ESCALATION_DIGEST_MISMATCH");
  requireTrue(ADVANCE_AMOUNT <= REQUESTED_ADVANCE * ESCALATION_MAX_REQUEST_BPS / 10_000n && ADVANCE_AMOUNT <= FACE_VALUE * ESCALATION_MAX_FACE_BPS / 10_000n, "ESCALATION_CAP_EXCEEDED");
  requireTrue(REPAYMENT_AMOUNT === ADVANCE_AMOUNT + ADVANCE_AMOUNT * ESCALATION_FEE_BPS / 10_000n, "ESCALATION_FEE_MISMATCH");
  const providerResults = [];
  for (const observation of observations.providers) {
    requireTrue(OFFICIAL_ENDPOINT_COMMITMENTS[observation.provider] === observation.endpointCommitment, `${observation.provider}:ENDPOINT_COMMITMENT`);
    requireTrue(!JSON.stringify(observation).includes("rpc.xlayer") && !JSON.stringify(observation).includes("xlayerrpc"), `${observation.provider}:ENDPOINT_LEAK`);
    requireTrue(quantity(observation.chainId) === CHAIN_ID, `${observation.provider}:WRONG_CHAIN`);
    requireTrue(quantity(observation.head.number) - TRANSACTIONS.at(-1).block + 1n >= MINIMUM_CONFIRMATIONS, `${observation.provider}:LOW_CONFIRMATIONS`);
    requireTrue(observation.transactions.length === TRANSACTIONS.length, `${observation.provider}:TRANSACTION_COUNT`);
    for (let index = 0; index < TRANSACTIONS.length; index += 1) {
      const expected = TRANSACTIONS[index];
      const actual = observation.transactions[index];
      requireTrue(actual.action === expected.action && lower(actual.transaction.hash) === lower(expected.hash), `${observation.provider}:${expected.action}:HASH`);
      requireTrue(getAddress(actual.transaction.from) === expected.from && getAddress(actual.transaction.to) === expected.to, `${observation.provider}:${expected.action}:PARTIES`);
      requireTrue(quantity(actual.transaction.nonce) === expected.nonce && quantity(actual.transaction.value) === 0n && keccak256(actual.transaction.input) === expected.inputHash, `${observation.provider}:${expected.action}:INPUT`);
      requireTrue(quantity(actual.transaction.blockNumber) === expected.block && lower(actual.transaction.blockHash) === lower(expected.blockHash) && quantity(actual.transaction.transactionIndex) === expected.index, `${observation.provider}:${expected.action}:BLOCK`);
      requireTrue(lower(actual.receipt.transactionHash) === lower(expected.hash) && quantity(actual.receipt.status) === 1n, `${observation.provider}:${expected.action}:RECEIPT`);
      requireTrue(quantity(actual.receipt.blockNumber) === expected.block && lower(actual.receipt.blockHash) === lower(expected.blockHash) && quantity(actual.receipt.transactionIndex) === expected.index, `${observation.provider}:${expected.action}:RECEIPT_BLOCK`);
      requireTrue(quantity(actual.receipt.gasUsed) === expected.gasUsed && quantity(actual.receipt.effectiveGasPrice) === expected.gasPrice && actual.receipt.logs.length === expected.logs, `${observation.provider}:${expected.action}:RECEIPT_DETAILS`);
      requireTrue(quantity(actual.block.number) === expected.block && lower(actual.block.hash) === lower(expected.blockHash) && lower(actual.block.transactions[Number(expected.index)]) === lower(expected.hash), `${observation.provider}:${expected.action}:CANONICAL_INCLUSION`);
    }
    const fundingCall = decodeFunctionData({ abi: fundAbi, data: observation.transactions[2].transaction.input });
    const [approval, underwriterSignature] = fundingCall.args;
    requireTrue(fundingCall.functionName === "fund" && underwriterSignature.length === 132, `${observation.provider}:FUND_CALL_SHAPE`);
    for (const [field, expected] of Object.entries(expectedEscalationApproval)) {
      const actual = approval[field];
      requireTrue(typeof expected === "bigint" ? actual === expected : lower(actual) === lower(expected), `${observation.provider}:ESCALATION_${field.toUpperCase()}`);
    }
    for (const [name, spec] of Object.entries(lifecycleCalls)) {
      const actual = observation.calls[name];
      requireTrue(actual.to === spec.to && quantity(actual.block) === spec.block && actual.data === spec.data, `${observation.provider}:${name}:CALL`);
    }
    const invoice = decodeFunctionResult({ abi: invoiceAbi, functionName: "invoices", data: observation.calls.invoice.result });
    requireTrue(Number(invoice[0]) === 3 && getAddress(invoice[1]) === SUPPLIER && getAddress(invoice[2]) === PAYER && getAddress(invoice[3]) === FUNDER, `${observation.provider}:FINAL_PARTIES_STATUS`);
    requireTrue(invoice[4] === FACE_VALUE && invoice[5] === ADVANCE_AMOUNT && invoice[6] === REPAYMENT_AMOUNT && invoice[7] === DUE_DATE, `${observation.provider}:FINAL_ECONOMICS`);
    requireTrue(lower(invoice[9]) === lower(INVOICE_DIGEST) && lower(invoice[10]) === lower(DECISION_DIGEST), `${observation.provider}:FINAL_DIGESTS`);
    const balances = Object.fromEntries(Object.entries(observation.calls).filter(([name]) => name !== "invoice").map(([name, call]) => [name, decodeUint(call.result, name.includes("Allowance") ? "allowance" : "balanceOf")]));
    requireTrue(balances.supplierAfterFunding - balances.supplierBeforeFunding === ADVANCE_AMOUNT, `${observation.provider}:SUPPLIER_DELTA`);
    requireTrue(balances.funderBeforeFunding - balances.funderAfterFunding === ADVANCE_AMOUNT, `${observation.provider}:FUNDER_ADVANCE_DELTA`);
    requireTrue(balances.payerBeforeSettlement - balances.payerAfterSettlement === REPAYMENT_AMOUNT, `${observation.provider}:PAYER_REPAYMENT_DELTA`);
    requireTrue(balances.funderAfterSettlement - balances.funderBeforeSettlement === REPAYMENT_AMOUNT, `${observation.provider}:FUNDER_REPAYMENT_DELTA`);
    requireTrue(balances.funderAllowanceAfter === 0n && balances.payerAllowanceAfter === 0n, `${observation.provider}:RESIDUAL_ALLOWANCE`);
    providerResults.push({ provider: observation.provider, head: quantity(observation.head.number).toString(), headHash: observation.head.hash, confirmations: (quantity(observation.head.number) - TRANSACTIONS.at(-1).block + 1n).toString() });
  }
  const comparable = observations.providers.map(({ provider: _provider, endpointCommitment: _endpoint, head: _head, ...rest }) => rest);
  requireTrue(JSON.stringify(comparable[0]) === JSON.stringify(comparable[1]), "PROVIDER_LIFECYCLE_DISAGREEMENT");
  return {
    schemaVersion: "openbell-xlayer-mainnet-lifecycle-verification-v1",
    observationsSha256: sha256(`${JSON.stringify(observations, null, 2)}\n`),
    chainId: CHAIN_ID.toString(), contract: CONTRACT, settlementToken: USDG,
    invoiceId: INVOICE_ID, invoiceDigest: INVOICE_DIGEST, decisionDigest: DECISION_DIGEST,
    rejectedArtifactHash: REJECTED_ARTIFACT_HASH,
    faceValue: FACE_VALUE.toString(), advanceAmount: ADVANCE_AMOUNT.toString(), repaymentAmount: REPAYMENT_AMOUNT.toString(),
    finalStatus: "SETTLED", providerResults,
    minimumObservedConfirmations: providerResults.reduce((minimum, item) => BigInt(item.confirmations) < minimum ? BigInt(item.confirmations) : minimum, BigInt(providerResults[0].confirmations)).toString(),
    transactionHashes: TRANSACTIONS.map(({ action, hash }) => ({ action, hash })),
    escalationPolicy: ESCALATION_POLICY, escalationCommitmentVerified: true,
    exactFundingDeltaVerified: true, exactRepaymentDeltaVerified: true, residualAllowancesZero: true,
    providerAgreement: true, endpointProvenanceCommitted: true, independentlyVerified: false
  };
};
