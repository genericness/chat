# CLAUDE.md

Guidance for working in this repo. Keep it high-signal — it's loaded every session.

## What this is

**chat** — a bring-your-own-key client for any OpenAI-compatible `/v1/chat/completions` API. Local-first, optional GitHub-OAuth chat sync. Three deliverables in one pnpm workspace:

- **web app** (repo root) — deployed to a single Cloudflare Worker at **chat.4x.rip**. Live, public-facing.
- **`packages/core`** (`@chat/core`) — platform-agnostic chat engine shared by web and mobile: generation loop, SSE streaming, tools, MCP, prefs, sync algorithm. Raw-TS source package, no build step. **No DOM/Dexie/React/UI imports allowed here** — platform specifics enter through `configureCore()` ports (store / prefs / fetch / callbacks).
- **`mobile/`** — Expo (SDK 57) app for iOS + Android. expo-sqlite + Drizzle implements the core store port; SecureStore holds API keys; `expo/fetch` provides streaming. See `mobile/README.md` for the dev/build/release runbook (EAS builds iOS from Linux; no Mac needed).

Core promise, do not break it: **API keys and chats never leave the device.** Keys live in `localStorage` (web) / SecureStore (mobile) only — never synced, never logged, never sent to our server. Model calls go device→provider directly. The Worker exists only for GitHub OAuth, opt-in sync (D1 + R2), and a few proxies for services that block browser CORS.

## Stack & commands

- Web: Vite 6 + React 19 + TypeScript, Tailwind v4 (CSS-first, no config file), shadcn `base-nova` on `@base-ui/react` (NOT Radix), lucide icons, sonner toasts. Dark-only (`class="dark"` on `<html>`).
- Single CF Worker + Hono serves the SPA (ASSETS binding) and `/api/*` (`run_worker_first`). `@cloudflare/vite-plugin` runs Worker + SPA on one origin in dev.
- Package manager **pnpm** (workspace: root + `packages/*` + `mobile`). Tsconfigs: app / `tsconfig.worker.json` / node / `packages/core` / `mobile`.
- `pnpm dev` · `pnpm build` (typechecks app+worker+core then builds — run before committing) · `pnpm run deploy` (build + `wrangler deploy`) · `pnpm cf-typegen`.
- Mobile checks: `cd mobile && npx tsc --noEmit && npx expo export --platform android` (full Metro bundle — run after touching core or mobile).
- CF resources: D1 `chat` + R2 `chat-media` (see `wrangler.jsonc`). OAuth needs `GITHUB_CLIENT_SECRET` + `COOKIE_SECRET` via `wrangler secret put`; `GITHUB_CLIENT_ID` is a var.

## Git conventions

- **Conventional Commits**, lowercase, imperative (`feat:`, `fix:`, `chore:`, `style:`, `docs:`, `refactor:`).
- **Never add a `Co-Authored-By` trailer or any Claude/Anthropic attribution to commits.** History was rewritten once to strip these — keep it out.
- Commit each logical change separately; deploy after meaningful changes.

## Architecture map

**`packages/core/src` (shared engine — platform-free):**

- `config.ts` — `configureCore(ports)` / `ports()` / `store()` / `coreFetch`. The whole platform seam: `store` (CoreStore), `prefs` (string get/set), `fetch`, `onError`, `onMcpAuthRequired`, `onArtifact`, `onConversationStop`, `extraTools` (web bridges E2B here; mobile omits it).
- `store.ts` — the CoreStore port interface. **Contract:** `messages.update` with a key explicitly set to `undefined` CLEARS the field (Dexie semantics; SQLite maps to NULL — never "skip"); writes are FIFO per store; `transaction(fn)` bodies contain only store ops.
- `generation.ts` — the heart. Module-singleton orchestrator: `sendMessage`, `regenerate`, `editResend`, the tool-call loop (up to `MAX_TOOL_ROUNDS`), AbortController map, **100ms-throttled write-through to the store** (never write per-chunk). Accumulates token usage + wall-time into `message.stats`.
- `openai.ts` — `streamChatCompletion`: coreFetch + eventsource-parser SSE loop, non-streaming JSON fallback, tool-call accumulation, usage capture (`stream_options.include_usage`).
- `tools.ts` — tool registry/dispatcher: built-in agent tools + `web_search`/`fetch_url` (Exa) + `extraTools` port + MCP; routes execution.
- `agent-tools.ts` — built-ins: `create_artifact`/`edit_artifact` (+ `withArtifactRuntime`), `ask_user`. `db-types.ts` / `db-helpers.ts` — data model + store-backed helpers (`active` flag unifies regenerate/compare/promote; `deletedAt` = sync tombstone). `sync.ts` — push/pull/manifest algorithm + `applying`/`running` guards (platforms own only the triggers). `profiles.ts` — prefs cache/PRESETS over the prefs port. `mcp.ts`/`mcp-auth.ts` — MCP Streamable-HTTP client + token refresh (interactive OAuth is platform-owned). `exa.ts`, `models.ts`, `endpoint-test.ts`.

