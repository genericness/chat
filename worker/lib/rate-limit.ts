import type { Context } from "hono"
import type { AppEnv } from "../types"

/** Best-effort fixed-window limiter backed by D1. It fails open on DB errors. */
export async function checkRateLimit(
  c: Context<AppEnv>,
  bucket: string,
  subject: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  const now = Date.now()
  const windowStart = Math.floor(now / windowMs) * windowMs
  const key = `${bucket}:${subject}`
  try {
    const row = await c.env.DB.prepare(
      `INSERT INTO rate_limits (key, window_start, count)
       VALUES (?, ?, 1)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE
           WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1
           ELSE 1
         END,
         window_start = excluded.window_start
       RETURNING count`
    )
      .bind(key, windowStart)
      .first<{ count: number }>()
    if (Math.random() < 0.01) {
      c.executionCtx.waitUntil(
        c.env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?")
          .bind(windowStart - 2 * windowMs)
          .run()
          .then(() => undefined)
          .catch(() => undefined)
      )
    }
    if ((row?.count ?? 1) <= limit) return true
    c.header("retry-after", String(Math.ceil((windowStart + windowMs - now) / 1000)))
    return false
  } catch {
    return true
  }
}

export function clientIp(c: Context<AppEnv>): string {
  return c.req.header("cf-connecting-ip") ?? "unknown"
}
