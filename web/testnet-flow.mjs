import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  hashTypedData,
  keccak256,
  parseAbiParameters,
  recoverTypedDataAddress,
  stringToHex
} from "viem";
import { OPENBELL_MAINNET, OPENBELL_TESTNET_TARGET, validateUnsignedDealPackage } from "./deal-package.mjs";

export const OPENBELL_TESTNET = Object.freeze({
  label: "XLAYER TESTNET FIXTURE — NO REAL VALUE",
  chainId: 1952,
  chainHex: "0x7a0",
  receivables: "0x7eb9C2418ec935d43E6761e462eAA5388BD6ca18",
  settlementToken: "0x7E7a189a8CE288E9581Ba3CDf14ac3D4a1624703",
  explorerTransactionBase: "https://www.okx.com/web3/explorer/xlayer-test/tx/"
});

export const OPENBELL_MAINNET_CONNECTED = Object.freeze({
  label: "XLAYER MAINNET — REAL USDG",
  chainId: 196,
  chainHex: "0xc4",
  receivables: OPENBELL_MAINNET.verifyingContract,
  settlementToken: OPENBELL_MAINNET.settlementToken,
  explorerTransactionBase: "https://www.okx.com/web3/explorer/xlayer/tx/"
});

const deployments = Object.freeze([OPENBELL_TESTNET, OPENBELL_MAINNET_CONNECTED]);
const deploymentForTarget = (target) => deployments.find((deployment) =>
  String(deployment.chainId) === String(target?.chainId)
  && deployment.receivables.toLowerCase() === String(target?.verifyingContract).toLowerCase()
  && deployment.settlementToken.toLowerCase() === String(target?.settlementToken).toLowerCase()
);
const deploymentForEnvelope = (candidate) => deployments.find((deployment) =>
  candidate?.label === deployment.label && typeof candidate?.chainId === "string" && candidate.chainId === String(deployment.chainId)
);
const sessionSchema = (deployment) => deployment === OPENBELL_TESTNET
  ? "openbell-testnet-invoice-session-v1" : "openbell-mainnet-invoice-session-v1";
const actionSchema = (deployment) => deployment === OPENBELL_TESTNET
  ? "openbell-testnet-browser-action-v1" : "openbell-mainnet-browser-action-v1";

export const FIXTURE_CLAIM_AMOUNT = 1_000_000_000n;

export const invoiceTypes = Object.freeze({
  InvoiceTerms: [
    { name: "invoiceId", type: "bytes32" },
    { name: "documentHash", type: "bytes32" },
    { name: "supplier", type: "address" },
    { name: "payer", type: "address" },
    { name: "faceValue", type: "uint128" },
    { name: "issuedAt", type: "uint64" },
    { name: "dueDate", type: "uint64" },
    { name: "nonce", type: "uint256" }
  ]
});

export const approvalTypes = Object.freeze({
  RiskApproval: [
    { name: "invoiceId", type: "bytes32" },
    { name: "invoiceDigest", type: "bytes32" },
    { name: "funder", type: "address" },
    { name: "advanceAmount", type: "uint128" },
    { name: "repaymentAmount", type: "uint128" },
    { name: "riskTimestamp", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
    { name: "riskReasonsHash", type: "bytes32" },
    { name: "modelHash", type: "bytes32" },
    { name: "nonce", type: "uint256" }
  ]
});

export const rejectionTypes = Object.freeze({
  RiskRejection: [
    { name: "invoiceId", type: "bytes32" },
    { name: "invoiceDigest", type: "bytes32" },
    { name: "riskTimestamp", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
    { name: "riskReasonsHash", type: "bytes32" },
    { name: "modelHash", type: "bytes32" },
    { name: "nonce", type: "uint256" }
  ]
});

export const assessmentTypes = Object.freeze({
  UnderwritingRequest: [
    { name: "invoiceId", type: "bytes32" },
    { name: "documentHash", type: "bytes32" },
    { name: "supplier", type: "address" },
    { name: "payer", type: "address" },
    { name: "funder", type: "address" },
    { name: "faceValue", type: "uint128" },
    { name: "requestedAdvance", type: "uint128" },
    { name: "evidenceHash", type: "bytes32" }
  ]
});

const receivablesAbi = [
  {
    type: "function",
    name: "invoices",
    stateMutability: "view",
    inputs: [{ name: "invoiceId", type: "bytes32" }],
    outputs: [
      { name: "status", type: "uint8" },
      { name: "supplier", type: "address" },
      { name: "payer", type: "address" },
      { name: "funder", type: "address" },
      { name: "faceValue", type: "uint128" },
      { name: "advanceAmount", type: "uint128" },
      { name: "repaymentAmount", type: "uint128" },
      { name: "dueDate", type: "uint64" },
      { name: "documentHash", type: "bytes32" },
      { name: "invoiceDigest", type: "bytes32" },
      { name: "decisionDigest", type: "bytes32" }
    ]
  },
  {
    type: "function",
    name: "registerInvoice",
    stateMutability: "nonpayable",
    inputs: [
      { name: "terms", type: "tuple", components: invoiceTypes.InvoiceTerms },
      { name: "supplierSignature", type: "bytes" },
      { name: "payerSignature", type: "bytes" }
    ],
    outputs: [{ name: "invoiceDigest", type: "bytes32" }]
  },
  {
    type: "function",
    name: "usedPartyNonces",
    stateMutability: "view",
    inputs: [
      { name: "signer", type: "address" },
      { name: "nonce", type: "uint256" }
    ],
    outputs: [{ name: "used", type: "bool" }]
  },
  {
    type: "function",
    name: "fund",
    stateMutability: "nonpayable",
    inputs: [
      { name: "approval", type: "tuple", components: approvalTypes.RiskApproval },
      { name: "underwriterSignature", type: "bytes" }
    ],
    outputs: [{ name: "decisionDigest", type: "bytes32" }]
  },
  {
    type: "function",
    name: "attestRejection",
    stateMutability: "nonpayable",
    inputs: [
      { name: "rejection", type: "tuple", components: rejectionTypes.RiskRejection },
      { name: "underwriterSignature", type: "bytes" }
    ],
    outputs: [{ name: "decisionDigest", type: "bytes32" }]
  },
  {
    type: "function",
    name: "settle",
    stateMutability: "nonpayable",
    inputs: [{ name: "invoiceId", type: "bytes32" }],
    outputs: []
  }
];

const tokenAbi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    name: "claimFixtureTokens",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: []
  },
  {
    type: "function",
    name: "hasClaimed",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "FAUCET_AMOUNT",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  }
];

