import { privateKeyToAccount } from "viem/accounts";
import { keccak256, stringToHex } from "viem";
import { expect, test } from "vitest";
import {
  CONNECTED_MAINNET,
  CONNECTED_TESTNET,
  ConnectedUnderwritingService,
  ConnectedPolicyRefusal,
  connectedArtifactHashOf,
  connectedAssessmentTypedData,
  type ConnectedDecisionStore,
  type ConnectedDeployment,
  type ConnectedUnderwritingRequest,
  type RegisteredInvoiceObservation,
  type StoredConnectedDecision
} from "../src/connected-underwriting.js";
import type { InvoiceRiskInput, ModelDecision, UnderwritingModel } from "../src/schema.js";
import { buildStrictBankrRequest } from "../src/live-model.js";
import {
  BANKR_APPROVAL_EXPLANATION,
  BANKR_MAINNET_APPROVAL_EXPLANATION,
  BANKR_REJECTION_EXPLANATION
} from "../src/live-model.js";

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
  readonly refusals = new Map<string, { resultJson: string; artifactHash: `0x${string}` }>();
  readonly completedArtifactHashes = new Map<string, `0x${string}`>();
  async load(invoiceId: `0x${string}`): Promise<StoredConnectedDecision | null> { return this.rows.get(invoiceId) ?? null; }
  async claim(invoiceId: `0x${string}`, requestHash: `0x${string}`): Promise<{ claimed: boolean; row: StoredConnectedDecision }> {
    const existing = this.rows.get(invoiceId);
    if (existing) return { claimed: false, row: existing };
    const row = { requestHash, status: "CLAIMED" as const };
    this.rows.set(invoiceId, row);
    return { claimed: true, row };
  }
  async beginModel(invoiceId: `0x${string}`, requestHash: `0x${string}`): Promise<void> {
    this.rows.set(invoiceId, { requestHash, status: "MODEL_IN_FLIGHT" });
  }
  async complete(invoiceId: `0x${string}`, requestHash: `0x${string}`, resultJson: string, artifactHash: `0x${string}`): Promise<void> {
    this.rows.set(invoiceId, { requestHash, status: "COMPLETE", resultJson });
    this.completedArtifactHashes.set(invoiceId, artifactHash);
  }
  async loadCompletedArtifactHash(invoiceId: `0x${string}`): Promise<`0x${string}` | null> { return this.completedArtifactHashes.get(invoiceId) ?? null; }
  async fail(invoiceId: `0x${string}`, requestHash: `0x${string}`, failureCode: string): Promise<void> {
    this.rows.set(invoiceId, { requestHash, status: "FAILED", failureCode });
  }
  async sealPolicyRefusal(invoiceId: `0x${string}`, requestHash: `0x${string}`, resultJson: string, artifactHash: `0x${string}`, failureCode: string): Promise<void> {
    if (this.refusals.has(invoiceId)) throw new Error("CONNECTED_STORE_REFUSAL_CONFLICT");
    this.refusals.set(invoiceId, { resultJson, artifactHash });
    this.rows.set(invoiceId, { requestHash, status: "FAILED", failureCode });
  }
  async loadPolicyRefusal(invoiceId: `0x${string}`): Promise<{ resultJson: string; artifactHash: `0x${string}` } | null> { return this.refusals.get(invoiceId) ?? null; }
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
  documentHashRegistered: true,
  invoiceDigestRegistered: true,
  ...overrides
});

const approval: ModelDecision = {
  verdict: "APPROVE",
  maximumAdvanceBps: 8_500,
  feeBps: 100,
  confidenceBps: 9_700,
  reasons: ["DUAL_SIGNATURES_VERIFIED", "DOCUMENT_HASH_VERIFIED", "CLEAN_DUPLICATE_CHECK", "LIMITED_PAYER_HISTORY"],
  explanation: BANKR_APPROVAL_EXPLANATION
};

