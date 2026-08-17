import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  getAddress,
  toHex,
  type Hex
} from "viem";
import { describe, expect, test } from "vitest";
import type { ReadOnlyJsonRpc } from "../src/confirmed-connected-observer.js";
import { CONNECTED_MAINNET } from "../src/connected-underwriting.js";
import { MAINNET_RECEIPT_HISTORY_BASELINE } from "../src/mainnet-receipt-history-baseline.js";
import { deriveReceiptBoundHistory, parseReceiptBoundHistorySnapshot } from "../src/receipt-bound-history.js";

const eventAbi = [
  { type: "event", name: "InvoiceRegistered", anonymous: false, inputs: [
    { name: "invoiceId", type: "bytes32", indexed: true }, { name: "invoiceDigest", type: "bytes32", indexed: true },
    { name: "supplier", type: "address", indexed: true }, { name: "payer", type: "address", indexed: false },
    { name: "faceValue", type: "uint128", indexed: false }, { name: "dueDate", type: "uint64", indexed: false },
    { name: "documentHash", type: "bytes32", indexed: false }
  ] },
  { type: "event", name: "InvoiceFunded", anonymous: false, inputs: [
    { name: "invoiceId", type: "bytes32", indexed: true }, { name: "decisionDigest", type: "bytes32", indexed: true },
    { name: "funder", type: "address", indexed: true }, { name: "supplier", type: "address", indexed: false },
    { name: "advanceAmount", type: "uint128", indexed: false }, { name: "repaymentAmount", type: "uint128", indexed: false },
    { name: "riskReasonsHash", type: "bytes32", indexed: false }, { name: "modelHash", type: "bytes32", indexed: false }
  ] },
  { type: "event", name: "InvoiceSettled", anonymous: false, inputs: [
    { name: "invoiceId", type: "bytes32", indexed: true }, { name: "payer", type: "address", indexed: true },
    { name: "funder", type: "address", indexed: true }, { name: "repaymentAmount", type: "uint128", indexed: false }
  ] },
  { type: "event", name: "InvoiceCancelled", anonymous: false, inputs: [
    { name: "invoiceId", type: "bytes32", indexed: true }, { name: "supplier", type: "address", indexed: true }
  ] },
  { type: "event", name: "InvoiceRejected", anonymous: false, inputs: [
    { name: "invoiceId", type: "bytes32", indexed: true }, { name: "decisionDigest", type: "bytes32", indexed: true },
    { name: "riskReasonsHash", type: "bytes32", indexed: false }, { name: "modelHash", type: "bytes32", indexed: false }
  ] }
] as const;

const readAbi = [{
  type: "function", name: "invoices", stateMutability: "view", inputs: [{ name: "invoiceId", type: "bytes32" }], outputs: [
    { name: "status", type: "uint8" }, { name: "supplier", type: "address" }, { name: "payer", type: "address" },
    { name: "funder", type: "address" }, { name: "faceValue", type: "uint128" }, { name: "advanceAmount", type: "uint128" },
    { name: "repaymentAmount", type: "uint128" }, { name: "dueDate", type: "uint64" }, { name: "documentHash", type: "bytes32" },
    { name: "invoiceDigest", type: "bytes32" }, { name: "decisionDigest", type: "bytes32" }
  ]
}] as const;

const payer = getAddress("0x1111111111111111111111111111111111111111");
const otherPayer = getAddress("0x2222222222222222222222222222222222222222");
const supplierA = getAddress("0x3333333333333333333333333333333333333333");
const supplierB = getAddress("0x4444444444444444444444444444444444444444");
const funder = getAddress("0x5555555555555555555555555555555555555555");
const zero = getAddress("0x0000000000000000000000000000000000000000");
const hash = (value: number): Hex => toHex(value, { size: 32 });
const blockHash = (block: bigint): Hex => toHex(block + 10_000n, { size: 32 });

interface InvoiceFixture {
  readonly invoiceId: Hex;
  readonly payer: `0x${string}`;
  readonly supplier: `0x${string}`;
  readonly faceValue: bigint;
  readonly dueDate: bigint;
  readonly status: 1 | 2 | 3 | 4 | 5;
  readonly registeredBlock: bigint;
  readonly fundedBlock?: bigint | undefined;
  readonly settledBlock?: bigint | undefined;
}

