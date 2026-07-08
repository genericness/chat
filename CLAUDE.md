# CLAUDE.md

Guidance for working in this repo. Keep it high-signal — it's loaded every session.

## What this is

**chat** — a bring-your-own-key web client for any OpenAI-compatible `/v1/chat/completions` API. Local-first (IndexedDB), optional GitHub-OAuth chat sync. Deployed to a single Cloudflare Worker at **chat.4x.rip**. Live, public-facing.

Core promise, do not break it: **API keys and chats never leave the browser.** Keys live in `localStorage` only — never synced, never logged, never sent to our server. Model calls go browser→provider directly. The Worker exists only for GitHub OAuth, opt-in sync (D1 + R2), and a few proxies for services that block browser CORS.

## Stack & commands

- Vite 6 + React 19 + TypeScript, Tailwind v4 (CSS-first, no config file), shadcn `base-nova` on `@base-ui/react` (NOT Radix), lucide icons, sonner toasts. Dark-only (`class="dark"` on `<html>`).
- Single CF Worker + Hono serves the SPA (ASSETS binding) and `/api/*` (`run_worker_first`). `@cloudflare/vite-plugin` runs Worker + SPA on one origin in dev.
- Package manager **pnpm**. Three tsconfigs: app / `tsconfig.worker.json` / node.
- `pnpm dev` · `pnpm build` (typechecks app+worker then builds — run before committing) · `pnpm run deploy` (build + `wrangler deploy`) · `pnpm cf-typegen`.
- CF resources: D1 `chat` + R2 `chat-media` (see `wrangler.jsonc`). OAuth needs `GITHUB_CLIENT_SECRET` + `COOKIE_SECRET` via `wrangler secret put`; `GITHUB_CLIENT_ID` is a var.
- **Mobile (Capacitor 8)**: `pnpm run build:app` (bakes `VITE_API_BASE=https://chat.4x.rip`, then `cap sync`); release AAB/APK via `cd android && JAVA_HOME=~/jdk-21 ANDROID_HOME=~/Android/Sdk ./gradlew bundleRelease` (signing keys in gitignored `android/keystore.properties` + `upload-keystore.jks` — back them up). Native detection: `IS_NATIVE`/`apiFetch` in `src/lib/api-base.ts`; native-only code in `src/lib/native.ts` behind literal `import.meta.env.VITE_API_BASE` guards so web bundles stay Capacitor-free. Deep links: `chat4x://` (GitHub + MCP OAuth). **Never enable the CapacitorHttp plugin — it buffers responses and breaks SSE streaming.**

## Git conventions

- **Conventional Commits**, lowercase, imperative (`feat:`, `fix:`, `chore:`, `style:`, `docs:`, `refactor:`).
- **Never add a `Co-Authored-By` trailer or any Claude/Anthropic attribution to commits.** History was rewritten once to strip these — keep it out.
- Commit each logical change separately; deploy after meaningful changes.

## Architecture map

- `src/lib/db.ts` — Dexie schema (`conversations`, `messages`, `attachments`). **Dexie is the single source of truth for chat UI** (`useLiveQuery`). Message model: an `active` flag on assistant messages unifies regenerate / compare / promote. `deletedAt` = sync tombstone.
- `src/lib/generation.ts` — the heart. Module-singleton orchestrator: `sendMessage`, `regenerate`, `editResend`, the tool-call loop (up to `MAX_TOOL_ROUNDS`), AbortController map, **100ms-throttled write-through to Dexie** (never write per-chunk). Accumulates token usage + wall-time into `message.stats`.
- `src/lib/openai.ts` — `streamChatCompletion`: fetch + eventsource-parser SSE loop, non-streaming JSON fallback, tool-call accumulation, usage capture (`stream_options.include_usage`).
- `src/lib/tools.ts` — tool registry/dispatcher. Gathers built-in agent tools + `web_search`/`fetch_url` (Exa) + E2B + MCP; routes execution.
- `src/lib/agent-tools.ts` — built-ins: `create_artifact`/`edit_artifact` (+ `withArtifactRuntime`), `ask_user`.
- `src/lib/e2b.ts` / `e2b-tools.ts` — sandboxes: code execution, `build_artifact` (esbuild in-sandbox), desktop computer use.
- `src/lib/mcp.ts` / `mcp-oauth.ts` — MCP Streamable-HTTP client + full browser OAuth (discovery, DCR, PKCE popup, refresh).
- `src/lib/exa.ts` — `exaSearch` + `exaContents`; `src/lib/profiles.ts` — localStorage prefs + `PRESETS` + `usePrefs`; `src/lib/sync.ts` — opt-in sync loop; `src/lib/panel.ts` — side-panel store.
- `worker/routes/` — `auth` (encrypted-cookie GitHub OAuth), `sync` (D1+R2, LWW, tombstones), `openrouter` (edge-cached slim model metadata), `exa` + `opencode` (CORS proxies).

## Non-obvious constraints (read before touching these areas)

- **CORS matrix.** Most providers are browser-direct. Exceptions proxy through the Worker same-origin: Exa (`/api/exa/*`) and OpenCode Zen (preset baseUrl `/api/opencode/go/v1` → `worker/routes/opencode.ts`). Anthropic needs the `anthropic-dangerous-direct-browser-access` header (added in `openai.ts` when host is `api.anthropic.com`). Google AI Studio prefixes model ids with `models/` — handled in `lookupMeta`. Before adding a provider preset, probe its CORS; if blocked, it needs a proxy (and a UI note that the key transits the worker).
- **Artifact iframe security.** Rendered in a sandbox with `allow-scripts` but deliberately **no `allow-same-origin`** — generated code must never reach our localStorage keys. That makes the doc URL `about:srcdoc` (opaque origin), which breaks `new URL(x, location.href)`; `withArtifactRuntime` injects a shim to fix it. Never add `allow-same-origin`, `rehype-raw`, or `dangerouslySetInnerHTML`.
- **Gemini thought_signature.** Thinking models attach `extra_content.google.thought_signature` to tool calls that MUST be echoed back verbatim or the API 400s. `openai.ts` preserves it opaquely through the tool loop — don't strip it when reconstructing assistant messages.
- **Sync** is opt-in, conversation-granularity, last-write-wins by `updatedAt`, with tombstones + a visibility-aware poll. Never sync attachment blobs over 8MB or keys. Deletes tombstone (kept until the server confirms) so they propagate; list queries filter out `deletedAt`.
- **Streaming survives navigation** because it's Dexie-backed. The boot janitor flips orphaned `streaming` rows to `stopped`.

## Verifying changes

There's no in-repo test suite. Verify runtime behavior by driving the real app: `pnpm dev`, then a headless browser against `http://localhost:5173`. For provider/streaming/tool logic, a small mock OpenAI-compatible SSE server (a scratch Node script) plus scripted Playwright flows is the established pattern — seed `localStorage` `chat:prefs` to point at the mock, exercise the flow, assert on DOM + the mock's captured request bodies. `pnpm build` must pass (it typechecks both app and worker).
