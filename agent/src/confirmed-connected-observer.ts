import {
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  hashTypedData,
  recoverTypedDataAddress,
  type Hex
} from "viem";
import {
  CONNECTED_TESTNET,
  type ConnectedDeployment,
  type ConnectedInvoiceObserver,
  type ConnectedUnderwritingRequest,
  type RegisteredInvoiceObservation
} from "./connected-underwriting.js";

export interface ReadOnlyJsonRpc {
  readonly label: string;
  request(method: string, params: readonly unknown[]): Promise<unknown>;
}

const invoiceComponents = [
  { name: "invoiceId", type: "bytes32" }, { name: "documentHash", type: "bytes32" },
  { name: "supplier", type: "address" }, { name: "payer", type: "address" },
  { name: "faceValue", type: "uint128" }, { name: "issuedAt", type: "uint64" },
  { name: "dueDate", type: "uint64" }, { name: "nonce", type: "uint256" }
] as const;
const abi = [
  { type: "function", name: "registerInvoice", stateMutability: "nonpayable", inputs: [
    { name: "terms", type: "tuple", components: invoiceComponents }, { name: "supplierSignature", type: "bytes" }, { name: "payerSignature", type: "bytes" }
  ], outputs: [{ name: "invoiceDigest", type: "bytes32" }] },
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
const invoiceTypes = { InvoiceTerms: invoiceComponents } as const;
const domainFor = (deployment: ConnectedDeployment) => ({ name: "OpenBell Receivables", version: "1", chainId: deployment.chainId, verifyingContract: deployment.receivables } as const);

const hex = (value: unknown, label: string): Hex => {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) throw new Error(`CONNECTED_RPC_INVALID_${label}`);
  return value.toLowerCase() as Hex;
};
const hash = (value: unknown, label: string): Hex => {
  const result = hex(value, label);
  if (result.length !== 66) throw new Error(`CONNECTED_RPC_INVALID_${label}`);
  return result;
};
const quantity = (value: unknown, label: string): bigint => BigInt(hex(value, label));
const object = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`CONNECTED_RPC_INVALID_${label}`);
  return value as Record<string, unknown>;
};
const exactAddress = (value: unknown, label: string) => {
  if (typeof value !== "string") throw new Error(`CONNECTED_RPC_INVALID_${label}`);
  try { return getAddress(value); } catch { throw new Error(`CONNECTED_RPC_INVALID_${label}`); }
};
const call = async (rpc: ReadOnlyJsonRpc, deployment: ConnectedDeployment, data: Hex, block: Hex): Promise<Hex> => hex(await rpc.request("eth_call", [{ to: deployment.receivables, data }, block]), "CALL_RESULT");
const read = async <T>(rpc: ReadOnlyJsonRpc, deployment: ConnectedDeployment, functionName: "settlementToken" | "underwriter" | "paused" | "usedDecisionNonces" | "usedDocumentHashes" | "usedInvoiceDigests" | "invoices" | "hashInvoice", args: readonly unknown[], block: Hex): Promise<T> => {
  const data = encodeFunctionData({ abi, functionName, args: args as never });
  return decodeFunctionResult({ abi, functionName, data: await call(rpc, deployment, data, block) }) as T;
};

const MINIMUM_CONFIRMATIONS = 12n;

