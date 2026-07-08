import type { UserRow } from "./lib/db"

export interface Bindings {
  ASSETS: Fetcher
  DB: D1Database
  MEDIA: R2Bucket
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  COOKIE_SECRET: string
  APP_BASE_URL: string
  /** Test/escape hatches for the ChatGPT provider; default to the real hosts. */
  CHATGPT_ISSUER?: string
  CODEX_BASE_URL?: string
}

export interface Variables {
  user: UserRow
}

export type AppEnv = { Bindings: Bindings; Variables: Variables }
