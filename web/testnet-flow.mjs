import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  hashTypedData,
  keccak256,
  recoverTypedDataAddress,
  stringToHex
} from "viem";
import { OPENBELL_TESTNET_TARGET, validateUnsignedDealPackage } from "./deal-package.mjs";

export const OPENBELL_TESTNET = Object.freeze({
  label: "XLAYER TESTNET FIXTURE — NO REAL VALUE",
  chainId: 1952,
  chainHex: "0x7a0",
  receivables: "0x7eb9C2418ec935d43E6761e462eAA5388BD6ca18",
  settlementToken: "0x7E7a189a8CE288E9581Ba3CDf14ac3D4a1624703",
  explorerTransactionBase: "https://www.okx.com/web3/explorer/xlayer-test/tx/"
});

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

const tokenAbi = [{
  type: "function",
  name: "approve",
  stateMutability: "nonpayable",
  inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ name: "", type: "bool" }]
}];

const hex32 = /^0x[0-9a-fA-F]{64}$/;
const signature = /^0x[0-9a-fA-F]{130}$/;
const uint = /^(0|[1-9][0-9]*)$/;
const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  return JSON.stringify(value);
};
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
const asUint = (value, label) => {
  if (!uint.test(String(value))) throw new Error(`${label} must be an unsigned decimal string.`);
  return BigInt(value);
};
const asSignature = (value, label) => {
  if (!signature.test(value)) throw new Error(`${label} must be one canonical 65-byte signature.`);
  return value;
};

export const testnetDomain = Object.freeze({
  name: "OpenBell Receivables",
  version: "1",
  chainId: OPENBELL_TESTNET.chainId,
  verifyingContract: OPENBELL_TESTNET.receivables
});

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

export const invoiceTypedData = (terms) => ({
  domain: testnetDomain,
  types: invoiceTypes,
  primaryType: "InvoiceTerms",
  message: normalizeTerms(terms)
});

