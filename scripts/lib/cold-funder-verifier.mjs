import { createHash } from "node:crypto";
import { decodeEventLog, decodeFunctionData, decodeFunctionResult, encodeFunctionData, getAddress, hashTypedData, keccak256, parseAbi } from "viem";
import { OFFICIAL_ENDPOINT_COMMITMENTS, approvalTypes, fundAbi, invoiceAbi, tokenAbi } from "./mainnet-lifecycle-verifier.mjs";

export const CHAIN_ID = 196n;
export const CONTRACT = "0xc4Ef249b80a6a034198C226278c51b0a903840dd";
export const USDG = "0x4ae46a509F6b1D9056937BA4500cb143933D2dc8";
export const INVOICE_ID = "0x02f989cca9d53aa2f9078a7c3f34290a16913706a265caa7465dc447f0dc1508";
export const INVOICE_DIGEST = "0x5933c7c05cb68e6973dc065d6df2102af5564a3db172042a72799a43b52b9127";
export const DECISION_DIGEST = "0x00bef15e4503fc69d35d2d4040d63aeb4452b305af7c7a5a25167ff315986135";
export const REJECTED_ARTIFACT_HASH = "0xe52035efbe431f0b7c7cc59b37d403e9ec1e6ae53b6bf457d91933f941038a3c";
export const SUPPLIER = "0x950d3A417dbBA923b775f2BFd146163961842Bd4";
export const PAYER = "0xFc2426CDbe672B0D92aC8399a16E88422AC5b737";
export const FUNDER = "0x2Ef3530496b22B2E87F1E5702e4D1FD6b3D05244";
export const FACE_VALUE = 20_000n;
export const ADVANCE_AMOUNT = 5_000n;
export const REPAYMENT_AMOUNT = 5_050n;
export const DUE_DATE = 1_787_356_799n;
export const MINIMUM_CONFIRMATIONS = 12n;
export const FUNDING = Object.freeze({
  hash: "0xa9068afbd10fec26550883b7d52018623d7b184ad8cbdb310099a547526e030a",
  block: 68_218_206n,
  blockHash: "0xa43b0d6c6a09019e4dc0900e09ce3dc40751d6a659373f8ede4813bba34eb731",
  index: 11n,
  nonce: 4n,
  gasUsed: 174_626n,
  gasPrice: 28_600_000n,
  inputHash: "0xb89a1160ee1ca2b58c89c8bd7a77bc5e293a02a8fbca6d368c7aa7c8730392ee"
});

const fundingEventAbi = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
  "event InvoiceFunded(bytes32 indexed invoiceId,bytes32 indexed decisionDigest,address indexed funder,address supplier,uint128 advanceAmount,uint128 repaymentAmount,bytes32 riskReasonsHash,bytes32 modelHash)"
]);

export const calls = Object.freeze({
  invoice: { to: CONTRACT, block: FUNDING.block, data: encodeFunctionData({ abi: invoiceAbi, functionName: "invoices", args: [INVOICE_ID] }) },
  supplierBefore: { to: USDG, block: FUNDING.block - 1n, data: encodeFunctionData({ abi: tokenAbi, functionName: "balanceOf", args: [SUPPLIER] }) },
  supplierAfter: { to: USDG, block: FUNDING.block, data: encodeFunctionData({ abi: tokenAbi, functionName: "balanceOf", args: [SUPPLIER] }) },
  funderBefore: { to: USDG, block: FUNDING.block - 1n, data: encodeFunctionData({ abi: tokenAbi, functionName: "balanceOf", args: [FUNDER] }) },
  funderAfter: { to: USDG, block: FUNDING.block, data: encodeFunctionData({ abi: tokenAbi, functionName: "balanceOf", args: [FUNDER] }) },
  allowanceAfter: { to: USDG, block: FUNDING.block, data: encodeFunctionData({ abi: tokenAbi, functionName: "allowance", args: [FUNDER, CONTRACT] }) }
});

const lower = (value) => String(value).toLowerCase();
const quantity = (value) => BigInt(value);
const requireTrue = (condition, code) => { if (!condition) throw new Error(code); };
const sha256 = (value) => `0x${createHash("sha256").update(value).digest("hex")}`;
const decodeUint = (result, name = "balanceOf") => BigInt(decodeFunctionResult({ abi: tokenAbi, functionName: name, data: result }));

