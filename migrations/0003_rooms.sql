-- Group chat rooms. The live transcript + presence lives in each room's
-- Durable Object (SQLite); this table is just the registry for routing,
-- ownership, "list my rooms", and revocation. No message content here.
CREATE TABLE rooms (
  token TEXT PRIMARY KEY,
  host_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  -- 'guests' = anyone with the link; 'members' = must sign in with GitHub.
  join_mode TEXT NOT NULL DEFAULT 'guests',
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);
CREATE INDEX idx_rooms_host ON rooms(host_user_id);
