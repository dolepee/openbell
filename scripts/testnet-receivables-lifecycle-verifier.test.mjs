import assert from "node:assert/strict";
import test from "node:test";

import { privateKeyToAccount } from "viem/accounts";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  hashTypedData,
  keccak256,
  parseAbiParameters,
  stringToHex
} from "viem";

import {
  createReadOnlyLifecycleProvider,
  LIFECYCLE_EXECUTION_SCHEMA,
  lifecycleVerifierAbis,
  verifyXLayerTestnetReceivablesLifecycle
} from "./lib/testnet-receivables-lifecycle-verifier.mjs";

const { tokenAbi, receivablesAbi } = lifecycleVerifierAbis;
const token = "0x7E7a189a8CE288E9581Ba3CDf14ac3D4a1624703";
const receivables = "0x7eb9C2418ec935d43E6761e462eAA5388BD6ca18";
const supplierAccount = privateKeyToAccount(`0x${"11".repeat(32)}`);
const payerAccount = privateKeyToAccount(`0x${"22".repeat(32)}`);
const funderAccount = privateKeyToAccount(`0x${"33".repeat(32)}`);
const underwriterAccount = privateKeyToAccount(`0x${"44".repeat(32)}`);
const zero = "0x0000000000000000000000000000000000000000";
const bytes32 = (label) => keccak256(stringToHex(label));
const hashes = Array.from({ length: 9 }, (_, index) => bytes32(`transaction-${index}`));
const invoiceTypes = { InvoiceTerms: [
  { name: "invoiceId", type: "bytes32" }, { name: "documentHash", type: "bytes32" },
  { name: "supplier", type: "address" }, { name: "payer", type: "address" },
  { name: "faceValue", type: "uint128" }, { name: "issuedAt", type: "uint64" },
  { name: "dueDate", type: "uint64" }, { name: "nonce", type: "uint256" }
] };
const rejectionTypes = { RiskRejection: [
  { name: "invoiceId", type: "bytes32" }, { name: "invoiceDigest", type: "bytes32" },
  { name: "riskTimestamp", type: "uint64" }, { name: "expiresAt", type: "uint64" },
  { name: "riskReasonsHash", type: "bytes32" }, { name: "modelHash", type: "bytes32" },
  { name: "nonce", type: "uint256" }
] };
const approvalTypes = { RiskApproval: [
  { name: "invoiceId", type: "bytes32" }, { name: "invoiceDigest", type: "bytes32" },
  { name: "funder", type: "address" }, { name: "advanceAmount", type: "uint128" },
  { name: "repaymentAmount", type: "uint128" }, { name: "riskTimestamp", type: "uint64" },
  { name: "expiresAt", type: "uint64" }, { name: "riskReasonsHash", type: "bytes32" },
  { name: "modelHash", type: "bytes32" }, { name: "nonce", type: "uint256" }
] };
const domain = { name: "OpenBell Receivables", version: "1", chainId: 1952, verifyingContract: receivables };

const eventLog = (abi, eventName, args) => {
  const event = abi.find((entry) => entry.type === "event" && entry.name === eventName);
  const indexed = Object.fromEntries(event.inputs.filter((input) => input.indexed).map((input) => [input.name, args[input.name]]));
  const ordinary = event.inputs.filter((input) => !input.indexed);
  return {
    address: abi === tokenAbi ? token : receivables,
    topics: encodeEventTopics({ abi, eventName, args: indexed }),
    data: ordinary.length === 0 ? "0x" : encodeAbiParameters(ordinary, ordinary.map((input) => args[input.name]))
  };
};