function harness(decision: ModelDecision | Error, observed = observation(), postObserved = observed, deployment: ConnectedDeployment = CONNECTED_TESTNET) {
  const store = new MemoryStore();
  let observerCalls = 0;
  let modelCalls = 0;
  let capturedInput: InvoiceRiskInput | undefined;
  const model: UnderwritingModel & { readonly lastReceipt?: unknown } = {
    modelId: "bankr:gpt-5.6-terra",
    get lastReceipt() {
      if (decision instanceof Error) return undefined;
      const rawResponse = JSON.stringify({
        id: "bankr-test-response",
        object: "chat.completion",
        model: "gpt-5.6-terra",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(decision) } }]
      });
      return {
        provider: "bankr-chat-completions",
        providerResponseId: "bankr-test-response",
        requestedModel: "gpt-5.6-terra",
        returnedModel: "gpt-5.6-terra",
        requestHash: buildStrictBankrRequest(capturedInput!, deployment === CONNECTED_MAINNET ? "registered-mainnet" : "synthetic").requestHash,
        responseHash: keccak256(stringToHex(rawResponse)),
        rawResponse,
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
    observer: { async inspect() { observerCalls += 1; return observerCalls === 1 ? observed : postObserved; } },
    modelFactory: () => model,
    deployment
  });
  return { service, store, calls: () => ({ observerCalls, modelCalls }), capturedInput: () => capturedInput };
}

test("mainnet requests bind the genuine-value acknowledgement, chain-196 domain and production deployment", async () => {
  const { syntheticFixtureAcknowledged: _fixtureBoundary, ...commonRequest } = unsignedRequest;
  const unsignedMainnet: Omit<ConnectedUnderwritingRequest, "supplierAuthorization"> = {
    ...commonRequest,
    schemaVersion: CONNECTED_MAINNET.schemaVersion,
    label: CONNECTED_MAINNET.label,
    realValueAcknowledged: true
  };
  const mainnetRequest: ConnectedUnderwritingRequest = {
    ...unsignedMainnet,
    supplierAuthorization: await supplier.signTypedData(connectedAssessmentTypedData(unsignedMainnet, CONNECTED_MAINNET))
  };
  const mainnetObservation = observation({
    chainId: CONNECTED_MAINNET.chainId,
    receivables: CONNECTED_MAINNET.receivables,
    settlementToken: CONNECTED_MAINNET.settlementToken,
    registrationTransactionHash: mainnetRequest.registrationTransactionHash,
    invoiceId: mainnetRequest.invoiceId,
    documentHash: mainnetRequest.documentHash,
    supplier: mainnetRequest.supplier,
    payer: mainnetRequest.payer,
    faceValue: mainnetRequest.faceValue,
    issuedAt: mainnetRequest.issuedAt,
    dueDate: mainnetRequest.dueDate
  });
  const h = harness({ ...approval, explanation: BANKR_MAINNET_APPROVAL_EXPLANATION }, mainnetObservation, mainnetObservation, CONNECTED_MAINNET);
  const result = await h.service.authorize(mainnetRequest);
  expect(result.signingRequest).toMatchObject({ label: CONNECTED_MAINNET.label, chainId: "196" });
  expect(result.observation).toMatchObject({ chainId: 196, receivables: CONNECTED_MAINNET.receivables, settlementToken: CONNECTED_MAINNET.settlementToken });
  await expect(h.service.authorize({ ...mainnetRequest, realValueAcknowledged: undefined })).rejects.toThrow();
});

test("mainnet service rejects a correctly signed testnet request before chain observation or model use", async () => {
  const h = harness(approval, observation(), observation(), CONNECTED_MAINNET);
  await expect(h.service.authorize(request)).rejects.toThrow();
  expect(h.calls()).toEqual({ observerCalls: 0, modelCalls: 0 });
  expect(h.store.rows.size).toBe(0);
});

