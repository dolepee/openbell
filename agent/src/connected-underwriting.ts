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
import { UnderwritingRefusal, underwriteInvoice } from "./underwriter.js";
import {
  BANKR_APPROVAL_EXPLANATION,
  BANKR_MAINNET_APPROVAL_EXPLANATION,
  BANKR_MAINNET_REJECTION_EXPLANATION,
  BANKR_REJECTION_EXPLANATION,
  buildStrictBankrRequest
} from "./live-model.js";
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
export const CONNECTED_MAINNET = Object.freeze({
  schemaVersion: "openbell-mainnet-underwriting-v1",
  label: "XLAYER MAINNET — REAL USDG",
  chainId: 196,
  receivables: "0xc4Ef249b80a6a034198C226278c51b0a903840dd",
  settlementToken: "0x4ae46a509F6b1D9056937BA4500cb143933D2dc8",
  maxAdvanceBps: 8_000,
  maxFeeBps: 2_000,
  maxRiskAgeSeconds: 3_600,
  maxDecisionLifetimeSeconds: 1_800,
  maxTenorSeconds: 90 * 24 * 60 * 60,
  minConfidenceBps: 7_000
});
export type ConnectedDeployment = typeof CONNECTED_TESTNET | typeof CONNECTED_MAINNET;

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

const requestFields = {
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
  supplierAuthorization: signature
} as const;
const enforceZeroHistory = (request: { payerHistory: z.infer<typeof historySchema> }, context: z.RefinementCtx) => {
  if (Object.values(request.payerHistory).some((value) => value !== 0)) {
    context.addIssue({ code: "custom", message: "CONNECTED_UNVERIFIED_PAYER_HISTORY_FORBIDDEN" });
  }
};
export const connectedUnderwritingRequestSchema = z.object({
  schemaVersion: z.literal(CONNECTED_TESTNET.schemaVersion),
  label: z.literal(CONNECTED_TESTNET.label),
  ...requestFields,
  syntheticFixtureAcknowledged: z.literal(true)
}).strict().superRefine(enforceZeroHistory);
export const mainnetUnderwritingRequestSchema = z.object({
  schemaVersion: z.literal(CONNECTED_MAINNET.schemaVersion),
  label: z.literal(CONNECTED_MAINNET.label),
  ...requestFields,
  realValueAcknowledged: z.literal(true)
}).strict().superRefine(enforceZeroHistory);

type TestnetUnderwritingRequest = z.infer<typeof connectedUnderwritingRequestSchema>;
export type ConnectedUnderwritingRequest = Omit<TestnetUnderwritingRequest, "schemaVersion" | "label" | "syntheticFixtureAcknowledged"> & {
  readonly schemaVersion: typeof CONNECTED_TESTNET.schemaVersion | typeof CONNECTED_MAINNET.schemaVersion;
  readonly label: typeof CONNECTED_TESTNET.label | typeof CONNECTED_MAINNET.label;
  readonly syntheticFixtureAcknowledged?: true;
  readonly realValueAcknowledged?: true;
};

