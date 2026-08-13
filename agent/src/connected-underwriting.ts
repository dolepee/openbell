import {
  encodeAbiParameters,
  getAddress,
  hashTypedData,
  keccak256,
  parseAbiParameters,
  recoverTypedDataAddress,
  stringToHex,
  type Hex
} from "viem";
import { z } from "zod";
import { underwriteInvoice } from "./underwriter.js";
import { BANKR_APPROVAL_EXPLANATION, BANKR_REJECTION_EXPLANATION, buildStrictBankrRequest } from "./live-model.js";
import { boundedDecisionSchema, modelDecisionSchema, type BoundedDecision, type InvoiceRiskInput, type UnderwritingModel } from "./schema.js";

export const CONNECTED_TESTNET = Object.freeze({
  schemaVersion: "openbell-connected-underwriting-v1",
  label: "XLAYER TESTNET FIXTURE — NO REAL VALUE",
  chainId: 1952,
  receivables: "0x7eb9C2418ec935d43E6761e462eAA5388BD6ca18",
  settlementToken: "0x7E7a189a8CE288E9581Ba3CDf14ac3D4a1624703",
  maxAdvanceBps: 8_000,
  maxFeeBps: 2_000,
  maxRiskAgeSeconds: 3_600,
  maxDecisionLifetimeSeconds: 1_800,
  maxTenorSeconds: 90 * 24 * 60 * 60,
  minConfidenceBps: 7_000
});

const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform((value) => getAddress(value));
const bytes32 = z.string().regex(/^0x[a-fA-F0-9]{64}$/).transform((value) => value.toLowerCase() as Hex);
const uintString = z.string().regex(/^(0|[1-9][0-9]*)$/);
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const signature = z.string().regex(/^0x[a-fA-F0-9]{130}$/).superRefine((value, context) => {
  const s = BigInt(`0x${value.slice(66, 130)}`);
  const v = Number.parseInt(value.slice(130, 132), 16);
  if (s === 0n || s > SECP256K1_N / 2n || (v !== 27 && v !== 28)) context.addIssue({ code: "custom", message: "CONNECTED_NON_CANONICAL_SIGNATURE" });
}).transform((value) => value as Hex);
const historySchema = z.object({
  completedSettlements: z.number().int().nonnegative(),
  onTimeSettlements: z.number().int().nonnegative(),
  lateSettlements: z.number().int().nonnegative(),
  defaults: z.number().int().nonnegative(),
  concentrationBps: z.number().int().min(0).max(10_000),
  daysSinceLastSettlement: z.number().int().nonnegative()
}).strict().superRefine((history, context) => {
  if (history.onTimeSettlements + history.lateSettlements > history.completedSettlements) {
    context.addIssue({ code: "custom", message: "Settlement-history components exceed completed settlements." });
  }
});

export const connectedUnderwritingRequestSchema = z.object({
  schemaVersion: z.literal(CONNECTED_TESTNET.schemaVersion),
  label: z.literal(CONNECTED_TESTNET.label),
  registrationTransactionHash: bytes32,
  invoiceId: bytes32,
  documentHash: bytes32,
  supplier: address,
  payer: address,
  funder: address,
  faceValue: uintString,
  issuedAt: z.number().int().nonnegative(),
  dueDate: z.number().int().positive(),
  requestedAdvance: uintString,
  payerHistory: historySchema,
  redactedContext: z.string().trim().min(1).max(2_000),
  syntheticFixtureAcknowledged: z.literal(true),
  supplierAuthorization: signature
}).strict().superRefine((request, context) => {
  if (Object.values(request.payerHistory).some((value) => value !== 0)) {
    context.addIssue({ code: "custom", message: "CONNECTED_UNVERIFIED_PAYER_HISTORY_FORBIDDEN" });
  }
});

export type ConnectedUnderwritingRequest = z.infer<typeof connectedUnderwritingRequestSchema>;

export interface RegisteredInvoiceObservation {
  readonly chainId: 1952;
  readonly receivables: typeof CONNECTED_TESTNET.receivables;
  readonly settlementToken: typeof CONNECTED_TESTNET.settlementToken;
  readonly blockNumber: string;
  readonly blockHash: Hex;
  readonly blockTimestamp: number;
  readonly registrationTransactionHash: Hex;
  readonly status: "REGISTERED";
  readonly invoiceId: Hex;
  readonly invoiceDigest: Hex;
  readonly documentHash: Hex;
  readonly supplier: `0x${string}`;
  readonly payer: `0x${string}`;
  readonly faceValue: string;
  readonly issuedAt: number;
  readonly dueDate: number;
  readonly underwriter: `0x${string}`;
  readonly paused: false;
  readonly decisionNonceUnused: true;
  readonly documentHashRegistered: true;
  readonly invoiceDigestRegistered: true;
}

