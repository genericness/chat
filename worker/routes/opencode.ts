import { Hono } from "hono"
import type { AppEnv } from "../types"

// OpenCode (Go and Zen) don't send CORS headers, so the browser can't call
// them directly like every other provider. We proxy them same-origin,
// forwarding the user's key in the Authorization header per request. The key
// (and the prompt/response) transit the worker but are never stored or logged.
//
//   `/api/opencode/zen/<rest>` → `https://opencode.ai/zen/<rest>`
//   `/api/opencode/go/<rest>`  → `https://opencode.ai/zen/go/<rest>`
//
// (OpenCode Go lives under the Zen gateway path, not a top-level /go path.)
const opencode = new Hono<AppEnv>()

opencode.all("/*", async (c) => {
  const url = new URL(c.req.url)
  const rest = url.pathname.replace(/^\/api\/opencode\//, "")
  const target = rest.startsWith("go/")
    ? `https://opencode.ai/zen/${rest}${url.search}`
    : `https://opencode.ai/zen/${rest.replace(/^zen\//, "")}${url.search}`

  const headers: Record<string, string> = {}
  const auth = c.req.header("authorization")
  if (auth) headers.authorization = auth
  const ct = c.req.header("content-type")
  if (ct) headers["content-type"] = ct

  const method = c.req.method
  const upstream = await fetch(target, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : c.req.raw.body,
  })
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
    },
  })
})

export default opencode
