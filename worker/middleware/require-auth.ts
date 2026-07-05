import type { MiddlewareHandler } from "hono"
import type { AppEnv } from "../types"
import { getSessionUserId, clearSession } from "../lib/cookies"
import { getUserById } from "../lib/db"

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const uid = await getSessionUserId(c)
  if (!uid) return c.json({ error: "unauthorized" }, 401)
  const user = await getUserById(c.env.DB, uid)
  if (!user) {
    clearSession(c)
    return c.json({ error: "unauthorized" }, 401)
  }
  c.set("user", user)
  await next()
}