export interface ConnectedInvoiceObserver {
  inspect(request: ConnectedUnderwritingRequest, decisionNonce: string): Promise<RegisteredInvoiceObservation>;
}

type StoredStatus = "CLAIMED" | "MODEL_IN_FLIGHT" | "COMPLETE" | "FAILED";
export interface StoredConnectedDecision {
  readonly requestHash: Hex;
  readonly status: StoredStatus;
  readonly resultJson?: string;
  readonly failureCode?: string;
}
export interface ConnectedDecisionStore {
  load(invoiceId: Hex): Promise<StoredConnectedDecision | null>;
  claim(invoiceId: Hex, requestHash: Hex, requestJson: string): Promise<{ claimed: boolean; row: StoredConnectedDecision }>;
  beginModel(invoiceId: Hex, requestHash: Hex): Promise<void>;
  complete(invoiceId: Hex, requestHash: Hex, resultJson: string): Promise<void>;
  fail(invoiceId: Hex, requestHash: Hex, failureCode: string): Promise<void>;
  reserveDailyModelCall(day: string, maximum: number): Promise<boolean>;
}

const modelEvidenceSchema = z.object({
  provider: z.literal("bankr-chat-completions"),
  providerResponseId: z.string().min(1),
  requestedModel: z.literal("gpt-5.6-terra"),
  returnedModel: z.literal("gpt-5.6-terra"),
  requestHash: bytes32,
  responseHash: bytes32,
  decision: modelDecisionSchema.strict()
}).strict();
const registeredObservationSchema = z.object({
  chainId: z.literal(1952),
  receivables: z.literal(CONNECTED_TESTNET.receivables),
  settlementToken: z.literal(CONNECTED_TESTNET.settlementToken),
  blockNumber: uintString,
  blockHash: bytes32,
  blockTimestamp: z.number().int().nonnegative(),
  registrationTransactionHash: bytes32,
  status: z.literal("REGISTERED"),
  invoiceId: bytes32,
  invoiceDigest: bytes32,
  documentHash: bytes32,
  supplier: address,
  payer: address,
  faceValue: uintString,
  issuedAt: z.number().int().nonnegative(),
  dueDate: z.number().int().positive(),
  underwriter: address,
  paused: z.literal(false),
  decisionNonceUnused: z.literal(true),
  documentHashRegistered: z.literal(true),
  invoiceDigestRegistered: z.literal(true)
}).strict();
const signingRequestSchema = z.object({
  schemaVersion: z.literal("openbell-connected-decision-signing-v1"),
  label: z.literal(CONNECTED_TESTNET.label),
  chainId: z.literal("1952"),
  underwriter: address,
  authorizedDigest: bytes32,
  nonce: uintString
}).strict();

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
const requestHashOf = (request: ConnectedUnderwritingRequest): Hex => keccak256(stringToHex(canonicalJson(request)));
const failureCode = (error: unknown): string => error instanceof Error ? error.message.slice(0, 160) : "CONNECTED_UNDERWRITING_FAILED";
const unsupportedZeroHistoryReasons = new Set([
  "STRONG_ON_TIME_HISTORY",
  "LATE_PAYMENT_HISTORY",
  "PRIOR_DEFAULT",
  "HIGH_COUNTERPARTY_CONCENTRATION",
  "STALE_SETTLEMENT_HISTORY"
]);

function assertModelReasonsSupported(input: InvoiceRiskInput, decision: z.infer<typeof modelDecisionSchema>): void {
  const hasVerifiedHistory = Object.values(input.payerHistory).some((value) => value !== 0);
  if (!hasVerifiedHistory && decision.reasons.some((reason) => unsupportedZeroHistoryReasons.has(reason))) {
    throw new Error("CONNECTED_MODEL_REASON_UNSUPPORTED_BY_EVIDENCE");
  }
  const expectedExplanation = decision.verdict === "APPROVE" ? BANKR_APPROVAL_EXPLANATION : BANKR_REJECTION_EXPLANATION;
  if (decision.explanation !== expectedExplanation) throw new Error("CONNECTED_MODEL_EXPLANATION_UNSUPPORTED");
}