const hex32 = /^0x[0-9a-fA-F]{64}$/;
const signature = /^0x[0-9a-fA-F]{130}$/;
const uint = /^(0|[1-9][0-9]*)$/;
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  return JSON.stringify(value);
};
const connectedBrowserArtifactHashOf = (value) => keccak256(stringToHex(canonicalJson(value)));
const allowedKeys = (candidate, keys, label) => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error(`${label} must be an object.`);
  const actual = Object.keys(candidate).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} contains unsupported or missing fields.`);
  }
};
const asAddress = (value, label) => {
  try { return getAddress(value); } catch { throw new Error(`${label} is not a valid address.`); }
};
const asHash = (value, label) => {
  if (!hex32.test(value)) throw new Error(`${label} must be bytes32.`);
  return value.toLowerCase();
};
export const normalizeRegistrationTransactionHash = (value) => asHash(
  String(value ?? "").trim(),
  "Registration transaction hash"
);
const asUint = (value, label) => {
  if (!uint.test(String(value))) throw new Error(`${label} must be an unsigned decimal string.`);
  return BigInt(value);
};
const asSignature = (value, label) => {
  if (!signature.test(value)) throw new Error(`${label} must be one canonical 65-byte signature.`);
  const s = BigInt(`0x${value.slice(66, 130)}`);
  const v = Number.parseInt(value.slice(130, 132), 16);
  if (s === 0n || s > SECP256K1_N / 2n || (v !== 27 && v !== 28)) throw new Error(`${label} must use canonical low-s ECDSA with v 27 or 28.`);
  return value;
};

const riskReasons = new Set([
  "DUAL_SIGNATURES_VERIFIED", "DOCUMENT_HASH_VERIFIED", "CLEAN_DUPLICATE_CHECK", "LIMITED_PAYER_HISTORY",
  "STRONG_ON_TIME_HISTORY", "LATE_PAYMENT_HISTORY", "PRIOR_DEFAULT", "HIGH_COUNTERPARTY_CONCENTRATION",
  "LONG_TENOR", "STALE_SETTLEMENT_HISTORY", "INCONSISTENT_EVIDENCE", "MODEL_UNCERTAINTY"
]);
const unsupportedZeroHistoryReasons = new Set([
  "STRONG_ON_TIME_HISTORY", "LATE_PAYMENT_HISTORY", "PRIOR_DEFAULT",
  "HIGH_COUNTERPARTY_CONCENTRATION", "STALE_SETTLEMENT_HISTORY"
]);
const refusalCodes = new Set(["MODEL_REJECTED", "LOW_CONFIDENCE"]);
const refusalMessages = Object.freeze({
  MODEL_REJECTED: "The bounded advance is zero.",
  LOW_CONFIDENCE: "The model confidence is below the policy floor."
});
const CONNECTED_MIN_CONFIDENCE_BPS = 7_000;
const CONNECTED_MAX_ADVANCE_BPS = 8_000n;
const CONNECTED_MAX_FEE_BPS = 2_000n;
const CONNECTED_MAX_DECISION_LIFETIME_SECONDS = 1_800;
const ESCALATION_MAX_FACE_BPS = 2_500n;
const ESCALATION_MAX_REQUEST_BPS = 5_000n;
const ESCALATION_FEE_BPS = 100n;
const ESCALATION_POLICY = "HUMAN_REVIEW_AFTER_MODEL_REJECTION_V1";
const BANKR_MAINNET_POLICY_PROMPT = "An APPROVE verdict requires confidenceBps of at least 7000. If the evidence does not justify that confidence, return REJECT instead of a lower-confidence APPROVE. The deterministic envelope caps maximumAdvanceBps at 8000 and feeBps at 2000.";
const RECEIPT_BOUND_MAINNET_SCHEMA = "openbell-mainnet-receipt-bound-underwriting-v1";
const bankrExplanationFor = (boundary, verdict) => boundary === "receipt-bound-mainnet"
  ? verdict === "APPROVE" ? "Confirmed OpenBell receipts on X Layer support approval within the returned structured limits." : "Confirmed OpenBell receipts on X Layer do not support approval."
  : boundary === "registered-mainnet"
    ? verdict === "APPROVE" ? "The supplied registered mainnet evidence supports approval within the returned structured limits." : "The supplied registered mainnet evidence does not support approval."
    : verdict === "APPROVE" ? "The supplied synthetic evidence supports approval within the returned structured limits." : "The supplied synthetic evidence does not support approval.";
const bankrSchemaFor = (boundary) => ({
  type: "object",
  additionalProperties: false,
  required: ["verdict", "maximumAdvanceBps", "feeBps", "confidenceBps", "reasons", "explanation"],
  properties: {
    verdict: { type: "string", enum: ["APPROVE", "REJECT"] },
    maximumAdvanceBps: { type: "integer", minimum: 0, maximum: 10_000 },
    feeBps: { type: "integer", minimum: 0, maximum: 10_000 },
    confidenceBps: { type: "integer", minimum: 0, maximum: 10_000 },
    reasons: {
      type: "array", minItems: 1, maxItems: 8, items: { type: "string", enum: [
        "DUAL_SIGNATURES_VERIFIED", "DOCUMENT_HASH_VERIFIED", "CLEAN_DUPLICATE_CHECK",
        "LIMITED_PAYER_HISTORY", "STRONG_ON_TIME_HISTORY", "LATE_PAYMENT_HISTORY",
        "PRIOR_DEFAULT", "HIGH_COUNTERPARTY_CONCENTRATION", "LONG_TENOR",
        "STALE_SETTLEMENT_HISTORY", "INCONSISTENT_EVIDENCE", "MODEL_UNCERTAINTY"
      ] }
    },
    explanation: { type: "string", enum: [bankrExplanationFor(boundary, "APPROVE"), bankrExplanationFor(boundary, "REJECT")] }
  }
});

export function buildBrowserBankrRequestHash(input, boundary) {
  const evidenceDescription = boundary === "receipt-bound-mainnet"
    ? "registered invoice evidence and confirmed OpenBell receipts on X Layer; overdue funded invoices are not protocol defaults"
    : boundary === "registered-mainnet" ? "registered mainnet invoice evidence" : "synthetic invoice evidence";
  const policyInstruction = boundary === "synthetic" ? "" : ` ${BANKR_MAINNET_POLICY_PROMPT}`;
  const body = JSON.stringify({
    model: "gpt-5.6-terra",
    messages: [
      { role: "system", content: `Assess only the supplied ${evidenceDescription}.${policyInstruction} Return exactly one JSON object matching the response schema. Never invent evidence.` },
      { role: "user", content: JSON.stringify(input) }
    ],
    reasoning_effort: "low",
    max_tokens: 1_200,
    store: false,
    response_format: { type: "json_schema", json_schema: { name: "openbell_underwriting_decision", strict: true, schema: bankrSchemaFor(boundary) } }
  });
  return keccak256(stringToHex(body));
}

const validateConnectedModelEvidence = (evidence, boundary) => {
  allowedKeys(evidence, ["provider", "providerResponseId", "requestedModel", "returnedModel", "requestHash", "responseHash", "rawResponse", "decision"], "Connected model evidence");
  if (evidence.provider !== "bankr-chat-completions" || evidence.requestedModel !== "gpt-5.6-terra" || evidence.returnedModel !== "gpt-5.6-terra" || typeof evidence.providerResponseId !== "string" || !evidence.providerResponseId) {
    throw new Error("Connected model receipt is invalid.");
  }
  asHash(evidence.requestHash, "Model request hash");
  asHash(evidence.responseHash, "Model response hash");
  if (typeof evidence.rawResponse !== "string" || evidence.rawResponse.length < 1 || new TextEncoder().encode(evidence.rawResponse).byteLength > 64 * 1_024) throw new Error("Connected model raw response is invalid.");
  if (keccak256(stringToHex(evidence.rawResponse)) !== evidence.responseHash) throw new Error("Connected model raw response hash does not match its receipt.");
  let providerEnvelope;
  let providerDecision;
  try {
    providerEnvelope = JSON.parse(evidence.rawResponse);
    providerDecision = JSON.parse(providerEnvelope?.choices?.[0]?.message?.content);
  } catch {
    throw new Error("Connected model raw response is invalid.");
  }
  if (providerEnvelope?.id !== evidence.providerResponseId || providerEnvelope?.model !== evidence.returnedModel || canonicalJson(providerDecision) !== canonicalJson(evidence.decision)) {
    throw new Error("Connected model raw response does not match its receipt.");
  }
  allowedKeys(evidence.decision, ["verdict", "maximumAdvanceBps", "feeBps", "confidenceBps", "reasons", "explanation"], "Connected model decision");
  if (!["APPROVE", "REJECT"].includes(evidence.decision.verdict)
    || ![evidence.decision.maximumAdvanceBps, evidence.decision.feeBps, evidence.decision.confidenceBps].every((value) => Number.isInteger(value) && value >= 0 && value <= 10_000)
    || !Array.isArray(evidence.decision.reasons) || evidence.decision.reasons.length < 1 || evidence.decision.reasons.length > 8
    || evidence.decision.reasons.some((reason) => !riskReasons.has(reason))
    || evidence.decision.explanation !== bankrExplanationFor(boundary, evidence.decision.verdict)) {
    throw new Error("Connected model decision is invalid.");
  }
  return evidence;
};

const validateConnectedObservation = (observation) => {
  allowedKeys(observation, ["chainId", "receivables", "settlementToken", "blockNumber", "blockHash", "blockTimestamp", "registrationTransactionHash", "status", "invoiceId", "invoiceDigest", "documentHash", "supplier", "payer", "faceValue", "issuedAt", "dueDate", "underwriter", "paused", "decisionNonceUnused", "documentHashRegistered", "invoiceDigestRegistered"], "Connected observation");
  const deployment = deployments.find((item) => item.chainId === observation.chainId
    && item.receivables.toLowerCase() === String(observation.receivables).toLowerCase()
    && item.settlementToken.toLowerCase() === String(observation.settlementToken).toLowerCase());
  if (!deployment || observation.status !== "REGISTERED" || observation.paused !== false || observation.decisionNonceUnused !== true
    || observation.documentHashRegistered !== true || observation.invoiceDigestRegistered !== true
    || !Number.isSafeInteger(observation.blockTimestamp) || observation.blockTimestamp < 0
    || !Number.isSafeInteger(observation.issuedAt) || observation.issuedAt < 0
    || !Number.isSafeInteger(observation.dueDate) || observation.dueDate <= 0) {
    throw new Error("Connected chain observation is invalid.");
  }
  asUint(observation.blockNumber, "Observed block number");
  asUint(observation.faceValue, "Observed face value");
  ["blockHash", "registrationTransactionHash", "invoiceId", "invoiceDigest", "documentHash"].forEach((key) => asHash(observation[key], `Observed ${key}`));
  ["receivables", "settlementToken", "supplier", "payer", "underwriter"].forEach((key) => asAddress(observation[key], `Observed ${key}`));
  return deployment;
};

const connectedModelInput = (observation, expectedRequest) => ({
  invoiceId: observation.invoiceId,
  invoiceDigest: observation.invoiceDigest,
  supplier: observation.supplier,
  payer: observation.payer,
  funder: expectedRequest.funder,
  faceValue: observation.faceValue,
  issuedAt: observation.issuedAt,
  dueDate: observation.dueDate,
  requestedAdvance: expectedRequest.requestedAdvance,
  evidence: { supplierSignatureValid: true, payerSignatureValid: true, duplicateInvoiceFound: false, documentHashMatches: true },
  payerHistory: expectedRequest.payerHistory,
  ...(expectedRequest.receiptBoundHistory ? { receiptBoundHistory: expectedRequest.receiptBoundHistory } : {}),
  redactedContext: expectedRequest.redactedContext
});

const connectedEvidenceBoundary = (expectedRequest, deployment) => deployment === OPENBELL_TESTNET
  ? "synthetic"
  : expectedRequest?.schemaVersion === RECEIPT_BOUND_MAINNET_SCHEMA ? "receipt-bound-mainnet" : "registered-mainnet";

const assertConnectedModelReasonsSupported = (modelInput, evidence) => {
  const hasVerifiedHistory = Object.values(modelInput.payerHistory).some((value) => value !== 0);
  if (!hasVerifiedHistory && evidence.decision.reasons.some((reason) => unsupportedZeroHistoryReasons.has(reason))) {
    throw new Error("Connected model reason is unsupported by the submitted evidence.");
  }
  if (modelInput.payerHistory.defaults === 0 && evidence.decision.reasons.includes("PRIOR_DEFAULT")) {
    throw new Error("Connected model reason is unsupported by the submitted evidence.");
  }
};

const bindConnectedResponseToRequest = (observation, expectedRequest, deployment) => {
  if (!expectedRequest || typeof expectedRequest !== "object" || Array.isArray(expectedRequest)) {
    throw new Error("Connected response requires the exact submitted assessment request.");
  }
  const expectedSchema = deployment === OPENBELL_TESTNET
    ? "openbell-connected-underwriting-v1"
    : expectedRequest?.receiptBoundHistory ? RECEIPT_BOUND_MAINNET_SCHEMA : "openbell-mainnet-underwriting-v1";
  const requestMatches = expectedRequest.schemaVersion === expectedSchema
    && expectedRequest.label === deployment.label
    && String(observation.registrationTransactionHash).toLowerCase() === String(expectedRequest.registrationTransactionHash).toLowerCase()
    && String(observation.invoiceId).toLowerCase() === String(expectedRequest.invoiceId).toLowerCase()
    && String(observation.documentHash).toLowerCase() === String(expectedRequest.documentHash).toLowerCase()
    && String(observation.supplier).toLowerCase() === String(expectedRequest.supplier).toLowerCase()
    && String(observation.payer).toLowerCase() === String(expectedRequest.payer).toLowerCase()
    && observation.faceValue === expectedRequest.faceValue
    && observation.issuedAt === expectedRequest.issuedAt
    && observation.dueDate === expectedRequest.dueDate;
  if (!requestMatches) throw new Error("Connected response does not match the submitted assessment request.");
  return connectedModelInput(observation, expectedRequest);
};

export function validateConnectedPolicyRefusal(candidate, expectedRequest, expectedArtifactHash) {
  if (asHash(expectedArtifactHash, "Policy refusal artifact hash") !== connectedBrowserArtifactHashOf(candidate)) throw new Error("Policy refusal artifact commitment does not match its evidence.");
  allowedKeys(candidate, ["schemaVersion", "outcome", "executionAuthority", "refusal", "modelEvidence", "observation"], "Policy refusal");
  if (candidate.schemaVersion !== "openbell-connected-policy-refusal-v1" || candidate.outcome !== "POLICY_REFUSAL" || candidate.executionAuthority !== false) {
    throw new Error("Policy refusal must explicitly carry no execution authority.");
  }
  allowedKeys(candidate.refusal, ["code", "message"], "Policy refusal reason");
  if (!refusalCodes.has(candidate.refusal.code) || typeof candidate.refusal.message !== "string" || !candidate.refusal.message.trim()) {
    throw new Error("Policy refusal reason is invalid.");
  }
  const observation = candidate.observation;
  const deployment = validateConnectedObservation(observation);
  const boundary = connectedEvidenceBoundary(expectedRequest, deployment);
  const evidence = validateConnectedModelEvidence(candidate.modelEvidence, boundary);
  const expectedMessage = refusalMessages[candidate.refusal.code];
  const messageMatches = expectedMessage instanceof Set
    ? expectedMessage.has(candidate.refusal.message)
    : candidate.refusal.message === expectedMessage;
  const lowConfidenceMatches = candidate.refusal.code !== "LOW_CONFIDENCE"
    || (evidence.decision.verdict === "APPROVE" && evidence.decision.confidenceBps < CONNECTED_MIN_CONFIDENCE_BPS);
  if (!messageMatches || !lowConfidenceMatches) {
    throw new Error("Policy refusal contradicts the model decision or connected policy.");
  }
  const modelInput = bindConnectedResponseToRequest(observation, expectedRequest, deployment);
  assertConnectedModelReasonsSupported(modelInput, evidence);
  if (buildBrowserBankrRequestHash(modelInput, boundary) !== evidence.requestHash) {
    throw new Error("Policy refusal model request hash does not match the submitted assessment request.");
  }
  if (candidate.refusal.code === "MODEL_REJECTED") {
    const boundedAdvanceBps = BigInt(Math.min(evidence.decision.maximumAdvanceBps, Number(CONNECTED_MAX_ADVANCE_BPS)));
    const maximumAdvance = (BigInt(observation.faceValue) * boundedAdvanceBps) / 10_000n;
    if (evidence.decision.verdict !== "APPROVE" || evidence.decision.confidenceBps < CONNECTED_MIN_CONFIDENCE_BPS || maximumAdvance !== 0n) {
      throw new Error("Policy refusal contradicts the model decision or connected policy.");
    }
  }
  return candidate;
}

export const testnetDomain = Object.freeze({
  name: "OpenBell Receivables",
  version: "1",
  chainId: OPENBELL_TESTNET.chainId,
  verifyingContract: OPENBELL_TESTNET.receivables
});

export const mainnetDomain = Object.freeze({
  name: "OpenBell Receivables",
  version: "1",
  chainId: OPENBELL_MAINNET_CONNECTED.chainId,
  verifyingContract: OPENBELL_MAINNET_CONNECTED.receivables
});
const domainFor = (deployment) => deployment === OPENBELL_TESTNET ? testnetDomain : mainnetDomain;

const normalizeTerms = (terms) => {
  allowedKeys(terms, ["invoiceId", "documentHash", "supplier", "payer", "faceValue", "issuedAt", "dueDate", "nonce"], "Invoice terms");
  const supplier = asAddress(terms.supplier, "Supplier");
  const payer = asAddress(terms.payer, "Payer");
  if (supplier === payer) throw new Error("Supplier and payer must be distinct.");
  return {
    invoiceId: asHash(terms.invoiceId, "Invoice ID"),
    documentHash: asHash(terms.documentHash, "Document hash"),
    supplier,
    payer,
    faceValue: asUint(terms.faceValue, "Face value"),
    issuedAt: asUint(terms.issuedAt, "Issued time"),
    dueDate: asUint(terms.dueDate, "Due time"),
    nonce: asUint(terms.nonce, "Party nonce")
  };
};

const normalizeApproval = (approval) => {
  allowedKeys(approval, ["invoiceId", "invoiceDigest", "funder", "advanceAmount", "repaymentAmount", "riskTimestamp", "expiresAt", "riskReasonsHash", "modelHash", "nonce"], "Risk approval");
  return {
    invoiceId: asHash(approval.invoiceId, "Invoice ID"),
    invoiceDigest: asHash(approval.invoiceDigest, "Invoice digest"),
    funder: asAddress(approval.funder, "Funder"),
    advanceAmount: asUint(approval.advanceAmount, "Advance amount"),
    repaymentAmount: asUint(approval.repaymentAmount, "Repayment amount"),
    riskTimestamp: asUint(approval.riskTimestamp, "Risk timestamp"),
    expiresAt: asUint(approval.expiresAt, "Decision expiry"),
    riskReasonsHash: asHash(approval.riskReasonsHash, "Risk reasons hash"),
    modelHash: asHash(approval.modelHash, "Model hash"),
    nonce: asUint(approval.nonce, "Decision nonce")
  };
};

const normalizeRejection = (rejection) => {
  allowedKeys(rejection, ["invoiceId", "invoiceDigest", "riskTimestamp", "expiresAt", "riskReasonsHash", "modelHash", "nonce"], "Risk rejection");
  return {
    invoiceId: asHash(rejection.invoiceId, "Invoice ID"),
    invoiceDigest: asHash(rejection.invoiceDigest, "Invoice digest"),
    riskTimestamp: asUint(rejection.riskTimestamp, "Risk timestamp"),
    expiresAt: asUint(rejection.expiresAt, "Decision expiry"),
    riskReasonsHash: asHash(rejection.riskReasonsHash, "Risk reasons hash"),
    modelHash: asHash(rejection.modelHash, "Model hash"),
    nonce: asUint(rejection.nonce, "Decision nonce")
  };
};

export const invoiceTypedData = (terms, deployment = OPENBELL_TESTNET) => ({
  domain: domainFor(deployment),
  types: invoiceTypes,
  primaryType: "InvoiceTerms",
  message: normalizeTerms(terms)
});

export const walletInvoiceTypedData = (terms, deployment = OPENBELL_TESTNET) => {
  const typedData = invoiceTypedData(terms, deployment);
  return {
    ...typedData,
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" }
      ],
      ...typedData.types
    }
  };
};

export const approvalTypedData = (approval, deployment = OPENBELL_TESTNET) => ({
  domain: domainFor(deployment),
  types: approvalTypes,
  primaryType: "RiskApproval",
  message: normalizeApproval(approval)
});

export const rejectionTypedData = (rejection, deployment = OPENBELL_TESTNET) => ({
  domain: domainFor(deployment),
  types: rejectionTypes,
  primaryType: "RiskRejection",
  message: normalizeRejection(rejection)
});

const walletDecisionTypedData = (typedData) => ({
  ...typedData,
  types: {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" }
    ],
    ...typedData.types
  }
});

const connectedEvidenceCommitments = (evidence) => {
  const receiptCommitment = keccak256(encodeAbiParameters(
    parseAbiParameters("string provider, string providerResponseId, string requestedModel, string returnedModel, bytes32 requestHash, bytes32 responseHash"),
    [evidence.provider, evidence.providerResponseId, evidence.requestedModel, evidence.returnedModel, evidence.requestHash, evidence.responseHash]
  ));
  const modelId = `bankr:${evidence.requestedModel}:receipt:${receiptCommitment}`;
  const modelHash = keccak256(encodeAbiParameters(
    parseAbiParameters("string modelId, string verdict, uint16 maximumAdvanceBps, uint16 feeBps, uint16 confidenceBps, string[] reasons, string explanation"),
    [modelId, evidence.decision.verdict, evidence.decision.maximumAdvanceBps, evidence.decision.feeBps, evidence.decision.confidenceBps, evidence.decision.reasons, evidence.decision.explanation]
  ));
  const riskReasonsHash = keccak256(encodeAbiParameters(
    parseAbiParameters("string[] reasons, string explanation"),
    [evidence.decision.reasons, evidence.decision.explanation]
  ));
  return Object.freeze({ receiptCommitment, modelId, modelHash, riskReasonsHash });
};

export function validateConnectedAssessment(assessment, expectedRequest) {
  allowedKeys(assessment, ["decision", "modelEvidence", "observation", "signingRequest", "artifactHash"], "Connected assessment");
  const { artifactHash, ...assessmentCore } = assessment;
  if (asHash(artifactHash, "Connected assessment artifact hash") !== connectedBrowserArtifactHashOf(assessmentCore)) throw new Error("Connected assessment artifact commitment does not match its evidence.");
  const deployment = validateConnectedObservation(assessmentCore.observation);
  const boundary = connectedEvidenceBoundary(expectedRequest, deployment);
  const evidence = validateConnectedModelEvidence(assessmentCore.modelEvidence, boundary);
  const modelInput = bindConnectedResponseToRequest(assessmentCore.observation, expectedRequest, deployment);
  assertConnectedModelReasonsSupported(modelInput, evidence);
  if (buildBrowserBankrRequestHash(modelInput, boundary) !== evidence.requestHash) throw new Error("Connected assessment model request hash changed.");

  const { modelId, modelHash, riskReasonsHash } = connectedEvidenceCommitments(evidence);
  const common = {
    invoiceId: assessmentCore.observation.invoiceId,
    invoiceDigest: assessmentCore.observation.invoiceDigest,
    riskTimestamp: assessmentCore.observation.blockTimestamp,
    expiresAt: Math.min(assessmentCore.observation.blockTimestamp + CONNECTED_MAX_DECISION_LIFETIME_SECONDS, assessmentCore.observation.dueDate),
    riskReasonsHash,
    modelHash,
    reasons: evidence.decision.reasons,
    explanation: evidence.decision.explanation,
    modelId
  };
  let expectedDecision;
  if (evidence.decision.verdict === "REJECT") {
    expectedDecision = { verdict: "REJECT", ...common };
  } else {
    if (evidence.decision.confidenceBps < CONNECTED_MIN_CONFIDENCE_BPS) throw new Error("Connected assessment should have been a policy refusal.");
    const boundedAdvanceBps = BigInt(Math.min(evidence.decision.maximumAdvanceBps, Number(CONNECTED_MAX_ADVANCE_BPS)));
    const maximumAdvance = (BigInt(assessmentCore.observation.faceValue) * boundedAdvanceBps) / 10_000n;
    const requestedAdvance = asUint(expectedRequest.requestedAdvance, "Requested advance");
    const advanceAmount = requestedAdvance < maximumAdvance ? requestedAdvance : maximumAdvance;
    if (advanceAmount === 0n) throw new Error("Connected assessment should have been a policy refusal.");
    const boundedFeeBps = BigInt(Math.min(evidence.decision.feeBps, Number(CONNECTED_MAX_FEE_BPS)));
    const repaymentAmount = advanceAmount + (advanceAmount * boundedFeeBps) / 10_000n;
    if (repaymentAmount > BigInt(assessmentCore.observation.faceValue)) throw new Error("Connected assessment should have been a policy refusal.");
    expectedDecision = {
      verdict: "APPROVE",
      ...common,
      funder: expectedRequest.funder,
      advanceAmount: advanceAmount.toString(),
      repaymentAmount: repaymentAmount.toString()
    };
  }
  if (canonicalJson(assessmentCore.decision) !== canonicalJson(expectedDecision)) throw new Error("Connected assessment decision is not the bounded result of its model evidence.");
  const expectedNonce = BigInt(keccak256(stringToHex(canonicalJson(expectedRequest)))).toString();
  if (assessmentCore.signingRequest?.nonce !== expectedNonce) throw new Error("Connected assessment nonce does not bind the submitted request.");
  if (deploymentForEnvelope(assessmentCore.signingRequest) !== deployment) throw new Error("Connected assessment signing deployment does not match its observation.");
  connectedDecisionTypedData(assessmentCore);
  return assessment;
}

export async function buildHumanEscalation({ assessment, session: sessionCandidate, assessedRequestedAdvance, funder, advanceAmount, riskTimestamp }) {
  allowedKeys(assessment, ["decision", "modelEvidence", "observation", "signingRequest", "artifactHash"], "Connected assessment");
  const { artifactHash, ...assessmentCore } = assessment;
  if (asHash(artifactHash, "Connected assessment artifact hash") !== connectedBrowserArtifactHashOf(assessmentCore)) throw new Error("Connected assessment artifact commitment does not match its evidence.");
  const deployment = validateConnectedObservation(assessmentCore.observation);
  if (deployment !== OPENBELL_MAINNET_CONNECTED) throw new Error("Human escalation is available only for registered mainnet evidence.");
  const evidence = validateConnectedModelEvidence(assessmentCore.modelEvidence, "registered-mainnet");
  if (evidence.decision.verdict !== "REJECT" || assessmentCore.decision.verdict !== "REJECT") throw new Error("Human escalation requires an authoritative model rejection.");
  const { modelId, modelHash, riskReasonsHash } = connectedEvidenceCommitments(evidence);
  if (assessmentCore.decision.modelId !== modelId || assessmentCore.decision.modelHash !== modelHash || assessmentCore.decision.riskReasonsHash !== riskReasonsHash) {
    throw new Error("Rejected assessment does not match its model receipt.");
  }
  connectedDecisionTypedData(assessment);

  const session = await validateInvoiceSession(sessionCandidate);
  const terms = session.dealPackage.invoiceTerms;
  const observation = assessmentCore.observation;
  if (session.dealPackage.target.chainId !== String(deployment.chainId)
    || terms.invoiceId.toLowerCase() !== observation.invoiceId.toLowerCase()
    || session.authorizedDigest.toLowerCase() !== observation.invoiceDigest.toLowerCase()
    || terms.documentHash.toLowerCase() !== observation.documentHash.toLowerCase()
    || terms.supplier.toLowerCase() !== observation.supplier.toLowerCase()
    || terms.payer.toLowerCase() !== observation.payer.toLowerCase()
    || terms.faceValue !== observation.faceValue) {
    throw new Error("Rejected assessment does not match the signed invoice session.");
  }

  const normalizedFunder = asAddress(funder, "Escalation funder");
  if (normalizedFunder === asAddress(terms.supplier, "Supplier") || normalizedFunder === asAddress(terms.payer, "Payer")) throw new Error("Funder must be distinct from supplier and payer.");
  const requested = asUint(assessedRequestedAdvance, "Assessed requested advance");
  if (requested !== asUint(session.dealPackage.underwritingRequest.requestedAdvance, "Session requested advance")) {
    throw new Error("Invoice session requested advance does not match the committed assessment request.");
  }
  const faceValue = asUint(terms.faceValue, "Face value");
  const requestedCap = requested * ESCALATION_MAX_REQUEST_BPS / 10_000n;
  const faceCap = faceValue * ESCALATION_MAX_FACE_BPS / 10_000n;
  const escalationCap = requestedCap < faceCap ? requestedCap : faceCap;
  const boundedAdvance = asUint(advanceAmount, "Escalation advance");
  if (boundedAdvance === 0n || boundedAdvance > escalationCap) throw new Error("Escalation advance exceeds the stricter human-review cap.");
  const repaymentAmount = boundedAdvance + boundedAdvance * ESCALATION_FEE_BPS / 10_000n;
  const timestamp = asUint(riskTimestamp, "Escalation review time");
  const dueDate = asUint(terms.dueDate, "Invoice due time");
  const expiresAt = timestamp + BigInt(CONNECTED_MAX_DECISION_LIFETIME_SECONDS) < dueDate
    ? timestamp + BigInt(CONNECTED_MAX_DECISION_LIFETIME_SECONDS) : dueDate;
  if (expiresAt <= timestamp) throw new Error("Invoice expires before the escalation can be signed.");

  const escalationReasonsHash = keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32 rejectedArtifactHash,string policy,uint16 maxFaceBps,uint16 maxRequestBps,uint16 feeBps,uint128 requestedAdvance,uint128 advanceAmount,uint128 repaymentAmount"),
    [artifactHash, ESCALATION_POLICY, Number(ESCALATION_MAX_FACE_BPS), Number(ESCALATION_MAX_REQUEST_BPS), Number(ESCALATION_FEE_BPS), requested, boundedAdvance, repaymentAmount]
  ));
  const nonce = BigInt(keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32 rejectedArtifactHash,address funder,uint128 advanceAmount,uint128 repaymentAmount,uint64 riskTimestamp"),
    [artifactHash, normalizedFunder, boundedAdvance, repaymentAmount, timestamp]
  ))).toString();
  const approval = {
    invoiceId: terms.invoiceId,
    invoiceDigest: session.authorizedDigest,
    funder: normalizedFunder,
    advanceAmount: boundedAdvance.toString(),
    repaymentAmount: repaymentAmount.toString(),
    riskTimestamp: timestamp.toString(),
    expiresAt: expiresAt.toString(),
    riskReasonsHash: escalationReasonsHash,
    modelHash: artifactHash,
    nonce
  };
  const authorizedDigest = hashTypedData(approvalTypedData(approval, deployment));
  return Object.freeze({
    schemaVersion: "openbell-human-escalation-v1",
    policy: ESCALATION_POLICY,
    rejectedArtifactHash: artifactHash,
    rejectedModelHash: modelHash,
    rejectedVerdict: "REJECT",
    faceValue: faceValue.toString(),
    requestedAdvance: requested.toString(),
    dueDate: dueDate.toString(),
    maxFaceBps: ESCALATION_MAX_FACE_BPS.toString(),
    maxRequestBps: ESCALATION_MAX_REQUEST_BPS.toString(),
    feeBps: ESCALATION_FEE_BPS.toString(),
    underwriter: observation.underwriter,
    supplier: observation.supplier,
    payer: observation.payer,
    authorizedDigest,
    approval
  });
}

export function humanEscalationTypedData(escalation) {
  allowedKeys(escalation, ["schemaVersion", "policy", "rejectedArtifactHash", "rejectedModelHash", "rejectedVerdict", "faceValue", "requestedAdvance", "dueDate", "maxFaceBps", "maxRequestBps", "feeBps", "underwriter", "supplier", "payer", "authorizedDigest", "approval"], "Human escalation");
  if (escalation.schemaVersion !== "openbell-human-escalation-v1" || escalation.policy !== ESCALATION_POLICY || escalation.rejectedVerdict !== "REJECT"
    || escalation.maxFaceBps !== ESCALATION_MAX_FACE_BPS.toString() || escalation.maxRequestBps !== ESCALATION_MAX_REQUEST_BPS.toString()
    || escalation.feeBps !== ESCALATION_FEE_BPS.toString()) {
    throw new Error("Human escalation policy changed.");
  }
  const rejectedArtifactHash = asHash(escalation.rejectedArtifactHash, "Rejected assessment artifact hash");
  asHash(escalation.rejectedModelHash, "Rejected model hash");
  const underwriter = asAddress(escalation.underwriter, "Escalation underwriter");
  const supplier = asAddress(escalation.supplier, "Escalation supplier");
  const payer = asAddress(escalation.payer, "Escalation payer");
  const funder = asAddress(escalation.approval?.funder, "Escalation funder");
  if (new Set([underwriter, supplier, payer, funder]).size !== 4) throw new Error("Escalation parties must be distinct.");

  const faceValue = asUint(escalation.faceValue, "Escalation face value");
  const requestedAdvance = asUint(escalation.requestedAdvance, "Escalation requested advance");
  const dueDate = asUint(escalation.dueDate, "Escalation due time");
  const advanceAmount = asUint(escalation.approval.advanceAmount, "Escalation advance");
  const repaymentAmount = asUint(escalation.approval.repaymentAmount, "Escalation repayment");
  const riskTimestamp = asUint(escalation.approval.riskTimestamp, "Escalation review time");
  const expiresAt = asUint(escalation.approval.expiresAt, "Escalation expiry");
  const requestedCap = requestedAdvance * ESCALATION_MAX_REQUEST_BPS / 10_000n;
  const faceCap = faceValue * ESCALATION_MAX_FACE_BPS / 10_000n;
  const escalationCap = requestedCap < faceCap ? requestedCap : faceCap;
  if (advanceAmount === 0n || advanceAmount > escalationCap) throw new Error("Escalation advance exceeds the stricter human-review cap.");
  const expectedRepayment = advanceAmount + advanceAmount * ESCALATION_FEE_BPS / 10_000n;
  if (repaymentAmount !== expectedRepayment || repaymentAmount > faceValue) throw new Error("Escalation repayment does not match the fixed policy fee.");
  const expectedExpiry = riskTimestamp + BigInt(CONNECTED_MAX_DECISION_LIFETIME_SECONDS) < dueDate
    ? riskTimestamp + BigInt(CONNECTED_MAX_DECISION_LIFETIME_SECONDS) : dueDate;
  if (expiresAt !== expectedExpiry || expiresAt <= riskTimestamp) throw new Error("Escalation expiry does not match the bounded review window.");

  const expectedReasonsHash = keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32 rejectedArtifactHash,string policy,uint16 maxFaceBps,uint16 maxRequestBps,uint16 feeBps,uint128 requestedAdvance,uint128 advanceAmount,uint128 repaymentAmount"),
    [rejectedArtifactHash, ESCALATION_POLICY, Number(ESCALATION_MAX_FACE_BPS), Number(ESCALATION_MAX_REQUEST_BPS), Number(ESCALATION_FEE_BPS), requestedAdvance, advanceAmount, repaymentAmount]
  ));
  if (asHash(escalation.approval.riskReasonsHash, "Escalation reasons hash") !== expectedReasonsHash) throw new Error("Escalation policy commitment changed.");
  if (asHash(escalation.approval.modelHash, "Escalation model hash") !== rejectedArtifactHash) throw new Error("Escalation no longer binds the rejected assessment.");
  const expectedNonce = BigInt(keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32 rejectedArtifactHash,address funder,uint128 advanceAmount,uint128 repaymentAmount,uint64 riskTimestamp"),
    [rejectedArtifactHash, funder, advanceAmount, repaymentAmount, riskTimestamp]
  ))).toString();
  if (escalation.approval.nonce !== expectedNonce) throw new Error("Escalation nonce does not bind the policy inputs.");

  const typedData = approvalTypedData(escalation.approval, OPENBELL_MAINNET_CONNECTED);
  if (hashTypedData(typedData).toLowerCase() !== asHash(escalation.authorizedDigest, "Escalation digest")) throw new Error("Human escalation digest changed.");
  return walletDecisionTypedData(typedData);
}

export async function finalizeHumanEscalation(escalation, underwriterSignature) {
  const typedData = humanEscalationTypedData(escalation);
  await assertSignature({ typedData: { ...typedData, types: approvalTypes }, authorizedDigest: escalation.authorizedDigest, expectedSigner: escalation.underwriter, value: underwriterSignature });
  const base = { schemaVersion: actionSchema(OPENBELL_MAINNET_CONNECTED), label: OPENBELL_MAINNET_CONNECTED.label, chainId: String(OPENBELL_MAINNET_CONNECTED.chainId) };
  const payload = { approval: escalation.approval, underwriter: escalation.underwriter, underwriterSignature };
  const actions = [
    { ...base, kind: "APPROVE_FUNDING", signer: escalation.approval.funder, authorizedDigest: escalation.authorizedDigest, payload },
    { ...base, kind: "FUND_INVOICE", signer: escalation.approval.funder, authorizedDigest: escalation.authorizedDigest, payload },
    { ...base, kind: "APPROVE_SETTLEMENT", signer: escalation.payer, authorizedDigest: null, payload: { invoiceId: escalation.approval.invoiceId, amount: escalation.approval.repaymentAmount } },
    { ...base, kind: "SETTLE_INVOICE", signer: escalation.payer, authorizedDigest: null, payload: { invoiceId: escalation.approval.invoiceId, repaymentAmount: escalation.approval.repaymentAmount } }
  ];
  await Promise.all(actions.map(validateBrowserAction));
  return actions;
}

export function connectedDecisionTypedData(assessment) {
  allowedKeys(assessment, "artifactHash" in assessment ? ["decision", "modelEvidence", "observation", "signingRequest", "artifactHash"] : ["decision", "modelEvidence", "observation", "signingRequest"], "Connected assessment");
  const { decision, observation, signingRequest } = assessment;
  const decisionKeys = decision?.verdict === "REJECT"
    ? ["verdict", "invoiceId", "invoiceDigest", "riskTimestamp", "expiresAt", "riskReasonsHash", "modelHash", "reasons", "explanation", "modelId"]
    : ["verdict", "invoiceId", "invoiceDigest", "funder", "advanceAmount", "repaymentAmount", "riskTimestamp", "expiresAt", "riskReasonsHash", "modelHash", "reasons", "explanation", "modelId"];
  allowedKeys(decision, decisionKeys, "Bounded decision");
  if (decision.verdict !== "REJECT" && decision.verdict !== "APPROVE") throw new Error("Unsupported bounded decision verdict.");
  if (asHash(decision.invoiceId, "Decision invoice ID") !== asHash(observation?.invoiceId, "Observed invoice ID")) throw new Error("Decision invoice changed.");
  if (!Number.isSafeInteger(decision.riskTimestamp) || !Number.isSafeInteger(decision.expiresAt) || decision.expiresAt <= decision.riskTimestamp) throw new Error("Decision timing is invalid.");
  if (assessment.modelEvidence?.decision?.verdict !== decision.verdict) throw new Error("Model evidence and bounded decision disagree.");
  allowedKeys(signingRequest, ["schemaVersion", "label", "chainId", "underwriter", "authorizedDigest", "nonce"], "Decision signing request");
  const deployment = deploymentForEnvelope(signingRequest);
  if (signingRequest.schemaVersion !== "openbell-connected-decision-signing-v1" || !deployment) throw new Error("Unsupported decision signing request.");
  const underwriter = asAddress(signingRequest.underwriter, "Underwriter");
  if (underwriter !== asAddress(observation?.underwriter, "Observed underwriter")) throw new Error("Decision underwriter changed.");
  const common = {
    invoiceId: decision.invoiceId,
    invoiceDigest: decision.invoiceDigest,
    riskTimestamp: String(decision.riskTimestamp),
    expiresAt: String(decision.expiresAt),
    riskReasonsHash: decision.riskReasonsHash,
    modelHash: decision.modelHash,
    nonce: signingRequest.nonce
  };
  const message = decision.verdict === "REJECT" ? common : {
    ...common,
    funder: decision.funder,
    advanceAmount: decision.advanceAmount,
    repaymentAmount: decision.repaymentAmount
  };
  const typedData = decision.verdict === "REJECT" ? rejectionTypedData(message, deployment) : approvalTypedData(message, deployment);
  if (hashTypedData(typedData).toLowerCase() !== asHash(signingRequest.authorizedDigest, "Authorized digest")) throw new Error("Decision digest changed.");
  return walletDecisionTypedData(typedData);
}

export async function finalizeConnectedAssessment(assessment, underwriterSignature) {
  const walletTypedData = connectedDecisionTypedData(assessment);
  const typedData = { ...walletTypedData, types: assessment.decision.verdict === "REJECT" ? rejectionTypes : approvalTypes };
  await assertSignature({ typedData, authorizedDigest: assessment.signingRequest.authorizedDigest, expectedSigner: assessment.signingRequest.underwriter, value: underwriterSignature });
  const deployment = deploymentForEnvelope(assessment.signingRequest);
  if (!deployment) throw new Error("Unsupported decision deployment.");
  const base = { schemaVersion: actionSchema(deployment), label: deployment.label, chainId: String(deployment.chainId) };
  const underwriter = asAddress(assessment.signingRequest.underwriter, "Underwriter");
  const message = walletTypedData.message;
  const actions = assessment.decision.verdict === "REJECT" ? [{
    ...base, kind: "ATTEST_REJECTION", signer: assessment.observation.supplier, authorizedDigest: assessment.signingRequest.authorizedDigest,
    payload: { rejection: Object.fromEntries(Object.entries(message).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value])), underwriter, underwriterSignature }
  }] : [
    { ...base, kind: "APPROVE_FUNDING", signer: assessment.decision.funder, authorizedDigest: assessment.signingRequest.authorizedDigest, payload: { approval: Object.fromEntries(Object.entries(message).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value])), underwriter, underwriterSignature } },
    { ...base, kind: "FUND_INVOICE", signer: assessment.decision.funder, authorizedDigest: assessment.signingRequest.authorizedDigest, payload: { approval: Object.fromEntries(Object.entries(message).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value])), underwriter, underwriterSignature } },
    { ...base, kind: "APPROVE_SETTLEMENT", signer: assessment.observation.payer, authorizedDigest: null, payload: { invoiceId: assessment.decision.invoiceId, amount: assessment.decision.repaymentAmount } },
    { ...base, kind: "SETTLE_INVOICE", signer: assessment.observation.payer, authorizedDigest: null, payload: { invoiceId: assessment.decision.invoiceId, repaymentAmount: assessment.decision.repaymentAmount } }
  ];
  await Promise.all(actions.map(validateBrowserAction));
  return actions;
}

export const connectedAssessmentTypedData = (request) => {
  const deployment = deployments.find((candidate) => request.label === candidate.label);
  if (!deployment) throw new Error("Unsupported connected assessment deployment.");
  const evidenceHash = keccak256(stringToHex(canonicalJson({
    registrationTransactionHash: request.registrationTransactionHash,
    issuedAt: request.issuedAt,
    dueDate: request.dueDate,
    payerHistory: request.payerHistory,
    redactedContext: request.redactedContext,
    valueBoundaryAcknowledged: deployment === OPENBELL_TESTNET ? request.syntheticFixtureAcknowledged : request.realValueAcknowledged,
    ...(request.receiptBoundHistory ? { receiptBoundHistory: request.receiptBoundHistory } : {})
  })));
  return {
    domain: domainFor(deployment),
    types: assessmentTypes,
    primaryType: "UnderwritingRequest",
    message: {
      invoiceId: request.invoiceId,
      documentHash: request.documentHash,
      supplier: request.supplier,
      payer: request.payer,
      funder: request.funder,
      faceValue: BigInt(request.faceValue),
      requestedAdvance: BigInt(request.requestedAdvance),
      evidenceHash
    }
  };
};

export const walletConnectedAssessmentTypedData = (request) => {
  const typedData = connectedAssessmentTypedData(request);
  return {
    ...typedData,
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" }
      ],
      ...typedData.types
    }
  };
};

export async function buildConnectedAssessmentRequest({ session: sessionCandidate, registrationTransactionHash, funder, payerHistory, receiptBoundHistory = null, redactedContext, supplierAuthorization = null }) {
  const session = await validateInvoiceSession(sessionCandidate);
  const deployment = deploymentForTarget(session.dealPackage.target);
  if (!deployment) throw new Error("Unsupported connected assessment deployment.");
  if (session.supplierSignature === null || session.payerSignature === null) throw new Error("Both invoice signatures are required before assessment.");
  const terms = normalizeTerms(session.dealPackage.invoiceTerms);
  const normalizedFunder = asAddress(funder, "Funder");
  if (normalizedFunder === terms.supplier || normalizedFunder === terms.payer) throw new Error("Funder must be distinct from supplier and payer.");
  allowedKeys(payerHistory, ["completedSettlements", "onTimeSettlements", "lateSettlements", "defaults", "concentrationBps", "daysSinceLastSettlement"], "Payer history");
  const history = {};
  for (const key of Object.keys(payerHistory)) {
    const value = payerHistory[key];
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Payer history ${key} is invalid.`);
    history[key] = value;
  }
  if (history.concentrationBps > 10_000 || history.onTimeSettlements + history.lateSettlements > history.completedSettlements) throw new Error("Payer history is inconsistent.");
  if (deployment === OPENBELL_TESTNET && Object.values(history).some((value) => value !== 0)) throw new Error("Unverified payer history is disabled for connected assessments.");
  const context = String(redactedContext).trim();
  if (!context || context.length > 2_000) throw new Error("Redacted context must contain 1 to 2,000 characters.");
  const unsigned = {
    schemaVersion: deployment === OPENBELL_TESTNET ? "openbell-connected-underwriting-v1" : receiptBoundHistory ? RECEIPT_BOUND_MAINNET_SCHEMA : "openbell-mainnet-underwriting-v1",
    label: deployment.label,
    registrationTransactionHash: asHash(registrationTransactionHash, "Registration transaction hash"),
    invoiceId: terms.invoiceId,
    documentHash: terms.documentHash,
    supplier: terms.supplier,
    payer: terms.payer,
    funder: normalizedFunder,
    faceValue: terms.faceValue.toString(),
    issuedAt: Number(terms.issuedAt),
    dueDate: Number(terms.dueDate),
    requestedAdvance: session.dealPackage.underwritingRequest.requestedAdvance,
    payerHistory: history,
    redactedContext: context,
    ...(receiptBoundHistory ? { receiptBoundHistory } : {}),
    ...(deployment === OPENBELL_TESTNET ? { syntheticFixtureAcknowledged: true } : { realValueAcknowledged: true })
  };
  if (supplierAuthorization === null) return unsigned;
  await assertSignature({ typedData: connectedAssessmentTypedData(unsigned), authorizedDigest: hashTypedData(connectedAssessmentTypedData(unsigned)), expectedSigner: terms.supplier, value: supplierAuthorization });
  return { ...unsigned, supplierAuthorization };
}

