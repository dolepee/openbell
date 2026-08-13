import { decodeFunctionData, encodeFunctionData, encodeFunctionResult, hashTypedData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { expect, test } from "vitest";
import { TwoProviderConnectedInvoiceObserver, type ReadOnlyJsonRpc } from "../src/confirmed-connected-observer.js";
import { CONNECTED_TESTNET, connectedAssessmentTypedData, type ConnectedUnderwritingRequest } from "../src/connected-underwriting.js";

const supplier = privateKeyToAccount(`0x${"11".repeat(32)}`);
const payer = privateKeyToAccount(`0x${"22".repeat(32)}`);
const funder = privateKeyToAccount(`0x${"33".repeat(32)}`);
const underwriter = privateKeyToAccount(`0x${"44".repeat(32)}`);
const invoiceComponents = [
  { name: "invoiceId", type: "bytes32" }, { name: "documentHash", type: "bytes32" }, { name: "supplier", type: "address" }, { name: "payer", type: "address" },
  { name: "faceValue", type: "uint128" }, { name: "issuedAt", type: "uint64" }, { name: "dueDate", type: "uint64" }, { name: "nonce", type: "uint256" }
] as const;
const abi = [
  { type: "function", name: "registerInvoice", stateMutability: "nonpayable", inputs: [{ name: "terms", type: "tuple", components: invoiceComponents }, { name: "supplierSignature", type: "bytes" }, { name: "payerSignature", type: "bytes" }], outputs: [{ name: "", type: "bytes32" }] },
  { type: "function", name: "hashInvoice", stateMutability: "view", inputs: [{ name: "terms", type: "tuple", components: invoiceComponents }], outputs: [{ name: "", type: "bytes32" }] },
  { type: "function", name: "settlementToken", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "underwriter", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "usedDecisionNonces", stateMutability: "view", inputs: [{ name: "signer", type: "address" }, { name: "nonce", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "usedDocumentHashes", stateMutability: "view", inputs: [{ name: "documentHash", type: "bytes32" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "usedInvoiceDigests", stateMutability: "view", inputs: [{ name: "invoiceDigest", type: "bytes32" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "invoices", stateMutability: "view", inputs: [{ name: "invoiceId", type: "bytes32" }], outputs: [
    { name: "status", type: "uint8" }, { name: "supplier", type: "address" }, { name: "payer", type: "address" }, { name: "funder", type: "address" },
    { name: "faceValue", type: "uint128" }, { name: "advanceAmount", type: "uint128" }, { name: "repaymentAmount", type: "uint128" }, { name: "dueDate", type: "uint64" },
    { name: "documentHash", type: "bytes32" }, { name: "invoiceDigest", type: "bytes32" }, { name: "decisionDigest", type: "bytes32" }
  ] }
] as const;
const terms = {
  invoiceId: `0x${"aa".repeat(32)}` as Hex,
  documentHash: `0x${"bb".repeat(32)}` as Hex,
  supplier: supplier.address,
  payer: payer.address,
  faceValue: 100_000_000n,
  issuedAt: 1_786_550_000n,
  dueDate: 1_789_142_000n,
  nonce: 7n
};
const domain = { name: "OpenBell Receivables", version: "1", chainId: 1952, verifyingContract: CONNECTED_TESTNET.receivables } as const;
const typedData = { domain, types: { InvoiceTerms: invoiceComponents }, primaryType: "InvoiceTerms" as const, message: terms };
const invoiceDigest = hashTypedData(typedData);
const txHash = `0x${"10".repeat(32)}` as Hex;
const receiptBlockHash = `0x${"55".repeat(32)}` as Hex;
const pinnedHash = `0x${"66".repeat(32)}` as Hex;

const unsignedRequest: Omit<ConnectedUnderwritingRequest, "supplierAuthorization"> = {
  schemaVersion: CONNECTED_TESTNET.schemaVersion,
  label: CONNECTED_TESTNET.label,
  registrationTransactionHash: txHash,
  invoiceId: terms.invoiceId,
  documentHash: terms.documentHash,
  supplier: supplier.address,
  payer: payer.address,
  funder: funder.address,
  faceValue: terms.faceValue.toString(),
  issuedAt: Number(terms.issuedAt),
  dueDate: Number(terms.dueDate),
  requestedAdvance: "75000000",
  payerHistory: { completedSettlements: 12, onTimeSettlements: 12, lateSettlements: 0, defaults: 0, concentrationBps: 2500, daysSinceLastSettlement: 12 },
  redactedContext: "Synthetic fixture evidence.",
  syntheticFixtureAcknowledged: true
};
const request: ConnectedUnderwritingRequest = { ...unsignedRequest, supplierAuthorization: await supplier.signTypedData(connectedAssessmentTypedData(unsignedRequest)) };

async function rpc(label: string, overrides: { pinnedHash?: Hex; status?: number; usedNonce?: boolean; head?: number; documentRegistered?: boolean; digestRegistered?: boolean } = {}): Promise<ReadOnlyJsonRpc> {
  const supplierSignature = await supplier.signTypedData(typedData);
  const payerSignature = await payer.signTypedData(typedData);
  const input = encodeFunctionData({ abi, functionName: "registerInvoice", args: [terms, supplierSignature, payerSignature] });
  return {
    label,
    async request(method, params) {
      if (method === "eth_chainId") return "0x7a0";
      const head = overrides.head ?? 101;
      if (method === "eth_blockNumber") return `0x${head.toString(16)}`;
      if (method === "eth_getTransactionByHash") return { hash: txHash, from: supplier.address, to: CONNECTED_TESTNET.receivables, value: "0x0", input, blockNumber: "0x5a", blockHash: receiptBlockHash };
      if (method === "eth_getTransactionReceipt") return { transactionHash: txHash, from: supplier.address, to: CONNECTED_TESTNET.receivables, status: "0x1", blockNumber: "0x5a", blockHash: receiptBlockHash, transactionIndex: "0x0" };
      if (method === "eth_getBlockByNumber") {
        if (params[0] === "0x5a") return { number: "0x5a", hash: receiptBlockHash, timestamp: "0x6a7d4a00", transactions: [txHash] };
        return { number: `0x${head.toString(16)}`, hash: overrides.pinnedHash ?? pinnedHash, timestamp: "0x6a7d4a54" };
      }
      if (method === "eth_call") {
        const transaction = params[0] as { data: Hex };
        const decoded = decodeFunctionData({ abi, data: transaction.data });
        if (decoded.functionName === "hashInvoice") return encodeFunctionResult({ abi, functionName: "hashInvoice", result: invoiceDigest });
        if (decoded.functionName === "settlementToken") return encodeFunctionResult({ abi, functionName: "settlementToken", result: CONNECTED_TESTNET.settlementToken });
        if (decoded.functionName === "underwriter") return encodeFunctionResult({ abi, functionName: "underwriter", result: underwriter.address });
        if (decoded.functionName === "paused") return encodeFunctionResult({ abi, functionName: "paused", result: false });
        if (decoded.functionName === "usedDecisionNonces") return encodeFunctionResult({ abi, functionName: "usedDecisionNonces", result: overrides.usedNonce ?? false });
        if (decoded.functionName === "usedDocumentHashes") return encodeFunctionResult({ abi, functionName: "usedDocumentHashes", result: overrides.documentRegistered ?? true });
        if (decoded.functionName === "usedInvoiceDigests") return encodeFunctionResult({ abi, functionName: "usedInvoiceDigests", result: overrides.digestRegistered ?? true });
        if (decoded.functionName === "invoices") return encodeFunctionResult({ abi, functionName: "invoices", result: [overrides.status ?? 1, supplier.address, payer.address, "0x0000000000000000000000000000000000000000", terms.faceValue, 0n, 0n, terms.dueDate, terms.documentHash, invoiceDigest, `0x${"00".repeat(32)}`] });
      }
      throw new Error(`unexpected ${method}`);
    }
  };
}

test("two providers prove the registered invoice, signatures, state, nonce, and canonical block", async () => {
  const observer = new TwoProviderConnectedInvoiceObserver([await rpc("official-a"), await rpc("official-b")]);
  const result = await observer.inspect(request, "123");
  expect(result.blockNumber).toBe("101");
  expect(result.invoiceDigest).toBe(invoiceDigest);
  expect(result.supplier).toBe(supplier.address);
  expect(result.decisionNonceUnused).toBe(true);
});

test("provider divergence and consumed decision nonce fail closed", async () => {
  await expect(new TwoProviderConnectedInvoiceObserver([await rpc("official-a"), await rpc("official-b", { pinnedHash: `0x${"77".repeat(32)}` })]).inspect(request, "123")).rejects.toThrow("CONNECTED_RPC_PROVIDER_DIVERGENCE");
  await expect(new TwoProviderConnectedInvoiceObserver([await rpc("official-a", { usedNonce: true }), await rpc("official-b", { usedNonce: true })]).inspect(request, "123")).rejects.toThrow("CONNECTED_RPC_INVOICE_NOT_AUTHORIZABLE");
});

test("non-registered state and provider identity collapse fail closed", async () => {
  await expect(new TwoProviderConnectedInvoiceObserver([await rpc("official-a", { status: 2 }), await rpc("official-b", { status: 2 })]).inspect(request, "123")).rejects.toThrow("CONNECTED_RPC_INVOICE_NOT_AUTHORIZABLE");
  const one = await rpc("same");
  expect(() => new TwoProviderConnectedInvoiceObserver([one, one])).toThrow("CONNECTED_RPC_PROVIDERS_MUST_BE_DISTINCT");
});

test("registration requires twelve confirmations on both providers", async () => {
  await expect(new TwoProviderConnectedInvoiceObserver([await rpc("official-a", { head: 100 }), await rpc("official-b", { head: 100 })]).inspect(request, "123")).rejects.toThrow("CONNECTED_RPC_INSUFFICIENT_CONFIRMATIONS");
});

test("contract duplicate-index membership is required before clean evidence is derived", async () => {
  await expect(new TwoProviderConnectedInvoiceObserver([await rpc("official-a", { documentRegistered: false }), await rpc("official-b", { documentRegistered: false })]).inspect(request, "123")).rejects.toThrow("CONNECTED_RPC_INVOICE_NOT_AUTHORIZABLE");
  await expect(new TwoProviderConnectedInvoiceObserver([await rpc("official-a", { digestRegistered: false }), await rpc("official-b", { digestRegistered: false })]).inspect(request, "123")).rejects.toThrow("CONNECTED_RPC_INVOICE_NOT_AUTHORIZABLE");
});
