import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { keccak256, stringToHex } from "viem";
import { modelDecisionSchema } from "../src/schema.js";

const evidencePath = new URL("../../evidence/openbell-bankr-model-evidence.json", import.meta.url);

describe("genuine Bankr model evidence", () => {
  it("binds both genuine first responses and the honest 75 / 75.75 economics", async () => {
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    expect(evidence.schemaVersion).toBe("openbell-bankr-genuine-model-evidence-v1");
    expect(evidence.label).toBe("XLAYER TESTNET FIXTURE — NO REAL VALUE");
    expect(evidence.provider).toBe("Bankr-mediated GPT-5.6 Terra");
    expect(evidence.attemptPolicy).toEqual({
      firstResponseAuthoritative: true,
      retries: "0",
      additionalModelCallsPermitted: false
    });

    const [rejected, approved] = evidence.requests;
    expect(modelDecisionSchema.strict().parse(rejected.decision).verdict).toBe("REJECT");
    const approvedDecision = modelDecisionSchema.strict().parse(approved.decision);
    expect(approvedDecision).toMatchObject({
      verdict: "APPROVE",
      maximumAdvanceBps: 8500,
      feeBps: 100,
      confidenceBps: 9700
    });

    for (const request of evidence.requests) {
      expect(keccak256(stringToHex(request.requestBody))).toBe(request.requestKeccak256);
      expect(`0x${createHash("sha256").update(request.requestBody).digest("hex")}`).toBe(request.requestSha256);
      expect(keccak256(stringToHex(request.rawResponse))).toBe(request.responseKeccak256);
      expect(`0x${createHash("sha256").update(`${request.rawResponse}\n`).digest("hex")}`).toBe(
        request.responseSha256
      );
      const envelope = JSON.parse(request.rawResponse);
      expect(envelope.id).toBe(request.providerResponseId);
      expect(JSON.parse(envelope.choices[0].message.content)).toEqual(request.decision);
    }

    const face = BigInt(evidence.economics.faceValue);
    const requested = BigInt(evidence.economics.requestedAdvance);
    const modelCeiling = (face * BigInt(evidence.economics.modelMaximumAdvanceBps)) / 10_000n;
    const contractCeiling = (face * BigInt(evidence.economics.contractMaximumAdvanceBps)) / 10_000n;
    const effective = [requested, modelCeiling, contractCeiling].reduce((minimum, value) =>
      value < minimum ? value : minimum
    );
    const repayment = effective + (effective * BigInt(evidence.economics.modelFeeBps)) / 10_000n;
    expect(modelCeiling).toBe(85_000_000n);
    expect(contractCeiling).toBe(80_000_000n);
    expect(effective.toString()).toBe(evidence.economics.effectiveAdvance);
    expect(repayment.toString()).toBe(evidence.economics.repayment);
    expect(evidence.olderRecordedFixture).toMatchObject({
      label: "OLDER RECORDED LOCAL FIXTURE — NO LIVE MODEL",
      fundedAdvance: "70000000",
      repayment: "73500000",
      authoritativeForLiveModelClaim: false
    });
  });
});
