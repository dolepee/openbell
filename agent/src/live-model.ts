import { keccak256, stringToHex } from "viem";
import { z } from "zod";
import {
  invoiceRiskInputSchema,
  modelDecisionSchema,
  type InvoiceRiskInput,
  type ModelDecision,
  type UnderwritingModel
} from "./schema.js";

export const BANKR_UNDERWRITING_MODEL = "gpt-5.6-terra" as const;
export const BANKR_REASONING_EFFORT = "low" as const;
export const BANKR_MAX_OUTPUT_TOKENS = 1_200 as const;
export const BANKR_TIMEOUT_MS = 30_000 as const;
export const BANKR_MAX_RESPONSE_BYTES = 64 * 1_024;
export const BANKR_CHAT_COMPLETIONS_URL = "https://llm.bankr.bot/v1/chat/completions" as const;
export const BANKR_APPROVAL_EXPLANATION = "The supplied synthetic evidence supports approval within the returned structured limits." as const;
export const BANKR_REJECTION_EXPLANATION = "The supplied synthetic evidence does not support approval." as const;
export const BANKR_MAINNET_APPROVAL_EXPLANATION = "The supplied registered mainnet evidence supports approval within the returned structured limits." as const;
export const BANKR_MAINNET_REJECTION_EXPLANATION = "The supplied registered mainnet evidence does not support approval." as const;
export type BankrEvidenceBoundary = "synthetic" | "registered-mainnet";
export const BANKR_MAINNET_POLICY_PROMPT = "An APPROVE verdict requires confidenceBps of at least 7000. If the evidence does not justify that confidence, return REJECT instead of a lower-confidence APPROVE. The deterministic envelope caps maximumAdvanceBps at 8000 and feeBps at 2000." as const;
const BANKR_INPUT_USD_PER_MILLION = 2;
const BANKR_OUTPUT_USD_PER_MILLION = 12;

const explanationFor = (boundary: BankrEvidenceBoundary, verdict: "APPROVE" | "REJECT") => {
  if (boundary === "registered-mainnet") {
    return verdict === "APPROVE" ? BANKR_MAINNET_APPROVAL_EXPLANATION : BANKR_MAINNET_REJECTION_EXPLANATION;
  }
  return verdict === "APPROVE" ? BANKR_APPROVAL_EXPLANATION : BANKR_REJECTION_EXPLANATION;
};

const schemaFor = (boundary: BankrEvidenceBoundary) => ({
  type: "object",
  additionalProperties: false,
  required: ["verdict", "maximumAdvanceBps", "feeBps", "confidenceBps", "reasons", "explanation"],
  properties: {
    verdict: { type: "string", enum: ["APPROVE", "REJECT"] },
    maximumAdvanceBps: { type: "integer", minimum: 0, maximum: 10_000 },
    feeBps: { type: "integer", minimum: 0, maximum: 10_000 },
    confidenceBps: { type: "integer", minimum: 0, maximum: 10_000 },
    reasons: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "string",
        enum: [
          "DUAL_SIGNATURES_VERIFIED", "DOCUMENT_HASH_VERIFIED", "CLEAN_DUPLICATE_CHECK",
          "LIMITED_PAYER_HISTORY", "STRONG_ON_TIME_HISTORY", "LATE_PAYMENT_HISTORY",
          "PRIOR_DEFAULT", "HIGH_COUNTERPARTY_CONCENTRATION", "LONG_TENOR",
          "STALE_SETTLEMENT_HISTORY", "INCONSISTENT_EVIDENCE", "MODEL_UNCERTAINTY"
        ]
      }
    },
    explanation: { type: "string", enum: [explanationFor(boundary, "APPROVE"), explanationFor(boundary, "REJECT")] }
  }
} as const);

export const decisionJsonSchema = schemaFor("synthetic");

const assistantMessageSchema = z.object({
  role: z.literal("assistant"),
  content: z.string().min(1),
  refusal: z.null().optional(),
  annotations: z.tuple([]).optional()
}).strict();

const chatCompletionEnvelopeSchema = z.object({
  id: z.string().min(1),
  object: z.literal("chat.completion"),
  model: z.string().min(1),
  choices: z.array(z.object({
    index: z.literal(0),
    finish_reason: z.literal("stop"),
    message: assistantMessageSchema
  }).strict()).length(1)
}).passthrough();

export interface OfflineBankrRequest {
  readonly body: string;
  readonly requestHash: `0x${string}`;
  readonly byteLength: number;
  readonly conservativeMaxInputTokens: number;
  readonly maxOutputTokens: typeof BANKR_MAX_OUTPUT_TOKENS;
  readonly conservativeMaximumCostUsd: string;
}

