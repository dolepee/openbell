CREATE TABLE IF NOT EXISTS mainnet_funding_candidates (
  invoice_id TEXT PRIMARY KEY NOT NULL CHECK (length(invoice_id) = 66 AND substr(invoice_id, 1, 2) = '0x'),
  candidate_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS mainnet_funding_candidates_status_expiry
ON mainnet_funding_candidates (status, expires_at DESC);