export async function assertSignature({ typedData, authorizedDigest, expectedSigner, value }) {
  const digest = hashTypedData(typedData);
  if (digest.toLowerCase() !== asHash(authorizedDigest, "Authorized digest")) {
    throw new Error("Typed-data digest does not match the authorized digest.");
  }
  const recovered = await recoverTypedDataAddress({ ...typedData, signature: asSignature(value, "Signature") });
  if (recovered !== asAddress(expectedSigner, "Expected signer")) throw new Error("Signature recovered the wrong signer.");
  return digest;
}

export async function validateInvoiceSession(candidate) {
  allowedKeys(candidate, ["schemaVersion", "label", "dealPackage", "authorizedDigest", "supplierSignature", "payerSignature"], "Invoice session");
  const deployment = deployments.find((item) => candidate.label === item.label && candidate.schemaVersion === sessionSchema(item));
  if (!deployment) {
    throw new Error("Unsupported invoice-session schema or label.");
  }
  const dealPackage = await validateUnsignedDealPackage(candidate.dealPackage);
  if (deploymentForTarget(dealPackage.target) !== deployment) {
    throw new Error("Invoice session does not target its labelled deployment.");
  }
  const typedData = invoiceTypedData(dealPackage.invoiceTerms, deployment);
  const digest = hashTypedData(typedData);
  if (digest.toLowerCase() !== asHash(candidate.authorizedDigest, "Authorized digest")) throw new Error("Invoice-session digest changed.");
  if (candidate.supplierSignature !== null) {
    await assertSignature({ typedData, authorizedDigest: digest, expectedSigner: dealPackage.invoiceTerms.supplier, value: candidate.supplierSignature });
  }
  if (candidate.payerSignature !== null) {
    await assertSignature({ typedData, authorizedDigest: digest, expectedSigner: dealPackage.invoiceTerms.payer, value: candidate.payerSignature });
  }
  return { ...candidate, dealPackage };
}

