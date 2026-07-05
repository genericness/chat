import type { UserRow } from "./lib/db"

export interface Bindings {
  ASSETS: Fetcher
  DB: D1Database
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  COOKIE_SECRET: string
  APP_BASE_URL: string
}

export interface Variables {
  user: UserRow
}

export type AppEnv = { Bindings: Bindings; Variables: Variables }
