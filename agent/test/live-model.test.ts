import { describe, expect, it, vi } from "vitest";
import {
  BANKR_APPROVAL_EXPLANATION,
  BANKR_CHAT_COMPLETIONS_URL,
  BANKR_MAINNET_APPROVAL_EXPLANATION,
  BANKR_MAX_OUTPUT_TOKENS,
  BANKR_MAX_RESPONSE_BYTES,
  BANKR_REASONING_EFFORT,
  BANKR_TIMEOUT_MS,
  BANKR_UNDERWRITING_MODEL,
  StrictBankrUnderwritingModel,
  buildStrictBankrRequest
} from "../src/live-model.js";
import type { InvoiceRiskInput } from "../src/schema.js";

const input: InvoiceRiskInput = {
  invoiceId: `0x${"11".repeat(32)}`,
  invoiceDigest: `0x${"22".repeat(32)}`,
  supplier: `0x${"33".repeat(20)}`,
  payer: `0x${"44".repeat(20)}`,
  funder: `0x${"55".repeat(20)}`,
  faceValue: "100000000",
  issuedAt: 2_000_000_000,
  dueDate: 2_002_592_000,
  requestedAdvance: "75000000",
  evidence: { supplierSignatureValid: true, payerSignatureValid: true, duplicateInvoiceFound: false, documentHashMatches: true },
  payerHistory: { completedSettlements: 8, onTimeSettlements: 8, lateSettlements: 0, defaults: 0, concentrationBps: 2_500, daysSinceLastSettlement: 12 },
  redactedContext: "Synthetic X Layer testnet fixture; no real value."
};

const decision = {
  verdict: "APPROVE",
  maximumAdvanceBps: 8500,
  feeBps: 100,
  confidenceBps: 9700,
  reasons: ["DUAL_SIGNATURES_VERIFIED", "CLEAN_DUPLICATE_CHECK"],
  explanation: BANKR_APPROVAL_EXPLANATION
};

const message = (content: unknown = JSON.stringify(decision)) => ({ role: "assistant", content, refusal: null, annotations: [] });
const envelope = (overrides: Record<string, unknown> = {}) => ({
  id: "chatcmpl_fixture_1",
  object: "chat.completion",
  created: 2_000_000_001,
  model: BANKR_UNDERWRITING_MODEL,
  choices: [{ index: 0, finish_reason: "stop", message: message() }],
  ...overrides
});
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const modelWith = (fetchImpl: typeof fetch) => new StrictBankrUnderwritingModel({ apiKey: "test-only", fetch: fetchImpl });

