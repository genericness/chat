-- Public read-only chat snapshots. A share is an opt-in, unguessable-token
-- copy of one conversation's text; the owner can revoke it. No keys, no
-- attachments, no per-chat settings are stored here.
CREATE TABLE shares (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conv_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_shares_user ON shares(user_id);
