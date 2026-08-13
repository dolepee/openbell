import { privateKeyToAccount } from "viem/accounts";
import { expect, test } from "vitest";
import {
  CONNECTED_TESTNET,
  ConnectedUnderwritingService,
  connectedAssessmentTypedData,
  type ConnectedDecisionStore,
  type ConnectedUnderwritingRequest,
  type RegisteredInvoiceObservation,
  type StoredConnectedDecision
} from "../src/connected-underwriting.js";
import type { InvoiceRiskInput, ModelDecision, UnderwritingModel } from "../src/schema.js";

const supplier = privateKeyToAccount(`0x${"11".repeat(32)}`);
const payer = privateKeyToAccount(`0x${"22".repeat(32)}`);
const funder = privateKeyToAccount(`0x${"33".repeat(32)}`);
const underwriter = privateKeyToAccount(`0x${"44".repeat(32)}`);

const unsignedRequest: Omit<ConnectedUnderwritingRequest, "supplierAuthorization"> = {
  schemaVersion: CONNECTED_TESTNET.schemaVersion,
  label: CONNECTED_TESTNET.label,
  registrationTransactionHash: `0x${"10".repeat(32)}`,
  invoiceId: `0x${"aa".repeat(32)}`,
  documentHash: `0x${"bb".repeat(32)}`,
  supplier: supplier.address,
  payer: payer.address,
  funder: funder.address,
  faceValue: "100000000",
  issuedAt: 1_786_550_000,
  dueDate: 1_789_142_000,
  requestedAdvance: "75000000",
  payerHistory: { completedSettlements: 0, onTimeSettlements: 0, lateSettlements: 0, defaults: 0, concentrationBps: 0, daysSinceLastSettlement: 0 },
  redactedContext: "Synthetic X Layer testnet fixture evidence; no real value.",
  syntheticFixtureAcknowledged: true
};
const request: ConnectedUnderwritingRequest = {
  ...unsignedRequest,
  supplierAuthorization: await supplier.signTypedData(connectedAssessmentTypedData(unsignedRequest))
};
const authorizedRequest = async (changes: Partial<Omit<ConnectedUnderwritingRequest, "supplierAuthorization">>): Promise<ConnectedUnderwritingRequest> => {
  const unsigned = { ...unsignedRequest, ...changes };
  return { ...unsigned, supplierAuthorization: await supplier.signTypedData(connectedAssessmentTypedData(unsigned)) };
};

class MemoryStore implements ConnectedDecisionStore {
  readonly rows = new Map<string, StoredConnectedDecision>();
  async load(invoiceId: `0x${string}`): Promise<StoredConnectedDecision | null> { return this.rows.get(invoiceId) ?? null; }
  async claim(invoiceId: `0x${string}`, requestHash: `0x${string}`): Promise<{ claimed: boolean; row: StoredConnectedDecision }> {
    const existing = this.rows.get(invoiceId);
    if (existing) return { claimed: false, row: existing };
    const row = { requestHash, status: "CLAIMED" as const };
    this.rows.set(invoiceId, row);
    return { claimed: true, row };
  }
  async complete(invoiceId: `0x${string}`, requestHash: `0x${string}`, resultJson: string): Promise<void> {
    this.rows.set(invoiceId, { requestHash, status: "COMPLETE", resultJson });
  }
  async fail(invoiceId: `0x${string}`, requestHash: `0x${string}`, failureCode: string): Promise<void> {
    this.rows.set(invoiceId, { requestHash, status: "FAILED", failureCode });
  }
  async reserveDailyModelCall(): Promise<boolean> { return true; }
}

const observation = (overrides: Partial<RegisteredInvoiceObservation> = {}): RegisteredInvoiceObservation => ({
  chainId: 1952,
  receivables: CONNECTED_TESTNET.receivables,
  settlementToken: CONNECTED_TESTNET.settlementToken,
  blockNumber: "120000",
  blockHash: `0x${"12".repeat(32)}`,
  blockTimestamp: 1_786_550_100,
  registrationTransactionHash: request.registrationTransactionHash,
  status: "REGISTERED",
  invoiceId: request.invoiceId,
  invoiceDigest: `0x${"cc".repeat(32)}`,
  documentHash: request.documentHash,
  supplier: request.supplier,
  payer: request.payer,
  faceValue: request.faceValue,
  issuedAt: request.issuedAt,
  dueDate: request.dueDate,
  underwriter: underwriter.address,
  paused: false,
  decisionNonceUnused: true,
  ...overrides
});

