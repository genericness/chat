import { Hono } from "hono"
import type { AppEnv } from "./types"
import exa from "./routes/exa"
import openrouter from "./routes/openrouter"

const app = new Hono<AppEnv>()

app.route("/api/openrouter", openrouter)
app.route("/api/exa", exa)

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404))

app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw))

export default app