export const walletInvoiceTypedData = (terms) => {
  const typedData = invoiceTypedData(terms);
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

export const approvalTypedData = (approval) => ({
  domain: testnetDomain,
  types: approvalTypes,
  primaryType: "RiskApproval",
  message: normalizeApproval(approval)
});

export const rejectionTypedData = (rejection) => ({
  domain: testnetDomain,
  types: rejectionTypes,
  primaryType: "RiskRejection",
  message: normalizeRejection(rejection)
});

export const connectedAssessmentTypedData = (request) => {
  const evidenceHash = keccak256(stringToHex(canonicalJson({
    registrationTransactionHash: request.registrationTransactionHash,
    issuedAt: request.issuedAt,
    dueDate: request.dueDate,
    payerHistory: request.payerHistory,
    redactedContext: request.redactedContext,
    syntheticFixtureAcknowledged: request.syntheticFixtureAcknowledged
  })));
  return {
    domain: testnetDomain,
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

export async function buildConnectedAssessmentRequest({ session: sessionCandidate, registrationTransactionHash, funder, payerHistory, redactedContext, supplierAuthorization = null }) {
  const session = await validateInvoiceSession(sessionCandidate);
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
  const context = String(redactedContext).trim();
  if (!context || context.length > 2_000) throw new Error("Redacted context must contain 1 to 2,000 characters.");
  const unsigned = {
    schemaVersion: "openbell-connected-underwriting-v1",
    label: OPENBELL_TESTNET.label,
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
    syntheticFixtureAcknowledged: true
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
  if (candidate.schemaVersion !== "openbell-testnet-invoice-session-v1" || candidate.label !== OPENBELL_TESTNET.label) {
    throw new Error("Unsupported invoice-session schema or label.");
  }
  const dealPackage = await validateUnsignedDealPackage(candidate.dealPackage);
  if (dealPackage.target.chainId !== OPENBELL_TESTNET_TARGET.chainId || dealPackage.target.verifyingContract !== OPENBELL_TESTNET_TARGET.verifyingContract) {
    throw new Error("Invoice session does not target the frozen testnet deployment.");
  }
  const typedData = invoiceTypedData(dealPackage.invoiceTerms);
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
  if (dealPackage.target.chainId !== OPENBELL_TESTNET_TARGET.chainId || dealPackage.target.verifyingContract !== OPENBELL_TESTNET_TARGET.verifyingContract) {
    throw new Error("Connected signing is available only for the labelled testnet fixture.");
  }
  return validateInvoiceSession({
    schemaVersion: "openbell-testnet-invoice-session-v1",
    label: OPENBELL_TESTNET.label,
    dealPackage,
    authorizedDigest: hashTypedData(invoiceTypedData(dealPackage.invoiceTerms)),
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
  if (session.supplierSignature === null || session.payerSignature === null) throw new Error("Both invoice signatures are required before registration.");
  return {
    schemaVersion: "openbell-testnet-browser-action-v1",
    label: OPENBELL_TESTNET.label,
    chainId: String(OPENBELL_TESTNET.chainId),
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
  if (candidate.schemaVersion !== "openbell-testnet-browser-action-v1") throw new Error("Unsupported action-package schema.");
  if (candidate.label !== OPENBELL_TESTNET.label) throw new Error("Action package is not labelled as the no-value fixture.");
  if (candidate.chainId !== String(OPENBELL_TESTNET.chainId)) throw new Error("Action package targets the wrong chain.");
};

export async function validateBrowserAction(candidate) {
  allowedKeys(candidate, ["schemaVersion", "label", "chainId", "kind", "signer", "authorizedDigest", "payload"], "Action package");
  basePackage(candidate);
  const signer = asAddress(candidate.signer, "Transaction signer");
  let to;
  let data;
  let amount = null;
  let invoiceId;
  let invoiceDigest = null;
  let expiresAt = null;

  if (candidate.kind === "REGISTER_INVOICE") {
    allowedKeys(candidate.payload, ["terms", "supplierSignature", "payerSignature"], "Registration payload");
    const terms = normalizeTerms(candidate.payload.terms);
    if (signer !== terms.supplier) throw new Error("Only the supplier may register the invoice.");
    const typedData = invoiceTypedData(candidate.payload.terms);
    await assertSignature({ typedData, authorizedDigest: candidate.authorizedDigest, expectedSigner: terms.supplier, value: candidate.payload.supplierSignature });
    await assertSignature({ typedData, authorizedDigest: candidate.authorizedDigest, expectedSigner: terms.payer, value: candidate.payload.payerSignature });
    to = OPENBELL_TESTNET.receivables;
    invoiceId = terms.invoiceId;
    invoiceDigest = candidate.authorizedDigest.toLowerCase();
    data = encodeFunctionData({ abi: receivablesAbi, functionName: "registerInvoice", args: [terms, candidate.payload.supplierSignature, candidate.payload.payerSignature] });
  } else if (candidate.kind === "ATTEST_REJECTION") {
    allowedKeys(candidate.payload, ["rejection", "underwriter", "underwriterSignature"], "Rejection payload");
    const rejection = normalizeRejection(candidate.payload.rejection);
    const underwriter = asAddress(candidate.payload.underwriter, "Underwriter");
    await assertSignature({ typedData: rejectionTypedData(candidate.payload.rejection), authorizedDigest: candidate.authorizedDigest, expectedSigner: underwriter, value: candidate.payload.underwriterSignature });
    to = OPENBELL_TESTNET.receivables;
    invoiceId = rejection.invoiceId;
    invoiceDigest = rejection.invoiceDigest;
    expiresAt = rejection.expiresAt;
    data = encodeFunctionData({ abi: receivablesAbi, functionName: "attestRejection", args: [rejection, candidate.payload.underwriterSignature] });
  } else if (candidate.kind === "APPROVE_FUNDING" || candidate.kind === "APPROVE_SETTLEMENT") {
    allowedKeys(candidate.payload, ["invoiceId", "amount"], "Token approval payload");
    invoiceId = asHash(candidate.payload.invoiceId, "Invoice ID");
    amount = asUint(candidate.payload.amount, "Token approval amount");
    if (amount === 0n) throw new Error("Token approval amount must be nonzero.");
    if (candidate.authorizedDigest !== null) throw new Error("Token approval cannot carry an EIP-712 digest.");
    to = OPENBELL_TESTNET.settlementToken;
    data = encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [OPENBELL_TESTNET.receivables, amount] });
  } else if (candidate.kind === "FUND_INVOICE") {
    allowedKeys(candidate.payload, ["approval", "underwriter", "underwriterSignature"], "Funding payload");
    const approval = normalizeApproval(candidate.payload.approval);
    if (signer !== approval.funder) throw new Error("Only the bound funder may execute funding.");
    const underwriter = asAddress(candidate.payload.underwriter, "Underwriter");
    await assertSignature({ typedData: approvalTypedData(candidate.payload.approval), authorizedDigest: candidate.authorizedDigest, expectedSigner: underwriter, value: candidate.payload.underwriterSignature });
    amount = approval.advanceAmount;
    to = OPENBELL_TESTNET.receivables;
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
    to = OPENBELL_TESTNET.receivables;
    data = encodeFunctionData({ abi: receivablesAbi, functionName: "settle", args: [invoiceId] });
  } else {
    throw new Error("Unsupported action kind.");
  }

  return Object.freeze({
    kind: candidate.kind,
    signer,
    chainId: OPENBELL_TESTNET.chainId,
    to: getAddress(to),
    data,
    value: 0n,
    amount,
    invoiceId,
    invoiceDigest,
    expiresAt
  });
}

export function buildInvoiceStateCall(invoiceId) {
  return encodeFunctionData({ abi: receivablesAbi, functionName: "invoices", args: [asHash(invoiceId, "Invoice ID")] });
}

export function assertActionAgainstInvoice(action, encodedResult, nowSeconds) {
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) throw new Error("Current time is invalid.");
  const [status, supplier, payer, funder, faceValue, advanceAmount, repaymentAmount, dueDate, documentHash, invoiceDigest] =
    decodeFunctionResult({ abi: receivablesAbi, functionName: "invoices", data: encodedResult });
  const record = { status: Number(status), supplier, payer, funder, faceValue, advanceAmount, repaymentAmount, dueDate, documentHash, invoiceDigest };
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
  if (Number(chainId) !== OPENBELL_TESTNET.chainId) throw new Error("Switch the wallet to X Layer testnet (chain 1952).");
  if (asAddress(account, "Connected account") !== action.signer) throw new Error("Connected wallet does not match the required signer.");
  return true;
}