export async function createInvoiceSession(dealPackageCandidate) {
  const dealPackage = await validateUnsignedDealPackage(dealPackageCandidate);
  const deployment = deploymentForTarget(dealPackage.target);
  if (!deployment) throw new Error("Connected signing is unavailable for this deployment.");
  return validateInvoiceSession({
    schemaVersion: sessionSchema(deployment),
    label: deployment.label,
    dealPackage,
    authorizedDigest: hashTypedData(invoiceTypedData(dealPackage.invoiceTerms, deployment)),
    supplierSignature: null,
    payerSignature: null
  });
}

export async function addInvoiceSessionSignature(sessionCandidate, signerCandidate, value) {
  const session = await validateInvoiceSession(sessionCandidate);
  const signer = asAddress(signerCandidate, "Invoice signer");
  const terms = session.dealPackage.invoiceTerms;
  const role = signer === asAddress(terms.supplier, "Supplier") ? "supplierSignature"
    : signer === asAddress(terms.payer, "Payer") ? "payerSignature" : null;
  if (!role) throw new Error("Connected wallet is neither the supplier nor the payer.");
  if (session[role] !== null && session[role].toLowerCase() !== value.toLowerCase()) throw new Error("A different signature is already sealed for this role.");
  const next = { ...session, [role]: value };
  return validateInvoiceSession(next);
}