**Web (repo root):**

- `src/lib/core-setup.ts` — wires web into core: Dexie-backed CoreStore adapter, localStorage prefs, sonner toasts, artifact panel, E2B extraTools. **Must stay main.tsx's first app import.**
- `src/lib/db.ts` — Dexie schema (**source of truth for chat UI** via `useLiveQuery`; do not change the schema without a migration plan) + re-exports of core types/helpers. `profiles.ts`/`sync.ts`/`hooks/use-models.ts` — thin web shells re-exporting core (`usePrefs`, `initSync` triggers, React Query hooks).
- `src/lib/e2b.ts` / `e2b-tools.ts` — web-only sandboxes: code execution, `build_artifact`, desktop computer use. `src/lib/mcp-oauth.ts` — the popup half of MCP OAuth. `src/lib/panel.ts` — side-panel store.
- `worker/routes/` — `auth` (encrypted-cookie GitHub OAuth + `?mobile=1` variant that redirects to `chat4x://auth?token=…`), `sync` (D1+R2, LWW, tombstones), `openrouter` (edge-cached slim model metadata), `exa` + `opencode` (CORS proxies). `worker/lib/cookies.ts` — `getSessionUserId` accepts the session cookie **or** an `Authorization: Bearer` mobile token (same encrypted payload + `exp`).

**Mobile (`mobile/src`):**

- `lib/setup.ts` — `initCore()`: polyfills (`crypto.randomUUID`), configureCore wiring, sync triggers (sqlite change listener + AppState). `lib/store.ts` — Drizzle/expo-sqlite CoreStore adapter (honors the undefined-clears contract). `lib/prefs.ts` — SecureStore (keys) + AsyncStorage (rest) behind the string prefs port. `lib/fetch.ts` — `expo/fetch` + origin prefix + bearer header. `lib/auth.ts`/`lib/mcp-oauth.ts` — openAuthSessionAsync flows. `app/` — expo-router screens (chats list / `c/[id]` / settings / `artifact/[convId]/[artifactId]` WebView).

## Non-obvious constraints (read before touching these areas)

- **Core is platform-free by construction.** `packages/core/package.json` deliberately depends only on `eventsource-parser` — adding dexie/react/sonner/expo there breaks the mobile app or the web app. New platform needs go through a `configureCore` port, not an import.
- **CORS matrix (web only — native has no CORS).** Most providers are browser-direct. Exceptions proxy through the Worker same-origin: Exa (`/api/exa/*`) and OpenCode Zen (preset baseUrl `/api/opencode/go/v1` → `worker/routes/opencode.ts`). Anthropic needs the `anthropic-dangerous-direct-browser-access` header (added in core `openai.ts` when host is `api.anthropic.com`). Google AI Studio prefixes model ids with `models/` — handled in `lookupMeta`. Before adding a provider preset, probe its CORS; if blocked, it needs a proxy (and a UI note that the key transits the worker).
- **Artifact sandbox security.** Web: iframe with `allow-scripts` but deliberately **no `allow-same-origin`** — generated code must never reach our localStorage keys. That makes the doc URL `about:srcdoc` (opaque origin), which breaks `new URL(x, location.href)`; `withArtifactRuntime` injects a shim to fix it. Never add `allow-same-origin`, `rehype-raw`, or `dangerouslySetInnerHTML`. Mobile: WebView with no injected bridge/onMessage — keep it that way.
- **Gemini thought_signature.** Thinking models attach `extra_content.google.thought_signature` to tool calls that MUST be echoed back verbatim or the API 400s. Core `openai.ts` preserves it opaquely through the tool loop — don't strip it when reconstructing assistant messages.
- **Sync** is opt-in, conversation-granularity, last-write-wins by `updatedAt`, with tombstones + a visibility-aware poll. Never sync attachment blobs over 8MB or keys. Deletes tombstone (kept until the server confirms) so they propagate; list queries filter out `deletedAt`. Mobile authenticates with a bearer token (same encrypted payload as the cookie + `exp`) minted by the `?mobile=1` OAuth flow.
- **Streaming survives navigation** because it's store-backed (Dexie / SQLite). The boot janitor flips orphaned `streaming` rows to `stopped`.

## Verifying changes

There's no in-repo test suite. Verify runtime behavior by driving the real app: `pnpm dev`, then a headless browser against `http://localhost:5173`. For provider/streaming/tool logic, a small mock OpenAI-compatible SSE server (a scratch Node script) plus scripted Playwright flows is the established pattern — seed `localStorage` `chat:prefs` to point at the mock, exercise the flow, assert on DOM + the mock's captured request bodies (this also exercises `@chat/core`, since web runs on it). `pnpm build` must pass (it typechecks app, worker, and core). For mobile: `cd mobile && npx tsc --noEmit && npx expo export --platform android` catches type/resolution/babel breakage without a device; real device behavior needs an EAS dev build.
