import { encodeAbiParameters, keccak256, parseAbiParameters, stringToHex } from "viem";
import {
  boundedDecisionSchema,
  invoiceRiskInputSchema,
  modelDecisionSchema,
  underwritingPolicySchema,
  type BoundedDecision,
  type InvoiceRiskInput,
  type UnderwritingModel,
  type UnderwritingPolicy
} from "./schema.js";

const BPS = 10_000n;

export class UnderwritingRefusal extends Error {
  constructor(
    readonly code:
      | "INVALID_EVIDENCE"
      | "DUPLICATE_INVOICE"
      | "INVALID_TENOR"
      | "MODEL_REJECTED"
      | "LOW_CONFIDENCE",
    message: string
  ) {
    super(message);
    this.name = "UnderwritingRefusal";
  }
}

function hashReasons(reasons: readonly string[], explanation: string): `0x${string}` {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("string[] reasons, string explanation"), [
      [...reasons],
      explanation
    ])
  );
}

function hashModel(modelId: string): `0x${string}` {
  return keccak256(stringToHex(modelId));
}

function validateObjectiveEvidence(input: InvoiceRiskInput, policy: UnderwritingPolicy): void {
  if (
    !input.evidence.supplierSignatureValid ||
    !input.evidence.payerSignatureValid ||
    !input.evidence.documentHashMatches
  ) {
    throw new UnderwritingRefusal("INVALID_EVIDENCE", "Both signatures and the document hash must verify.");
  }
  if (input.evidence.duplicateInvoiceFound) {
    throw new UnderwritingRefusal("DUPLICATE_INVOICE", "The invoice already appears in the duplicate index.");
  }
  if (input.dueDate <= input.issuedAt || input.dueDate - input.issuedAt > policy.maxTenorSeconds) {
    throw new UnderwritingRefusal("INVALID_TENOR", "The invoice tenor is outside the protocol envelope.");
  }
}

export async function underwriteInvoice(args: {
  input: InvoiceRiskInput;
  model: UnderwritingModel;
  policy: UnderwritingPolicy;
  now: number;
}): Promise<BoundedDecision> {
  const input = invoiceRiskInputSchema.parse(args.input);
  const policy = underwritingPolicySchema.parse(args.policy);
  if (!Number.isInteger(args.now) || args.now < 0) throw new Error("now must be a non-negative integer");

  validateObjectiveEvidence(input, policy);

  const modelDecision = modelDecisionSchema.parse(await args.model.decide(input));
  const common = {
    invoiceId: input.invoiceId,
    invoiceDigest: input.invoiceDigest,
    riskTimestamp: args.now,
    expiresAt: Math.min(args.now + policy.maxDecisionLifetimeSeconds, input.dueDate),
    riskReasonsHash: hashReasons(modelDecision.reasons, modelDecision.explanation),
    modelHash: hashModel(args.model.modelId),
    reasons: modelDecision.reasons,
    explanation: modelDecision.explanation,
    modelId: args.model.modelId
  } as const;

  if (modelDecision.verdict === "REJECT") {
    return boundedDecisionSchema.parse({ verdict: "REJECT", ...common });
  }
  if (modelDecision.confidenceBps < policy.minConfidenceBps) {
    throw new UnderwritingRefusal("LOW_CONFIDENCE", "The model confidence is below the policy floor.");
  }

  const faceValue = BigInt(input.faceValue);
  const requestedAdvance = BigInt(input.requestedAdvance);
  const boundedAdvanceBps = BigInt(Math.min(modelDecision.maximumAdvanceBps, policy.maxAdvanceBps));
  const maximumAdvance = (faceValue * boundedAdvanceBps) / BPS;
  const advanceAmount = requestedAdvance < maximumAdvance ? requestedAdvance : maximumAdvance;
  if (advanceAmount === 0n) {
    throw new UnderwritingRefusal("MODEL_REJECTED", "The bounded advance is zero.");
  }

  const boundedFeeBps = BigInt(Math.min(modelDecision.feeBps, policy.maxFeeBps));
  const repaymentAmount = advanceAmount + (advanceAmount * boundedFeeBps) / BPS;
  if (repaymentAmount > faceValue) {
    throw new UnderwritingRefusal("MODEL_REJECTED", "The repayment would exceed the invoice face value.");
  }

  return boundedDecisionSchema.parse({
    verdict: "APPROVE",
    ...common,
    funder: input.funder,
    advanceAmount: advanceAmount.toString(),
    repaymentAmount: repaymentAmount.toString()
  });
}