export async function registrationActionFromSession(sessionCandidate) {
  const session = await validateInvoiceSession(sessionCandidate);
  const deployment = deploymentForTarget(session.dealPackage.target);
  if (!deployment) throw new Error("Unsupported registration deployment.");
  if (session.supplierSignature === null || session.payerSignature === null) throw new Error("Both invoice signatures are required before registration.");
  return {
    schemaVersion: actionSchema(deployment),
    label: deployment.label,
    chainId: String(deployment.chainId),
    kind: "REGISTER_INVOICE",
    signer: session.dealPackage.invoiceTerms.supplier,
    authorizedDigest: session.authorizedDigest,
    payload: {
      terms: session.dealPackage.invoiceTerms,
      supplierSignature: session.supplierSignature,
      payerSignature: session.payerSignature
    }
  };
}

const basePackage = (candidate) => {
  const labelledDeployment = deployments.find((deployment) => candidate?.label === deployment.label);
  if (!labelledDeployment || candidate.schemaVersion !== actionSchema(labelledDeployment)) throw new Error("Unsupported action-package schema or deployment label.");
  if (typeof candidate.chainId !== "string" || candidate.chainId !== String(labelledDeployment.chainId)) throw new Error("Action package targets the wrong chain.");
  const deployment = labelledDeployment;
  return deployment;
};

