// ChatGPT (Codex) egress forwarder.
//
// OpenAI's WAF on chatgpt.com blocks Cloudflare Worker subrequests outright
// (Workers stamp an unremovable `cf-worker` header on egress; requests bearing
// it get a bot-challenge 403). Plain Node egress passes, so the worker's
// /api/chatgpt facade routes the codex leg through this dumb pipe instead:
//
//   worker → this forwarder → chatgpt.com/backend-api/codex
//
// Run it anywhere that isn't Cloudflare (dev machine, VPS), then point the
// worker at it:
//   node scripts/codex-forwarder.mjs                       # listens on :8789
//   CODEX_BASE_URL=http://localhost:8789/codex             # .dev.vars (dev)
//   CODEX_BASE_URL=https://your-host/codex                 # wrangler var (prod)
//
// If the forwarder is reachable from the open internet, set a shared secret on
// both sides so only your worker can use it:
//   CODEX_FORWARDER_SECRET=… node scripts/codex-forwarder.mjs
//   wrangler secret put CODEX_PROXY_SECRET
//
// It only relays an allowlist of headers and streams bodies both ways; nothing
// is stored or logged.

import { createServer } from "node:http"
import { Readable } from "node:stream"

const PORT = Number(process.env.PORT ?? 8789)
const UPSTREAM = "https://chatgpt.com/backend-api/codex"
const SECRET = process.env.CODEX_FORWARDER_SECRET

const FORWARD = ["authorization", "chatgpt-account-id", "originator", "openai-beta", "content-type", "accept"]

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost")
  if (url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" })
    return res.end('{"ok":true}')
  }
  if (SECRET && req.headers["x-forwarder-secret"] !== SECRET) {
    res.writeHead(401, { "content-type": "application/json" })
    return res.end('{"detail":"forwarder secret required"}')
  }
  if (!url.pathname.startsWith("/codex/")) {
    res.writeHead(404, { "content-type": "application/json" })
    return res.end('{"detail":"use /codex/<path>"}')
  }
  const target = `${UPSTREAM}/${url.pathname.slice("/codex/".length)}${url.search}`

  const headers = {}
  for (const h of FORWARD) if (req.headers[h]) headers[h] = req.headers[h]

  let upstream
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : Readable.toWeb(req),
      duplex: "half",
    })
  } catch (err) {
    res.writeHead(502, { "content-type": "application/json" })
    return res.end(JSON.stringify({ detail: `forwarder could not reach upstream: ${err.message}` }))
  }

  res.writeHead(upstream.status, {
    "content-type": upstream.headers.get("content-type") ?? "application/json",
  })
  if (upstream.body) Readable.fromWeb(upstream.body).pipe(res)
  else res.end()
}).listen(PORT, () => console.log(`codex forwarder → ${UPSTREAM} on :${PORT}${SECRET ? " (secret required)" : ""}`))