const buildPacket = async () => {
  const rejectedTerms = { invoiceId: bytes32("rejected"), documentHash: bytes32("rejected-document"), supplier: supplierAccount.address, payer: payerAccount.address, faceValue: 100_000_000n, issuedAt: 1_780_000_000n, dueDate: 1_782_592_000n, nonce: 1n };
  const approvedTerms = { ...rejectedTerms, invoiceId: bytes32("approved"), documentHash: bytes32("approved-document"), nonce: 2n };
  const makeInvoice = async (terms) => ({
    terms,
    invoiceDigest: hashTypedData({ domain, types: invoiceTypes, primaryType: "InvoiceTerms", message: terms }),
    supplierSignature: await supplierAccount.signTypedData({ domain, types: invoiceTypes, primaryType: "InvoiceTerms", message: terms }),
    payerSignature: await payerAccount.signTypedData({ domain, types: invoiceTypes, primaryType: "InvoiceTerms", message: terms })
  });
  const rejected = await makeInvoice(rejectedTerms);
  const approved = await makeInvoice(approvedTerms);
  const rejection = { invoiceId: rejectedTerms.invoiceId, invoiceDigest: rejected.invoiceDigest, riskTimestamp: 1_780_000_100n, expiresAt: 1_780_003_700n, riskReasonsHash: bytes32("prior-default"), modelHash: bytes32("genuine-rejection"), nonce: 1n };
  const approval = { invoiceId: approvedTerms.invoiceId, invoiceDigest: approved.invoiceDigest, funder: funderAccount.address, advanceAmount: 75_000_000n, repaymentAmount: 75_750_000n, riskTimestamp: 1_780_000_100n, expiresAt: 1_780_003_700n, riskReasonsHash: bytes32("strong-history"), modelHash: bytes32("genuine-approval"), nonce: 2n };
  const rejectionDigest = hashTypedData({ domain, types: rejectionTypes, primaryType: "RiskRejection", message: rejection });
  const approvalDigest = hashTypedData({ domain, types: approvalTypes, primaryType: "RiskApproval", message: approval });
  const rejectionSignature = await underwriterAccount.signTypedData({ domain, types: rejectionTypes, primaryType: "RiskRejection", message: rejection });
  const approvalSignature = await underwriterAccount.signTypedData({ domain, types: approvalTypes, primaryType: "RiskApproval", message: approval });
  const actions = [
    ["PAYER_CLAIM", payerAccount.address, token, 0n, encodeFunctionData({ abi: tokenAbi, functionName: "claimFixtureTokens" })],
    ["FUNDER_CLAIM", funderAccount.address, token, 0n, encodeFunctionData({ abi: tokenAbi, functionName: "claimFixtureTokens" })],
    ["REGISTER_REJECTED", supplierAccount.address, receivables, 0n, encodeFunctionData({ abi: receivablesAbi, functionName: "registerInvoice", args: [rejectedTerms, rejected.supplierSignature, rejected.payerSignature] })],
    ["ATTEST_REJECTION", supplierAccount.address, receivables, 1n, encodeFunctionData({ abi: receivablesAbi, functionName: "attestRejection", args: [rejection, rejectionSignature] })],
    ["REGISTER_APPROVED", supplierAccount.address, receivables, 2n, encodeFunctionData({ abi: receivablesAbi, functionName: "registerInvoice", args: [approvedTerms, approved.supplierSignature, approved.payerSignature] })],
    ["FUNDER_APPROVE", funderAccount.address, token, 1n, encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [receivables, 75_000_000n] })],
    ["FUND_APPROVED", funderAccount.address, receivables, 2n, encodeFunctionData({ abi: receivablesAbi, functionName: "fund", args: [approval, approvalSignature] })],
    ["PAYER_APPROVE", payerAccount.address, token, 1n, encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [receivables, 75_750_000n] })],
    ["SETTLE_APPROVED", payerAccount.address, receivables, 2n, encodeFunctionData({ abi: receivablesAbi, functionName: "settle", args: [approvedTerms.invoiceId] })]
  ].map(([kind, from, to, nonce, calldata]) => ({ kind, from, to, nonce: nonce.toString(), value: "0", calldata }));
  return {
    schemaVersion: LIFECYCLE_EXECUTION_SCHEMA,
    label: "XLAYER TESTNET FIXTURE — NO REAL VALUE",
    chainId: "1952",
    deployment: { fixtureToken: token, receivables, underwriter: underwriterAccount.address },
    roles: { supplier: supplierAccount.address, payer: payerAccount.address, funder: funderAccount.address },
    economics: { faceValue: "100000000", requestedAdvance: "75000000", modelMaximumAdvanceBps: "8500", contractMaximumAdvanceBps: "8000", effectiveAdvance: "75000000", modelFeeBps: "100", repayment: "75750000" },
    eip712: { domain: { ...domain }, invoiceTypes, approvalTypes, rejectionTypes, invoices: { rejected, approved }, rejection, rejectionDigest, rejectionSignature, approval, approvalDigest, approvalSignature },
    actions
  };
};

