import {
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  keccak256,
  stringToHex,
  type Hex
} from "viem";
import { z } from "zod";
import { CONNECTED_MAINNET, type ConnectedDeployment } from "./connected-underwriting.js";
import type { ReadOnlyJsonRpc } from "./confirmed-connected-observer.js";

export const RECEIPT_HISTORY_SCHEMA = "openbell-receipt-bound-history-v1" as const;
export const MAINNET_DEPLOYMENT_BLOCK = 67_764_503n;
export const HISTORY_CONFIRMATIONS = 12n;
export const HISTORY_LOG_CHUNK_BLOCKS = 100n;
export const HISTORY_MAX_CHUNKS = 10_000;
export const HISTORY_MAX_LOGS = 10_000;

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((value) => getAddress(value));
const bytes32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((value) => value.toLowerCase() as Hex);
const quantitySchema = z.string().regex(/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/).transform((value) => BigInt(value));

const eventAbi = [
  {
    type: "event", name: "InvoiceRegistered", anonymous: false,
    inputs: [
      { name: "invoiceId", type: "bytes32", indexed: true },
      { name: "invoiceDigest", type: "bytes32", indexed: true },
      { name: "supplier", type: "address", indexed: true },
      { name: "payer", type: "address", indexed: false },
      { name: "faceValue", type: "uint128", indexed: false },
      { name: "dueDate", type: "uint64", indexed: false },
      { name: "documentHash", type: "bytes32", indexed: false }
    ]
  },
  {
    type: "event", name: "InvoiceFunded", anonymous: false,
    inputs: [
      { name: "invoiceId", type: "bytes32", indexed: true },
      { name: "decisionDigest", type: "bytes32", indexed: true },
      { name: "funder", type: "address", indexed: true },
      { name: "supplier", type: "address", indexed: false },
      { name: "advanceAmount", type: "uint128", indexed: false },
      { name: "repaymentAmount", type: "uint128", indexed: false },
      { name: "riskReasonsHash", type: "bytes32", indexed: false },
      { name: "modelHash", type: "bytes32", indexed: false }
    ]
  },
  {
    type: "event", name: "InvoiceSettled", anonymous: false,
    inputs: [
      { name: "invoiceId", type: "bytes32", indexed: true },
      { name: "payer", type: "address", indexed: true },
      { name: "funder", type: "address", indexed: true },
      { name: "repaymentAmount", type: "uint128", indexed: false }
    ]
  },
  {
    type: "event", name: "InvoiceCancelled", anonymous: false,
    inputs: [
      { name: "invoiceId", type: "bytes32", indexed: true },
      { name: "supplier", type: "address", indexed: true }
    ]
  },
  {
    type: "event", name: "InvoiceRejected", anonymous: false,
    inputs: [
      { name: "invoiceId", type: "bytes32", indexed: true },
      { name: "decisionDigest", type: "bytes32", indexed: true },
      { name: "riskReasonsHash", type: "bytes32", indexed: false },
      { name: "modelHash", type: "bytes32", indexed: false }
    ]
  }
] as const;

const readAbi = [{
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
}] as const;

const eventTopics = eventAbi.map((event) => keccak256(stringToHex(
  `${event.name}(${event.inputs.map((input) => input.type).join(",")})`
)));

interface CanonicalLog {
  readonly address: `0x${string}`;
  readonly blockHash: Hex;
  readonly blockNumber: bigint;
  readonly transactionHash: Hex;
  readonly transactionIndex: bigint;
  readonly logIndex: bigint;
  readonly data: Hex;
  readonly topics: readonly Hex[];
}

interface CanonicalBlock {
  readonly number: bigint;
  readonly hash: Hex;
  readonly timestamp: number;
}

interface InvoiceState {
  readonly status: number;
  readonly supplier: `0x${string}`;
  readonly payer: `0x${string}`;
  readonly funder: `0x${string}`;
  readonly faceValue: bigint;
  readonly advanceAmount: bigint;
  readonly repaymentAmount: bigint;
  readonly dueDate: bigint;
  readonly documentHash: Hex;
  readonly invoiceDigest: Hex;
  readonly decisionDigest: Hex;
}