export const fixtureClaimPackage = (signerCandidate) => {
  const signer = asAddress(signerCandidate, "Fixture claimant");
  if (signer === "0x0000000000000000000000000000000000000000") throw new Error("Fixture claimant must be nonzero.");
  return {
    schemaVersion: "openbell-testnet-browser-action-v1",
    label: OPENBELL_TESTNET.label,
    chainId: String(OPENBELL_TESTNET.chainId),
    kind: "CLAIM_FIXTURE_TOKENS",
    signer,
    authorizedDigest: null,
    payload: {}
  };
};

export const createFixtureClaimAction = (signerCandidate) => validateBrowserAction(fixtureClaimPackage(signerCandidate));

export async function validateBrowserAction(candidate) {
  allowedKeys(candidate, ["schemaVersion", "label", "chainId", "kind", "signer", "authorizedDigest", "payload"], "Action package");
  const deployment = basePackage(candidate);
  const signer = asAddress(candidate.signer, "Transaction signer");
  let to;
  let data;
  let amount = null;
  let invoiceId;
  let invoiceDigest = null;
  let expiresAt = null;
  let registration = null;

  if (candidate.kind === "CLAIM_FIXTURE_TOKENS") {
    if (deployment !== OPENBELL_TESTNET) throw new Error("Fixture-token claims are forbidden on mainnet.");
    allowedKeys(candidate.payload, [], "Fixture claim payload");
    if (candidate.authorizedDigest !== null) throw new Error("Fixture claim cannot carry an EIP-712 digest.");
    to = deployment.settlementToken;
    amount = FIXTURE_CLAIM_AMOUNT;
    invoiceId = null;
    data = encodeFunctionData({ abi: tokenAbi, functionName: "claimFixtureTokens" });
  } else if (candidate.kind === "REGISTER_INVOICE") {
    allowedKeys(candidate.payload, ["terms", "supplierSignature", "payerSignature"], "Registration payload");
    const terms = normalizeTerms(candidate.payload.terms);
    if (signer !== terms.supplier) throw new Error("Only the supplier may register the invoice.");
    const typedData = invoiceTypedData(candidate.payload.terms, deployment);
    await assertSignature({ typedData, authorizedDigest: candidate.authorizedDigest, expectedSigner: terms.supplier, value: candidate.payload.supplierSignature });
    await assertSignature({ typedData, authorizedDigest: candidate.authorizedDigest, expectedSigner: terms.payer, value: candidate.payload.payerSignature });
    to = deployment.receivables;
    invoiceId = terms.invoiceId;
    invoiceDigest = candidate.authorizedDigest.toLowerCase();
    registration = Object.freeze({ supplier: terms.supplier, payer: terms.payer, nonce: terms.nonce });
    data = encodeFunctionData({ abi: receivablesAbi, functionName: "registerInvoice", args: [terms, candidate.payload.supplierSignature, candidate.payload.payerSignature] });
  } else if (candidate.kind === "ATTEST_REJECTION") {
    allowedKeys(candidate.payload, ["rejection", "underwriter", "underwriterSignature"], "Rejection payload");
    const rejection = normalizeRejection(candidate.payload.rejection);
    const underwriter = asAddress(candidate.payload.underwriter, "Underwriter");
    await assertSignature({ typedData: rejectionTypedData(candidate.payload.rejection, deployment), authorizedDigest: candidate.authorizedDigest, expectedSigner: underwriter, value: candidate.payload.underwriterSignature });
    to = deployment.receivables;
    invoiceId = rejection.invoiceId;
    invoiceDigest = rejection.invoiceDigest;
    expiresAt = rejection.expiresAt;
    data = encodeFunctionData({ abi: receivablesAbi, functionName: "attestRejection", args: [rejection, candidate.payload.underwriterSignature] });
  } else if (candidate.kind === "APPROVE_FUNDING") {
    allowedKeys(candidate.payload, ["approval", "underwriter", "underwriterSignature"], "Funding approval payload");
    const approval = normalizeApproval(candidate.payload.approval);
    if (signer !== approval.funder) throw new Error("Only the bound funder may approve funding.");
    const underwriter = asAddress(candidate.payload.underwriter, "Underwriter");
    await assertSignature({ typedData: approvalTypedData(candidate.payload.approval, deployment), authorizedDigest: candidate.authorizedDigest, expectedSigner: underwriter, value: candidate.payload.underwriterSignature });
    invoiceId = approval.invoiceId;
    invoiceDigest = approval.invoiceDigest;
    amount = approval.advanceAmount;
    expiresAt = approval.expiresAt;
    to = deployment.settlementToken;
    data = encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [deployment.receivables, amount] });
  } else if (candidate.kind === "APPROVE_SETTLEMENT") {
    allowedKeys(candidate.payload, ["invoiceId", "amount"], "Token approval payload");
    invoiceId = asHash(candidate.payload.invoiceId, "Invoice ID");
    amount = asUint(candidate.payload.amount, "Token approval amount");
    if (amount === 0n) throw new Error("Token approval amount must be nonzero.");
    if (candidate.authorizedDigest !== null) throw new Error("Settlement approval cannot carry an EIP-712 digest.");
    to = deployment.settlementToken;
    data = encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [deployment.receivables, amount] });
  } else if (candidate.kind === "FUND_INVOICE") {
    allowedKeys(candidate.payload, ["approval", "underwriter", "underwriterSignature"], "Funding payload");
    const approval = normalizeApproval(candidate.payload.approval);
    if (signer !== approval.funder) throw new Error("Only the bound funder may execute funding.");
    const underwriter = asAddress(candidate.payload.underwriter, "Underwriter");
    await assertSignature({ typedData: approvalTypedData(candidate.payload.approval, deployment), authorizedDigest: candidate.authorizedDigest, expectedSigner: underwriter, value: candidate.payload.underwriterSignature });
    amount = approval.advanceAmount;
    to = deployment.receivables;
    invoiceId = approval.invoiceId;
    invoiceDigest = approval.invoiceDigest;
    expiresAt = approval.expiresAt;
    data = encodeFunctionData({ abi: receivablesAbi, functionName: "fund", args: [approval, candidate.payload.underwriterSignature] });
  } else if (candidate.kind === "SETTLE_INVOICE") {
    allowedKeys(candidate.payload, ["invoiceId", "repaymentAmount"], "Settlement payload");
    invoiceId = asHash(candidate.payload.invoiceId, "Invoice ID");
    amount = asUint(candidate.payload.repaymentAmount, "Repayment amount");
    if (amount === 0n) throw new Error("Repayment amount must be nonzero.");
    if (candidate.authorizedDigest !== null) throw new Error("Settlement cannot carry an EIP-712 digest.");
    to = deployment.receivables;
    data = encodeFunctionData({ abi: receivablesAbi, functionName: "settle", args: [invoiceId] });
  } else {
    throw new Error("Unsupported action kind.");
  }

  return Object.freeze({
    kind: candidate.kind,
    signer,
    chainId: deployment.chainId,
    to: getAddress(to),
    data,
    value: 0n,
    amount,
    invoiceId,
    invoiceDigest,
    expiresAt,
    registration
  });
}

