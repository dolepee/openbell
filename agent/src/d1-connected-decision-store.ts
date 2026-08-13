import type { Hex } from "viem";
import { connectedDailyBudgetTableSql, connectedDecisionTableSql } from "../../db/schema.js";
import type { ConnectedDecisionStore, StoredConnectedDecision } from "./connected-underwriting.js";

interface D1RunResult { readonly success?: boolean; readonly meta?: { readonly changes?: number } }
interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<D1RunResult>;
  first<T>(): Promise<T | null>;
}
export interface D1DatabaseLike { prepare(sql: string): D1Statement }

interface DecisionRow {
  readonly request_hash: string;
  readonly status: string;
  readonly result_json: string | null;
  readonly failure_code: string | null;
  readonly updated_at: number;
}

export const CONNECTED_CLAIM_LEASE_MS = 60_000;

const parseRow = (row: DecisionRow): StoredConnectedDecision => {
  if (!/^0x[0-9a-f]{64}$/.test(row.request_hash)) throw new Error("CONNECTED_STORE_CORRUPT_HASH");
  if (row.status === "CLAIMED" && row.result_json === null && row.failure_code === null) return { requestHash: row.request_hash as Hex, status: "CLAIMED" };
  if (row.status === "MODEL_IN_FLIGHT" && row.result_json === null && row.failure_code === null) return { requestHash: row.request_hash as Hex, status: "MODEL_IN_FLIGHT" };
  if (row.status === "COMPLETE" && row.result_json !== null && row.failure_code === null) return { requestHash: row.request_hash as Hex, status: "COMPLETE", resultJson: row.result_json };
  if (row.status === "FAILED" && row.result_json === null && row.failure_code !== null) return { requestHash: row.request_hash as Hex, status: "FAILED", failureCode: row.failure_code };
  throw new Error("CONNECTED_STORE_CORRUPT_ROW");
};

export class D1ConnectedDecisionStore implements ConnectedDecisionStore {
  #initialized = false;
  constructor(readonly database: D1DatabaseLike, readonly now: () => number = () => Date.now()) {}

  async #initialize(): Promise<void> {
    if (this.#initialized) return;
    const result = await this.database.prepare(connectedDecisionTableSql).run();
    if (result.success === false) throw new Error("CONNECTED_STORE_SCHEMA_FAILED");
    const budgetResult = await this.database.prepare(connectedDailyBudgetTableSql).run();
    if (budgetResult.success === false) throw new Error("CONNECTED_STORE_BUDGET_SCHEMA_FAILED");
    this.#initialized = true;
  }

  async claim(invoiceId: Hex, requestHash: Hex, requestJson: string): Promise<{ claimed: boolean; row: StoredConnectedDecision }> {
    await this.#initialize();
    const timestamp = this.now();
    const inserted = await this.database.prepare(
      "INSERT OR IGNORE INTO connected_underwriting_decisions (invoice_id, request_hash, request_json, status, created_at, updated_at) VALUES (?, ?, ?, 'CLAIMED', ?, ?)"
    ).bind(invoiceId, requestHash, requestJson, timestamp, timestamp).run();
    const row = await this.database.prepare(
      "SELECT request_hash, status, result_json, failure_code, updated_at FROM connected_underwriting_decisions WHERE invoice_id = ?"
    ).bind(invoiceId).first<DecisionRow>();
    if (!row) throw new Error("CONNECTED_STORE_CLAIM_MISSING");
    if (inserted.meta?.changes === 1) return { claimed: true, row: parseRow(row) };
    if (row.request_hash !== requestHash) return { claimed: false, row: parseRow(row) };
    const staleBefore = timestamp - CONNECTED_CLAIM_LEASE_MS;
    if (row.status === "CLAIMED" && row.updated_at <= staleBefore) {
      const reclaimed = await this.database.prepare(
        "UPDATE connected_underwriting_decisions SET updated_at = ? WHERE invoice_id = ? AND request_hash = ? AND status = 'CLAIMED' AND updated_at = ?"
      ).bind(timestamp, invoiceId, requestHash, row.updated_at).run();
      if (reclaimed.meta?.changes === 1) return { claimed: true, row: { requestHash, status: "CLAIMED" } };
    }
    if (row.status === "MODEL_IN_FLIGHT" && row.updated_at <= staleBefore) {
      await this.database.prepare(
        "UPDATE connected_underwriting_decisions SET status = 'FAILED', failure_code = 'CONNECTED_MODEL_OUTCOME_UNCERTAIN', updated_at = ? WHERE invoice_id = ? AND request_hash = ? AND status = 'MODEL_IN_FLIGHT' AND updated_at = ?"
      ).bind(timestamp, invoiceId, requestHash, row.updated_at).run();
    }
    const current = await this.database.prepare(
      "SELECT request_hash, status, result_json, failure_code, updated_at FROM connected_underwriting_decisions WHERE invoice_id = ?"
    ).bind(invoiceId).first<DecisionRow>();
    if (!current) throw new Error("CONNECTED_STORE_CLAIM_MISSING");
    return { claimed: false, row: parseRow(current) };
  }