test("mainnet service rejects supplier authority signed for the testnet EIP-712 domain", async () => {
  const { syntheticFixtureAcknowledged: _fixtureBoundary, ...commonRequest } = unsignedRequest;
  const unsignedMainnet: Omit<ConnectedUnderwritingRequest, "supplierAuthorization"> = {
    ...commonRequest,
    schemaVersion: CONNECTED_MAINNET.schemaVersion,
    label: CONNECTED_MAINNET.label,
    realValueAcknowledged: true
  };
  const wrongDomainSignature = await supplier.signTypedData(connectedAssessmentTypedData(unsignedMainnet, CONNECTED_TESTNET));
  const mainnetObservation = observation({
    chainId: CONNECTED_MAINNET.chainId,
    receivables: CONNECTED_MAINNET.receivables,
    settlementToken: CONNECTED_MAINNET.settlementToken
  });
  const h = harness(approval, mainnetObservation, mainnetObservation, CONNECTED_MAINNET);
  await expect(h.service.authorize({ ...unsignedMainnet, supplierAuthorization: wrongDomainSignature })).rejects.toThrow("CONNECTED_ASSESSMENT_WRONG_SUPPLIER_SIGNATURE");
  expect(h.calls()).toEqual({ observerCalls: 0, modelCalls: 0 });
  expect(h.store.rows.size).toBe(0);
});

test("registered objective evidence produces an unsigned bounded assessment and durable byte replay", async () => {
  const h = harness(approval);
  const first = await h.service.authorize(request);
  expect(first.decision.verdict).toBe("APPROVE");
  if (first.decision.verdict !== "APPROVE") throw new Error("expected approval");
  expect(first.decision.advanceAmount).toBe("75000000");
  expect(first.decision.repaymentAmount).toBe("75750000");
  expect(first.signingRequest).toMatchObject({ underwriter: underwriter.address, chainId: "1952" });
  expect(h.capturedInput()?.evidence).toEqual({ supplierSignatureValid: true, payerSignatureValid: true, duplicateInvoiceFound: false, documentHashMatches: true });
  const stored = JSON.stringify(first);
  const second = await h.service.authorize(JSON.parse(JSON.stringify(request)));
  expect(JSON.stringify(second)).toBe(stored);
  expect(h.calls()).toEqual({ observerCalls: 2, modelCalls: 1 });
});

test("durable replay remains exact when the confirmed block advances during the model call", async () => {
  const firstObservation = observation();
  const postObservation = observation({
    blockNumber: "120001",
    blockHash: `0x${"13".repeat(32)}`,
    blockTimestamp: firstObservation.blockTimestamp + 5
  });
  const h = harness(approval, firstObservation, postObservation);
  const first = await h.service.authorize(request);
  expect(first.decision.riskTimestamp).toBe(postObservation.blockTimestamp);
  expect(first.observation.blockHash).toBe(postObservation.blockHash);
  const second = await h.service.authorize(request);
  expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  expect(h.calls()).toEqual({ observerCalls: 2, modelCalls: 1 });
});

test("durable successful replay rejects result bytes that do not match the stored artifact commitment", async () => {
  const h = harness(approval);
  await h.service.authorize(request);
  const row = h.store.rows.get(request.invoiceId);
  if (row?.status !== "COMPLETE" || !row.resultJson) throw new Error("expected complete row");
  const parsed = JSON.parse(row.resultJson);
  parsed.modelEvidence.providerResponseId = "transport-edited-response";
  h.store.rows.set(request.invoiceId, { ...row, resultJson: JSON.stringify(parsed) });
  await expect(h.service.authorize(request)).rejects.toThrow("CONNECTED_DECISION_ARTIFACT_HASH_MISMATCH");
  expect(h.calls()).toEqual({ observerCalls: 2, modelCalls: 1 });
});

test("genuine model rejection emits an unsigned underwriter signing request", async () => {
  const h = harness({ verdict: "REJECT", maximumAdvanceBps: 0, feeBps: 0, confidenceBps: 9_000, reasons: ["MODEL_UNCERTAINTY"], explanation: BANKR_REJECTION_EXPLANATION });
  const result = await h.service.authorize(request);
  expect(result.decision.verdict).toBe("REJECT");
  expect(result.signingRequest.underwriter).toBe(underwriter.address);
});