export function buildInvoiceStateCall(invoiceId) {
  return encodeFunctionData({ abi: receivablesAbi, functionName: "invoices", args: [asHash(invoiceId, "Invoice ID")] });
}

export function buildAllowanceStateCall(ownerCandidate, spenderCandidate = OPENBELL_MAINNET_CONNECTED.receivables) {
  return encodeFunctionData({
    abi: tokenAbi,
    functionName: "allowance",
    args: [asAddress(ownerCandidate, "Allowance owner"), asAddress(spenderCandidate, "Allowance spender")]
  });
}

export function decodeAllowanceState(result) {
  return decodeFunctionResult({ abi: tokenAbi, functionName: "allowance", data: result });
}

export function decodeInvoiceState(encodedResult) {
  const [status, supplier, payer, funder, faceValue, advanceAmount, repaymentAmount, dueDate, documentHash, invoiceDigest, decisionDigest] =
    decodeFunctionResult({ abi: receivablesAbi, functionName: "invoices", data: encodedResult });
  return Object.freeze({
    status: Number(status), supplier, payer, funder, faceValue, advanceAmount, repaymentAmount, dueDate, documentHash, invoiceDigest, decisionDigest
  });
}

export function buildPartyNonceStateCall(signer, nonce) {
  return encodeFunctionData({
    abi: receivablesAbi,
    functionName: "usedPartyNonces",
    args: [asAddress(signer, "Invoice signer"), asUint(nonce, "Invoice nonce")]
  });
}

