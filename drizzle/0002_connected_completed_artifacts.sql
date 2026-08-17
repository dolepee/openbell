CREATE TABLE IF NOT EXISTS connected_underwriting_completed_artifacts (
  invoice_id TEXT PRIMARY KEY NOT NULL,
  request_hash TEXT NOT NULL,
  artifact_hash TEXT NOT NULL CHECK (length(artifact_hash) = 66 AND substr(artifact_hash, 1, 2) = '0x'),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (invoice_id) REFERENCES connected_underwriting_decisions(invoice_id)
) STRICT;

CREATE TABLE IF NOT EXISTS connected_underwriting_legacy_completed_decisions (
  invoice_id TEXT PRIMARY KEY NOT NULL,
  request_hash TEXT NOT NULL,
  request_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS connected_underwriting_schema_state (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
) STRICT;

INSERT OR IGNORE INTO connected_underwriting_legacy_completed_decisions
  (invoice_id, request_hash, request_json, result_json, created_at, updated_at)
SELECT invoice_id, request_hash, request_json, result_json, created_at, updated_at
FROM connected_underwriting_decisions AS decision
WHERE status = 'COMPLETE'
  AND NOT EXISTS (
    SELECT 1 FROM connected_underwriting_completed_artifacts AS artifact
    WHERE artifact.invoice_id = decision.invoice_id AND artifact.request_hash = decision.request_hash
  );

DELETE FROM connected_underwriting_decisions
WHERE status = 'COMPLETE'
  AND NOT EXISTS (
    SELECT 1 FROM connected_underwriting_completed_artifacts AS artifact
    WHERE artifact.invoice_id = connected_underwriting_decisions.invoice_id
      AND artifact.request_hash = connected_underwriting_decisions.request_hash
  );

INSERT OR IGNORE INTO connected_underwriting_schema_state (key, value)
VALUES ('completed-artifacts-v1', 'complete');