async function inspectProvider(rpc: ReadOnlyJsonRpc, request: ConnectedUnderwritingRequest, nonce: string, verificationBlock: bigint, deployment: ConnectedDeployment): Promise<RegisteredInvoiceObservation> {
  if (quantity(await rpc.request("eth_chainId", []), "CHAIN_ID") !== BigInt(deployment.chainId)) throw new Error("CONNECTED_RPC_WRONG_CHAIN");
  const blockTag = `0x${verificationBlock.toString(16)}` as Hex;
  const transaction = object(await rpc.request("eth_getTransactionByHash", [request.registrationTransactionHash]), "TRANSACTION");
  const receipt = object(await rpc.request("eth_getTransactionReceipt", [request.registrationTransactionHash]), "RECEIPT");
  if (hash(transaction.hash, "TX_HASH") !== request.registrationTransactionHash || hash(receipt.transactionHash, "RECEIPT_TX_HASH") !== request.registrationTransactionHash) throw new Error("CONNECTED_RPC_TRANSACTION_HASH_MISMATCH");
  if (exactAddress(transaction.to, "TX_TO") !== deployment.receivables || exactAddress(receipt.to, "RECEIPT_TO") !== deployment.receivables) throw new Error("CONNECTED_RPC_WRONG_CONTRACT");
  if (quantity(transaction.value, "TX_VALUE") !== 0n || receipt.status !== "0x1") throw new Error("CONNECTED_RPC_FAILED_OR_VALUE_TRANSACTION");
  const receiptBlock = quantity(receipt.blockNumber, "RECEIPT_BLOCK");
  if (receiptBlock > verificationBlock) throw new Error("CONNECTED_RPC_UNCONFIRMED_TRANSACTION");
  if (verificationBlock - receiptBlock + 1n < MINIMUM_CONFIRMATIONS) throw new Error("CONNECTED_RPC_INSUFFICIENT_CONFIRMATIONS");
  const receiptBlockHash = hash(receipt.blockHash, "RECEIPT_BLOCK_HASH");
  if (quantity(transaction.blockNumber, "TX_BLOCK") !== receiptBlock || hash(transaction.blockHash, "TX_BLOCK_HASH") !== receiptBlockHash) throw new Error("CONNECTED_RPC_TRANSACTION_RECEIPT_BLOCK_MISMATCH");
  const canonicalReceiptBlock = object(await rpc.request("eth_getBlockByNumber", [`0x${receiptBlock.toString(16)}`, false]), "RECEIPT_CANONICAL_BLOCK");
  if (hash(canonicalReceiptBlock.hash, "CANONICAL_RECEIPT_HASH") !== receiptBlockHash || quantity(canonicalReceiptBlock.number, "CANONICAL_RECEIPT_NUMBER") !== receiptBlock) throw new Error("CONNECTED_RPC_RECEIPT_REORG");
  const transactionIndex = Number(quantity(receipt.transactionIndex, "RECEIPT_TRANSACTION_INDEX"));
  const blockTransactions = canonicalReceiptBlock.transactions;
  if (!Array.isArray(blockTransactions) || transactionIndex < 0 || transactionIndex >= blockTransactions.length || hash(blockTransactions[transactionIndex], "BLOCK_TRANSACTION") !== request.registrationTransactionHash) throw new Error("CONNECTED_RPC_TRANSACTION_NOT_AT_RECEIPT_INDEX");
  const pinned = object(await rpc.request("eth_getBlockByNumber", [blockTag, false]), "PINNED_BLOCK");
  if (quantity(pinned.number, "PINNED_NUMBER") !== verificationBlock) throw new Error("CONNECTED_RPC_PINNED_NUMBER_MISMATCH");
  const verificationBlockHash = hash(pinned.hash, "PINNED_HASH");
  const blockTimestamp = Number(quantity(pinned.timestamp, "PINNED_TIMESTAMP"));
  if (!Number.isSafeInteger(blockTimestamp)) throw new Error("CONNECTED_RPC_PINNED_TIMESTAMP_RANGE");

  const input = hex(transaction.input, "TX_INPUT");
  const decoded = decodeFunctionData({ abi, data: input });
  if (decoded.functionName !== "registerInvoice") throw new Error("CONNECTED_RPC_WRONG_REGISTRATION_CALL");
  const [terms, supplierSignature, payerSignature] = decoded.args;
  const normalizedTerms = {
    invoiceId: terms.invoiceId.toLowerCase() as Hex,
    documentHash: terms.documentHash.toLowerCase() as Hex,
    supplier: getAddress(terms.supplier), payer: getAddress(terms.payer), faceValue: terms.faceValue,
    issuedAt: terms.issuedAt, dueDate: terms.dueDate, nonce: terms.nonce
  };
  if (exactAddress(transaction.from, "TX_FROM") !== normalizedTerms.supplier) throw new Error("CONNECTED_RPC_WRONG_REGISTRATION_SENDER");
  if (exactAddress(receipt.from, "RECEIPT_FROM") !== normalizedTerms.supplier) throw new Error("CONNECTED_RPC_WRONG_RECEIPT_SENDER");
  const typedData = { domain: domainFor(deployment), types: invoiceTypes, primaryType: "InvoiceTerms" as const, message: normalizedTerms };
  const localDigest = hashTypedData(typedData);
  if (await recoverTypedDataAddress({ ...typedData, signature: supplierSignature }) !== normalizedTerms.supplier) throw new Error("CONNECTED_RPC_WRONG_SUPPLIER_SIGNATURE");
  if (await recoverTypedDataAddress({ ...typedData, signature: payerSignature }) !== normalizedTerms.payer) throw new Error("CONNECTED_RPC_WRONG_PAYER_SIGNATURE");
  const contractDigest = await read<Hex>(rpc, deployment, "hashInvoice", [normalizedTerms], blockTag);
  if (localDigest !== contractDigest.toLowerCase()) throw new Error("CONNECTED_RPC_INVOICE_DIGEST_MISMATCH");

  const settlementToken = getAddress(await read<string>(rpc, deployment, "settlementToken", [], blockTag));
  const underwriter = getAddress(await read<string>(rpc, deployment, "underwriter", [], blockTag));
  const paused = await read<boolean>(rpc, deployment, "paused", [], blockTag);
  const usedNonce = await read<boolean>(rpc, deployment, "usedDecisionNonces", [underwriter, BigInt(nonce)], blockTag);
  const [status, supplier, payer, , faceValue, , , dueDate, documentHash, invoiceDigest] = await read<readonly [number, `0x${string}`, `0x${string}`, `0x${string}`, bigint, bigint, bigint, bigint, Hex, Hex, Hex]>(rpc, deployment, "invoices", [request.invoiceId], blockTag);
  const documentHashRegistered = await read<boolean>(rpc, deployment, "usedDocumentHashes", [request.documentHash], blockTag);
  const invoiceDigestRegistered = await read<boolean>(rpc, deployment, "usedInvoiceDigests", [invoiceDigest], blockTag);
  if (Number(status) !== 1 || paused || usedNonce || !documentHashRegistered || !invoiceDigestRegistered) throw new Error("CONNECTED_RPC_INVOICE_NOT_AUTHORIZABLE");
  const finalPinned = object(await rpc.request("eth_getBlockByNumber", [blockTag, false]), "FINAL_PINNED_BLOCK");
  if (hash(finalPinned.hash, "FINAL_PINNED_HASH") !== verificationBlockHash || quantity(finalPinned.number, "FINAL_PINNED_NUMBER") !== verificationBlock) throw new Error("CONNECTED_RPC_PINNED_REORG");
  const finalReceiptBlock = object(await rpc.request("eth_getBlockByNumber", [`0x${receiptBlock.toString(16)}`, false]), "FINAL_RECEIPT_BLOCK");
  if (hash(finalReceiptBlock.hash, "FINAL_RECEIPT_HASH") !== receiptBlockHash || quantity(finalReceiptBlock.number, "FINAL_RECEIPT_NUMBER") !== receiptBlock) throw new Error("CONNECTED_RPC_RECEIPT_REORG");

  return {
    chainId: deployment.chainId,
    receivables: deployment.receivables,
    settlementToken,
    blockNumber: verificationBlock.toString(),
    blockHash: verificationBlockHash,
    blockTimestamp,
    registrationTransactionHash: request.registrationTransactionHash,
    status: "REGISTERED",
    invoiceId: normalizedTerms.invoiceId,
    invoiceDigest: invoiceDigest.toLowerCase() as Hex,
    documentHash: documentHash.toLowerCase() as Hex,
    supplier: getAddress(supplier),
    payer: getAddress(payer),
    faceValue: faceValue.toString(),
    issuedAt: Number(normalizedTerms.issuedAt),
    dueDate: Number(dueDate),
    underwriter,
    paused: false,
    decisionNonceUnused: true,
    documentHashRegistered: true,
    invoiceDigestRegistered: true
  };
}

export class TwoProviderConnectedInvoiceObserver implements ConnectedInvoiceObserver {
  constructor(readonly providers: readonly [ReadOnlyJsonRpc, ReadOnlyJsonRpc], readonly deployment: ConnectedDeployment = CONNECTED_TESTNET) {
    if (providers[0].label === providers[1].label) throw new Error("CONNECTED_RPC_PROVIDERS_MUST_BE_DISTINCT");
  }
  async inspect(request: ConnectedUnderwritingRequest, decisionNonce: string): Promise<RegisteredInvoiceObservation> {
    const [firstHead, secondHead] = await Promise.all([
      this.providers[0].request("eth_blockNumber", []).then((value) => quantity(value, "HEAD")),
      this.providers[1].request("eth_blockNumber", []).then((value) => quantity(value, "HEAD"))
    ]);
    const verificationBlock = firstHead < secondHead ? firstHead : secondHead;
    const [first, second] = await Promise.all([
      inspectProvider(this.providers[0], request, decisionNonce, verificationBlock, this.deployment),
      inspectProvider(this.providers[1], request, decisionNonce, verificationBlock, this.deployment)
    ]);
    if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error("CONNECTED_RPC_PROVIDER_DIVERGENCE");
    return first;
  }
}
