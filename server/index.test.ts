import { encodeAbiParameters, parseAbiParameters } from "viem";
import { afterEach, expect, test, vi } from "vitest";
import { connectedRequestHashOf, mainnetUnderwritingRequestSchema } from "../agent/src/connected-underwriting.js";
import worker from "./index.js";

const environment = {
  ASSETS: { fetch: async () => new Response("asset") },
  DB: { prepare: () => { throw new Error("DB_MUST_NOT_BE_TOUCHED"); } }
} as never;
const api = "https://openbell.dolepee.com/api/connected-underwriting";
const jsonRpcResponse = (result: string) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
  headers: { "content-type": "application/json" }
});
const invoiceState = (status: number) => encodeAbiParameters(
  parseAbiParameters("uint8, address, address, address, uint128, uint128, uint128, uint64, bytes32, bytes32, bytes32"),
  [status, `0x${"11".repeat(20)}`, `0x${"22".repeat(20)}`, `0x${"33".repeat(20)}`, 100_000n, 0n, 0n, 1_800_000_000n, `0x${"44".repeat(32)}`, `0x${"55".repeat(32)}`, `0x${"00".repeat(32)}`]
);

afterEach(() => vi.unstubAllGlobals());

test("connected endpoint rejects non-POST requests before dependencies", async () => {
  const response = await worker.fetch(new Request(api), environment);
  expect(response.status).toBe(405);
  expect(await response.json()).toEqual({ error: "METHOD_NOT_ALLOWED" });
});

test("connected endpoint requires a same-origin browser request", async () => {
  const response = await worker.fetch(new Request(api, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
    body: "{}"
  }), environment);
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "SAME_ORIGIN_REQUIRED" });
});

test("connected endpoint rejects malformed payloads without model, RPC, signer or DB access", async () => {
  const response = await worker.fetch(new Request(api, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://openbell.dolepee.com", "sec-fetch-site": "same-origin" },
    body: "{}"
  }), environment);
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ error: "CONNECTED_UNDERWRITING_FAILED" });
});

test("site fallback remains delegated to the static asset binding", async () => {
  const response = await worker.fetch(new Request("https://openbell.dolepee.com/proof/"), environment);
  expect(await response.text()).toBe("asset");
});

test("assessment artifact status confirms only the exact decision-store commitment", async () => {
  const invoiceId = `0x${"11".repeat(32)}`;
  const artifactHash = `0x${"33".repeat(32)}`;
  const storedRequest = mainnetUnderwritingRequestSchema.parse({
    schemaVersion: "openbell-mainnet-underwriting-v1",
    label: "XLAYER MAINNET — REAL USDG",
    registrationTransactionHash: `0x${"44".repeat(32)}`,
    invoiceId,
    documentHash: `0x${"55".repeat(32)}`,
    supplier: `0x${"66".repeat(20)}`,
    payer: `0x${"77".repeat(20)}`,
    funder: `0x${"88".repeat(20)}`,
    faceValue: "100000000",
    issuedAt: 1_786_000_000,
    dueDate: 1_786_086_400,
    requestedAdvance: "50000000",
    payerHistory: { completedSettlements: 0, onTimeSettlements: 0, lateSettlements: 0, defaults: 0, concentrationBps: 0, daysSinceLastSettlement: 0 },
    redactedContext: "Registered mainnet invoice.",
    supplierAuthorization: `0x${"99".repeat(32)}${"00".repeat(31)}011b`,
    realValueAcknowledged: true
  });
  const requestHash = connectedRequestHashOf(storedRequest);
  const requestJson = JSON.stringify(storedRequest);
  const bound: unknown[][] = [];
  const artifactEnvironment = {
    ASSETS: { fetch: async () => new Response("asset") },
    DB: {
      prepare: () => ({
        bind: (...values: unknown[]) => {
          bound.push(values);
          return { first: async () => values.join(":") === [invoiceId, requestHash, artifactHash].join(":") ? { request_json: requestJson } : null };
        }
      })
    }
  } as never;
  const request = (hash: string) => new Request("https://openbell.dolepee.com/api/assessment-artifact-status", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://openbell.dolepee.com", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ invoiceId, requestHash, artifactHash: hash })
  });
  const verified = await worker.fetch(request(artifactHash), artifactEnvironment);
  expect(verified.status).toBe(200);
  expect(await verified.json()).toEqual({ verified: true, requestedAdvance: "50000000" });
  const mismatch = await worker.fetch(request(`0x${"44".repeat(32)}`), artifactEnvironment);
  expect(await mismatch.json()).toEqual({ verified: false });
  expect(bound).toHaveLength(2);
});