const fixture = (overrides: Partial<InvoiceFixture> = {}): InvoiceFixture => ({
  invoiceId: hash(1), payer, supplier: supplierA, faceValue: 100n, dueDate: 1_050n,
  status: 3, registeredBlock: 100n, fundedBlock: 101n, settledBlock: 102n, ...overrides
});

type RpcLog = {
  address: `0x${string}`; blockHash: Hex; blockNumber: Hex; transactionHash: Hex;
  transactionIndex: Hex; logIndex: Hex; data: Hex; topics: readonly Hex[]; removed: false;
};

const rpcLog = (block: bigint, index: number, transactionHash: Hex, topics: readonly Hex[], data: Hex): RpcLog => ({
  address: CONNECTED_MAINNET.receivables,
  blockHash: blockHash(block),
  blockNumber: `0x${block.toString(16)}`,
  transactionHash,
  transactionIndex: `0x${BigInt(transactionHash).toString(16)}`,
  logIndex: `0x${index.toString(16)}`,
  data,
  topics,
  removed: false
});
const exactTopics = (topics: ReturnType<typeof encodeEventTopics>): readonly Hex[] => topics.flat().filter((topic): topic is Hex => topic !== null);

const logsFor = (entry: InvoiceFixture): RpcLog[] => {
  const invoiceDigest = hash(Number(BigInt(entry.invoiceId) + 10n));
  const documentHash = hash(Number(BigInt(entry.invoiceId) + 20n));
  const decisionDigest = hash(Number(BigInt(entry.invoiceId) + 30n));
  const riskReasonsHash = hash(31);
  const modelHash = hash(32);
  const logs: RpcLog[] = [rpcLog(entry.registeredBlock, 0, entry.invoiceId,
    exactTopics(encodeEventTopics({ abi: eventAbi, eventName: "InvoiceRegistered", args: { invoiceId: entry.invoiceId, invoiceDigest, supplier: entry.supplier } })),
    encodeAbiParameters([{ type: "address" }, { type: "uint128" }, { type: "uint64" }, { type: "bytes32" }], [entry.payer, entry.faceValue, entry.dueDate, documentHash]))];
  if (entry.status === 2 || entry.status === 3) {
    logs.push(rpcLog(entry.fundedBlock ?? 101n, 1, entry.invoiceId,
      exactTopics(encodeEventTopics({ abi: eventAbi, eventName: "InvoiceFunded", args: { invoiceId: entry.invoiceId, decisionDigest, funder } })),
      encodeAbiParameters([{ type: "address" }, { type: "uint128" }, { type: "uint128" }, { type: "bytes32" }, { type: "bytes32" }], [entry.supplier, 50n, 51n, riskReasonsHash, modelHash])));
  }
  if (entry.status === 3) {
    logs.push(rpcLog(entry.settledBlock ?? 102n, 2, entry.invoiceId,
      exactTopics(encodeEventTopics({ abi: eventAbi, eventName: "InvoiceSettled", args: { invoiceId: entry.invoiceId, payer: entry.payer, funder } })),
      encodeAbiParameters([{ type: "uint128" }], [51n])));
  } else if (entry.status === 4) {
    logs.push(rpcLog(entry.registeredBlock + 1n, 1, entry.invoiceId,
      exactTopics(encodeEventTopics({ abi: eventAbi, eventName: "InvoiceCancelled", args: { invoiceId: entry.invoiceId, supplier: entry.supplier } })), "0x"));
  } else if (entry.status === 5) {
    logs.push(rpcLog(entry.registeredBlock + 1n, 1, entry.invoiceId,
      exactTopics(encodeEventTopics({ abi: eventAbi, eventName: "InvoiceRejected", args: { invoiceId: entry.invoiceId, decisionDigest } })),
      encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [riskReasonsHash, modelHash])));
  }
  return logs;
};

