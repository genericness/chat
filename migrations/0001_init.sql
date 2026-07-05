CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id INTEGER NOT NULL UNIQUE,
  login TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  meta_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX idx_conv_user ON conversations(user_id, updated_at);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conv_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  msg_json TEXT NOT NULL
);
CREATE INDEX idx_msg_conv ON messages(conv_id, seq);