function committedModelId(input: InvoiceRiskInput, evidence: z.infer<typeof modelEvidenceSchema>): string {
  const expectedRequestHash = buildStrictBankrRequest(input).requestHash;
  if (evidence.requestHash !== expectedRequestHash) throw new Error("CONNECTED_MODEL_REQUEST_HASH_MISMATCH");
  const receiptCommitment = keccak256(encodeAbiParameters(
    parseAbiParameters("string provider, string providerResponseId, string requestedModel, string returnedModel, bytes32 requestHash, bytes32 responseHash"),
    [evidence.provider, evidence.providerResponseId, evidence.requestedModel, evidence.returnedModel, evidence.requestHash, evidence.responseHash]
  ));
  return `bankr:${evidence.requestedModel}:receipt:${receiptCommitment}`;
}

const approvalTypes = {
  RiskApproval: [
    { name: "invoiceId", type: "bytes32" }, { name: "invoiceDigest", type: "bytes32" },
    { name: "funder", type: "address" }, { name: "advanceAmount", type: "uint128" },
    { name: "repaymentAmount", type: "uint128" }, { name: "riskTimestamp", type: "uint64" },
    { name: "expiresAt", type: "uint64" }, { name: "riskReasonsHash", type: "bytes32" },
    { name: "modelHash", type: "bytes32" }, { name: "nonce", type: "uint256" }
  ]
} as const;
const rejectionTypes = {
  RiskRejection: [
    { name: "invoiceId", type: "bytes32" }, { name: "invoiceDigest", type: "bytes32" },
    { name: "riskTimestamp", type: "uint64" }, { name: "expiresAt", type: "uint64" },
    { name: "riskReasonsHash", type: "bytes32" }, { name: "modelHash", type: "bytes32" },
    { name: "nonce", type: "uint256" }
  ]
} as const;
const domain = { name: "OpenBell Receivables", version: "1", chainId: 1952, verifyingContract: CONNECTED_TESTNET.receivables } as const;
const assessmentTypes = { UnderwritingRequest: [
  { name: "invoiceId", type: "bytes32" }, { name: "documentHash", type: "bytes32" },
  { name: "supplier", type: "address" }, { name: "payer", type: "address" }, { name: "funder", type: "address" },
  { name: "faceValue", type: "uint128" }, { name: "requestedAdvance", type: "uint128" }, { name: "evidenceHash", type: "bytes32" }
] } as const;

export function connectedAssessmentTypedData(candidate: Omit<ConnectedUnderwritingRequest, "supplierAuthorization">) {
  const evidenceHash = keccak256(stringToHex(canonicalJson({
    registrationTransactionHash: candidate.registrationTransactionHash,
    issuedAt: candidate.issuedAt,
    dueDate: candidate.dueDate,
    payerHistory: candidate.payerHistory,
    redactedContext: candidate.redactedContext,
    syntheticFixtureAcknowledged: candidate.syntheticFixtureAcknowledged
  })));
  return { domain, types: assessmentTypes, primaryType: "UnderwritingRequest" as const, message: {
    invoiceId: candidate.invoiceId,
    documentHash: candidate.documentHash,
    supplier: candidate.supplier,
    payer: candidate.payer,
    funder: candidate.funder,
    faceValue: BigInt(candidate.faceValue),
    requestedAdvance: BigInt(candidate.requestedAdvance),
    evidenceHash
  } };
}

function typedDecision(decision: BoundedDecision, nonce: string): { typedData: Record<string, unknown>; digest: Hex } {
  if (decision.verdict === "APPROVE") {
    const typedData = { domain, types: approvalTypes, primaryType: "RiskApproval" as const, message: {
      invoiceId: decision.invoiceId as Hex,
      invoiceDigest: decision.invoiceDigest as Hex,
      funder: getAddress(decision.funder),
      advanceAmount: BigInt(decision.advanceAmount),
      repaymentAmount: BigInt(decision.repaymentAmount),
      riskTimestamp: BigInt(decision.riskTimestamp),
      expiresAt: BigInt(decision.expiresAt),
      riskReasonsHash: decision.riskReasonsHash as Hex,
      modelHash: decision.modelHash as Hex,
      nonce: BigInt(nonce)
    } };
    return { typedData, digest: hashTypedData(typedData) };
  }
  const typedData = { domain, types: rejectionTypes, primaryType: "RiskRejection" as const, message: {
    invoiceId: decision.invoiceId as Hex,
    invoiceDigest: decision.invoiceDigest as Hex,
    riskTimestamp: BigInt(decision.riskTimestamp),
    expiresAt: BigInt(decision.expiresAt),
    riskReasonsHash: decision.riskReasonsHash as Hex,
    modelHash: decision.modelHash as Hex,
    nonce: BigInt(nonce)
  } };
  return { typedData, digest: hashTypedData(typedData) };
}

