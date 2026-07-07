import { Hono } from "hono"
import type { AppEnv } from "../types"
import { randomToken } from "../lib/crypto"
import { exchangeCode, getUser, revokeToken } from "../lib/github"
import { upsertUser } from "../lib/db"
import {
  setSession,
  clearSession,
  setState,
  getState,
  clearState,
  mintSessionToken,
} from "../lib/cookies"

const auth = new Hono<AppEnv>()

auth.get("/login", (c) => {
  // ?mobile=1 → finish the flow by handing the app a bearer token via its
  // custom scheme. The flag rides in `state`, which GitHub echoes back.
  const mobile = c.req.query("mobile") === "1"
  const state = randomToken(16) + (mobile ? ".mobile" : "")
  setState(c, state)
  const params = new URLSearchParams({
    client_id: c.env.GITHUB_CLIENT_ID,
    redirect_uri: `${c.env.APP_BASE_URL}/api/auth/callback`,
    scope: "read:user",
    state,
  })
  return c.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`)
})

auth.get("/callback", async (c) => {
  const code = c.req.query("code")
  const state = c.req.query("state")
  const expected = getState(c)
  clearState(c)
  if (!code || !state || !expected || state !== expected) {
    return c.redirect("/?auth=error")
  }
  const token = await exchangeCode(
    c.env.GITHUB_CLIENT_ID,
    c.env.GITHUB_CLIENT_SECRET,
    code,
    `${c.env.APP_BASE_URL}/api/auth/callback`
  )
  if (!token) return c.redirect("/?auth=error")

  const gh = await getUser(token)
  await revokeToken(c.env.GITHUB_CLIENT_ID, c.env.GITHUB_CLIENT_SECRET, token)

  const user = await upsertUser(c.env.DB, gh)
  await setSession(c, user.id)
  if (state.endsWith(".mobile")) {
    const token = await mintSessionToken(c, user.id)
    return c.redirect(`chat4x://auth?token=${encodeURIComponent(token)}`)
  }
  return c.redirect("/")
})

auth.post("/logout", (c) => {
  clearSession(c)
  return c.body(null, 204)
})

export default auth