test("low-confidence approval preserves model evidence but creates no signing authority", async () => {
  const h = harness({ ...approval, confidenceBps: 6_999 });
  let refusal: ConnectedPolicyRefusal | undefined;
  try {
    await h.service.authorize(request);
  } catch (error) {
    if (error instanceof ConnectedPolicyRefusal) refusal = error;
    else throw error;
  }
  expect(refusal?.evidence).toMatchObject({
    outcome: "POLICY_REFUSAL",
    executionAuthority: false,
    refusal: { code: "LOW_CONFIDENCE" },
    modelEvidence: { decision: { verdict: "APPROVE", confidenceBps: 6_999 } }
  });
  expect(Object.keys(refusal?.evidence ?? {})).not.toContain("signingRequest");
  expect(h.store.rows.get(request.invoiceId)).toEqual(expect.objectContaining({ status: "FAILED", failureCode: "LOW_CONFIDENCE" }));
  expect(h.store.refusals.has(request.invoiceId)).toBe(true);
  expect(h.calls()).toEqual({ observerCalls: 2, modelCalls: 1 });
  let replay: ConnectedPolicyRefusal | undefined;
  try {
    await h.service.authorize(request);
  } catch (error) {
    if (error instanceof ConnectedPolicyRefusal) replay = error;
    else throw error;
  }
  expect(replay?.evidence).toEqual(refusal?.evidence);
  expect(h.calls()).toEqual({ observerCalls: 2, modelCalls: 1 });
});

test.each(["providerResponseId", "responseHash", "decision"] as const)("durable refusal replay rejects edited artifact field %s", async (field) => {
  const h = harness({ ...approval, confidenceBps: 6_999 });
  await expect(h.service.authorize(request)).rejects.toBeInstanceOf(ConnectedPolicyRefusal);
  const stored = h.store.refusals.get(request.invoiceId);
  if (!stored) throw new Error("expected stored refusal");
  const parsed = JSON.parse(stored.resultJson);
  if (field === "providerResponseId") parsed.modelEvidence.providerResponseId = "forged-response";
  else if (field === "responseHash") parsed.modelEvidence.responseHash = `0x${"ef".repeat(32)}`;
  else parsed.modelEvidence.decision.confidenceBps = 6_998;
  h.store.refusals.set(request.invoiceId, { ...stored, resultJson: JSON.stringify(parsed) });
  await expect(h.service.authorize(request)).rejects.toThrow("CONNECTED_POLICY_REFUSAL_ARTIFACT_HASH_MISMATCH");
  expect(h.calls()).toEqual({ observerCalls: 2, modelCalls: 1 });
});

test("durable refusal replay rejects a terminal failure code that disagrees with its sealed artifact", async () => {
  const h = harness({ ...approval, confidenceBps: 6_999 });
  await expect(h.service.authorize(request)).rejects.toBeInstanceOf(ConnectedPolicyRefusal);
  const row = h.store.rows.get(request.invoiceId);
  if (!row || row.status !== "FAILED") throw new Error("expected failed refusal row");
  h.store.rows.set(request.invoiceId, { ...row, failureCode: "MODEL_REJECTED" });
  await expect(h.service.authorize(request)).rejects.toThrow("CONNECTED_POLICY_REFUSAL_FAILURE_CODE_MISMATCH");
  expect(h.calls()).toEqual({ observerCalls: 2, modelCalls: 1 });
});

test("refusal persistence failure does not create a terminal row without its artifact", async () => {
  const h = harness({ ...approval, confidenceBps: 6_999 });
  h.store.sealPolicyRefusal = async () => { throw new Error("D1_BATCH_FAILED"); };
  await expect(h.service.authorize(request)).rejects.toThrow("CONNECTED_POLICY_REFUSAL_PERSISTENCE_FAILED");
  expect(h.store.rows.get(request.invoiceId)).toEqual(expect.objectContaining({ status: "MODEL_IN_FLIGHT" }));
  expect(h.store.refusals.has(request.invoiceId)).toBe(false);
  expect(h.calls()).toEqual({ observerCalls: 2, modelCalls: 1 });
});

