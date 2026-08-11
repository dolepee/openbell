import { describe, expect, it } from "vitest";
import { UnderwritingRefusal, underwriteInvoice } from "../src/underwriter.js";
import type { InvoiceRiskInput, ModelDecision, UnderwritingModel, UnderwritingPolicy } from "../src/schema.js";

const NOW = 1_786_359_600;
const policy: UnderwritingPolicy = {
  maxAdvanceBps: 8_000,
  maxFeeBps: 2_000,
  maxRiskAgeSeconds: 3_600,
  maxDecisionLifetimeSeconds: 900,
  minConfidenceBps: 7_000,
  maxTenorSeconds: 90 * 24 * 60 * 60
};

const input: InvoiceRiskInput = {
  invoiceId: `0x${"11".repeat(32)}`,
  invoiceDigest: `0x${"22".repeat(32)}`,
  supplier: `0x${"33".repeat(20)}`,
  payer: `0x${"44".repeat(20)}`,
  funder: `0x${"55".repeat(20)}`,
  faceValue: "100000000",
  issuedAt: NOW - 60,
  dueDate: NOW + 30 * 24 * 60 * 60,
  requestedAdvance: "75000000",
  evidence: {
    supplierSignatureValid: true,
    payerSignatureValid: true,
    duplicateInvoiceFound: false,
    documentHashMatches: true
  },
  payerHistory: {
    completedSettlements: 12,
    onTimeSettlements: 11,
    lateSettlements: 1,
    defaults: 0,
    concentrationBps: 2_000,
    daysSinceLastSettlement: 8
  },
  redactedContext: "Verified software delivery invoice with net-30 payment terms."
};

class ScriptedModel implements UnderwritingModel {
  readonly modelId = "openbell-test-model:2026-08-10";

  constructor(private readonly response: ModelDecision) {}

  async decide(): Promise<ModelDecision> {
    return this.response;
  }
}

const approval: ModelDecision = {
  verdict: "APPROVE",
  maximumAdvanceBps: 7_000,
  feeBps: 500,
  confidenceBps: 8_800,
  reasons: ["DUAL_SIGNATURES_VERIFIED", "CLEAN_DUPLICATE_CHECK", "STRONG_ON_TIME_HISTORY"],
  explanation: "The payer has a strong settlement history with one non-default late payment."
};

describe("underwriteInvoice", () => {
  it("bounds an AI approval below both the request and hard policy ceiling", async () => {
    const result = await underwriteInvoice({ input, model: new ScriptedModel(approval), policy, now: NOW });

    expect(result.verdict).toBe("APPROVE");
    if (result.verdict !== "APPROVE") throw new Error("expected approval");
    expect(result.advanceAmount).toBe("70000000");
    expect(result.repaymentAmount).toBe("73500000");
    expect(result.riskReasonsHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("allows the AI to tighten terms under changed payer conditions", async () => {
    const stricter: ModelDecision = {
      ...approval,
      maximumAdvanceBps: 4_000,
      feeBps: 900,
      reasons: ["LATE_PAYMENT_HISTORY", "HIGH_COUNTERPARTY_CONCENTRATION"],
      explanation: "Late settlements and concentration require a smaller advance."
    };
    const result = await underwriteInvoice({ input, model: new ScriptedModel(stricter), policy, now: NOW });

    expect(result.verdict).toBe("APPROVE");
    if (result.verdict !== "APPROVE") throw new Error("expected approval");
    expect(result.advanceAmount).toBe("40000000");
    expect(result.repaymentAmount).toBe("43600000");
  });

  it("commits the exact recorded model response rather than only its model ID", async () => {
    const first = await underwriteInvoice({ input, model: new ScriptedModel(approval), policy, now: NOW });
    const second = await underwriteInvoice({
      input,
      model: new ScriptedModel({
        ...approval,
        explanation: "The same model ID returned materially different recorded reasoning."
      }),
      policy,
      now: NOW
    });

    expect(first.modelId).toBe(second.modelId);
    expect(first.modelHash).not.toBe(second.modelHash);
  });

  it("preserves a structured model rejection", async () => {
    const rejection: ModelDecision = {
      verdict: "REJECT",
      maximumAdvanceBps: 0,
      feeBps: 0,
      confidenceBps: 9_100,
      reasons: ["PRIOR_DEFAULT"],
      explanation: "A prior default is outside the current underwriting appetite."
    };
    const result = await underwriteInvoice({ input, model: new ScriptedModel(rejection), policy, now: NOW });
    expect(result.verdict).toBe("REJECT");
  });

  it("rejects invalid evidence before invoking the model", async () => {
    let calls = 0;
    const model: UnderwritingModel = {
      modelId: "must-not-run",
      async decide() {
        calls += 1;
        return approval;
      }
    };
    await expect(
      underwriteInvoice({
        input: { ...input, evidence: { ...input.evidence, payerSignatureValid: false } },
        model,
        policy,
        now: NOW
      })
    ).rejects.toMatchObject({ code: "INVALID_EVIDENCE" } satisfies Partial<UnderwritingRefusal>);
    expect(calls).toBe(0);
  });

  it("rejects duplicate evidence before invoking the model", async () => {
    await expect(
      underwriteInvoice({
        input: { ...input, evidence: { ...input.evidence, duplicateInvoiceFound: true } },
        model: new ScriptedModel(approval),
        policy,
        now: NOW
      })
    ).rejects.toMatchObject({ code: "DUPLICATE_INVOICE" });
  });

  it("rejects a low-confidence approval", async () => {
    await expect(
      underwriteInvoice({
        input,
        model: new ScriptedModel({ ...approval, confidenceBps: 6_999 }),
        policy,
        now: NOW
      })
    ).rejects.toMatchObject({ code: "LOW_CONFIDENCE" });
  });

  it("never lets model fee or advance terms exceed hard policy caps", async () => {
    const permissiveModel: ModelDecision = {
      ...approval,
      maximumAdvanceBps: 9_900,
      feeBps: 9_900
    };
    const result = await underwriteInvoice({
      input: { ...input, requestedAdvance: "99000000" },
      model: new ScriptedModel(permissiveModel),
      policy,
      now: NOW
    });

    expect(result.verdict).toBe("APPROVE");
    if (result.verdict !== "APPROVE") throw new Error("expected approval");
    expect(result.advanceAmount).toBe("80000000");
    expect(result.repaymentAmount).toBe("96000000");
  });
});
