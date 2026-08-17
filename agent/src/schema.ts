import { z } from "zod";

const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const bytes32 = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const uintString = z.string().regex(/^(0|[1-9][0-9]*)$/);

export const invoiceRiskInputSchema = z.object({
  invoiceId: bytes32,
  invoiceDigest: bytes32,
  supplier: address,
  payer: address,
  funder: address,
  faceValue: uintString,
  issuedAt: z.number().int().nonnegative(),
  dueDate: z.number().int().positive(),
  requestedAdvance: uintString,
  evidence: z.object({
    supplierSignatureValid: z.boolean(),
    payerSignatureValid: z.boolean(),
    duplicateInvoiceFound: z.boolean(),
    documentHashMatches: z.boolean()
  }),
  payerHistory: z.object({
    completedSettlements: z.number().int().nonnegative(),
    onTimeSettlements: z.number().int().nonnegative(),
    lateSettlements: z.number().int().nonnegative(),
    defaults: z.number().int().nonnegative(),
    concentrationBps: z.number().int().min(0).max(10_000),
    daysSinceLastSettlement: z.number().int().nonnegative()
  }),
  receiptBoundHistory: z.object({
    schemaVersion: z.literal("openbell-receipt-bound-history-v1"),
    chainId: z.literal(196),
    receivables: address,
    payer: address,
    fromBlock: uintString,
    throughBlock: uintString,
    throughBlockHash: bytes32,
    completedSettlements: z.number().int().nonnegative(),
    onTimeSettlements: z.number().int().nonnegative(),
    lateSettlements: z.number().int().nonnegative(),
    activeFunded: z.number().int().nonnegative(),
    overdueFunded: z.number().int().nonnegative(),
    counterpartyConcentrationBps: z.number().int().min(0).max(10_000),
    daysSinceLastSettlement: z.number().int().nonnegative(),
    invoiceIds: z.array(bytes32),
    historyCommitment: bytes32
  }).strict().optional(),
  redactedContext: z.string().trim().min(1).max(2_000)
});

export type InvoiceRiskInput = z.infer<typeof invoiceRiskInputSchema>;

export const riskReasonSchema = z.enum([
  "DUAL_SIGNATURES_VERIFIED",
  "DOCUMENT_HASH_VERIFIED",
  "CLEAN_DUPLICATE_CHECK",
  "LIMITED_PAYER_HISTORY",
  "STRONG_ON_TIME_HISTORY",
  "LATE_PAYMENT_HISTORY",
  "PRIOR_DEFAULT",
  "HIGH_COUNTERPARTY_CONCENTRATION",
  "LONG_TENOR",
  "STALE_SETTLEMENT_HISTORY",
  "INCONSISTENT_EVIDENCE",
  "MODEL_UNCERTAINTY"
]);

export const modelDecisionSchema = z.object({
  verdict: z.enum(["APPROVE", "REJECT"]),
  maximumAdvanceBps: z.number().int().min(0).max(10_000),
  feeBps: z.number().int().min(0).max(10_000),
  confidenceBps: z.number().int().min(0).max(10_000),
  reasons: z.array(riskReasonSchema).min(1).max(8),
  explanation: z.string().trim().min(1).max(600)
});

export type ModelDecision = z.infer<typeof modelDecisionSchema>;

export interface UnderwritingModel {
  readonly modelId: string;
  decide(input: InvoiceRiskInput): Promise<unknown>;
}

export const underwritingPolicySchema = z.object({
  maxAdvanceBps: z.number().int().min(1).max(10_000),
  maxFeeBps: z.number().int().min(0).max(10_000),
  maxRiskAgeSeconds: z.number().int().positive(),
  maxDecisionLifetimeSeconds: z.number().int().positive(),
  minConfidenceBps: z.number().int().min(0).max(10_000),
  maxTenorSeconds: z.number().int().positive()
});

export type UnderwritingPolicy = z.infer<typeof underwritingPolicySchema>;

export const boundedDecisionSchema = z.discriminatedUnion("verdict", [
  z.object({
    verdict: z.literal("APPROVE"),
    invoiceId: bytes32,
    invoiceDigest: bytes32,
    funder: address,
    advanceAmount: uintString,
    repaymentAmount: uintString,
    riskTimestamp: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    riskReasonsHash: bytes32,
    modelHash: bytes32,
    reasons: z.array(riskReasonSchema),
    explanation: z.string(),
    modelId: z.string()
  }),
  z.object({
    verdict: z.literal("REJECT"),
    invoiceId: bytes32,
    invoiceDigest: bytes32,
    riskTimestamp: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    riskReasonsHash: bytes32,
    modelHash: bytes32,
    reasons: z.array(riskReasonSchema),
    explanation: z.string(),
    modelId: z.string()
  })
]);

export type BoundedDecision = z.infer<typeof boundedDecisionSchema>;
