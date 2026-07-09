import { Hono } from "hono"
import type { AppEnv } from "../types"
import { randomToken, encryptToken } from "../lib/crypto"
import { exchangeCode, getUser, revokeToken } from "../lib/github"
import { upsertUser } from "../lib/db"
import { setSession, clearSession, setState, getState, clearState } from "../lib/cookies"

const auth = new Hono<AppEnv>()

auth.get("/login", (c) => {
  // ".m" marks a native-app login: the callback returns a bearer token via
  // deep link instead of setting a cookie.
  const state = randomToken(16) + (c.req.query("mobile") ? ".m" : "")
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
  const mobile = state.endsWith(".m")
  const fail = () => c.redirect(mobile ? "chat4x://auth#error=1" : "/?auth=error")
  const token = await exchangeCode(
    c.env.GITHUB_CLIENT_ID,
    c.env.GITHUB_CLIENT_SECRET,
    code,
    `${c.env.APP_BASE_URL}/api/auth/callback`
  )
  if (!token) return fail()

  const gh = await getUser(token)
  await revokeToken(c.env.GITHUB_CLIENT_ID, c.env.GITHUB_CLIENT_SECRET, token)

  const user = await upsertUser(c.env.DB, gh)
  if (mobile) {
    const exp = Date.now() + 30 * 24 * 60 * 60 * 1000
    const session = await encryptToken(c.env.COOKIE_SECRET, JSON.stringify({ uid: user.id, exp }))
    return c.redirect(`chat4x://auth#token=${session}`)
  }
  await setSession(c, user.id)
  return c.redirect("/")
})

auth.post("/logout", (c) => {
  clearSession(c)
  return c.body(null, 204)
})

export default auth