const approval: ModelDecision = {
  verdict: "APPROVE",
  maximumAdvanceBps: 8_500,
  feeBps: 100,
  confidenceBps: 9_700,
  reasons: ["DUAL_SIGNATURES_VERIFIED", "DOCUMENT_HASH_VERIFIED", "CLEAN_DUPLICATE_CHECK", "STRONG_ON_TIME_HISTORY"],
  explanation: "Synthetic evidence is acceptable within bounded terms."
};

function harness(decision: ModelDecision | Error, observed = observation()) {
  const store = new MemoryStore();
  let observerCalls = 0;
  let modelCalls = 0;
  let signerCalls = 0;
  let capturedInput: InvoiceRiskInput | undefined;
  const model: UnderwritingModel & { readonly lastReceipt?: unknown } = {
    modelId: "bankr:gpt-5.6-terra",
    get lastReceipt() {
      return decision instanceof Error ? undefined : {
        provider: "bankr-chat-completions",
        providerResponseId: "bankr-test-response",
        requestedModel: "gpt-5.6-terra",
        returnedModel: "gpt-5.6-terra",
        requestHash: `0x${"ab".repeat(32)}`,
        responseHash: `0x${"cd".repeat(32)}`,
        decision
      };
    },
    async decide(input) {
      modelCalls += 1;
      capturedInput = input;
      if (decision instanceof Error) throw decision;
      return decision;
    }
  };
  const service = new ConnectedUnderwritingService({
    store,
    observer: { async inspect() { observerCalls += 1; return observed; } },
    modelFactory: () => model,
    signer: {
      address: underwriter.address,
      async sign(_typedData, digest) { signerCalls += 1; return underwriter.sign({ hash: digest }); }
    }
  });
  return { service, store, calls: () => ({ observerCalls, modelCalls, signerCalls }), capturedInput: () => capturedInput };
}

test("registered objective evidence produces exact bounded approval actions and durable byte replay", async () => {
  const h = harness(approval);
  const first = await h.service.authorize(request);
  expect(first.decision.verdict).toBe("APPROVE");
  if (first.decision.verdict !== "APPROVE") throw new Error("expected approval");
  expect(first.decision.advanceAmount).toBe("75000000");
  expect(first.decision.repaymentAmount).toBe("75750000");
  expect(first.actions.map((action) => action.kind)).toEqual(["APPROVE_FUNDING", "FUND_INVOICE", "APPROVE_SETTLEMENT", "SETTLE_INVOICE"]);
  expect(h.capturedInput()?.evidence).toEqual({ supplierSignatureValid: true, payerSignatureValid: true, duplicateInvoiceFound: false, documentHashMatches: true });
  const stored = JSON.stringify(first);
  const second = await h.service.authorize(JSON.parse(JSON.stringify(request)));
  expect(JSON.stringify(second)).toBe(stored);
  expect(h.calls()).toEqual({ observerCalls: 2, modelCalls: 1, signerCalls: 1 });
});

test("genuine model rejection emits only supplier rejection action", async () => {
  const h = harness({ verdict: "REJECT", maximumAdvanceBps: 0, feeBps: 0, confidenceBps: 9_000, reasons: ["PRIOR_DEFAULT"], explanation: "Prior default." });
  const result = await h.service.authorize(request);
  expect(result.decision.verdict).toBe("REJECT");
  expect(result.actions).toHaveLength(1);
  expect(result.actions[0]?.kind).toBe("ATTEST_REJECTION");
  expect(result.actions[0]?.signer).toBe(supplier.address);
});

test("supplier-declared payer history is rejected before chain, model, signer or DB access", async () => {
  const h = harness(approval);
  const withClaimedHistory = await authorizedRequest({ payerHistory: { ...request.payerHistory, completedSettlements: 1, onTimeSettlements: 1 } });
  await expect(h.service.authorize(withClaimedHistory)).rejects.toThrow("CONNECTED_UNVERIFIED_PAYER_HISTORY_FORBIDDEN");
  expect(h.calls()).toEqual({ observerCalls: 0, modelCalls: 0, signerCalls: 0 });
  expect(h.store.rows.size).toBe(0);
});

