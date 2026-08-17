export const connectedDecisionTableSql = `CREATE TABLE IF NOT EXISTS connected_underwriting_decisions (
  invoice_id TEXT PRIMARY KEY NOT NULL,
  request_hash TEXT NOT NULL,
  request_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CLAIMED', 'MODEL_IN_FLIGHT', 'COMPLETE', 'FAILED')),
  result_json TEXT,
  failure_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((status = 'COMPLETE' AND result_json IS NOT NULL AND failure_code IS NULL)
      OR (status = 'FAILED' AND result_json IS NULL AND failure_code IS NOT NULL)
      OR (status IN ('CLAIMED', 'MODEL_IN_FLIGHT') AND result_json IS NULL AND failure_code IS NULL))
) STRICT`;

export const connectedDailyBudgetTableSql = `CREATE TABLE IF NOT EXISTS connected_underwriting_daily_budget (
  day TEXT PRIMARY KEY NOT NULL,
  used INTEGER NOT NULL CHECK (used >= 0)
) STRICT`;

export const connectedPolicyRefusalTableSql = `CREATE TABLE IF NOT EXISTS connected_underwriting_policy_refusals (
  invoice_id TEXT PRIMARY KEY NOT NULL,
  request_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  artifact_hash TEXT NOT NULL CHECK (length(artifact_hash) = 66 AND substr(artifact_hash, 1, 2) = '0x'),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (invoice_id) REFERENCES connected_underwriting_decisions(invoice_id)
) STRICT`;
