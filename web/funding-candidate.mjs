import { getAddress } from "viem";
import { OPENBELL_MAINNET_CONNECTED, validateBrowserAction } from "./testnet-flow.mjs";

const hex32 = /^0x[0-9a-fA-F]{64}$/;
const uint = /^(0|[1-9][0-9]*)$/;

const allowedKeys = (candidate, keys, label) => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error(`${label} must be an object.`);
  const actual = Object.keys(candidate).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} contains unsupported or missing fields.`);
  }
};

const address = (value, label) => {
  try { return getAddress(value); } catch { throw new Error(`${label} is not a valid address.`); }
};

const hash = (value, label) => {
  if (!hex32.test(String(value))) throw new Error(`${label} is not a bytes32 value.`);
  return String(value).toLowerCase();
};

const amount = (value, label) => {
  if (!uint.test(String(value))) throw new Error(`${label} is not an unsigned integer.`);
  return BigInt(value);
};

export async function validateFundingCandidate(candidate, nowSeconds = Math.floor(Date.now() / 1_000)) {
  allowedKeys(candidate, ["schemaVersion", "status", "title", "summary", "invoice", "authority", "actions"], "Funding candidate");
  if (candidate.schemaVersion !== "openbell-mainnet-funding-candidate-v1" || candidate.status !== "OPEN") {
    throw new Error("No open OpenBell funding candidate is available.");
  }
  if (typeof candidate.title !== "string" || candidate.title.length < 8 || candidate.title.length > 100) throw new Error("Funding candidate title is invalid.");
  if (typeof candidate.summary !== "string" || candidate.summary.length < 30 || candidate.summary.length > 280) throw new Error("Funding candidate summary is invalid.");
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) throw new Error("Current time is invalid.");

  allowedKeys(candidate.invoice, ["invoiceId", "documentHash", "supplier", "payer", "funder", "faceValue", "requestedAdvance", "approvedAdvance", "repaymentAmount", "dueDate"], "Funding invoice");
  const invoice = Object.freeze({
    invoiceId: hash(candidate.invoice.invoiceId, "Invoice ID"),
    documentHash: hash(candidate.invoice.documentHash, "Document hash"),
    supplier: address(candidate.invoice.supplier, "Supplier"),
    payer: address(candidate.invoice.payer, "Payer"),
    funder: address(candidate.invoice.funder, "Funder"),
    faceValue: amount(candidate.invoice.faceValue, "Face value"),
    requestedAdvance: amount(candidate.invoice.requestedAdvance, "Requested advance"),
    approvedAdvance: amount(candidate.invoice.approvedAdvance, "Approved advance"),
    repaymentAmount: amount(candidate.invoice.repaymentAmount, "Repayment amount"),
    dueDate: amount(candidate.invoice.dueDate, "Due date")
  });
  if (new Set([invoice.supplier, invoice.payer, invoice.funder].map((value) => value.toLowerCase())).size !== 3) throw new Error("Funding candidate roles must be distinct.");
  if (invoice.approvedAdvance === 0n || invoice.approvedAdvance > invoice.requestedAdvance || invoice.approvedAdvance > invoice.faceValue * 8_000n / 10_000n) {
    throw new Error("Approved advance exceeds a published funding boundary.");
  }
  if (invoice.repaymentAmount <= invoice.approvedAdvance || invoice.dueDate <= BigInt(nowSeconds)) throw new Error("Funding candidate economics or due date are invalid.");

  allowedKeys(candidate.authority, ["modelVerdict", "policy", "rejectedArtifactHash", "expiresAt"], "Funding authority");
  if (candidate.authority.modelVerdict !== "REJECT" || candidate.authority.policy !== "HUMAN_REVIEW_AFTER_MODEL_REJECTION_V1") {
    throw new Error("Funding candidate does not preserve the original model rejection.");
  }
  const rejectedArtifactHash = hash(candidate.authority.rejectedArtifactHash, "Rejected artifact hash");
  const expiresAt = amount(candidate.authority.expiresAt, "Authority expiry");
  if (expiresAt <= BigInt(nowSeconds) || expiresAt > invoice.dueDate) throw new Error("Funding authority has expired or exceeds the invoice due date.");

  if (!Array.isArray(candidate.actions) || candidate.actions.length !== 2) throw new Error("Funding candidate must contain exactly two actions.");
  const [approvalAction, fundingAction] = await Promise.all(candidate.actions.map(validateBrowserAction));
  if (approvalAction.kind !== "APPROVE_FUNDING" || fundingAction.kind !== "FUND_INVOICE") throw new Error("Funding candidate action order is invalid.");
  for (const action of [approvalAction, fundingAction]) {
    if (action.chainId !== OPENBELL_MAINNET_CONNECTED.chainId || action.signer !== invoice.funder) throw new Error("Funding candidate signer or chain changed.");
    if (action.invoiceId !== invoice.invoiceId || action.amount !== invoice.approvedAdvance || action.expiresAt !== expiresAt) throw new Error("Funding candidate action economics changed.");
  }
  const approvalPayload = candidate.actions[1]?.payload?.approval;
  if (hash(approvalPayload?.modelHash, "Funding model hash") !== rejectedArtifactHash) throw new Error("Funding authority no longer binds the rejected model artifact.");
  if (amount(approvalPayload?.repaymentAmount, "Authorized repayment") !== invoice.repaymentAmount) throw new Error("Funding repayment differs from the signed authority.");

  return Object.freeze({
    title: candidate.title,
    summary: candidate.summary,
    invoice,
    authority: Object.freeze({ modelVerdict: "REJECT", policy: candidate.authority.policy, rejectedArtifactHash, expiresAt }),
    approvalAction,
    fundingAction
  });
}

export function assertFundingCandidateAgainstInvoice(candidate, record) {
  if (!candidate?.invoice || !record) throw new Error("Funding candidate state is unavailable.");
  const expected = candidate.invoice;
  if (record.status !== 1 && record.status !== 2) throw new Error("Invoice is not available for funding.");
  if (record.supplier.toLowerCase() !== expected.supplier.toLowerCase()
    || record.payer.toLowerCase() !== expected.payer.toLowerCase()
    || record.faceValue !== expected.faceValue
    || record.dueDate !== expected.dueDate
    || record.documentHash.toLowerCase() !== expected.documentHash
    || record.invoiceDigest.toLowerCase() !== candidate.fundingAction.invoiceDigest.toLowerCase()) {
    throw new Error("Public candidate differs from the registered invoice.");
  }
  if (record.status === 2 && (record.funder.toLowerCase() !== expected.funder.toLowerCase()
    || record.advanceAmount !== expected.approvedAdvance
    || record.repaymentAmount !== expected.repaymentAmount)) {
    throw new Error("Funded invoice differs from the signed candidate.");
  }
  return true;
}
