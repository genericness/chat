export interface GitHubUser {
  id: number
  login: string
  name: string | null
  avatarUrl: string
}

export async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string
): Promise<string | null> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  })
  const data = (await res.json()) as { access_token?: string }
  return data.access_token ?? null
}

export async function getUser(token: string): Promise<GitHubUser> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "chat.4x.rip",
    },
  })
  if (!res.ok) throw new Error(`github /user failed (${res.status})`)
  const u = (await res.json()) as {
    id: number
    login: string
    name: string | null
    avatar_url: string
  }
  return { id: u.id, login: u.login, name: u.name, avatarUrl: u.avatar_url }
}

/** Identity-only login: the token is revoked as soon as we have the profile. */
export async function revokeToken(
  clientId: string,
  clientSecret: string,
  token: string
): Promise<void> {
  await fetch(`https://api.github.com/applications/${clientId}/token`, {
    method: "DELETE",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "chat.4x.rip",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ access_token: token }),
  }).catch(() => undefined)
}
