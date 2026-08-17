import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { connectedDailyBudgetTableSql, connectedDecisionTableSql, connectedPolicyRefusalTableSql } from "../../db/schema.js";
import { D1ConnectedDecisionStore, type D1DatabaseLike } from "../src/d1-connected-decision-store.js";

class StatementAdapter {
  #values: SQLInputValue[] = [];
  constructor(readonly statement: StatementSync) {}
  bind(...values: unknown[]): StatementAdapter { this.#values = values as SQLInputValue[]; return this; }
  async run() {
    const result = this.statement.run(...this.#values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
  async first<T>(): Promise<T | null> { return (this.statement.get(...this.#values) as T | undefined) ?? null; }
}

const database = (): D1DatabaseLike => {
  const sqlite = new DatabaseSync(":memory:");
  return { prepare: (sql) => new StatementAdapter(sqlite.prepare(sql)) };
};
const invoiceId = `0x${"aa".repeat(32)}` as const;
const requestHash = `0x${"bb".repeat(32)}` as const;
const artifactHash = `0x${"cc".repeat(32)}` as const;

test("Sites D1 migration is byte-derived from the runtime schema", () => {
  expect(readFileSync("drizzle/0000_connected_underwriting.sql", "utf8")).toBe(`${connectedDecisionTableSql};\n\n${connectedDailyBudgetTableSql};\n`);
  expect(readFileSync("drizzle/0001_connected_policy_refusals.sql", "utf8")).toBe(`${connectedPolicyRefusalTableSql};\n`);
});

test("D1 store atomically claims once and returns the exact completed envelope", async () => {
  let clock = 100;
  const store = new D1ConnectedDecisionStore(database(), () => ++clock);
  const first = await store.claim(invoiceId, requestHash, "{\"request\":1}");
  expect(first).toEqual({ claimed: true, row: { requestHash, status: "CLAIMED" } });
  expect(await store.load(invoiceId)).toEqual({ requestHash, status: "CLAIMED" });
  const concurrent = await store.claim(invoiceId, requestHash, "{\"request\":1}");
  expect(concurrent).toEqual({ claimed: false, row: { requestHash, status: "CLAIMED" } });
  await store.beginModel(invoiceId, requestHash);
  await store.complete(invoiceId, requestHash, "{\"result\":1}");
  const replay = await store.claim(invoiceId, requestHash, "{\"request\":1}");
  expect(replay).toEqual({ claimed: false, row: { requestHash, status: "COMPLETE", resultJson: "{\"result\":1}" } });
  await expect(store.complete(invoiceId, requestHash, "{}")).rejects.toThrow("CONNECTED_STORE_COMPLETE_CONFLICT");
});

test("D1 store seals failure and refuses later state replacement", async () => {
  const store = new D1ConnectedDecisionStore(database(), () => 200);
  await store.claim(invoiceId, requestHash, "{}");
  await store.fail(invoiceId, requestHash, "LIVE_MODEL_TIMEOUT");
  const replay = await store.claim(invoiceId, requestHash, "{}");
  expect(replay.row).toEqual({ requestHash, status: "FAILED", failureCode: "LIVE_MODEL_TIMEOUT" });
  await expect(store.complete(invoiceId, requestHash, "{}")).rejects.toThrow("CONNECTED_STORE_COMPLETE_CONFLICT");
});

test("D1 store preserves one policy-refusal artifact without reopening execution", async () => {
  const store = new D1ConnectedDecisionStore(database(), () => 210);
  await store.claim(invoiceId, requestHash, "{}");
  await store.beginModel(invoiceId, requestHash);
  await store.recordPolicyRefusal(invoiceId, requestHash, "{\"refusal\":1}", artifactHash);
  await store.fail(invoiceId, requestHash, "LOW_CONFIDENCE");
  expect(await store.loadPolicyRefusal(invoiceId, requestHash)).toEqual({ resultJson: "{\"refusal\":1}", artifactHash });
  await expect(store.recordPolicyRefusal(invoiceId, requestHash, "{\"refusal\":2}", artifactHash)).rejects.toThrow("CONNECTED_STORE_REFUSAL_CONFLICT");
  expect((await store.claim(invoiceId, requestHash, "{}")).row).toEqual({ requestHash, status: "FAILED", failureCode: "LOW_CONFIDENCE" });
});

test("a stale pre-model claim is recoverable without duplicating a model call", async () => {
  let clock = 1_000;
  const store = new D1ConnectedDecisionStore(database(), () => clock);
  await store.claim(invoiceId, requestHash, "{}");
  clock += 60_001;
  expect(await store.claim(invoiceId, requestHash, "{}")).toEqual({ claimed: true, row: { requestHash, status: "CLAIMED" } });
});

test("an uncertain stale model call is sealed failed and never retried", async () => {
  let clock = 1_000;
  const store = new D1ConnectedDecisionStore(database(), () => clock);
  await store.claim(invoiceId, requestHash, "{}");
  await store.beginModel(invoiceId, requestHash);
  clock += 60_001;
  const replay = await store.claim(invoiceId, requestHash, "{}");
  expect(replay).toEqual({ claimed: false, row: { requestHash, status: "FAILED", failureCode: "CONNECTED_MODEL_OUTCOME_UNCERTAIN" } });
});

test("same invoice with a changed request hash remains an auditable conflict", async () => {
  const store = new D1ConnectedDecisionStore(database());
  expect(await store.load(invoiceId)).toBeNull();
  await store.claim(invoiceId, requestHash, "{}");
  const changed = await store.claim(invoiceId, `0x${"cc".repeat(32)}`, "{\"changed\":true}");
  expect(changed.claimed).toBe(false);
  expect(changed.row.requestHash).toBe(requestHash);
});

test("D1 store enforces the durable daily paid-model ceiling", async () => {
  const store = new D1ConnectedDecisionStore(database());
  expect(await store.reserveDailyModelCall("2026-08-13", 2)).toBe(true);
  expect(await store.reserveDailyModelCall("2026-08-13", 2)).toBe(true);
  expect(await store.reserveDailyModelCall("2026-08-13", 2)).toBe(false);
  expect(await store.reserveDailyModelCall("2026-08-14", 2)).toBe(true);
  await expect(store.reserveDailyModelCall("not-a-day", 2)).rejects.toThrow("CONNECTED_STORE_INVALID_BUDGET_REQUEST");
});