const buildChain = (packet, options = {}) => {
  const blocks = Object.fromEntries(Array.from({ length: 9 }, (_, index) => {
    const number = 101n + BigInt(index);
    return [number.toString(), { number, hash: bytes32(`block-${index}`), transactions: [hashes[index]] }];
  }));
  const logs = [
    [eventLog(tokenAbi, "Transfer", { from: zero, to: payerAccount.address, value: 1_000_000_000n })],
    [eventLog(tokenAbi, "Transfer", { from: zero, to: funderAccount.address, value: 1_000_000_000n })],
    [eventLog(receivablesAbi, "InvoiceRegistered", { invoiceId: packet.eip712.invoices.rejected.terms.invoiceId, invoiceDigest: packet.eip712.invoices.rejected.invoiceDigest, supplier: supplierAccount.address, payer: payerAccount.address, faceValue: 100_000_000n, dueDate: packet.eip712.invoices.rejected.terms.dueDate, documentHash: packet.eip712.invoices.rejected.terms.documentHash })],
    [eventLog(receivablesAbi, "InvoiceRejected", { invoiceId: packet.eip712.rejection.invoiceId, decisionDigest: packet.eip712.rejectionDigest, riskReasonsHash: packet.eip712.rejection.riskReasonsHash, modelHash: packet.eip712.rejection.modelHash })],
    [eventLog(receivablesAbi, "InvoiceRegistered", { invoiceId: packet.eip712.invoices.approved.terms.invoiceId, invoiceDigest: packet.eip712.invoices.approved.invoiceDigest, supplier: supplierAccount.address, payer: payerAccount.address, faceValue: 100_000_000n, dueDate: packet.eip712.invoices.approved.terms.dueDate, documentHash: packet.eip712.invoices.approved.terms.documentHash })],
    [eventLog(tokenAbi, "Approval", { owner: funderAccount.address, spender: receivables, value: 75_000_000n })],
    [eventLog(tokenAbi, "Transfer", { from: funderAccount.address, to: supplierAccount.address, value: 75_000_000n }), eventLog(receivablesAbi, "InvoiceFunded", { invoiceId: packet.eip712.approval.invoiceId, decisionDigest: packet.eip712.approvalDigest, funder: funderAccount.address, supplier: supplierAccount.address, advanceAmount: 75_000_000n, repaymentAmount: 75_750_000n, riskReasonsHash: packet.eip712.approval.riskReasonsHash, modelHash: packet.eip712.approval.modelHash })],
    [eventLog(tokenAbi, "Approval", { owner: payerAccount.address, spender: receivables, value: 75_750_000n })],
    [eventLog(tokenAbi, "Transfer", { from: payerAccount.address, to: funderAccount.address, value: 75_750_000n }), eventLog(receivablesAbi, "InvoiceSettled", { invoiceId: packet.eip712.approval.invoiceId, payer: payerAccount.address, funder: funderAccount.address, repaymentAmount: 75_750_000n })]
  ];
  const txs = Object.fromEntries(packet.actions.map((action, index) => [hashes[index], { hash: hashes[index], from: action.from, to: action.to, nonce: BigInt(action.nonce), value: 0n, input: action.calldata, blockNumber: 101n + BigInt(index), blockHash: blocks[String(101 + index)].hash }]));
  const receipts = Object.fromEntries(packet.actions.map((_, index) => [hashes[index], { transactionHash: hashes[index], blockNumber: 101n + BigInt(index), blockHash: blocks[String(101 + index)].hash, transactionIndex: 0n, status: "success", logs: logs[index] }]));
  const balanceAt = (address, block) => {
    if (block <= 106n) return address === payerAccount.address || address === funderAccount.address ? 1_000_000_000n : 0n;
    if (block <= 108n) return address === supplierAccount.address ? 75_000_000n : address === payerAccount.address ? 1_000_000_000n : address === funderAccount.address ? 925_000_000n : 0n;
    return address === supplierAccount.address ? 75_000_000n : address === payerAccount.address ? 924_250_000n : address === funderAccount.address ? 1_000_750_000n : 0n;
  };
  const provider = {
    name: options.name ?? "provider-a",
    async chainId() { return 1952n; },
    async blockNumber() { return options.head ?? 120n; },
    async transaction(hash) { return txs[hash]; },
    async receipt(hash) { return receipts[hash]; },
    async blockByNumber(number) { return blocks[number.toString()]; },
    async blockByHash(hash) { return Object.values(blocks).find((block) => block.hash === hash); },
    async call({ data, blockNumber }) {
      const decoded = decodeFunctionData({ abi: data.startsWith("0x70a08231") ? tokenAbi : receivablesAbi, data });
      if (decoded.functionName === "balanceOf") return encodeFunctionResult({ abi: tokenAbi, functionName: "balanceOf", result: options.movedRejection && blockNumber === 104n && decoded.args[0] === supplierAccount.address ? 1n : balanceAt(decoded.args[0], blockNumber) });
      if (decoded.functionName === "invoices") {
        const rejected = decoded.args[0] === packet.eip712.invoices.rejected.terms.invoiceId;
        const terms = rejected ? packet.eip712.invoices.rejected.terms : packet.eip712.invoices.approved.terms;
        return encodeFunctionResult({ abi: receivablesAbi, functionName: "invoices", result: rejected
          ? [5, supplierAccount.address, payerAccount.address, zero, 100_000_000n, 0n, 0n, terms.dueDate, terms.documentHash, packet.eip712.invoices.rejected.invoiceDigest, packet.eip712.rejectionDigest]
          : [3, supplierAccount.address, payerAccount.address, funderAccount.address, 100_000_000n, 75_000_000n, 75_750_000n, terms.dueDate, terms.documentHash, packet.eip712.invoices.approved.invoiceDigest, packet.eip712.approvalDigest] });
      }
      throw new Error("unexpected call");
    }
  };
  return provider;
};

