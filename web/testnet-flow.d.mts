export function buildBrowserBankrRequestHash(
  input: import("../agent/src/schema.js").InvoiceRiskInput,
  boundary: "synthetic" | "registered-mainnet"
): `0x${string}`;
export function validateConnectedAssessment<T>(candidate: T, expectedRequest: unknown): T;
export function validateConnectedPolicyRefusal<T>(candidate: T, expectedRequest: unknown, expectedArtifactHash: unknown): T;
export function buildHumanEscalation(input: {
  assessment: unknown;
  session: unknown;
  assessedRequestedAdvance: string;
  funder: `0x${string}`;
  advanceAmount: string;
  riskTimestamp: string | number | bigint;
}): Promise<unknown>;
export function humanEscalationTypedData(escalation: unknown): unknown;
export function finalizeHumanEscalation(escalation: unknown, underwriterSignature: `0x${string}`): Promise<unknown[]>;
