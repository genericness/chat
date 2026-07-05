import { Hono } from "hono"
import type { AppEnv } from "./types"
import { getSessionUserId } from "./lib/cookies"
import { getUserById } from "./lib/db"
import auth from "./routes/auth"
import exa from "./routes/exa"
import openrouter from "./routes/openrouter"
import sync from "./routes/sync"

const app = new Hono<AppEnv>()

app.route("/api/auth", auth)
app.route("/api/openrouter", openrouter)
app.route("/api/exa", exa)
app.route("/api/sync", sync)

app.get("/api/me", async (c) => {
  const uid = await getSessionUserId(c)
  if (!uid) return c.json({ error: "unauthorized" }, 401)
  const user = await getUserById(c.env.DB, uid)
  if (!user) return c.json({ error: "unauthorized" }, 401)
  return c.json({
    id: user.id,
    login: user.login,
    name: user.name,
    avatarUrl: user.avatar_url,
  })
})

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404))

app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw))

export default app
