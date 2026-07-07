# chat — mobile

Expo app for [chat.4x.rip](https://chat.4x.rip). All chat/streaming/tool logic
comes from `@chat/core` (see `packages/core`); this package is the mobile
platform shell: SQLite storage, SecureStore keys, expo-router UI.

## Dev loop (no Mac required)

```sh
pnpm install                       # from the repo root
cd mobile
npx expo start                     # Metro dev server
```

First time on a physical phone you need a **development build** (Expo Go can't
load the expo-sqlite/secure-store config plugins):

```sh
npx eas login                      # once
npx eas build --profile development --platform android   # or ios
# install the resulting build on the phone, then `npx expo start` and scan
```

iOS builds compile on EAS's cloud Macs — Linux/Windows work fine.

## Sanity checks that run without a device

```sh
npx tsc --noEmit                   # typecheck
npx expo export --platform android # full Metro bundle (catches resolution/babel issues)
```

## Store release

```sh
npx eas build -p all --profile production
npx eas submit -p ios              # App Store Connect (needs Apple Developer Program)
npx eas submit -p android          # Play Console (first upload is manual via web UI)
```

Checklist before first submission:
- Replace template icons/splash in `assets/images/` (still Expo defaults).
- App Store review notes: BYOK app — reviewers need a demo API key (use a
  low-limit OpenRouter key) and a line explaining keys never leave the device.
- Add `"usesNonExemptEncryption": false` under `ios.infoPlist.ITSAppUsesNonExemptEncryption`
  equivalents in app.json (HTTPS only) to skip the export-compliance questionnaire.
- Play data safety: keys stored on-device; opt-in sync stores chat content in
  the app's backend (D1/R2).

## Platform notes

- Provider calls have no CORS on native; the worker proxies are still used for
  Exa and OpenCode (same `/api/*` routes, prefixed with the app origin in
  `src/lib/fetch.ts`, which also attaches the session bearer token).
- Auth: `chat4x://auth` custom-scheme redirect carries the bearer token; it's
  the same encrypted payload as the web session cookie, plus an `exp`.
- E2B sandboxes/computer-use are web-only for now (`extraTools` port left
  unset in `src/lib/setup.ts`).
- Prefs secrets (API keys) live in SecureStore, one entry per key; the rest of
  the prefs JSON is in AsyncStorage (`src/lib/prefs.ts`). MCP OAuth tokens
  currently ride in the AsyncStorage half.