export function buildStrictBankrRequest(input: InvoiceRiskInput, boundary: BankrEvidenceBoundary = "synthetic"): OfflineBankrRequest {
  const canonicalInput = invoiceRiskInputSchema.strict().parse(input);
  const evidenceDescription = boundary === "registered-mainnet" ? "registered mainnet invoice evidence" : "synthetic invoice evidence";
  const policyInstruction = boundary === "registered-mainnet" ? ` ${BANKR_MAINNET_POLICY_PROMPT}` : "";
  const body = JSON.stringify({
    model: BANKR_UNDERWRITING_MODEL,
    messages: [
      {
        role: "system",
        content: `Assess only the supplied ${evidenceDescription}.${policyInstruction} Return exactly one JSON object matching the response schema. Never invent evidence.`
      },
      { role: "user", content: JSON.stringify(canonicalInput) }
    ],
    reasoning_effort: BANKR_REASONING_EFFORT,
    max_tokens: BANKR_MAX_OUTPUT_TOKENS,
    store: false,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "openbell_underwriting_decision",
        strict: true,
        schema: schemaFor(boundary)
      }
    }
  });
  const byteLength = Buffer.byteLength(body, "utf8");
  // One token per UTF-8 byte is a deliberately conservative ceiling for offline approval.
  const conservativeMaxInputTokens = byteLength;
  const maximumCost =
    (conservativeMaxInputTokens * BANKR_INPUT_USD_PER_MILLION
      + BANKR_MAX_OUTPUT_TOKENS * BANKR_OUTPUT_USD_PER_MILLION) / 1_000_000;
  return {
    body,
    requestHash: keccak256(stringToHex(body)),
    byteLength,
    conservativeMaxInputTokens,
    maxOutputTokens: BANKR_MAX_OUTPUT_TOKENS,
    conservativeMaximumCostUsd: maximumCost.toFixed(8)
  };
}

async function readBoundedResponse(response: Response): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > BANKR_MAX_RESPONSE_BYTES) {
    throw new Error("LIVE_MODEL_RESPONSE_TOO_LARGE");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > BANKR_MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("LIVE_MODEL_RESPONSE_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export interface LiveModelReceipt {
  readonly provider: "bankr-chat-completions";
  readonly providerResponseId: string;
  readonly requestedModel: typeof BANKR_UNDERWRITING_MODEL;
  readonly returnedModel: typeof BANKR_UNDERWRITING_MODEL;
  readonly requestHash: `0x${string}`;
  readonly responseHash: `0x${string}`;
  readonly rawResponse: string;
  readonly decision: ModelDecision;
}

export class StrictBankrUnderwritingModel implements UnderwritingModel {
  readonly modelId = `bankr:${BANKR_UNDERWRITING_MODEL}`;
  #attempted = false;
  #lastReceipt: LiveModelReceipt | undefined;

  constructor(readonly options: { apiKey: string; fetch?: typeof fetch; evidenceBoundary?: BankrEvidenceBoundary }) {
    if (!options.apiKey.trim()) throw new Error("BANKR_API_KEY_REQUIRED");
  }

  get lastReceipt(): LiveModelReceipt | undefined {
    return this.#lastReceipt;
  }

  async decide(input: InvoiceRiskInput): Promise<ModelDecision> {
    if (this.#attempted) throw new Error("LIVE_MODEL_SINGLE_ATTEMPT_ONLY");
    this.#attempted = true;
    const boundary = this.options.evidenceBoundary ?? "synthetic";
    const request = buildStrictBankrRequest(input, boundary);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, BANKR_TIMEOUT_MS);
    try {
      const response = await (this.options.fetch ?? fetch)(BANKR_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: { "x-api-key": this.options.apiKey, "content-type": "application/json" },
        body: request.body,
        signal: controller.signal
      });
      const raw = await readBoundedResponse(response);
      if (!response.ok) throw new Error(`LIVE_MODEL_HTTP_${response.status}`);
      const envelope = chatCompletionEnvelopeSchema.parse(JSON.parse(raw));
      if (envelope.model !== BANKR_UNDERWRITING_MODEL) throw new Error("LIVE_MODEL_RETURNED_MODEL_MISMATCH");
      const decision = modelDecisionSchema.strict().parse(JSON.parse(envelope.choices[0]!.message.content));
      const expectedExplanation = explanationFor(boundary, decision.verdict);
      if (decision.explanation !== expectedExplanation) throw new Error("LIVE_MODEL_EXPLANATION_VERDICT_MISMATCH");
      this.#lastReceipt = {
        provider: "bankr-chat-completions",
        providerResponseId: envelope.id,
        requestedModel: BANKR_UNDERWRITING_MODEL,
        returnedModel: BANKR_UNDERWRITING_MODEL,
        requestHash: request.requestHash,
        responseHash: keccak256(stringToHex(raw)),
        rawResponse: raw,
        decision
      };
      return decision;
    } catch (error) {
      if (timedOut || controller.signal.aborted) throw new Error("LIVE_MODEL_TIMEOUT");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