export interface RegisteredInvoiceObservation {
  readonly chainId: number;
  readonly receivables: `0x${string}`;
  readonly settlementToken: `0x${string}`;
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
  sealPolicyRefusal(invoiceId: Hex, requestHash: Hex, resultJson: string, artifactHash: Hex, failureCode: string): Promise<void>;
  loadPolicyRefusal(invoiceId: Hex, requestHash: Hex): Promise<{ resultJson: string; artifactHash: Hex } | null>;
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
  chainId: z.number().int().positive(),
  receivables: address,
  settlementToken: address,
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
  label: z.string().min(1),
  chainId: uintString,
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
const refusalArtifactHashOf = (resultJson: string): Hex => keccak256(stringToHex(resultJson));
const failureCode = (error: unknown): string => error instanceof Error ? error.message.slice(0, 160) : "CONNECTED_UNDERWRITING_FAILED";
const unsupportedZeroHistoryReasons = new Set([
  "STRONG_ON_TIME_HISTORY",
  "LATE_PAYMENT_HISTORY",
  "PRIOR_DEFAULT",
  "HIGH_COUNTERPARTY_CONCENTRATION",
  "STALE_SETTLEMENT_HISTORY"
]);

function assertModelReasonsSupported(input: InvoiceRiskInput, decision: z.infer<typeof modelDecisionSchema>, deployment: ConnectedDeployment): void {
  const hasVerifiedHistory = Object.values(input.payerHistory).some((value) => value !== 0);
  if (!hasVerifiedHistory && decision.reasons.some((reason) => unsupportedZeroHistoryReasons.has(reason))) {
    throw new Error("CONNECTED_MODEL_REASON_UNSUPPORTED_BY_EVIDENCE");
  }
  const expectedExplanation = deployment === CONNECTED_MAINNET
    ? decision.verdict === "APPROVE" ? BANKR_MAINNET_APPROVAL_EXPLANATION : BANKR_MAINNET_REJECTION_EXPLANATION
    : decision.verdict === "APPROVE" ? BANKR_APPROVAL_EXPLANATION : BANKR_REJECTION_EXPLANATION;
  if (decision.explanation !== expectedExplanation) throw new Error("CONNECTED_MODEL_EXPLANATION_UNSUPPORTED");
}

function committedModelId(input: InvoiceRiskInput, evidence: z.infer<typeof modelEvidenceSchema>, deployment: ConnectedDeployment): string {
  const expectedRequestHash = buildStrictBankrRequest(input, deployment === CONNECTED_MAINNET ? "registered-mainnet" : "synthetic").requestHash;
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
const domainFor = (deployment: ConnectedDeployment) => ({
  name: "OpenBell Receivables",
  version: "1",
  chainId: deployment.chainId,
  verifyingContract: deployment.receivables
} as const);
const assessmentTypes = { UnderwritingRequest: [
  { name: "invoiceId", type: "bytes32" }, { name: "documentHash", type: "bytes32" },
  { name: "supplier", type: "address" }, { name: "payer", type: "address" }, { name: "funder", type: "address" },
  { name: "faceValue", type: "uint128" }, { name: "requestedAdvance", type: "uint128" }, { name: "evidenceHash", type: "bytes32" }
] } as const;

export function connectedAssessmentTypedData(candidate: Omit<ConnectedUnderwritingRequest, "supplierAuthorization">, deployment: ConnectedDeployment = CONNECTED_TESTNET) {
  const valueBoundaryAcknowledged = candidate.syntheticFixtureAcknowledged ?? candidate.realValueAcknowledged;
  const evidenceHash = keccak256(stringToHex(canonicalJson({
    registrationTransactionHash: candidate.registrationTransactionHash,
    issuedAt: candidate.issuedAt,
    dueDate: candidate.dueDate,
    payerHistory: candidate.payerHistory,
    redactedContext: candidate.redactedContext,
    valueBoundaryAcknowledged
  })));
  return { domain: domainFor(deployment), types: assessmentTypes, primaryType: "UnderwritingRequest" as const, message: {
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

function typedDecision(decision: BoundedDecision, nonce: string, deployment: ConnectedDeployment): { typedData: Record<string, unknown>; digest: Hex } {
  const domain = domainFor(deployment);
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

function assertObservation(request: ConnectedUnderwritingRequest, observation: RegisteredInvoiceObservation, deployment: ConnectedDeployment): void {
  if (observation.chainId !== deployment.chainId || observation.receivables !== deployment.receivables || observation.settlementToken !== deployment.settlementToken) throw new Error("CONNECTED_OBSERVATION_WRONG_DEPLOYMENT");
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
const policyFor = (deployment: ConnectedDeployment) => ({
  maxAdvanceBps: deployment.maxAdvanceBps,
  maxFeeBps: deployment.maxFeeBps,
  maxRiskAgeSeconds: deployment.maxRiskAgeSeconds,
  maxDecisionLifetimeSeconds: deployment.maxDecisionLifetimeSeconds,
  minConfidenceBps: deployment.minConfidenceBps,
  maxTenorSeconds: deployment.maxTenorSeconds
});

function buildUnsignedAssessmentResult(decision: BoundedDecision, observation: RegisteredInvoiceObservation, nonce: string, digest: Hex, modelEvidence: z.infer<typeof modelEvidenceSchema>, deployment: ConnectedDeployment) {
  return {
    decision,
    modelEvidence,
    observation,
    signingRequest: {
      schemaVersion: "openbell-connected-decision-signing-v1" as const,
      label: deployment.label,
      chainId: String(deployment.chainId),
      underwriter: observation.underwriter,
      authorizedDigest: digest,
      nonce
    }
  };
}

const policyRefusalEvidenceSchema = z.object({
  schemaVersion: z.literal("openbell-connected-policy-refusal-v1"),
  outcome: z.literal("POLICY_REFUSAL"),
  executionAuthority: z.literal(false),
  refusal: z.object({ code: z.enum(["INVALID_EVIDENCE", "DUPLICATE_INVOICE", "INVALID_TENOR", "MODEL_REJECTED", "LOW_CONFIDENCE"]), message: z.string().min(1) }).strict(),
  modelEvidence: modelEvidenceSchema,
  observation: registeredObservationSchema
}).strict();
export type ConnectedPolicyRefusalEvidence = z.infer<typeof policyRefusalEvidenceSchema>;

export class ConnectedPolicyRefusal extends Error {
  constructor(readonly evidence: ConnectedPolicyRefusalEvidence) {
    super("CONNECTED_POLICY_REFUSAL");
    this.name = "ConnectedPolicyRefusal";
  }
}

class ConnectedPolicyRefusalPersistenceError extends Error {
  constructor() {
    super("CONNECTED_POLICY_REFUSAL_PERSISTENCE_FAILED");
    this.name = "ConnectedPolicyRefusalPersistenceError";
  }
}

const buildPolicyRefusalEvidence = (
  refusal: UnderwritingRefusal,
  modelEvidence: z.infer<typeof modelEvidenceSchema>,
  observation: RegisteredInvoiceObservation
): ConnectedPolicyRefusalEvidence => policyRefusalEvidenceSchema.parse({
  schemaVersion: "openbell-connected-policy-refusal-v1",
  outcome: "POLICY_REFUSAL",
  executionAuthority: false,
  refusal: { code: refusal.code, message: refusal.message },
  modelEvidence,
  observation
});

const validateStoredPolicyRefusal = async (
  candidate: unknown,
  request: ConnectedUnderwritingRequest,
  deployment: ConnectedDeployment
): Promise<ConnectedPolicyRefusalEvidence> => {
  const refusal = policyRefusalEvidenceSchema.parse(candidate);
  const observation = refusal.observation as RegisteredInvoiceObservation;
  assertObservation(request, observation, deployment);
  const input = riskInputFrom(request, observation);
  committedModelId(input, refusal.modelEvidence, deployment);
  try {
    await underwriteInvoice({
      input,
      model: { modelId: committedModelId(input, refusal.modelEvidence, deployment), decide: async () => refusal.modelEvidence.decision },
      policy: policyFor(deployment),
      now: observation.blockTimestamp
    });
  } catch (error) {
    if (error instanceof UnderwritingRefusal && error.code === refusal.refusal.code && error.message === refusal.refusal.message) {
      return refusal;
    }
    throw new Error("CONNECTED_POLICY_REFUSAL_CORRUPT");
  }
  throw new Error("CONNECTED_POLICY_REFUSAL_CREATED_EXECUTION_AUTHORITY");
};

export class ConnectedUnderwritingService {
  constructor(readonly dependencies: {
    observer: ConnectedInvoiceObserver;
    store: ConnectedDecisionStore;
    modelFactory: () => UnderwritingModel;
    deployment?: ConnectedDeployment;
  }) {}

  async authorize(candidate: unknown): Promise<ReturnType<typeof buildUnsignedAssessmentResult>> {
    const deployment = this.dependencies.deployment ?? CONNECTED_TESTNET;
    const request = (deployment === CONNECTED_TESTNET ? connectedUnderwritingRequestSchema : mainnetUnderwritingRequestSchema).parse(candidate) as ConnectedUnderwritingRequest;
    const { supplierAuthorization: _supplierAuthorization, ...unsignedRequest } = request;
    const recoveredSupplier = await recoverTypedDataAddress({ ...connectedAssessmentTypedData(unsignedRequest, deployment), signature: request.supplierAuthorization });
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
        assertObservation(request, storedObservation, deployment);
        const storedInput = riskInputFrom(request, storedObservation);
        const reconstructedDecision = await underwriteInvoice({
          input: storedInput,
          model: { modelId: committedModelId(storedInput, modelEvidence, deployment), decide: async () => modelEvidence.decision },
          policy: policyFor(deployment),
          now: storedObservation.blockTimestamp
        });
        if (canonicalJson(reconstructedDecision) !== canonicalJson(decision)) throw new Error("CONNECTED_DECISION_CORRUPT_MODEL_BINDING");
        const { digest } = typedDecision(decision, nonce, deployment);
        const storedSigningRequest = signingRequestSchema.parse(record.signingRequest);
        if (storedSigningRequest.label !== deployment.label || storedSigningRequest.chainId !== String(deployment.chainId) || storedSigningRequest.underwriter !== storedObservation.underwriter || storedSigningRequest.authorizedDigest !== digest || storedSigningRequest.nonce !== nonce) {
          throw new Error("CONNECTED_DECISION_CORRUPT_SIGNING_REQUEST");
        }
        const rebuilt = buildUnsignedAssessmentResult(decision, storedObservation, nonce, digest, modelEvidence, deployment);
        if (canonicalJson(rebuilt) !== canonicalJson(parsed)) throw new Error("CONNECTED_DECISION_CORRUPT_RESULT");
        return rebuilt;
      }
      if (row.status === "FAILED") {
        const storedRefusal = await this.dependencies.store.loadPolicyRefusal(request.invoiceId, requestHash);
        if (storedRefusal !== null) {
          if (refusalArtifactHashOf(storedRefusal.resultJson) !== storedRefusal.artifactHash) {
            throw new Error("CONNECTED_POLICY_REFUSAL_ARTIFACT_HASH_MISMATCH");
          }
          const refusal = await validateStoredPolicyRefusal(JSON.parse(storedRefusal.resultJson), request, deployment);
          throw new ConnectedPolicyRefusal(refusal);
        }
        throw new Error(row.failureCode ?? "CONNECTED_DECISION_PREVIOUSLY_FAILED");
      }
      throw new Error("CONNECTED_DECISION_IN_PROGRESS_OR_RECONCILIATION_REQUIRED");
    };
    const claim = await this.dependencies.store.claim(request.invoiceId, requestHash, requestJson);
    if (!claim.claimed) return returnStored(claim.row);
    try {
      const observation = await this.dependencies.observer.inspect(request, nonce);
      assertObservation(request, observation, deployment);
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
      assertModelReasonsSupported(input, modelDecision, deployment);
      const postModelObservation = await this.dependencies.observer.inspect(request, nonce);
      assertObservation(request, postModelObservation, deployment);
      const beforeBlock = BigInt(observation.blockNumber);
      const afterBlock = BigInt(postModelObservation.blockNumber);
      if (afterBlock < beforeBlock || (afterBlock === beforeBlock && postModelObservation.blockHash !== observation.blockHash)) {
        throw new Error("CONNECTED_OBSERVATION_REORG_OR_REGRESSION");
      }
      const postModelInput = riskInputFrom(request, postModelObservation);
      let decision: BoundedDecision;
      try {
        decision = await underwriteInvoice({
          input: postModelInput,
          model: { modelId: committedModelId(postModelInput, modelEvidence, deployment), decide: async () => modelDecision },
          policy: policyFor(deployment),
          now: postModelObservation.blockTimestamp
        });
      } catch (error) {
        if (!(error instanceof UnderwritingRefusal)) throw error;
        const refusal = buildPolicyRefusalEvidence(error, modelEvidence, postModelObservation);
        const refusalJson = JSON.stringify(refusal);
        try {
          await this.dependencies.store.sealPolicyRefusal(request.invoiceId, requestHash, refusalJson, refusalArtifactHashOf(refusalJson), error.code);
        } catch {
          throw new ConnectedPolicyRefusalPersistenceError();
        }
        throw new ConnectedPolicyRefusal(refusal);
      }
      const { digest } = typedDecision(decision, nonce, deployment);
      const result = buildUnsignedAssessmentResult(decision, postModelObservation, nonce, digest, modelEvidence, deployment);
      const resultJson = JSON.stringify(result);
      await this.dependencies.store.complete(request.invoiceId, requestHash, resultJson);
      return result;
    } catch (error) {
      if (error instanceof ConnectedPolicyRefusal || error instanceof ConnectedPolicyRefusalPersistenceError) throw error;
      await this.dependencies.store.fail(request.invoiceId, requestHash, failureCode(error));
      throw error;
    }
  }
}