const stateFor = (entry: InvoiceFixture) => {
  const invoiceDigest = hash(Number(BigInt(entry.invoiceId) + 10n));
  const documentHash = hash(Number(BigInt(entry.invoiceId) + 20n));
  const decisionDigest = hash(Number(BigInt(entry.invoiceId) + 30n));
  return [entry.status, entry.supplier, entry.payer, entry.status === 2 || entry.status === 3 ? funder : zero,
    entry.faceValue, entry.status === 2 || entry.status === 3 ? 50n : 0n, entry.status === 2 || entry.status === 3 ? 51n : 0n,
    entry.dueDate, documentHash, invoiceDigest, entry.status === 2 || entry.status === 3 || entry.status === 5 ? decisionDigest : hash(0)] as const;
};

interface RpcOverrides {
  readonly mutateLogs?: (logs: RpcLog[], from: bigint, to: bigint) => RpcLog[];
  readonly mutateState?: (state: ReturnType<typeof stateFor>, invoiceId: Hex) => ReturnType<typeof stateFor>;
  readonly blockHash?: (block: bigint, call: number) => Hex;
}

const makeRpc = (label: string, fixtures: readonly InvoiceFixture[], overrides: RpcOverrides = {}) => {
  const allLogs = fixtures.flatMap(logsFor);
  const states = new Map(fixtures.map((entry) => [entry.invoiceId.toLowerCase(), entry]));
  const requestedRanges: Array<readonly [bigint, bigint]> = [];
  let blockCalls = 0;
  const rpc: ReadOnlyJsonRpc = {
    label,
    async request(method, params) {
      if (method === "eth_chainId") return "0xc4";
      if (method === "eth_blockNumber") return "0x6a";
      if (method === "eth_getBlockByNumber") {
        blockCalls += 1;
        const block = BigInt(params[0] as string);
        return { number: `0x${block.toString(16)}`, hash: overrides.blockHash?.(block, blockCalls) ?? blockHash(block), timestamp: `0x${(1_000n + block).toString(16)}` };
      }
      if (method === "eth_getLogs") {
        const filter = params[0] as { fromBlock: string; toBlock: string };
        const from = BigInt(filter.fromBlock);
        const to = BigInt(filter.toBlock);
        requestedRanges.push([from, to]);
        const selected = allLogs.filter((log) => BigInt(log.blockNumber) >= from && BigInt(log.blockNumber) <= to);
        return overrides.mutateLogs?.([...selected], from, to) ?? selected;
      }
      if (method === "eth_call") {
        const call = params[0] as { data: Hex };
        const decoded = decodeFunctionData({ abi: readAbi, data: call.data });
        const invoiceId = (decoded.args[0] as Hex).toLowerCase();
        const entry = states.get(invoiceId);
        if (!entry) throw new Error("missing fixture state");
        const state = stateFor(entry);
        return encodeFunctionResult({ abi: readAbi, functionName: "invoices", result: overrides.mutateState?.(state, entry.invoiceId) ?? state });
      }
      throw new Error(`unexpected ${method}`);
    }
  };
  return { rpc, requestedRanges };
};

const derive = async (fixtures: readonly InvoiceFixture[], firstOverrides: RpcOverrides = {}, secondOverrides: RpcOverrides = {}) => {
  const first = makeRpc("official-a", fixtures, firstOverrides);
  const second = makeRpc("official-b", fixtures, secondOverrides);
  const snapshot = await deriveReceiptBoundHistory([first.rpc, second.rpc], payer, {
    fromBlock: 100n, confirmations: 1n, chunkBlocks: 2n, maximumChunks: 10, maximumLogs: 100
  });
  return { snapshot, first, second };
};

