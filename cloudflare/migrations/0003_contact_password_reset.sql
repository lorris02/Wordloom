ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE challenges ADD COLUMN email TEXT;
ALTER TABLE challenges ADD COLUMN phone TEXT;
CREATE UNIQUE INDEX users_phone ON users(phone);
CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX password_resets_expiry ON password_resets(expires_at);
