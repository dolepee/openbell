export const OPENBELL_MAINNET = Object.freeze({
  network: "X Layer mainnet",
  chainId: "196",
  verifyingContract: "0xc4Ef249b80a6a034198C226278c51b0a903840dd",
  settlementToken: "0x4ae46a509F6b1D9056937BA4500cb143933D2dc8",
  settlementTokenSymbol: "USDG",
  settlementTokenDecimals: 6
});

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const zeroAddress = "0x0000000000000000000000000000000000000000";

export const createPreparationGuard = () => {
  let revision = 0;
  return Object.freeze({
    begin: () => ++revision,
    invalidate: () => ++revision,
    isCurrent: (candidateRevision) => candidateRevision === revision
  });
};

export const decimalToBaseUnits = (raw) => {
  const value = String(raw).trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) {
    throw new Error("Amounts must be positive numbers with at most six decimal places.");
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
};

export const baseUnitsToDecimal = (value) => {
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}.00`;
};

export const calculateDealEconomics = (faceValueInput, requestedAdvanceInput) => {
  const faceValue = decimalToBaseUnits(faceValueInput);
  const requestedAdvance = decimalToBaseUnits(requestedAdvanceInput);
  if (faceValue === 0n || requestedAdvance === 0n) {
    throw new Error("Face value and requested advance must be greater than zero.");
  }
  if (requestedAdvance > faceValue) throw new Error("Requested advance cannot exceed the invoice face value.");
  const immutableMaximumAdvance = faceValue * 8_000n / 10_000n;
  const preAiUpperBound = requestedAdvance < immutableMaximumAdvance ? requestedAdvance : immutableMaximumAdvance;
  return { faceValue, requestedAdvance, immutableMaximumAdvance, preAiUpperBound };
};

export const sha256 = async (bytes) => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `0x${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
};

export const buildUnsignedDealPackage = async ({
  supplier,
  payer,
  faceValue: faceValueInput,
  requestedAdvance: requestedAdvanceInput,
  dueDate: dueDateInput,
  nonce: nonceInput,
  documentHash: documentHashInput,
  createdAtMs = Date.now()
}) => {
  if (!addressPattern.test(supplier) || !addressPattern.test(payer)) throw new Error("Enter valid supplier and payer addresses.");
  if (supplier.toLowerCase() === zeroAddress || payer.toLowerCase() === zeroAddress) {
    throw new Error("Supplier and payer must be nonzero addresses.");
  }
  if (supplier.toLowerCase() === payer.toLowerCase()) throw new Error("Supplier and payer must be different addresses.");
  const economics = calculateDealEconomics(faceValueInput, requestedAdvanceInput);
  if (!/^\d+$/.test(String(nonceInput))) throw new Error("Supplier nonce must be a non-negative integer.");
  const nonce = BigInt(nonceInput);
  const documentHash = String(documentHashInput).toLowerCase();
  if (!hashPattern.test(documentHash)) throw new Error("Provide a valid 32-byte SHA-256 commitment.");

  const issuedAt = Math.floor(createdAtMs / 1000);
  const dueDate = Math.floor(new Date(`${dueDateInput}T23:59:59Z`).getTime() / 1000);
  if (!Number.isSafeInteger(dueDate) || dueDate <= issuedAt) throw new Error("Due date must be in the future.");
  if (dueDate - issuedAt > 90 * 24 * 60 * 60) throw new Error("Due date cannot exceed OpenBell's immutable 90-day tenor.");

  const terms = {
    invoiceId: "",
    documentHash,
    supplier,
    payer,
    faceValue: economics.faceValue.toString(),
    issuedAt: String(issuedAt),
    dueDate: String(dueDate),
    nonce: nonce.toString()
  };
  const identityPreimage = JSON.stringify({
    domain: "OPENBELL_RECEIVABLES_DEAL_V2",
    chainId: OPENBELL_MAINNET.chainId,
    verifyingContract: OPENBELL_MAINNET.verifyingContract.toLowerCase(),
    ...terms
  });
  terms.invoiceId = await sha256(new TextEncoder().encode(identityPreimage));

  return {
    schemaVersion: "openbell-receivables-deal-preparation-v1",
    createdAt: new Date(createdAtMs).toISOString(),
    boundary: "UNSIGNED PREPARATION ONLY — NOT UNDERWRITTEN — NOT A TRANSACTION",
    target: { ...OPENBELL_MAINNET },
    invoiceTerms: terms,
    underwritingRequest: {
      requestedAdvance: economics.requestedAdvance.toString(),
      immutableMaximumAdvanceBps: "8000",
      immutableMaximumAdvance: economics.immutableMaximumAdvance.toString(),
      preAiUpperBound: economics.preAiUpperBound.toString(),
      status: "AI_ASSESSMENT_REQUIRED"
    },
    disclosures: {
      documentBytesIncluded: false,
      documentUploaded: false,
      aiAssessmentIncluded: false,
      signaturesIncluded: false,
      privateKeysIncluded: false,
      calldataIncluded: false,
      transactionAuthorized: false,
      financingPromised: false
    }
  };
};

const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

export const validateUnsignedDealPackage = async (candidate) => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("Package must be a JSON object.");
  if (candidate.schemaVersion !== "openbell-receivables-deal-preparation-v1") throw new Error("Unsupported deal-package schema.");
  const createdAtMs = Date.parse(candidate.createdAt);
  if (!Number.isFinite(createdAtMs)) throw new Error("Package creation time is invalid.");
  const terms = candidate.invoiceTerms;
  const request = candidate.underwritingRequest;
  if (!terms || !request) throw new Error("Package terms are incomplete.");
  const dueDate = new Date(Number(terms.dueDate) * 1000).toISOString().slice(0, 10);
  const rebuilt = await buildUnsignedDealPackage({
    supplier: terms.supplier,
    payer: terms.payer,
    faceValue: baseUnitsToDecimal(BigInt(terms.faceValue)),
    requestedAdvance: baseUnitsToDecimal(BigInt(request.requestedAdvance)),
    dueDate,
    nonce: terms.nonce,
    documentHash: terms.documentHash,
    createdAtMs
  });
  if (stableJson(candidate) !== stableJson(rebuilt)) throw new Error("Package fields do not match the deterministic OpenBell preparation.");
  return rebuilt;
};
