CREATE TABLE IF NOT EXISTS connected_underwriting_completed_artifacts (
  invoice_id TEXT PRIMARY KEY NOT NULL,
  request_hash TEXT NOT NULL,
  artifact_hash TEXT NOT NULL CHECK (length(artifact_hash) = 66 AND substr(artifact_hash, 1, 2) = '0x'),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (invoice_id) REFERENCES connected_underwriting_decisions(invoice_id)
) STRICT;