export const verifyColdFunderObservations = (observations) => {
  requireTrue(observations?.schemaVersion === "openbell-independent-cold-funder-observations-v1", "WRONG_COLD_FUNDER_SCHEMA");
  requireTrue(Array.isArray(observations.providers) && observations.providers.length === 2, "TWO_PROVIDERS_REQUIRED");
  requireTrue(new Set(observations.providers.map(({ provider }) => provider)).size === 2, "PROVIDERS_NOT_DISTINCT");
  const providerResults = [];
  for (const observation of observations.providers) {
    requireTrue(OFFICIAL_ENDPOINT_COMMITMENTS[observation.provider] === observation.endpointCommitment, `${observation.provider}:ENDPOINT_COMMITMENT`);
    requireTrue(!JSON.stringify(observation).includes("rpc.xlayer") && !JSON.stringify(observation).includes("xlayerrpc"), `${observation.provider}:ENDPOINT_LEAK`);
    requireTrue(quantity(observation.chainId) === CHAIN_ID, `${observation.provider}:WRONG_CHAIN`);
    requireTrue(quantity(observation.head.number) - FUNDING.block + 1n >= MINIMUM_CONFIRMATIONS, `${observation.provider}:LOW_CONFIRMATIONS`);
    const { transaction, receipt, block } = observation.funding;
    requireTrue(lower(transaction.hash) === lower(FUNDING.hash), `${observation.provider}:HASH`);
    requireTrue(getAddress(transaction.from) === FUNDER && getAddress(transaction.to) === CONTRACT, `${observation.provider}:PARTIES`);
    requireTrue(quantity(transaction.nonce) === FUNDING.nonce && quantity(transaction.value) === 0n && keccak256(transaction.input) === FUNDING.inputHash, `${observation.provider}:INPUT`);
    requireTrue(quantity(transaction.blockNumber) === FUNDING.block && lower(transaction.blockHash) === lower(FUNDING.blockHash) && quantity(transaction.transactionIndex) === FUNDING.index, `${observation.provider}:BLOCK`);
    requireTrue(lower(receipt.transactionHash) === lower(FUNDING.hash) && quantity(receipt.status) === 1n, `${observation.provider}:RECEIPT`);
    requireTrue(quantity(receipt.blockNumber) === FUNDING.block && lower(receipt.blockHash) === lower(FUNDING.blockHash) && quantity(receipt.transactionIndex) === FUNDING.index, `${observation.provider}:RECEIPT_BLOCK`);
    requireTrue(quantity(receipt.gasUsed) === FUNDING.gasUsed && quantity(receipt.effectiveGasPrice) === FUNDING.gasPrice && receipt.logs.length === 2, `${observation.provider}:RECEIPT_DETAILS`);
    requireTrue(quantity(block.number) === FUNDING.block && lower(block.hash) === lower(FUNDING.blockHash) && lower(block.transactions[Number(FUNDING.index)]) === lower(FUNDING.hash), `${observation.provider}:CANONICAL_INCLUSION`);
    const decoded = decodeFunctionData({ abi: fundAbi, data: transaction.input });
    const [approval, signature] = decoded.args;
    requireTrue(decoded.functionName === "fund" && signature.length === 132, `${observation.provider}:FUND_CALL_SHAPE`);
    requireTrue(lower(approval.invoiceId) === lower(INVOICE_ID) && lower(approval.invoiceDigest) === lower(INVOICE_DIGEST) && getAddress(approval.funder) === FUNDER, `${observation.provider}:APPROVAL_BINDING`);
    requireTrue(approval.advanceAmount === ADVANCE_AMOUNT && approval.repaymentAmount === REPAYMENT_AMOUNT && lower(approval.modelHash) === lower(REJECTED_ARTIFACT_HASH), `${observation.provider}:APPROVAL_ECONOMICS`);
    requireTrue(lower(hashTypedData({ domain: { name: "OpenBell Receivables", version: "1", chainId: CHAIN_ID, verifyingContract: CONTRACT }, types: approvalTypes, primaryType: "RiskApproval", message: approval })) === lower(DECISION_DIGEST), `${observation.provider}:DECISION_DIGEST`);
    const transfer = decodeEventLog({ abi: fundingEventAbi, eventName: "Transfer", topics: receipt.logs[0].topics, data: receipt.logs[0].data, strict: true });
    requireTrue(getAddress(receipt.logs[0].address) === USDG && getAddress(transfer.args.from) === FUNDER && getAddress(transfer.args.to) === SUPPLIER && transfer.args.value === ADVANCE_AMOUNT, `${observation.provider}:TRANSFER_EVENT`);
    const funded = decodeEventLog({ abi: fundingEventAbi, eventName: "InvoiceFunded", topics: receipt.logs[1].topics, data: receipt.logs[1].data, strict: true });
    requireTrue(getAddress(receipt.logs[1].address) === CONTRACT && lower(funded.args.invoiceId) === lower(INVOICE_ID) && lower(funded.args.decisionDigest) === lower(DECISION_DIGEST), `${observation.provider}:FUNDED_EVENT_BINDING`);
    requireTrue(getAddress(funded.args.funder) === FUNDER && getAddress(funded.args.supplier) === SUPPLIER && funded.args.advanceAmount === ADVANCE_AMOUNT && funded.args.repaymentAmount === REPAYMENT_AMOUNT, `${observation.provider}:FUNDED_EVENT_ECONOMICS`);
    requireTrue(lower(funded.args.riskReasonsHash) === lower(approval.riskReasonsHash) && lower(funded.args.modelHash) === lower(REJECTED_ARTIFACT_HASH), `${observation.provider}:FUNDED_EVENT_DECISION`);
    for (const [name, spec] of Object.entries(calls)) {
      const actual = observation.calls[name];
      requireTrue(getAddress(actual.to) === spec.to && quantity(actual.block) === spec.block && actual.data === spec.data, `${observation.provider}:${name}:CALL`);
    }
    const invoice = decodeFunctionResult({ abi: invoiceAbi, functionName: "invoices", data: observation.calls.invoice.result });
    requireTrue(Number(invoice[0]) === 2 && getAddress(invoice[1]) === SUPPLIER && getAddress(invoice[2]) === PAYER && getAddress(invoice[3]) === FUNDER, `${observation.provider}:FUNDED_PARTIES_STATUS`);
    requireTrue(invoice[4] === FACE_VALUE && invoice[5] === ADVANCE_AMOUNT && invoice[6] === REPAYMENT_AMOUNT && invoice[7] === DUE_DATE, `${observation.provider}:FUNDED_ECONOMICS`);
    requireTrue(lower(invoice[9]) === lower(INVOICE_DIGEST) && lower(invoice[10]) === lower(DECISION_DIGEST), `${observation.provider}:FUNDED_DIGESTS`);
    const supplierBefore = decodeUint(observation.calls.supplierBefore.result);
    const supplierAfter = decodeUint(observation.calls.supplierAfter.result);
    const funderBefore = decodeUint(observation.calls.funderBefore.result);
    const funderAfter = decodeUint(observation.calls.funderAfter.result);
    const allowanceAfter = decodeUint(observation.calls.allowanceAfter.result, "allowance");
    requireTrue(supplierAfter - supplierBefore === ADVANCE_AMOUNT && funderBefore - funderAfter === ADVANCE_AMOUNT, `${observation.provider}:EXACT_FUNDING_DELTA`);
    requireTrue(allowanceAfter === 0n, `${observation.provider}:RESIDUAL_ALLOWANCE`);
    providerResults.push({ provider: observation.provider, head: quantity(observation.head.number).toString(), headHash: observation.head.hash, confirmations: (quantity(observation.head.number) - FUNDING.block + 1n).toString() });
  }
  const comparable = observations.providers.map(({ provider: _provider, endpointCommitment: _endpoint, head: _head, ...rest }) => rest);
  requireTrue(JSON.stringify(comparable[0]) === JSON.stringify(comparable[1]), "PROVIDER_COLD_FUNDER_DISAGREEMENT");
  return {
    schemaVersion: "openbell-independent-cold-funder-verification-v1",
    observationsSha256: sha256(`${JSON.stringify(observations, null, 2)}\n`),
    chainId: CHAIN_ID.toString(), contract: CONTRACT, settlementToken: USDG,
    invoiceId: INVOICE_ID, invoiceDigest: INVOICE_DIGEST, decisionDigest: DECISION_DIGEST,
    rejectedArtifactHash: REJECTED_ARTIFACT_HASH, funder: FUNDER, supplier: SUPPLIER, payer: PAYER,
    faceValue: FACE_VALUE.toString(), advanceAmount: ADVANCE_AMOUNT.toString(), repaymentAmount: REPAYMENT_AMOUNT.toString(),
    finalStatus: "FUNDED", fundingTransactionHash: FUNDING.hash, providerResults,
    minimumObservedConfirmations: providerResults.reduce((minimum, item) => BigInt(item.confirmations) < minimum ? BigInt(item.confirmations) : minimum, BigInt(providerResults[0].confirmations)).toString(),
    canonicalInclusionVerified: true, exactFundingDeltaVerified: true, residualAllowanceZero: true,
    decisionDigestVerified: true, providerAgreement: true, endpointProvenanceCommitted: true,
    testerIndependence: "USER_ATTESTED_NOT_ONCHAIN_VERIFIABLE"
  };
};