test("verifies two-provider rejection, funding, and settlement evidence", async () => {
  const packet = await buildPacket();
  const result = await verifyXLayerTestnetReceivablesLifecycle({ packet, transactionHashes: hashes, providers: [buildChain(packet), buildChain(packet, { name: "provider-b" })] });
  assert.equal(result.rejection.zeroTokenMovementVerified, true);
  assert.equal(result.approval.status, "SETTLED");
  assert.equal(result.approval.effectiveAdvance, "75000000");
  assert.equal(result.approval.repayment, "75750000");
});

test("rejects contract/model/effective economics drift", async () => {
  const packet = await buildPacket();
  packet.economics.effectiveAdvance = "70000000";
  await assert.rejects(() => verifyXLayerTestnetReceivablesLifecycle({ packet, transactionHashes: hashes, providers: [buildChain(packet), buildChain(packet, { name: "provider-b" })] }), /WRONG_EFFECTIVE_ADVANCE/);
});

test("rejects token movement on the prior-default path", async () => {
  const packet = await buildPacket();
  await assert.rejects(() => verifyXLayerTestnetReceivablesLifecycle({ packet, transactionHashes: hashes, providers: [buildChain(packet, { movedRejection: true }), buildChain(packet, { name: "provider-b" })] }), /REJECTION_MOVED_SUPPLIER/);
});

test("rejects insufficient confirmation depth", async () => {
  const packet = await buildPacket();
  await assert.rejects(() => verifyXLayerTestnetReceivablesLifecycle({ packet, transactionHashes: hashes, providers: [buildChain(packet, { head: 109n }), buildChain(packet, { name: "provider-b" })] }), /CONFIRMATIONS/);
});

test("rejects transaction calldata drift", async () => {
  const packet = await buildPacket();
  packet.actions[5].calldata = "0x1234";
  await assert.rejects(() => verifyXLayerTestnetReceivablesLifecycle({ packet, transactionHashes: hashes, providers: [buildChain(packet), buildChain(packet, { name: "provider-b" })] }), /ACTION_5_CALLDATA/);
});

test("rejects a string EIP-712 chain ID even when numerically equal", async () => {
  const packet = await buildPacket();
  packet.eip712.domain.chainId = "1952";
  await assert.rejects(() => verifyXLayerTestnetReceivablesLifecycle({ packet, transactionHashes: hashes, providers: [buildChain(packet), buildChain(packet, { name: "provider-b" })] }), /EIP712_CHAIN_ID_MUST_BE_NUMERIC/);
});

test("accepts numeric chain ID and signatures recover directly from declared digests", async () => {
  const packet = await buildPacket();
  assert.equal(typeof packet.eip712.domain.chainId, "number");
  const result = await verifyXLayerTestnetReceivablesLifecycle({ packet, transactionHashes: hashes, providers: [buildChain(packet), buildChain(packet, { name: "provider-b" })] });
  assert.equal(result.approval.status, "SETTLED");
});

test("read-only adapter exposes no signer, send, wallet, or broadcast capability", () => {
  const provider = createReadOnlyLifecycleProvider("official-a", "https://testrpc.xlayer.tech/terigon");
  assert.deepEqual(Object.keys(provider).sort(), ["blockByHash", "blockByNumber", "blockNumber", "call", "chainId", "name", "receipt", "transaction"]);
  assert.equal(Object.values(provider).some((value) => typeof value === "function" && /sign|send|broadcast|wallet/i.test(value.name)), false);
  assert.throws(() => createReadOnlyLifecycleProvider("bad", "http://remote.example"), /OFFICIAL_HTTPS_RPC_REQUIRED/);
  assert.throws(() => createReadOnlyLifecycleProvider("bad", "https://user:secret@example.com"), /OFFICIAL_HTTPS_RPC_REQUIRED/);
});
