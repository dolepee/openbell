import { expect, test } from "vitest";
import worker from "./index.js";

const environment = {
  ASSETS: { fetch: async () => new Response("asset") },
  DB: { prepare: () => { throw new Error("DB_MUST_NOT_BE_TOUCHED"); } }
} as never;
const api = "https://openbell.dolepee.com/api/connected-underwriting";

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
  const requestHash = `0x${"22".repeat(32)}`;
  const artifactHash = `0x${"33".repeat(32)}`;
  const bound: unknown[][] = [];
  const artifactEnvironment = {
    ASSETS: { fetch: async () => new Response("asset") },
    DB: {
      prepare: () => ({
        bind: (...values: unknown[]) => {
          bound.push(values);
          return { first: async () => values.join(":") === [invoiceId, requestHash, artifactHash].join(":") ? { verified: 1 } : null };
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
  expect(await verified.json()).toEqual({ verified: true });
  const mismatch = await worker.fetch(request(`0x${"44".repeat(32)}`), artifactEnvironment);
  expect(await mismatch.json()).toEqual({ verified: false });
  expect(bound).toHaveLength(2);
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