test.each([
  "STRONG_ON_TIME_HISTORY",
  "LATE_PAYMENT_HISTORY",
  "PRIOR_DEFAULT",
  "HIGH_COUNTERPARTY_CONCENTRATION",
  "STALE_SETTLEMENT_HISTORY"
] as const)("unsupported zero-history model reason %s fails before signing", async (reason) => {
  const h = harness({ ...approval, reasons: [reason] });
  await expect(h.service.authorize(request)).rejects.toThrow("CONNECTED_MODEL_REASON_UNSUPPORTED_BY_EVIDENCE");
  expect(h.calls()).toEqual({ observerCalls: 1, modelCalls: 1 });
  const stored = h.store.rows.get(request.invoiceId);
  expect(stored?.status).toBe("FAILED");
});

test("free-form model explanation fails before signing even with supported reasons", async () => {
  const h = harness({ ...approval, explanation: "The payer has prior defaults despite the zero-history evidence." });
  await expect(h.service.authorize(request)).rejects.toThrow("CONNECTED_MODEL_EXPLANATION_UNSUPPORTED");
  expect(h.calls()).toEqual({ observerCalls: 1, modelCalls: 1 });
});

test("supplier-declared payer history is rejected before chain, model, signer or DB access", async () => {
  const h = harness(approval);
  const withClaimedHistory = await authorizedRequest({ payerHistory: { ...request.payerHistory, completedSettlements: 1, onTimeSettlements: 1 } });
  await expect(h.service.authorize(withClaimedHistory)).rejects.toThrow("CONNECTED_UNVERIFIED_PAYER_HISTORY_FORBIDDEN");
  expect(h.calls()).toEqual({ observerCalls: 0, modelCalls: 0 });
  expect(h.store.rows.size).toBe(0);
});

test("zero requested advance is rejected before chain, model, signer or DB access", async () => {
  const h = harness(approval);
  const zeroAdvance = await authorizedRequest({ requestedAdvance: "0" });
  await expect(h.service.authorize(zeroAdvance)).rejects.toThrow();
  expect(h.calls()).toEqual({ observerCalls: 0, modelCalls: 0 });
  expect(h.store.rows.size).toBe(0);
});

test("changed retry conflicts before a second observer, model, or signature call", async () => {
  const h = harness(approval);
  await h.service.authorize(request);
  await expect(h.service.authorize(await authorizedRequest({ requestedAdvance: "74000000" }))).rejects.toThrow("CONNECTED_DECISION_REQUEST_CONFLICT");
  expect(h.calls()).toEqual({ observerCalls: 2, modelCalls: 1 });
});

test("durable replay rejects a coherently edited decision row without external calls", async () => {
  const h = harness(approval);
  await h.service.authorize(request);
  const row = h.store.rows.get(request.invoiceId);
  if (row?.status !== "COMPLETE" || !row.resultJson) throw new Error("expected complete row");
  const parsed = JSON.parse(row.resultJson);
  parsed.decision.advanceAmount = "74000000";
  h.store.rows.set(request.invoiceId, { ...row, resultJson: JSON.stringify(parsed) });
  h.store.completedArtifactHashes.set(request.invoiceId, connectedArtifactHashOf(parsed));
  await expect(h.service.authorize(request)).rejects.toThrow("CONNECTED_DECISION_CORRUPT_MODEL_BINDING");
  expect(h.calls()).toEqual({ observerCalls: 2, modelCalls: 1 });
});

test("durable replay rejects a coherently rewritten provider envelope and commitment", async () => {
  const h = harness(approval);
  await h.service.authorize(request);
  const row = h.store.rows.get(request.invoiceId);
  if (row?.status !== "COMPLETE" || !row.resultJson) throw new Error("expected complete row");
  const parsed = JSON.parse(row.resultJson);
  parsed.modelEvidence.providerResponseId = "coherently-forged-response";
  const envelope = JSON.parse(parsed.modelEvidence.rawResponse);
  envelope.id = parsed.modelEvidence.providerResponseId;
  parsed.modelEvidence.rawResponse = JSON.stringify(envelope);
  parsed.modelEvidence.responseHash = keccak256(stringToHex(parsed.modelEvidence.rawResponse));
  h.store.rows.set(request.invoiceId, { ...row, resultJson: JSON.stringify(parsed) });
  h.store.completedArtifactHashes.set(request.invoiceId, connectedArtifactHashOf(parsed));
  await expect(h.service.authorize(request)).rejects.toThrow("CONNECTED_DECISION_CORRUPT_MODEL_BINDING");
  expect(h.calls()).toEqual({ observerCalls: 2, modelCalls: 1 });
});