  async load(invoiceId: Hex): Promise<StoredConnectedDecision | null> {
    await this.#initialize();
    const row = await this.database.prepare(
      "SELECT request_hash, status, result_json, failure_code, updated_at FROM connected_underwriting_decisions WHERE invoice_id = ?"
    ).bind(invoiceId).first<DecisionRow>();
    return row ? parseRow(row) : null;
  }

  async beginModel(invoiceId: Hex, requestHash: Hex): Promise<void> {
    await this.#initialize();
    const result = await this.database.prepare(
      "UPDATE connected_underwriting_decisions SET status = 'MODEL_IN_FLIGHT', updated_at = ? WHERE invoice_id = ? AND request_hash = ? AND status = 'CLAIMED'"
    ).bind(this.now(), invoiceId, requestHash).run();
    if (result.meta?.changes !== 1) throw new Error("CONNECTED_STORE_BEGIN_MODEL_CONFLICT");
  }

  async complete(invoiceId: Hex, requestHash: Hex, resultJson: string): Promise<void> {
    await this.#initialize();
    const result = await this.database.prepare(
      "UPDATE connected_underwriting_decisions SET status = 'COMPLETE', result_json = ?, updated_at = ? WHERE invoice_id = ? AND request_hash = ? AND status = 'MODEL_IN_FLIGHT'"
    ).bind(resultJson, this.now(), invoiceId, requestHash).run();
    if (result.meta?.changes !== 1) throw new Error("CONNECTED_STORE_COMPLETE_CONFLICT");
  }

  async fail(invoiceId: Hex, requestHash: Hex, failureCode: string): Promise<void> {
    await this.#initialize();
    const result = await this.database.prepare(
      "UPDATE connected_underwriting_decisions SET status = 'FAILED', failure_code = ?, updated_at = ? WHERE invoice_id = ? AND request_hash = ? AND status IN ('CLAIMED', 'MODEL_IN_FLIGHT')"
    ).bind(failureCode, this.now(), invoiceId, requestHash).run();
    if (result.meta?.changes !== 1) throw new Error("CONNECTED_STORE_FAIL_CONFLICT");
  }

  async reserveDailyModelCall(day: string, maximum: number): Promise<boolean> {
    await this.#initialize();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isSafeInteger(maximum) || maximum < 1) {
      throw new Error("CONNECTED_STORE_INVALID_BUDGET_REQUEST");
    }
    const inserted = await this.database.prepare(
      "INSERT OR IGNORE INTO connected_underwriting_daily_budget (day, used) VALUES (?, 0)"
    ).bind(day).run();
    if (inserted.success === false) throw new Error("CONNECTED_STORE_BUDGET_INSERT_FAILED");
    const updated = await this.database.prepare(
      "UPDATE connected_underwriting_daily_budget SET used = used + 1 WHERE day = ? AND used < ?"
    ).bind(day, maximum).run();
    return updated.meta?.changes === 1;
  }
}
