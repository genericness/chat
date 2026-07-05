import type { GitHubUser } from "./github"

export interface UserRow {
  id: number
  github_id: number
  login: string
  name: string | null
  avatar_url: string
  created_at: number
  last_seen_at: number
}

export async function upsertUser(db: D1Database, gh: GitHubUser): Promise<UserRow> {
  const ts = Date.now()
  const row = await db
    .prepare(
      `INSERT INTO users (github_id, login, name, avatar_url, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(github_id) DO UPDATE SET
         login = excluded.login,
         name = excluded.name,
         avatar_url = excluded.avatar_url,
         last_seen_at = excluded.last_seen_at
       RETURNING *`
    )
    .bind(gh.id, gh.login.toLowerCase(), gh.name, gh.avatarUrl, ts, ts)
    .first<UserRow>()
  return row as UserRow
}

export function getUserById(db: D1Database, id: number): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>()
}
