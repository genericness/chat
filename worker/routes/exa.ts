import { Hono } from "hono"
import type { AppEnv } from "../types"

// api.exa.ai only allows *.exa.ai browser origins, so the search call has to
// hop through us. The user's key transits in a header per request — it is
// never stored or logged.
const exa = new Hono<AppEnv>()

// Pass-through proxy for the Exa endpoints the app uses. The key transits in a
// header per request and is never stored or logged.
const proxy = (path: string) =>
  exa.post(path, async (c) => {
    const key = c.req.header("x-exa-key")
    if (!key) return c.json({ error: "missing_key" }, 400)
    const upstream = await fetch(`https://api.exa.ai${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: c.req.raw.body,
    })
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "content-type": "application/json" },
    })
  })

proxy("/search")
proxy("/contents")

export default exa