describe("receipt-bound payer history", () => {
  test("the checked-in baseline has exact parity with the dual-provider evidence artifact", () => {
    const artifact = JSON.parse(readFileSync(new URL("../../evidence/openbell-receipt-bound-history-baseline.json", import.meta.url), "utf8")) as Record<string, unknown>;
    expect(parseReceiptBoundHistorySnapshot(artifact.snapshot)).toEqual(MAINNET_RECEIPT_HISTORY_BASELINE);
    expect(artifact.derivation).toEqual({ fromBlock: "67764503", throughBlock: "68230450", chunkSizeBlocks: 100, chunksPerProvider: 4660, confirmations: 12, providerAgreementRequired: true });
    expect(() => parseReceiptBoundHistorySnapshot({ ...MAINNET_RECEIPT_HISTORY_BASELINE, completedSettlements: 2 })).toThrow("RECEIPT_HISTORY_INCOMPLETE_SETTLEMENT_CLASSIFICATION");
    expect(() => parseReceiptBoundHistorySnapshot({ ...MAINNET_RECEIPT_HISTORY_BASELINE, historyCommitment: hash(999) })).toThrow("RECEIPT_HISTORY_COMMITMENT_MISMATCH");
  });

  test("derives exact settled, funded, timing, concentration, and contiguous pagination facts", async () => {
    const settledOnTime = fixture({ dueDate: 1_102n });
    const settledLate = fixture({ invoiceId: hash(2), supplier: supplierB, faceValue: 300n, dueDate: 1_100n, registeredBlock: 100n, fundedBlock: 102n, settledBlock: 103n });
    const fundedActive = fixture({ invoiceId: hash(3), faceValue: 100n, dueDate: 1_200n, status: 2, registeredBlock: 103n, fundedBlock: 104n, settledBlock: undefined });
    const fundedOverdue = fixture({ invoiceId: hash(4), supplier: supplierB, faceValue: 500n, dueDate: 1_050n, status: 2, registeredBlock: 104n, fundedBlock: 105n, settledBlock: undefined });
    const { snapshot, first, second } = await derive([settledOnTime, settledLate, fundedActive, fundedOverdue]);

    expect(snapshot).toMatchObject({
      completedSettlements: 2, onTimeSettlements: 1, lateSettlements: 1,
      activeFunded: 1, overdueFunded: 1, counterpartyConcentrationBps: 8000,
      daysSinceLastSettlement: 0, fromBlock: "100", throughBlock: "106"
    });
    expect(snapshot.invoiceIds).toEqual([hash(1), hash(2), hash(3), hash(4)]);
    expect(snapshot.historyCommitment).toMatch(/^0x[0-9a-f]{64}$/);
    expect(first.requestedRanges).toEqual([[100n, 101n], [102n, 103n], [104n, 105n], [106n, 106n]]);
    expect(second.requestedRanges).toEqual(first.requestedRanges);
  });

  test("returns a committed zero-history snapshot without inventing defaults", async () => {
    const { snapshot } = await derive([fixture({ payer: otherPayer })]);
    expect(snapshot).toMatchObject({ completedSettlements: 0, onTimeSettlements: 0, lateSettlements: 0, activeFunded: 0, overdueFunded: 0, counterpartyConcentrationBps: 0, daysSinceLastSettlement: 0, invoiceIds: [] });
  });

  test("cancelled and rejected invoices do not count as repayment or default", async () => {
    const { snapshot } = await derive([
      fixture({ invoiceId: hash(5), status: 4, fundedBlock: undefined, settledBlock: undefined }),
      fixture({ invoiceId: hash(6), status: 5, registeredBlock: 102n, fundedBlock: undefined, settledBlock: undefined })
    ]);
    expect(snapshot).toMatchObject({ completedSettlements: 0, activeFunded: 0, overdueFunded: 0 });
  });

  test("fails closed on provider log omission, mutation, pinned disagreement, and event-block disagreement", async () => {
    const entry = fixture();
    await expect(derive([entry], {}, { mutateLogs: (logs) => logs.slice(0, -1) })).rejects.toThrow("RECEIPT_HISTORY_PROVIDER_LOG_DIVERGENCE");
    await expect(derive([entry], {}, { mutateLogs: (logs) => logs.map((log) => ({ ...log, transactionHash: hash(999) })) })).rejects.toThrow("RECEIPT_HISTORY_PROVIDER_LOG_DIVERGENCE");
    await expect(derive([entry], {}, { blockHash: (block) => block === 106n ? hash(888) : blockHash(block) })).rejects.toThrow("RECEIPT_HISTORY_PINNED_BLOCK_DIVERGENCE");
    await expect(derive([entry], {}, { blockHash: (block) => block === 100n ? hash(777) : blockHash(block) })).rejects.toThrow("RECEIPT_HISTORY_EVENT_BLOCK_DIVERGENCE");
  });

  test("fails closed on duplicate logs, out-of-chunk logs, and lifecycle reordering", async () => {
    const entry = fixture();
    await expect(derive([entry], { mutateLogs: (logs) => logs.length ? [...logs, logs[0]!] : logs }, { mutateLogs: (logs) => logs.length ? [...logs, logs[0]!] : logs })).rejects.toThrow("RECEIPT_HISTORY_DUPLICATE_LOG");
    await expect(derive([entry], { mutateLogs: (logs, from) => from === 100n ? [{ ...logs[0]!, blockNumber: "0x69" }] : logs }, { mutateLogs: (logs, from) => from === 100n ? [{ ...logs[0]!, blockNumber: "0x69" }] : logs })).rejects.toThrow("RECEIPT_HISTORY_LOG_OUTSIDE_CHUNK");
    const reordered = fixture({ fundedBlock: 103n, settledBlock: 102n });
    await expect(derive([reordered])).rejects.toThrow("RECEIPT_HISTORY_INVALID_SETTLEMENT_ORDER");
  });

  test("fails closed on wrong-contract logs and the configured history-size ceiling", async () => {
    const wrongContract = (logs: RpcLog[]) => logs.map((log) => ({ ...log, address: supplierA }));
    await expect(derive([fixture()], { mutateLogs: wrongContract }, { mutateLogs: wrongContract })).rejects.toThrow("RECEIPT_HISTORY_WRONG_LOG_CONTRACT");
    const a = makeRpc("official-a", [fixture()]);
    const b = makeRpc("official-b", [fixture()]);
    await expect(deriveReceiptBoundHistory([a.rpc, b.rpc], payer, {
      fromBlock: 100n, confirmations: 1n, chunkBlocks: 2n, maximumChunks: 10, maximumLogs: 2
    })).rejects.toThrow("RECEIPT_HISTORY_LOG_LIMIT");
  });

  test("fails closed when pinned contract state disagrees with events or providers", async () => {
    const entry = fixture();
    const badStatus = (state: ReturnType<typeof stateFor>) => [2, ...state.slice(1)] as unknown as ReturnType<typeof stateFor>;
    await expect(derive([entry], { mutateState: badStatus }, { mutateState: badStatus })).rejects.toThrow("RECEIPT_HISTORY_INVOICE_STATE_MISMATCH");
    const changedFace = (state: ReturnType<typeof stateFor>) => [state[0], state[1], state[2], state[3], 999n, ...state.slice(5)] as unknown as ReturnType<typeof stateFor>;
    await expect(derive([entry], {}, { mutateState: changedFace })).rejects.toThrow("RECEIPT_HISTORY_INVOICE_STATE_DIVERGENCE");
  });

  test("fails closed on an invalid chunk size, insufficient limit, and a final pinned-block reorg", async () => {
    const a = makeRpc("official-a", [fixture()]);
    const b = makeRpc("official-b", [fixture()]);
    await expect(deriveReceiptBoundHistory([a.rpc, b.rpc], payer, { fromBlock: 100n, confirmations: 1n, chunkBlocks: 101n })).rejects.toThrow("RECEIPT_HISTORY_INVALID_CHUNK_SIZE");
    await expect(deriveReceiptBoundHistory([a.rpc, b.rpc], payer, { fromBlock: 100n, confirmations: 1n, chunkBlocks: 2n, maximumChunks: 3 })).rejects.toThrow("RECEIPT_HISTORY_CHUNK_LIMIT");
    await expect(deriveReceiptBoundHistory([a.rpc, b.rpc], payer, { fromBlock: 100n, throughBlock: 107n, confirmations: 1n })).rejects.toThrow("RECEIPT_HISTORY_UNCONFIRMED_THROUGH_BLOCK");
    const reorg = (block: bigint, call: number) => block === 106n && call > 4 ? hash(909) : blockHash(block);
    await expect(derive([fixture()], { blockHash: reorg }, { blockHash: reorg })).rejects.toThrow("RECEIPT_HISTORY_PINNED_BLOCK_REORG");
  });

  test("requires distinct provider identities", async () => {
    const one = makeRpc("same", [fixture()]).rpc;
    await expect(deriveReceiptBoundHistory([one, one], payer, { fromBlock: 100n, confirmations: 1n })).rejects.toThrow("RECEIPT_HISTORY_PROVIDERS_MUST_BE_DISTINCT");
  });
});
import { readFileSync } from "node:fs";
