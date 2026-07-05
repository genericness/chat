# chat

A bring-your-own-key chat client for any OpenAI-compatible `/v1/chat/completions` API. Live at [chat.4x.rip](https://chat.4x.rip).

Your endpoints, API keys, and chats live in your browser. The server is only involved in three optional things: GitHub login, cross-device chat sync, and two small proxies (OpenRouter model metadata, Exa search).

## Features

- **Any OpenAI-compatible endpoint** — presets for OpenRouter, OpenAI, Anthropic, Groq, Together, Mistral, Ollama, and LM Studio, plus multiple saved endpoint profiles (name, base URL, key, default model).
- **Streaming** responses over SSE with a stop button, plus a graceful fallback for servers that don't stream.
- **Markdown** rendering with syntax-highlighted code blocks (copy button), GFM tables, and KaTeX math.
- **Multi-model compare** — pick 2+ models, watch them stream side by side, then promote one response to continue the thread.
- **Attachments** — images sent as multimodal content parts; text files inlined into the prompt.
- **Web search** via [Exa](https://exa.ai) using your own Exa key, with cited sources under the response.
- **Chat ergonomics** — edit + resend, regenerate with version history, rename/delete, `⌘K` search across chats, `⌘⇧O` new chat.
- **System prompts & sampling** — a global default system prompt plus per-conversation overrides for prompt, temperature, max tokens, model, and endpoint.
- **Local-first storage** — everything in IndexedDB; the app fully works with zero login.
- **Optional sync** — sign in with GitHub and opt in to sync chats to D1 (attachments to R2, capped at 8MB each). Last-write-wins per conversation. Endpoints and API keys are **never** synced.

## Privacy model

- Endpoint profiles and API keys are stored in `localStorage` only. They are never sent to this app's server, never synced, never logged.
- Model API calls go directly from your browser to the endpoint you configured.
- The Exa key transits our worker per-request (Exa's API blocks direct browser calls) but is not stored or logged server-side.
- GitHub login is identity-only: the OAuth token is revoked immediately after fetching your profile.

## Architecture

- **Cloudflare Worker + Hono** serves the SPA (via the `ASSETS` binding) and the small API: GitHub OAuth, `/api/sync/*` (D1 + R2), `/api/openrouter/models` (edge-cached slim metadata), `/api/exa/search` (pass-through proxy).
- **Vite + React 19 + TypeScript**, Tailwind v4 (CSS-first config), shadcn/ui (`base-nova` style on Base UI), TanStack Query for server state, Dexie (`useLiveQuery`) as the single source of truth for chats — streams write through to IndexedDB, so generation survives navigation.
- **D1** stores users, conversation metadata, and per-message rows; **R2** stores attachment blobs.

## Local development

1. Create a GitHub OAuth app (only needed for login/sync): callback URL `http://localhost:5173/api/auth/callback`.
2. Copy the env template and fill it in:

   ```sh
   cp .dev.vars.example .dev.vars
   ```

3. Install and run (the Vite dev server runs the SPA and the Worker together on one origin):

   ```sh
   pnpm install
   pnpm exec wrangler d1 migrations apply chat --local
   pnpm dev
   ```

## Environment variables

| Name                   | Kind                        | Purpose                                  |
| ---------------------- | --------------------------- | ---------------------------------------- |
| `GITHUB_CLIENT_ID`     | var (`wrangler.jsonc`)      | GitHub OAuth app client id               |
| `APP_BASE_URL`         | var (`wrangler.jsonc`)      | Origin used in the OAuth callback URL    |
| `GITHUB_CLIENT_SECRET` | secret                      | GitHub OAuth app client secret           |
| `COOKIE_SECRET`        | secret                      | AES key for the encrypted session cookie |

Locally these come from `.dev.vars` (gitignored).

## Deployment

One-time setup:

```sh
pnpm exec wrangler d1 create chat          # put the database_id in wrangler.jsonc
pnpm exec wrangler r2 bucket create chat-media
pnpm exec wrangler d1 migrations apply chat --remote
pnpm exec wrangler secret put GITHUB_CLIENT_SECRET
pnpm exec wrangler secret put COOKIE_SECRET   # e.g. openssl rand -base64 32
```

Then set `GITHUB_CLIENT_ID` in `wrangler.jsonc` (prod OAuth app callback: `https://your-domain/api/auth/callback`) and deploy:

```sh
pnpm run deploy
```

The custom domain is bound via the `routes` block in `wrangler.jsonc`.

## Scripts

- `pnpm dev` — Vite dev server (SPA + Worker, one origin)
- `pnpm build` — typecheck app + worker, then build
- `pnpm preview` — preview the production build
- `pnpm run deploy` — build and `wrangler deploy`
- `pnpm cf-typegen` — generate Worker binding types
