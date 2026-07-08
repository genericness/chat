import { Hono } from "hono"
import { cors } from "hono/cors"
import type { AppEnv } from "./types"
import { getSessionUserId } from "./lib/cookies"
import { getUserById } from "./lib/db"
import auth from "./routes/auth"
import chatgpt from "./routes/chatgpt"
import exa from "./routes/exa"
import opencode from "./routes/opencode"
import openrouter from "./routes/openrouter"
import sync from "./routes/sync"

const app = new Hono<AppEnv>()

// Native app WebViews (Capacitor) call these APIs cross-origin with bearer auth.
app.use("/api/*", cors({ origin: ["capacitor://localhost", "https://localhost"] }))

app.route("/api/auth", auth)
app.route("/api/chatgpt", chatgpt)
app.route("/api/openrouter", openrouter)
app.route("/api/exa", exa)
app.route("/api/opencode", opencode)
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