function assertObservation(request: ConnectedUnderwritingRequest, observation: RegisteredInvoiceObservation): void {
  if (observation.chainId !== CONNECTED_TESTNET.chainId || observation.receivables !== CONNECTED_TESTNET.receivables || observation.settlementToken !== CONNECTED_TESTNET.settlementToken) throw new Error("CONNECTED_OBSERVATION_WRONG_DEPLOYMENT");
  if (observation.status !== "REGISTERED" || observation.paused !== false || observation.decisionNonceUnused !== true) throw new Error("CONNECTED_OBSERVATION_NOT_AUTHORIZABLE");
  const pairs: Array<[unknown, unknown]> = [
    [observation.registrationTransactionHash, request.registrationTransactionHash], [observation.invoiceId, request.invoiceId],
    [observation.documentHash, request.documentHash], [observation.supplier, request.supplier], [observation.payer, request.payer],
    [observation.faceValue, request.faceValue], [observation.issuedAt, request.issuedAt], [observation.dueDate, request.dueDate]
  ];
  if (pairs.some(([actual, expected]) => String(actual).toLowerCase() !== String(expected).toLowerCase())) throw new Error("CONNECTED_OBSERVATION_REQUEST_MISMATCH");
  if (request.funder === request.supplier || request.funder === request.payer) throw new Error("CONNECTED_FUNDER_MUST_BE_DISTINCT");
}

const riskInputFrom = (request: ConnectedUnderwritingRequest, observation: RegisteredInvoiceObservation): InvoiceRiskInput => ({
  invoiceId: request.invoiceId,
  invoiceDigest: observation.invoiceDigest,
  supplier: request.supplier,
  payer: request.payer,
  funder: request.funder,
  faceValue: request.faceValue,
  issuedAt: request.issuedAt,
  dueDate: request.dueDate,
  requestedAdvance: request.requestedAdvance,
  evidence: { supplierSignatureValid: true, payerSignatureValid: true, duplicateInvoiceFound: false, documentHashMatches: true },
  payerHistory: request.payerHistory,
  redactedContext: request.redactedContext
});
const connectedPolicy = {
  maxAdvanceBps: CONNECTED_TESTNET.maxAdvanceBps,
  maxFeeBps: CONNECTED_TESTNET.maxFeeBps,
  maxRiskAgeSeconds: CONNECTED_TESTNET.maxRiskAgeSeconds,
  maxDecisionLifetimeSeconds: CONNECTED_TESTNET.maxDecisionLifetimeSeconds,
  minConfidenceBps: CONNECTED_TESTNET.minConfidenceBps,
  maxTenorSeconds: CONNECTED_TESTNET.maxTenorSeconds
} as const;

function buildUnsignedAssessmentResult(decision: BoundedDecision, observation: RegisteredInvoiceObservation, nonce: string, digest: Hex, modelEvidence: z.infer<typeof modelEvidenceSchema>) {
  return {
    decision,
    modelEvidence,
    observation,
    signingRequest: {
      schemaVersion: "openbell-connected-decision-signing-v1" as const,
      label: CONNECTED_TESTNET.label,
      chainId: "1952" as const,
      underwriter: observation.underwriter,
      authorizedDigest: digest,
      nonce
    }
  };
}

export class ConnectedUnderwritingService {
  constructor(readonly dependencies: {
    observer: ConnectedInvoiceObserver;
    store: ConnectedDecisionStore;
    modelFactory: () => UnderwritingModel;
  }) {}