interface Registration {
  readonly invoiceId: Hex;
  readonly invoiceDigest: Hex;
  readonly documentHash: Hex;
  readonly supplier: `0x${string}`;
  readonly payer: `0x${string}`;
  readonly faceValue: bigint;
  readonly dueDate: bigint;
  readonly position: bigint;
}

interface Lifecycle {
  readonly registration: Registration;
  funded?: { readonly position: bigint; readonly decisionDigest: Hex; readonly funder: `0x${string}`; readonly supplier: `0x${string}`; readonly advanceAmount: bigint; readonly repaymentAmount: bigint };
  settled?: { readonly position: bigint; readonly payer: `0x${string}`; readonly funder: `0x${string}`; readonly repaymentAmount: bigint; readonly blockNumber: bigint };
  cancelled?: { readonly position: bigint; readonly supplier: `0x${string}` };
  rejected?: { readonly position: bigint; readonly decisionDigest: Hex };
}

export interface ReceiptBoundHistorySnapshot {
  readonly schemaVersion: typeof RECEIPT_HISTORY_SCHEMA;
  readonly chainId: 196;
  readonly receivables: `0x${string}`;
  readonly payer: `0x${string}`;
  readonly fromBlock: string;
  readonly throughBlock: string;
  readonly throughBlockHash: Hex;
  readonly completedSettlements: number;
  readonly onTimeSettlements: number;
  readonly lateSettlements: number;
  readonly activeFunded: number;
  readonly overdueFunded: number;
  readonly counterpartyConcentrationBps: number;
  readonly daysSinceLastSettlement: number;
  readonly invoiceIds: readonly Hex[];
  readonly historyCommitment: Hex;
}

const decimalStringSchema = z.string().regex(/^(?:0|[1-9][0-9]*)$/);
const receiptBoundHistorySnapshotSchema = z.object({
  schemaVersion: z.literal(RECEIPT_HISTORY_SCHEMA),
  chainId: z.literal(196),
  receivables: addressSchema,
  payer: addressSchema,
  fromBlock: decimalStringSchema,
  throughBlock: decimalStringSchema,
  throughBlockHash: bytes32Schema,
  completedSettlements: z.number().int().nonnegative(),
  onTimeSettlements: z.number().int().nonnegative(),
  lateSettlements: z.number().int().nonnegative(),
  activeFunded: z.number().int().nonnegative(),
  overdueFunded: z.number().int().nonnegative(),
  counterpartyConcentrationBps: z.number().int().min(0).max(10_000),
  daysSinceLastSettlement: z.number().int().nonnegative(),
  invoiceIds: z.array(bytes32Schema).max(HISTORY_MAX_LOGS),
  historyCommitment: bytes32Schema
}).strict();

export interface HistoryDerivationOptions {
  readonly deployment?: ConnectedDeployment;
  readonly fromBlock?: bigint;
  readonly throughBlock?: bigint;
  readonly confirmations?: bigint;
  readonly chunkBlocks?: bigint;
  readonly maximumChunks?: number;
  readonly maximumLogs?: number;
  readonly onChunk?: (progress: { provider: string; completed: number; total: number }) => void;
}

const object = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`RECEIPT_HISTORY_INVALID_${label}`);
  return value as Record<string, unknown>;
};
const quantity = (value: unknown, label: string): bigint => {
  const parsed = quantitySchema.safeParse(value);
  if (!parsed.success) throw new Error(`RECEIPT_HISTORY_INVALID_${label}`);
  return parsed.data;
};
const bytes32 = (value: unknown, label: string): Hex => {
  const parsed = bytes32Schema.safeParse(value);
  if (!parsed.success) throw new Error(`RECEIPT_HISTORY_INVALID_${label}`);
  return parsed.data;
};
const address = (value: unknown, label: string): `0x${string}` => {
  const parsed = addressSchema.safeParse(value);
  if (!parsed.success) throw new Error(`RECEIPT_HISTORY_INVALID_${label}`);
  return parsed.data;
};
const safeNumber = (value: bigint, label: string): number => {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(`RECEIPT_HISTORY_INVALID_${label}`);
  return result;
};
const logPosition = (log: CanonicalLog): bigint => (log.blockNumber << 64n) | (log.transactionIndex << 32n) | log.logIndex;