test.each(["providerResponseId", "responseHash"] as const)("durable replay rejects edited model provenance field %s", async (field) => {
  const h = harness(approval);
  await h.service.authorize(request);
  const row = h.store.rows.get(request.invoiceId);
  if (row?.status !== "COMPLETE" || !row.resultJson) throw new Error("expected complete row");
  const parsed = JSON.parse(row.resultJson);
  parsed.modelEvidence[field] = field === "providerResponseId" ? "forged-response" : `0x${"ef".repeat(32)}`;
  h.store.rows.set(request.invoiceId, { ...row, resultJson: JSON.stringify(parsed) });
  h.store.completedArtifactHashes.set(request.invoiceId, connectedArtifactHashOf(parsed));
  await expect(h.service.authorize(request)).rejects.toThrow("CONNECTED_MODEL_RECEIPT_INVALID");
  expect(h.calls()).toEqual({ observerCalls: 2, modelCalls: 1 });
});

test("durable replay recomputes and rejects an edited Bankr request hash", async () => {
  const h = harness(approval);
  await h.service.authorize(request);
  const row = h.store.rows.get(request.invoiceId);
  if (row?.status !== "COMPLETE" || !row.resultJson) throw new Error("expected complete row");
  const parsed = JSON.parse(row.resultJson);
  parsed.modelEvidence.requestHash = `0x${"ef".repeat(32)}`;
  h.store.rows.set(request.invoiceId, { ...row, resultJson: JSON.stringify(parsed) });
  h.store.completedArtifactHashes.set(request.invoiceId, connectedArtifactHashOf(parsed));
  await expect(h.service.authorize(request)).rejects.toThrow("CONNECTED_MODEL_REQUEST_HASH_MISMATCH");
  expect(h.calls()).toEqual({ observerCalls: 2, modelCalls: 1 });
});

test("first model failure is durable and never retried", async () => {
  const h = harness(new Error("LIVE_MODEL_TIMEOUT"));
  await expect(h.service.authorize(request)).rejects.toThrow("LIVE_MODEL_TIMEOUT");
  await expect(h.service.authorize(request)).rejects.toThrow("LIVE_MODEL_TIMEOUT");
  expect(h.calls()).toEqual({ observerCalls: 1, modelCalls: 1 });
});

test("wrong deployment or invoice state fails before reservation, model, or signature", async () => {
  const h = harness(approval, observation({ status: "REGISTERED", paused: true as false }));
  await expect(h.service.authorize(request)).rejects.toThrow("CONNECTED_OBSERVATION_NOT_AUTHORIZABLE");
  expect(h.calls()).toEqual({ observerCalls: 1, modelCalls: 0 });
  expect(h.store.rows.get(request.invoiceId)?.status).toBe("FAILED");
});

test("the unsigned signing request binds the current onchain underwriter without server-side signing", async () => {
  const h = harness(approval, observation({ underwriter: payer.address }));
  const result = await h.service.authorize(request);
  expect(result.signingRequest.underwriter).toBe(payer.address);
  expect(h.calls()).toEqual({ observerCalls: 2, modelCalls: 1 });
});

test("only the registered supplier can authorize the paid assessment", async () => {
  const h = harness(approval);
  const forged = { ...request, supplierAuthorization: await payer.signTypedData(connectedAssessmentTypedData(unsignedRequest)) };
  await expect(h.service.authorize(forged)).rejects.toThrow("CONNECTED_ASSESSMENT_WRONG_SUPPLIER_SIGNATURE");
  expect(h.calls()).toEqual({ observerCalls: 0, modelCalls: 0 });
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
  expect(h.calls()).toEqual({ observerCalls: 0, modelCalls: 0 });
});
