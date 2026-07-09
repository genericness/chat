-- Invited members for a room (a "project"). When a room's join_mode is
-- 'members', only the host and these GitHub logins may join. Login is stored
-- lowercased to match GitHub's case-insensitive usernames.
CREATE TABLE room_members (
  token TEXT NOT NULL REFERENCES rooms(token) ON DELETE CASCADE,
  login TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (token, login)
);
CREATE INDEX idx_room_members_login ON room_members(login);