const canonicalBlock = (value: unknown, expected: bigint): CanonicalBlock => {
  const candidate = object(value, "BLOCK");
  const number = quantity(candidate.number, "BLOCK_NUMBER");
  const timestamp = safeNumber(quantity(candidate.timestamp, "BLOCK_TIMESTAMP"), "BLOCK_TIMESTAMP_RANGE");
  if (number !== expected) throw new Error("RECEIPT_HISTORY_BLOCK_NUMBER_MISMATCH");
  return { number, hash: bytes32(candidate.hash, "BLOCK_HASH"), timestamp };
};

const canonicalLog = (value: unknown, deployment: ConnectedDeployment): CanonicalLog => {
  const candidate = object(value, "LOG");
  if (candidate.removed === true) throw new Error("RECEIPT_HISTORY_REMOVED_LOG");
  if (!Array.isArray(candidate.topics) || candidate.topics.length === 0 || candidate.topics.length > 4) throw new Error("RECEIPT_HISTORY_INVALID_LOG_TOPICS");
  const normalized = {
    address: address(candidate.address, "LOG_ADDRESS"),
    blockHash: bytes32(candidate.blockHash, "LOG_BLOCK_HASH"),
    blockNumber: quantity(candidate.blockNumber, "LOG_BLOCK_NUMBER"),
    transactionHash: bytes32(candidate.transactionHash, "LOG_TRANSACTION_HASH"),
    transactionIndex: quantity(candidate.transactionIndex, "LOG_TRANSACTION_INDEX"),
    logIndex: quantity(candidate.logIndex, "LOG_INDEX"),
    data: typeof candidate.data === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(candidate.data) ? candidate.data.toLowerCase() as Hex : (() => { throw new Error("RECEIPT_HISTORY_INVALID_LOG_DATA"); })(),
    topics: candidate.topics.map((topic, index) => bytes32(topic, `LOG_TOPIC_${index}`))
  } as const;
  if (normalized.address !== getAddress(deployment.receivables)) throw new Error("RECEIPT_HISTORY_WRONG_LOG_CONTRACT");
  if (!eventTopics.includes(normalized.topics[0]!)) throw new Error("RECEIPT_HISTORY_UNKNOWN_EVENT");
  if (normalized.transactionIndex >= 2n ** 32n || normalized.logIndex >= 2n ** 32n) throw new Error("RECEIPT_HISTORY_LOG_POSITION_RANGE");
  return normalized;
};

const serializeLog = (log: CanonicalLog): string => JSON.stringify({
  address: log.address.toLowerCase(), blockHash: log.blockHash, blockNumber: log.blockNumber.toString(),
  transactionHash: log.transactionHash, transactionIndex: log.transactionIndex.toString(),
  logIndex: log.logIndex.toString(), data: log.data, topics: log.topics
});