describe("StrictBankrUnderwritingModel", () => {
  it("builds the exact pinned, bounded, non-stored request offline", () => {
    const request = buildStrictBankrRequest(input);
    const body = JSON.parse(request.body);
    expect(body).toMatchObject({
      model: "gpt-5.6-terra",
      reasoning_effort: "low",
      max_tokens: 1200,
      store: false,
      response_format: { type: "json_schema", json_schema: { strict: true } }
    });
    expect(body.messages).toHaveLength(2);
    expect(request.byteLength).toBe(Buffer.byteLength(request.body));
    expect(request.conservativeMaxInputTokens).toBe(request.byteLength);
    expect(request.requestHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(BANKR_REASONING_EFFORT).toBe("low");
    expect(BANKR_MAX_OUTPUT_TOKENS).toBe(1200);
  });

  it("uses a truthful registered-mainnet boundary without changing the historical testnet request", async () => {
    const request = buildStrictBankrRequest(input, "registered-mainnet");
    const body = JSON.parse(request.body);
    expect(body.messages[0].content).toContain("registered mainnet invoice evidence");
    expect(body.messages[0].content).not.toContain("synthetic");
    expect(body.response_format.json_schema.schema.properties.explanation.enum).toContain(BANKR_MAINNET_APPROVAL_EXPLANATION);

    const mainnetDecision = { ...decision, explanation: BANKR_MAINNET_APPROVAL_EXPLANATION };
    const model = new StrictBankrUnderwritingModel({
      apiKey: "test-only",
      evidenceBoundary: "registered-mainnet",
      fetch: (async () => jsonResponse(envelope({ choices: [{ index: 0, finish_reason: "stop", message: message(JSON.stringify(mainnetDecision)) }] }))) as typeof fetch
    });
    await expect(model.decide(input)).resolves.toEqual(mainnetDecision);
  });

  it("refuses missing credentials without making a request", () => {
    expect(() => new StrictBankrUnderwritingModel({ apiKey: "" })).toThrow("BANKR_API_KEY_REQUIRED");
  });

  it("accepts exactly one completed assistant JSON message", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(url).toBe(BANKR_CHAT_COMPLETIONS_URL);
      expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("test-only");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: BANKR_UNDERWRITING_MODEL,
        reasoning_effort: "low",
        max_tokens: 1200,
        store: false
      });
      return jsonResponse(envelope());
    });
    const model = modelWith(fetchMock as typeof fetch);
    await expect(model.decide(input)).resolves.toEqual(decision);
    expect(model.lastReceipt).toMatchObject({
      provider: "bankr-chat-completions",
      providerResponseId: "chatcmpl_fixture_1",
      requestedModel: BANKR_UNDERWRITING_MODEL,
      returnedModel: BANKR_UNDERWRITING_MODEL
    });
  });

  it.each([
    [{ ...decision, maximumAdvanceBps: 10_001 }],
    [{ ...decision, unexpected: true }],
    [{ ...decision, reasons: [] }]
  ])("rejects malformed decision output %#", async (badDecision) => {
    const badEnvelope = envelope({ choices: [{ index: 0, finish_reason: "stop", message: message(JSON.stringify(badDecision)) }] });
    await expect(modelWith((async () => jsonResponse(badEnvelope)) as typeof fetch).decide(input)).rejects.toThrow();
  });

  it("rejects a free-form explanation even when structured reasons are allowed", async () => {
    const badEnvelope = envelope({ choices: [{ index: 0, finish_reason: "stop", message: message(JSON.stringify({ ...decision, explanation: "The payer has prior defaults." })) }] });
    await expect(modelWith((async () => jsonResponse(badEnvelope)) as typeof fetch).decide(input)).rejects.toThrow("LIVE_MODEL_EXPLANATION_VERDICT_MISMATCH");
  });

  it("times out after exactly thirty seconds", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = ((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      })) as typeof fetch;
      const expectation = expect(modelWith(fetchMock).decide(input)).rejects.toThrow("LIVE_MODEL_TIMEOUT");
      await vi.advanceTimersByTimeAsync(BANKR_TIMEOUT_MS);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a response larger than 64 KiB", async () => {
    const oversized = "x".repeat(BANKR_MAX_RESPONSE_BYTES + 1);
    await expect(modelWith((async () => new Response(oversized)) as typeof fetch).decide(input)).rejects.toThrow("LIVE_MODEL_RESPONSE_TOO_LARGE");
  });

  it("rejects refusals", async () => {
    const refused = envelope({ choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "", refusal: "Cannot comply." } }] });
    await expect(modelWith((async () => jsonResponse(refused)) as typeof fetch).decide(input)).rejects.toThrow();
  });

  it.each([
    [{ type: "url_citation", url: "https://example.invalid" }],
    [null],
    "not-an-array",
    null
  ])("rejects non-empty or malformed annotations %#", async (annotations) => {
    const annotated = envelope({
      choices: [{ index: 0, finish_reason: "stop", message: { ...message(), annotations } }]
    });
    await expect(modelWith((async () => jsonResponse(annotated)) as typeof fetch).decide(input)).rejects.toThrow();
  });

  it("rejects multiple messages", async () => {
    const multiple = envelope({ choices: [
      { index: 0, finish_reason: "stop", message: message() },
      { index: 1, finish_reason: "stop", message: message() }
    ] });
    await expect(modelWith((async () => jsonResponse(multiple)) as typeof fetch).decide(input)).rejects.toThrow();
  });

  it.each([
    { ...message(), tool_calls: [{ id: "call_1", type: "function", function: { name: "retry", arguments: "{}" } }] },
    { ...message(), function_call: { name: "retry", arguments: "{}" } }
  ])("rejects tool and function messages %#", async (badMessage) => {
    const bad = envelope({ choices: [{ index: 0, finish_reason: "stop", message: badMessage }] });
    await expect(modelWith((async () => jsonResponse(bad)) as typeof fetch).decide(input)).rejects.toThrow();
  });

  it("rejects a returned-model mismatch", async () => {
    await expect(modelWith((async () => jsonResponse(envelope({ model: "gpt-5.6-luna" }))) as typeof fetch).decide(input)).rejects.toThrow("LIVE_MODEL_RETURNED_MODEL_MISMATCH");
  });

  it("rejects non-stop, failed, and malformed responses", async () => {
    const incomplete = envelope({ choices: [{ index: 0, finish_reason: "length", message: message() }] });
    await expect(modelWith((async () => jsonResponse(incomplete)) as typeof fetch).decide(input)).rejects.toThrow();
    await expect(modelWith((async () => jsonResponse({ error: "rate" }, 429)) as typeof fetch).decide(input)).rejects.toThrow("LIVE_MODEL_HTTP_429");
    await expect(modelWith((async () => new Response("{not-json")) as typeof fetch).decide(input)).rejects.toThrow();
  });

  it("makes at most one authoritative attempt per instance", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(envelope()));
    const model = modelWith(fetchMock as typeof fetch);
    await model.decide(input);
    await expect(model.decide(input)).rejects.toThrow("LIVE_MODEL_SINGLE_ATTEMPT_ONLY");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
