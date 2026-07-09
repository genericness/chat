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

// srcdoc artifacts inherit this policy, so inline scripts/styles and HTTPS CDN
// assets remain allowed while the iframe sandbox supplies the origin boundary.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https:",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "connect-src 'self' https: http: wss: ws:",
  "frame-src 'self' https: blob:",
  "media-src 'self' data: blob: https:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https:",
].join("; ")

app.use("*", async (c, next) => {
  await next()
  const headers = new Headers(c.res.headers)
  if (!headers.has("content-security-policy")) {
    headers.set("content-security-policy", CONTENT_SECURITY_POLICY)
  }
  headers.set("referrer-policy", "no-referrer")
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
  headers.set("x-content-type-options", "nosniff")
  headers.set("x-frame-options", "DENY")
  if (new URL(c.req.url).protocol === "https:") {
    headers.set("strict-transport-security", "max-age=31536000; includeSubDomains")
  }
  c.res = new Response(c.res.body, {
    status: c.res.status,
    statusText: c.res.statusText,
    headers,
  })
})

// Native app WebViews (Capacitor) call these APIs cross-origin with bearer auth.
app.use(
  "/api/*",
  cors({
    origin: ["capacitor://localhost", "https://localhost"],
    exposeHeaders: ["x-attachment-name"],
  })
)

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
