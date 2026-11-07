-- Accounts made before this change count as confirmed. Sign-up inserts 0 for new ones.
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1;
CREATE TABLE email_confirmations (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX email_confirmations_expiry ON email_confirmations(expires_at);
