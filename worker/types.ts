import type { UserRow } from "./lib/db"
import type { Room } from "./room"

export interface Bindings {
  ASSETS: Fetcher
  DB: D1Database
  MEDIA: R2Bucket
  ROOM: DurableObjectNamespace<Room>
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  COOKIE_SECRET: string
  APP_BASE_URL: string
  /** Test/escape hatches for the ChatGPT provider; default to the real hosts. */
  CHATGPT_ISSUER?: string
  /** chatgpt.com blocks Worker egress — point this at scripts/codex-forwarder.mjs. */
  CODEX_BASE_URL?: string
  /** Shared secret sent to the forwarder as x-forwarder-secret. */
  CODEX_PROXY_SECRET?: string
}

export interface Variables {
  user: UserRow
}

export type AppEnv = { Bindings: Bindings; Variables: Variables }
