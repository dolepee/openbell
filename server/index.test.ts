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