test("changed retry conflicts before a second observer, model, or signature call", async () => {
  const h = harness(approval);
  await h.service.authorize(request);
  await expect(h.service.authorize(await authorizedRequest({ requestedAdvance: "74000000" }))).rejects.toThrow("CONNECTED_DECISION_REQUEST_CONFLICT");
  expect(h.calls()).toEqual({ observerCalls: 2, modelCalls: 1, signerCalls: 1 });
});

test("durable replay rejects a coherently edited decision row without external calls", async () => {
  const h = harness(approval);
  await h.service.authorize(request);
  const row = h.store.rows.get(request.invoiceId);
  if (row?.status !== "COMPLETE" || !row.resultJson) throw new Error("expected complete row");
  const parsed = JSON.parse(row.resultJson);
  parsed.decision.advanceAmount = "74000000";
  h.store.rows.set(request.invoiceId, { ...row, resultJson: JSON.stringify(parsed) });
  await expect(h.service.authorize(request)).rejects.toThrow("CONNECTED_DECISION_CORRUPT_MODEL_BINDING");
  expect(h.calls()).toEqual({ observerCalls: 2, modelCalls: 1, signerCalls: 1 });
});

test("first model failure is durable and never retried", async () => {
  const h = harness(new Error("LIVE_MODEL_TIMEOUT"));
  await expect(h.service.authorize(request)).rejects.toThrow("LIVE_MODEL_TIMEOUT");
  await expect(h.service.authorize(request)).rejects.toThrow("LIVE_MODEL_TIMEOUT");
  expect(h.calls()).toEqual({ observerCalls: 1, modelCalls: 1, signerCalls: 0 });
});

test("wrong deployment or invoice state fails before reservation, model, or signature", async () => {
  const h = harness(approval, observation({ status: "REGISTERED", paused: true as false }));
  await expect(h.service.authorize(request)).rejects.toThrow("CONNECTED_OBSERVATION_NOT_AUTHORIZABLE");
  expect(h.calls()).toEqual({ observerCalls: 1, modelCalls: 0, signerCalls: 0 });
  expect(h.store.rows.size).toBe(0);
});

test("configured signer must still be the current onchain underwriter", async () => {
  const h = harness(approval, observation({ underwriter: payer.address }));
  await expect(h.service.authorize(request)).rejects.toThrow("CONNECTED_SIGNER_NOT_CURRENT_UNDERWRITER");
  expect(h.calls()).toEqual({ observerCalls: 1, modelCalls: 0, signerCalls: 0 });
  expect(h.store.rows.size).toBe(0);
});

test("only the registered supplier can authorize the paid assessment", async () => {
  const h = harness(approval);
  const forged = { ...request, supplierAuthorization: await payer.signTypedData(connectedAssessmentTypedData(unsignedRequest)) };
  await expect(h.service.authorize(forged)).rejects.toThrow("CONNECTED_ASSESSMENT_WRONG_SUPPLIER_SIGNATURE");
  expect(h.calls()).toEqual({ observerCalls: 0, modelCalls: 0, signerCalls: 0 });
  expect(h.store.rows.size).toBe(0);
});

test("malleated high-s supplier authority is rejected before any side effect", async () => {
  const original = request.supplierAuthorization;
  const originalS = BigInt(`0x${original.slice(66, 130)}`);
  const originalV = Number.parseInt(original.slice(130, 132), 16);
  const highS = (0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n - originalS).toString(16).padStart(64, "0");
  const malleated = `${original.slice(0, 66)}${highS}${originalV === 27 ? "1c" : "1b"}`;
  const h = harness(approval);
  await expect(h.service.authorize({ ...request, supplierAuthorization: malleated })).rejects.toThrow("CONNECTED_NON_CANONICAL_SIGNATURE");
  expect(h.calls()).toEqual({ observerCalls: 0, modelCalls: 0, signerCalls: 0 });
});
