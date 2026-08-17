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

export const connectedCompletedArtifactTableSql = `CREATE TABLE IF NOT EXISTS connected_underwriting_completed_artifacts (
  invoice_id TEXT PRIMARY KEY NOT NULL,
  request_hash TEXT NOT NULL,
  artifact_hash TEXT NOT NULL CHECK (length(artifact_hash) = 66 AND substr(artifact_hash, 1, 2) = '0x'),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (invoice_id) REFERENCES connected_underwriting_decisions(invoice_id)
) STRICT`;

export const connectedLegacyCompletedDecisionTableSql = `CREATE TABLE IF NOT EXISTS connected_underwriting_legacy_completed_decisions (
  invoice_id TEXT PRIMARY KEY NOT NULL,
  request_hash TEXT NOT NULL,
  request_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT`;

export const archiveLegacyConnectedDecisionsSql = `INSERT OR IGNORE INTO connected_underwriting_legacy_completed_decisions
  (invoice_id, request_hash, request_json, result_json, created_at, updated_at)
SELECT invoice_id, request_hash, request_json, result_json, created_at, updated_at
FROM connected_underwriting_decisions AS decision
WHERE status = 'COMPLETE'
  AND NOT EXISTS (
    SELECT 1 FROM connected_underwriting_completed_artifacts AS artifact
    WHERE artifact.invoice_id = decision.invoice_id AND artifact.request_hash = decision.request_hash
  )`;

export const retireLegacyConnectedDecisionsSql = `DELETE FROM connected_underwriting_decisions
WHERE status = 'COMPLETE'
  AND NOT EXISTS (
    SELECT 1 FROM connected_underwriting_completed_artifacts AS artifact
    WHERE artifact.invoice_id = connected_underwriting_decisions.invoice_id
      AND artifact.request_hash = connected_underwriting_decisions.request_hash
  )`;

export const connectedCompletedArtifactMigrationSql = `${connectedCompletedArtifactTableSql};

${connectedLegacyCompletedDecisionTableSql};

${archiveLegacyConnectedDecisionsSql};

${retireLegacyConnectedDecisionsSql}`;