  async authorize(candidate: unknown): Promise<ReturnType<typeof buildUnsignedAssessmentResult>> {
    const request = connectedUnderwritingRequestSchema.parse(candidate);
    const { supplierAuthorization: _supplierAuthorization, ...unsignedRequest } = request;
    const recoveredSupplier = await recoverTypedDataAddress({ ...connectedAssessmentTypedData(unsignedRequest), signature: request.supplierAuthorization });
    if (recoveredSupplier !== request.supplier) throw new Error("CONNECTED_ASSESSMENT_WRONG_SUPPLIER_SIGNATURE");
    const requestJson = canonicalJson(request);
    const requestHash = requestHashOf(request);
    const nonce = BigInt(requestHash).toString();
    const returnStored = async (row: StoredConnectedDecision): Promise<ReturnType<typeof buildUnsignedAssessmentResult>> => {
      if (row.requestHash !== requestHash) throw new Error("CONNECTED_DECISION_REQUEST_CONFLICT");
      if (row.status === "COMPLETE" && row.resultJson) {
        const parsed: unknown = JSON.parse(row.resultJson);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("CONNECTED_DECISION_CORRUPT_RESULT");
        const record = parsed as Record<string, unknown>;
        if (Object.keys(record).sort().join(",") !== "decision,modelEvidence,observation,signingRequest") throw new Error("CONNECTED_DECISION_CORRUPT_RESULT");
        const decision = boundedDecisionSchema.parse(record.decision);
        const modelEvidence = modelEvidenceSchema.parse(record.modelEvidence);
        const storedObservation = registeredObservationSchema.parse(record.observation) as RegisteredInvoiceObservation;
        assertObservation(request, storedObservation);
        const storedInput = riskInputFrom(request, storedObservation);
        const reconstructedDecision = await underwriteInvoice({
          input: storedInput,
          model: { modelId: committedModelId(storedInput, modelEvidence), decide: async () => modelEvidence.decision },
          policy: connectedPolicy,
          now: storedObservation.blockTimestamp
        });
        if (canonicalJson(reconstructedDecision) !== canonicalJson(decision)) throw new Error("CONNECTED_DECISION_CORRUPT_MODEL_BINDING");
        const { digest } = typedDecision(decision, nonce);
        const storedSigningRequest = signingRequestSchema.parse(record.signingRequest);
        if (storedSigningRequest.underwriter !== storedObservation.underwriter || storedSigningRequest.authorizedDigest !== digest || storedSigningRequest.nonce !== nonce) {
          throw new Error("CONNECTED_DECISION_CORRUPT_SIGNING_REQUEST");
        }
        const rebuilt = buildUnsignedAssessmentResult(decision, storedObservation, nonce, digest, modelEvidence);
        if (canonicalJson(rebuilt) !== canonicalJson(parsed)) throw new Error("CONNECTED_DECISION_CORRUPT_RESULT");
        return rebuilt;
      }
      if (row.status === "FAILED") throw new Error(row.failureCode ?? "CONNECTED_DECISION_PREVIOUSLY_FAILED");
      throw new Error("CONNECTED_DECISION_IN_PROGRESS_OR_RECONCILIATION_REQUIRED");
    };
    const claim = await this.dependencies.store.claim(request.invoiceId, requestHash, requestJson);
    if (!claim.claimed) return returnStored(claim.row);
    try {
      const observation = await this.dependencies.observer.inspect(request, nonce);
      assertObservation(request, observation);
      const input = riskInputFrom(request, observation);
      const budgetDay = new Date(observation.blockTimestamp * 1_000).toISOString().slice(0, 10);
      if (!await this.dependencies.store.reserveDailyModelCall(budgetDay, 5)) {
        throw new Error("CONNECTED_DAILY_MODEL_BUDGET_EXHAUSTED");
      }
      await this.dependencies.store.beginModel(request.invoiceId, requestHash);
      const model = this.dependencies.modelFactory();
      const modelDecision = modelDecisionSchema.strict().parse(await model.decide(input));
      const modelEvidence = modelEvidenceSchema.parse((model as UnderwritingModel & { readonly lastReceipt?: unknown }).lastReceipt);
      if (canonicalJson(modelEvidence.decision) !== canonicalJson(modelDecision)) throw new Error("CONNECTED_MODEL_RECEIPT_DECISION_MISMATCH");
      assertModelReasonsSupported(input, modelDecision);
      const postModelObservation = await this.dependencies.observer.inspect(request, nonce);
      assertObservation(request, postModelObservation);
      const beforeBlock = BigInt(observation.blockNumber);
      const afterBlock = BigInt(postModelObservation.blockNumber);
      if (afterBlock < beforeBlock || (afterBlock === beforeBlock && postModelObservation.blockHash !== observation.blockHash)) {
        throw new Error("CONNECTED_OBSERVATION_REORG_OR_REGRESSION");
      }
      const postModelInput = riskInputFrom(request, postModelObservation);
      const decision = await underwriteInvoice({
        input: postModelInput,
        model: { modelId: committedModelId(postModelInput, modelEvidence), decide: async () => modelDecision },
        policy: connectedPolicy,
        now: postModelObservation.blockTimestamp
      });
      const { digest } = typedDecision(decision, nonce);
      const result = buildUnsignedAssessmentResult(decision, postModelObservation, nonce, digest, modelEvidence);
      const resultJson = JSON.stringify(result);
      await this.dependencies.store.complete(request.invoiceId, requestHash, resultJson);
      return result;
    } catch (error) {
      await this.dependencies.store.fail(request.invoiceId, requestHash, failureCode(error));
      throw error;
    }
  }
}