export function assertRegistrationNoncesAvailable(action, supplierResult, payerResult) {
  if (action.kind !== "REGISTER_INVOICE") throw new Error("Action is not an invoice registration.");
  const supplierUsed = decodeFunctionResult({ abi: receivablesAbi, functionName: "usedPartyNonces", data: supplierResult });
  const payerUsed = decodeFunctionResult({ abi: receivablesAbi, functionName: "usedPartyNonces", data: payerResult });
  if (supplierUsed || payerUsed) {
    const party = supplierUsed && payerUsed ? "supplier and payer" : supplierUsed ? "supplier" : "payer";
    throw new Error(`This package reuses a nonce already consumed by the ${party}. Prepare and sign a fresh package in Studio.`);
  }
  return true;
}

export function buildFixtureClaimStateCalls(accountCandidate) {
  const account = asAddress(accountCandidate, "Fixture claimant");
  return Object.freeze({
    hasClaimed: encodeFunctionData({ abi: tokenAbi, functionName: "hasClaimed", args: [account] }),
    balance: encodeFunctionData({ abi: tokenAbi, functionName: "balanceOf", args: [account] }),
    faucetAmount: encodeFunctionData({ abi: tokenAbi, functionName: "FAUCET_AMOUNT" })
  });
}

export function assertFixtureClaimAvailable(action, { hasClaimedResult, balanceResult, faucetAmountResult }) {
  if (action.kind !== "CLAIM_FIXTURE_TOKENS") throw new Error("Action is not a fixture-token claim.");
  const claimed = decodeFunctionResult({ abi: tokenAbi, functionName: "hasClaimed", data: hasClaimedResult });
  const balance = decodeFunctionResult({ abi: tokenAbi, functionName: "balanceOf", data: balanceResult });
  const faucetAmount = decodeFunctionResult({ abi: tokenAbi, functionName: "FAUCET_AMOUNT", data: faucetAmountResult });
  if (claimed) throw new Error("This account already claimed fixture tUSDG.");
  if (faucetAmount !== FIXTURE_CLAIM_AMOUNT || action.amount !== FIXTURE_CLAIM_AMOUNT) {
    throw new Error("Fixture-token faucet amount changed.");
  }
  return Object.freeze({ balance, faucetAmount });
}

export function assertFixtureClaimCompleted(action, { hasClaimedResult, balanceResult }, previousBalance) {
  if (action.kind !== "CLAIM_FIXTURE_TOKENS") throw new Error("Action is not a fixture-token claim.");
  const claimed = decodeFunctionResult({ abi: tokenAbi, functionName: "hasClaimed", data: hasClaimedResult });
  const balance = decodeFunctionResult({ abi: tokenAbi, functionName: "balanceOf", data: balanceResult });
  if (!claimed) throw new Error("Fixture-token claim flag was not set.");
  if (balance !== previousBalance + FIXTURE_CLAIM_AMOUNT) throw new Error("Fixture-token balance did not increase by exactly the faucet amount.");
  return Object.freeze({ balance, claimed });
}

export function assertActionAgainstInvoice(action, encodedResult, nowSeconds) {
  if (action.kind === "CLAIM_FIXTURE_TOKENS") throw new Error("Fixture claims do not use invoice state.");
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) throw new Error("Current time is invalid.");
  const record = decodeInvoiceState(encodedResult);
  if (action.expiresAt !== null && BigInt(nowSeconds) > action.expiresAt) throw new Error("The underwriting decision has expired.");
  if (action.kind === "REGISTER_INVOICE") {
    if (record.status !== 0) throw new Error("Invoice ID is already in use.");
  } else {
    if (action.invoiceDigest !== null && record.invoiceDigest.toLowerCase() !== action.invoiceDigest.toLowerCase()) {
      throw new Error("Action invoice digest differs from the registered invoice.");
    }
    if (["ATTEST_REJECTION", "APPROVE_FUNDING", "FUND_INVOICE"].includes(action.kind) && record.status !== 1) {
      throw new Error("Invoice is not in REGISTERED state.");
    }
    if (["APPROVE_SETTLEMENT", "SETTLE_INVOICE"].includes(action.kind) && record.status !== 2) {
      throw new Error("Invoice is not in FUNDED state.");
    }
  }
  if (action.kind === "ATTEST_REJECTION" && record.supplier !== action.signer) throw new Error("Only the registered supplier may attest rejection.");
  if (action.kind === "FUND_INVOICE" && action.amount > (record.faceValue * 8_000n) / 10_000n) throw new Error("Funding exceeds the immutable contract ceiling.");
  if (action.kind === "APPROVE_FUNDING" && action.amount > (record.faceValue * 8_000n) / 10_000n) throw new Error("Funding approval exceeds the immutable contract ceiling.");
  if (["APPROVE_SETTLEMENT", "SETTLE_INVOICE"].includes(action.kind)) {
    if (record.payer !== action.signer) throw new Error("Only the registered payer may approve or settle repayment.");
    if (action.amount !== record.repaymentAmount) throw new Error("Settlement amount differs from the registered repayment.");
  }
  return Object.freeze(record);
}

export function assertWalletContext(action, { account, chainId }) {
  if (Number(chainId) !== action.chainId) throw new Error(`Switch the wallet to X Layer chain ${action.chainId}.`);
  if (asAddress(account, "Connected account") !== action.signer) throw new Error("Connected wallet does not match the required signer.");
  return true;
}