test("assessment artifact status rejects schema-valid request drift against the committed hash", async () => {
  const invoiceId = `0x${"11".repeat(32)}`;
  const requestHash = `0x${"22".repeat(32)}`;
  const artifactHash = `0x${"33".repeat(32)}`;
  const requestJson = JSON.stringify({
    schemaVersion: "openbell-mainnet-underwriting-v1",
    label: "XLAYER MAINNET — REAL USDG",
    registrationTransactionHash: `0x${"44".repeat(32)}`,
    invoiceId,
    documentHash: `0x${"55".repeat(32)}`,
    supplier: `0x${"66".repeat(20)}`,
    payer: `0x${"77".repeat(20)}`,
    funder: `0x${"88".repeat(20)}`,
    faceValue: "100000000",
    issuedAt: 1_786_000_000,
    dueDate: 1_786_086_400,
    requestedAdvance: "90000000",
    payerHistory: { completedSettlements: 0, onTimeSettlements: 0, lateSettlements: 0, defaults: 0, concentrationBps: 0, daysSinceLastSettlement: 0 },
    redactedContext: "Registered mainnet invoice.",
    supplierAuthorization: `0x${"99".repeat(32)}${"00".repeat(31)}011b`,
    realValueAcknowledged: true
  });
  const driftEnvironment = {
    ASSETS: { fetch: async () => new Response("asset") },
    DB: { prepare: () => ({ bind: () => ({ first: async () => ({ request_json: requestJson }) }) }) }
  } as never;
  const response = await worker.fetch(new Request("https://openbell.dolepee.com/api/assessment-artifact-status", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://openbell.dolepee.com", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ invoiceId, requestHash, artifactHash })
  }), driftEnvironment);
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "CORRUPT_ARTIFACT_REQUEST" });
});

test("assessment artifact status rejects malformed and cross-origin probes without touching storage", async () => {
  const endpoint = "https://openbell.dolepee.com/api/assessment-artifact-status";
  const crossOrigin = await worker.fetch(new Request(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
    body: "{}"
  }), environment);
  expect(crossOrigin.status).toBe(403);
  const malformed = await worker.fetch(new Request(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://openbell.dolepee.com", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ invoiceId: "0x01", requestHash: "0x02", artifactHash: "0x03" })
  }), environment);
  expect(malformed.status).toBe(400);
  expect(await malformed.json()).toEqual({ error: "INVALID_ARTIFACT_QUERY" });
});

test("funding candidate endpoint returns only the current open D1 candidate", async () => {
  const invoiceId = `0x${"10".repeat(32)}`;
  const candidate = {
    schemaVersion: "openbell-mainnet-funding-candidate-v1",
    status: "OPEN",
    title: "One bounded supplier advance",
    invoice: { invoiceId }
  };
  vi.stubGlobal("fetch", vi.fn(async () => jsonRpcResponse(invoiceState(1))));
  const candidateEnvironment = {
    ASSETS: { fetch: async () => new Response("asset") },
    DB: { prepare: () => ({ first: async () => ({ candidate_json: JSON.stringify(candidate) }) }) }
  } as never;
  const response = await worker.fetch(new Request("https://openbell.dolepee.com/api/funding-candidate"), candidateEnvironment);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual(candidate);
});

test("funding candidate endpoint hides a row after its invoice leaves REGISTERED state", async () => {
  const candidate = {
    schemaVersion: "openbell-mainnet-funding-candidate-v1",
    status: "OPEN",
    title: "One bounded supplier advance",
    invoice: { invoiceId: `0x${"10".repeat(32)}` }
  };
  vi.stubGlobal("fetch", vi.fn(async () => jsonRpcResponse(invoiceState(2))));
  const candidateEnvironment = {
    ASSETS: { fetch: async () => new Response("asset") },
    DB: { prepare: () => ({ first: async () => ({ candidate_json: JSON.stringify(candidate) }) }) }
  } as never;
  const response = await worker.fetch(new Request("https://openbell.dolepee.com/api/funding-candidate"), candidateEnvironment);
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "NO_OPEN_FUNDING_CANDIDATE" });
});

test("funding candidate endpoint fails closed for missing, malformed, and non-GET candidates", async () => {
  const missingEnvironment = {
    ASSETS: { fetch: async () => new Response("asset") },
    DB: { prepare: () => ({ first: async () => null }) }
  } as never;
  const endpoint = "https://openbell.dolepee.com/api/funding-candidate";
  const missing = await worker.fetch(new Request(endpoint), missingEnvironment);
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ error: "NO_OPEN_FUNDING_CANDIDATE" });

  const corruptEnvironment = {
    ASSETS: { fetch: async () => new Response("asset") },
    DB: { prepare: () => ({ first: async () => ({ candidate_json: JSON.stringify({ schemaVersion: "wrong", status: "OPEN" }) }) }) }
  } as never;
  const corrupt = await worker.fetch(new Request(endpoint), corruptEnvironment);
  expect(corrupt.status).toBe(500);
  expect(await corrupt.json()).toEqual({ error: "CORRUPT_FUNDING_CANDIDATE" });

  const wrongMethod = await worker.fetch(new Request(endpoint, { method: "PUT" }), environment);
  expect(wrongMethod.status).toBe(405);
  expect(await wrongMethod.json()).toEqual({ error: "METHOD_NOT_ALLOWED" });

  const crossOriginPost = await worker.fetch(new Request(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
    body: "{}"
  }), environment);
  expect(crossOriginPost.status).toBe(403);
  expect(await crossOriginPost.json()).toEqual({ error: "SAME_ORIGIN_REQUIRED" });
});