const scanProvider = async (args: {
  rpc: ReadOnlyJsonRpc;
  deployment: ConnectedDeployment;
  fromBlock: bigint;
  throughBlock: bigint;
  chunkBlocks: bigint;
  maximumChunks: number;
  maximumLogs: number;
  onChunk?: HistoryDerivationOptions["onChunk"];
}): Promise<readonly CanonicalLog[]> => {
  if (args.chunkBlocks <= 0n || args.chunkBlocks > HISTORY_LOG_CHUNK_BLOCKS) throw new Error("RECEIPT_HISTORY_INVALID_CHUNK_SIZE");
  const span = args.throughBlock - args.fromBlock + 1n;
  const total = safeNumber((span + args.chunkBlocks - 1n) / args.chunkBlocks, "CHUNK_COUNT_RANGE");
  if (total <= 0 || total > args.maximumChunks) throw new Error("RECEIPT_HISTORY_CHUNK_LIMIT");
  const logs: CanonicalLog[] = [];
  let expectedFrom = args.fromBlock;
  for (let index = 0; index < total; index += 1) {
    const fromBlock = args.fromBlock + BigInt(index) * args.chunkBlocks;
    const toBlock = fromBlock + args.chunkBlocks - 1n > args.throughBlock ? args.throughBlock : fromBlock + args.chunkBlocks - 1n;
    if (fromBlock !== expectedFrom || toBlock < fromBlock) throw new Error("RECEIPT_HISTORY_NONCONTIGUOUS_SCAN");
    const response = await args.rpc.request("eth_getLogs", [{
      address: args.deployment.receivables,
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${toBlock.toString(16)}`,
      topics: [eventTopics]
    }]);
    if (!Array.isArray(response)) throw new Error("RECEIPT_HISTORY_INVALID_LOG_RESPONSE");
    for (const entry of response) {
      const log = canonicalLog(entry, args.deployment);
      if (log.blockNumber < fromBlock || log.blockNumber > toBlock) throw new Error("RECEIPT_HISTORY_LOG_OUTSIDE_CHUNK");
      logs.push(log);
      if (logs.length > args.maximumLogs) throw new Error("RECEIPT_HISTORY_LOG_LIMIT");
    }
    expectedFrom = toBlock + 1n;
    args.onChunk?.({ provider: args.rpc.label, completed: index + 1, total });
  }
  if (expectedFrom !== args.throughBlock + 1n) throw new Error("RECEIPT_HISTORY_INCOMPLETE_SCAN");
  logs.sort((left, right) => logPosition(left) < logPosition(right) ? -1 : logPosition(left) > logPosition(right) ? 1 : 0);
  const seen = new Set<string>();
  const seenPositions = new Set<string>();
  for (const log of logs) {
    const key = `${log.blockHash}:${log.transactionHash}:${log.logIndex}`;
    if (seen.has(key)) throw new Error("RECEIPT_HISTORY_DUPLICATE_LOG");
    seen.add(key);
    const position = logPosition(log).toString();
    if (seenPositions.has(position)) throw new Error("RECEIPT_HISTORY_LOG_POSITION_CONFLICT");
    seenPositions.add(position);
  }
  return logs;
};

const readInvoice = async (rpc: ReadOnlyJsonRpc, deployment: ConnectedDeployment, invoiceId: Hex, block: bigint): Promise<InvoiceState> => {
  const data = encodeFunctionData({ abi: readAbi, functionName: "invoices", args: [invoiceId] });
  const raw = await rpc.request("eth_call", [{ to: deployment.receivables, data }, `0x${block.toString(16)}`]);
  if (typeof raw !== "string" || !/^0x[0-9a-fA-F]+$/.test(raw)) throw new Error("RECEIPT_HISTORY_INVALID_INVOICE_CALL");
  const [status, supplier, payer, funder, faceValue, advanceAmount, repaymentAmount, dueDate, documentHash, invoiceDigest, decisionDigest] = decodeFunctionResult({ abi: readAbi, functionName: "invoices", data: raw as Hex });
  return {
    status: Number(status), supplier: getAddress(supplier), payer: getAddress(payer), funder: getAddress(funder),
    faceValue, advanceAmount, repaymentAmount, dueDate, documentHash: documentHash.toLowerCase() as Hex,
    invoiceDigest: invoiceDigest.toLowerCase() as Hex, decisionDigest: decisionDigest.toLowerCase() as Hex
  };
};

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  return JSON.stringify(value);
};

export const receiptBoundHistoryCommitment = (snapshot: Omit<ReceiptBoundHistorySnapshot, "historyCommitment">): Hex =>
  keccak256(stringToHex(canonicalJson(snapshot)));

export const parseReceiptBoundHistorySnapshot = (value: unknown): ReceiptBoundHistorySnapshot => {
  const parsed = receiptBoundHistorySnapshotSchema.parse(value);
  if (parsed.receivables !== CONNECTED_MAINNET.receivables) throw new Error("RECEIPT_HISTORY_WRONG_BASELINE_CONTRACT");
  if (BigInt(parsed.fromBlock) !== MAINNET_DEPLOYMENT_BLOCK || BigInt(parsed.throughBlock) < MAINNET_DEPLOYMENT_BLOCK) throw new Error("RECEIPT_HISTORY_INVALID_BASELINE_RANGE");
  if (parsed.onTimeSettlements + parsed.lateSettlements !== parsed.completedSettlements) throw new Error("RECEIPT_HISTORY_INCOMPLETE_SETTLEMENT_CLASSIFICATION");
  const sortedIds = [...parsed.invoiceIds].sort();
  if (new Set(sortedIds).size !== sortedIds.length || sortedIds.some((invoiceId, index) => invoiceId !== parsed.invoiceIds[index])) {
    throw new Error("RECEIPT_HISTORY_INVOICE_IDS_NOT_CANONICAL");
  }
  const { historyCommitment, ...withoutCommitment } = parsed;
  if (receiptBoundHistoryCommitment(withoutCommitment) !== historyCommitment) throw new Error("RECEIPT_HISTORY_COMMITMENT_MISMATCH");
  return parsed;
};

const historiesFromLogs = (logs: readonly CanonicalLog[], payer: `0x${string}`): Map<Hex, Lifecycle> => {
  const histories = new Map<Hex, Lifecycle>();
  for (const log of logs) {
    const decoded = decodeEventLog({ abi: eventAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]], strict: true });
    const position = logPosition(log);
    if (decoded.eventName === "InvoiceRegistered") {
      const invoiceId = decoded.args.invoiceId.toLowerCase() as Hex;
      if (histories.has(invoiceId)) throw new Error("RECEIPT_HISTORY_DUPLICATE_REGISTRATION");
      histories.set(invoiceId, { registration: {
        invoiceId, invoiceDigest: decoded.args.invoiceDigest.toLowerCase() as Hex,
        documentHash: decoded.args.documentHash.toLowerCase() as Hex, supplier: getAddress(decoded.args.supplier),
        payer: getAddress(decoded.args.payer), faceValue: decoded.args.faceValue, dueDate: decoded.args.dueDate, position
      } });
      continue;
    }
    const invoiceId = decoded.args.invoiceId.toLowerCase() as Hex;
    const lifecycle = histories.get(invoiceId);
    if (!lifecycle) throw new Error("RECEIPT_HISTORY_EVENT_WITHOUT_REGISTRATION");
    if (position <= lifecycle.registration.position) throw new Error("RECEIPT_HISTORY_EVENT_BEFORE_REGISTRATION");
    if (decoded.eventName === "InvoiceFunded") {
      if (lifecycle.funded || lifecycle.cancelled || lifecycle.rejected || lifecycle.settled) throw new Error("RECEIPT_HISTORY_INVALID_FUNDING_ORDER");
      lifecycle.funded = { position, decisionDigest: decoded.args.decisionDigest.toLowerCase() as Hex, funder: getAddress(decoded.args.funder), supplier: getAddress(decoded.args.supplier), advanceAmount: decoded.args.advanceAmount, repaymentAmount: decoded.args.repaymentAmount };
    } else if (decoded.eventName === "InvoiceSettled") {
      if (!lifecycle.funded || lifecycle.settled || lifecycle.cancelled || lifecycle.rejected || position <= lifecycle.funded.position) throw new Error("RECEIPT_HISTORY_INVALID_SETTLEMENT_ORDER");
      lifecycle.settled = { position, payer: getAddress(decoded.args.payer), funder: getAddress(decoded.args.funder), repaymentAmount: decoded.args.repaymentAmount, blockNumber: log.blockNumber };
    } else if (decoded.eventName === "InvoiceCancelled") {
      if (lifecycle.funded || lifecycle.cancelled || lifecycle.rejected || lifecycle.settled) throw new Error("RECEIPT_HISTORY_INVALID_CANCELLATION_ORDER");
      lifecycle.cancelled = { position, supplier: getAddress(decoded.args.supplier) };
    } else if (decoded.eventName === "InvoiceRejected") {
      if (lifecycle.funded || lifecycle.cancelled || lifecycle.rejected || lifecycle.settled) throw new Error("RECEIPT_HISTORY_INVALID_REJECTION_ORDER");
      lifecycle.rejected = { position, decisionDigest: decoded.args.decisionDigest.toLowerCase() as Hex };
    }
  }
  return new Map([...histories].filter(([, lifecycle]) => lifecycle.registration.payer === payer));
};

const expectedStatus = (lifecycle: Lifecycle): number => lifecycle.settled ? 3 : lifecycle.funded ? 2 : lifecycle.cancelled ? 4 : lifecycle.rejected ? 5 : 1;

export async function deriveReceiptBoundHistory(
  providers: readonly [ReadOnlyJsonRpc, ReadOnlyJsonRpc],
  payerInput: string,
  options: HistoryDerivationOptions = {}
): Promise<ReceiptBoundHistorySnapshot> {
  if (providers[0].label === providers[1].label) throw new Error("RECEIPT_HISTORY_PROVIDERS_MUST_BE_DISTINCT");
  const deployment = options.deployment ?? CONNECTED_MAINNET;
  if (deployment.chainId !== 196) throw new Error("RECEIPT_HISTORY_WRONG_DEPLOYMENT");
  const payer = address(payerInput, "PAYER");
  const fromBlock = options.fromBlock ?? MAINNET_DEPLOYMENT_BLOCK;
  const confirmations = options.confirmations ?? HISTORY_CONFIRMATIONS;
  const chunkBlocks = options.chunkBlocks ?? HISTORY_LOG_CHUNK_BLOCKS;
  const maximumChunks = options.maximumChunks ?? HISTORY_MAX_CHUNKS;
  const maximumLogs = options.maximumLogs ?? HISTORY_MAX_LOGS;
  if (fromBlock < 0n || confirmations <= 0n) throw new Error("RECEIPT_HISTORY_INVALID_RANGE");

  const [firstChain, secondChain, firstHead, secondHead] = await Promise.all([
    providers[0].request("eth_chainId", []), providers[1].request("eth_chainId", []),
    providers[0].request("eth_blockNumber", []), providers[1].request("eth_blockNumber", [])
  ]);
  if (quantity(firstChain, "CHAIN_ID") !== 196n || quantity(secondChain, "CHAIN_ID") !== 196n) throw new Error("RECEIPT_HISTORY_WRONG_CHAIN");
  const minimumHead = quantity(firstHead, "HEAD") < quantity(secondHead, "HEAD") ? quantity(firstHead, "HEAD") : quantity(secondHead, "HEAD");
  if (minimumHead + 1n < confirmations) throw new Error("RECEIPT_HISTORY_INSUFFICIENT_HEAD");
  const confirmedThroughBlock = minimumHead - confirmations + 1n;
  const throughBlock = options.throughBlock ?? confirmedThroughBlock;
  if (throughBlock > confirmedThroughBlock) throw new Error("RECEIPT_HISTORY_UNCONFIRMED_THROUGH_BLOCK");
  if (throughBlock < fromBlock) throw new Error("RECEIPT_HISTORY_RANGE_NOT_AVAILABLE");
  const blockTag = `0x${throughBlock.toString(16)}`;
  const [firstPinned, secondPinned] = await Promise.all([
    providers[0].request("eth_getBlockByNumber", [blockTag, false]).then((value) => canonicalBlock(value, throughBlock)),
    providers[1].request("eth_getBlockByNumber", [blockTag, false]).then((value) => canonicalBlock(value, throughBlock))
  ]);
  if (firstPinned.hash !== secondPinned.hash || firstPinned.timestamp !== secondPinned.timestamp) throw new Error("RECEIPT_HISTORY_PINNED_BLOCK_DIVERGENCE");

  const scan = (rpc: ReadOnlyJsonRpc) => scanProvider({ rpc, deployment, fromBlock, throughBlock, chunkBlocks, maximumChunks, maximumLogs, ...(options.onChunk ? { onChunk: options.onChunk } : {}) });
  const [firstLogs, secondLogs] = await Promise.all([scan(providers[0]), scan(providers[1])]);
  if (firstLogs.length !== secondLogs.length || firstLogs.some((log, index) => serializeLog(log) !== serializeLog(secondLogs[index]!))) {
    throw new Error("RECEIPT_HISTORY_PROVIDER_LOG_DIVERGENCE");
  }
  const eventBlocks = new Map<bigint, Hex>();
  for (const log of firstLogs) {
    const existing = eventBlocks.get(log.blockNumber);
    if (existing && existing !== log.blockHash) throw new Error("RECEIPT_HISTORY_EVENT_BLOCK_HASH_CONFLICT");
    eventBlocks.set(log.blockNumber, log.blockHash);
  }
  await Promise.all([...eventBlocks].map(async ([blockNumber, expectedHash]) => {
    const tag = `0x${blockNumber.toString(16)}`;
    const [first, second] = await Promise.all([
      providers[0].request("eth_getBlockByNumber", [tag, false]).then((value) => canonicalBlock(value, blockNumber)),
      providers[1].request("eth_getBlockByNumber", [tag, false]).then((value) => canonicalBlock(value, blockNumber))
    ]);
    if (first.hash !== expectedHash || second.hash !== expectedHash || first.timestamp !== second.timestamp) {
      throw new Error("RECEIPT_HISTORY_EVENT_BLOCK_DIVERGENCE");
    }
  }));
  const histories = historiesFromLogs(firstLogs, payer);
  const settlementBlocks = [...new Set([...histories.values()].flatMap((history) => history.settled ? [history.settled.blockNumber] : []))];
  const settlementTimestamps = new Map<bigint, number>();
  await Promise.all(settlementBlocks.map(async (blockNumber) => {
    const tag = `0x${blockNumber.toString(16)}`;
    const [first, second] = await Promise.all([
      providers[0].request("eth_getBlockByNumber", [tag, false]).then((value) => canonicalBlock(value, blockNumber)),
      providers[1].request("eth_getBlockByNumber", [tag, false]).then((value) => canonicalBlock(value, blockNumber))
    ]);
    if (first.hash !== second.hash || first.timestamp !== second.timestamp) throw new Error("RECEIPT_HISTORY_SETTLEMENT_BLOCK_DIVERGENCE");
    settlementTimestamps.set(blockNumber, first.timestamp);
  }));

  const states = new Map<Hex, InvoiceState>();
  await Promise.all([...histories.entries()].map(async ([invoiceId, lifecycle]) => {
    const [first, second] = await Promise.all([
      readInvoice(providers[0], deployment, invoiceId, throughBlock), readInvoice(providers[1], deployment, invoiceId, throughBlock)
    ]);
    if (canonicalJson(first) !== canonicalJson(second)) throw new Error("RECEIPT_HISTORY_INVOICE_STATE_DIVERGENCE");
    const registration = lifecycle.registration;
    if (first.status !== expectedStatus(lifecycle) || first.supplier !== registration.supplier || first.payer !== payer
      || first.faceValue !== registration.faceValue || first.dueDate !== registration.dueDate
      || first.documentHash !== registration.documentHash || first.invoiceDigest !== registration.invoiceDigest) {
      throw new Error("RECEIPT_HISTORY_INVOICE_STATE_MISMATCH");
    }
    if (lifecycle.funded && (first.funder !== lifecycle.funded.funder || first.advanceAmount !== lifecycle.funded.advanceAmount || first.repaymentAmount !== lifecycle.funded.repaymentAmount || first.decisionDigest !== lifecycle.funded.decisionDigest || lifecycle.funded.supplier !== registration.supplier)) {
      throw new Error("RECEIPT_HISTORY_FUNDING_STATE_MISMATCH");
    }
    if (lifecycle.settled && (lifecycle.settled.payer !== payer || lifecycle.settled.funder !== first.funder || lifecycle.settled.repaymentAmount !== first.repaymentAmount)) {
      throw new Error("RECEIPT_HISTORY_SETTLEMENT_STATE_MISMATCH");
    }
    if (lifecycle.cancelled && lifecycle.cancelled.supplier !== registration.supplier) throw new Error("RECEIPT_HISTORY_CANCELLATION_STATE_MISMATCH");
    if (lifecycle.rejected && first.decisionDigest !== lifecycle.rejected.decisionDigest) throw new Error("RECEIPT_HISTORY_REJECTION_STATE_MISMATCH");
    states.set(invoiceId, first);
  }));

  let completedSettlements = 0;
  let onTimeSettlements = 0;
  let lateSettlements = 0;
  let activeFunded = 0;
  let overdueFunded = 0;
  let latestSettlement = 0;
  const supplierFaces = new Map<string, bigint>();
  let totalFace = 0n;
  for (const [invoiceId, lifecycle] of histories) {
    const state = states.get(invoiceId)!;
    totalFace += state.faceValue;
    supplierFaces.set(state.supplier, (supplierFaces.get(state.supplier) ?? 0n) + state.faceValue);
    if (lifecycle.settled) {
      completedSettlements += 1;
      const settledAt = settlementTimestamps.get(lifecycle.settled.blockNumber);
      if (settledAt === undefined) throw new Error("RECEIPT_HISTORY_MISSING_SETTLEMENT_TIMESTAMP");
      if (settledAt > firstPinned.timestamp) throw new Error("RECEIPT_HISTORY_SETTLEMENT_FROM_FUTURE");
      latestSettlement = Math.max(latestSettlement, settledAt);
      if (BigInt(settledAt) <= state.dueDate) onTimeSettlements += 1;
      else lateSettlements += 1;
    } else if (state.status === 2) {
      if (state.dueDate < BigInt(firstPinned.timestamp)) overdueFunded += 1;
      else activeFunded += 1;
    }
  }
  const maximumSupplierFace = [...supplierFaces.values()].reduce((maximum, current) => current > maximum ? current : maximum, 0n);
  const concentration = totalFace === 0n ? 0n : maximumSupplierFace * 10_000n / totalFace;
  const withoutCommitment = {
    schemaVersion: RECEIPT_HISTORY_SCHEMA,
    chainId: 196 as const,
    receivables: getAddress(deployment.receivables), payer,
    fromBlock: fromBlock.toString(), throughBlock: throughBlock.toString(), throughBlockHash: firstPinned.hash,
    completedSettlements, onTimeSettlements, lateSettlements, activeFunded, overdueFunded,
    counterpartyConcentrationBps: safeNumber(concentration, "CONCENTRATION_RANGE"),
    daysSinceLastSettlement: latestSettlement === 0 ? 0 : Math.floor((firstPinned.timestamp - latestSettlement) / 86_400),
    invoiceIds: [...histories.keys()].sort()
  } as const;
  const snapshot = { ...withoutCommitment, historyCommitment: receiptBoundHistoryCommitment(withoutCommitment) };

  const [firstFinal, secondFinal] = await Promise.all([
    providers[0].request("eth_getBlockByNumber", [blockTag, false]).then((value) => canonicalBlock(value, throughBlock)),
    providers[1].request("eth_getBlockByNumber", [blockTag, false]).then((value) => canonicalBlock(value, throughBlock))
  ]);
  if (firstFinal.hash !== firstPinned.hash || secondFinal.hash !== firstPinned.hash) throw new Error("RECEIPT_HISTORY_PINNED_BLOCK_REORG");
  return snapshot;
}
