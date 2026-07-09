// Native-only (Capacitor) glue. Never imported statically: main.tsx and the
// login button load it behind an IS_NATIVE guard, so web bundles never fetch
// the @capacitor chunks.
import { App } from "@capacitor/app"
import { Browser } from "@capacitor/browser"
import { Capacitor } from "@capacitor/core"

import { API_BASE, setAuthToken } from "@/lib/api-base"
import { handleBack } from "@/lib/back-stack"

let onAuthChanged: (() => void) | undefined
let deepLinkWaiter: ((params: URLSearchParams) => void) | undefined
const PENDING_AUTH_KEY = "chat:pending-native-auth"

interface PendingNativeAuth {
  state: string
  verifier: string
  expiresAt: number
}

function b64url(bytes: Uint8Array): string {
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function loadPendingAuth(): PendingNativeAuth | undefined {
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_AUTH_KEY) ?? "") as PendingNativeAuth
    if (
      typeof pending.state === "string" &&
      typeof pending.verifier === "string" &&
      typeof pending.expiresAt === "number" &&
      pending.expiresAt > Date.now()
    ) {
      return pending
    }
  } catch {
    // Missing or stale pending login.
  }
  localStorage.removeItem(PENDING_AUTH_KEY)
  return undefined
}

async function handleAppUrl(url: string) {
  if (!url.startsWith("chat4x://")) return
  if (url.startsWith("chat4x://auth")) {
    const pending = loadPendingAuth()
    if (!pending) return // Never accept an unsolicited session callback.
    const params = new URL(url).searchParams
    if (params.get("state") !== pending.state) return
    await Browser.close().catch(() => {})
    if (params.get("error")) {
      localStorage.removeItem(PENDING_AUTH_KEY)
      return
    }
    const code = params.get("code")
    if (!code) return
    const res = await fetch(`${API_BASE}/api/auth/mobile/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, code_verifier: pending.verifier }),
    })
    if (!res.ok) return
    const body = (await res.json()) as { token?: string }
    if (!body.token) return
    localStorage.removeItem(PENDING_AUTH_KEY)
    setAuthToken(body.token)
    onAuthChanged?.()
    return
  }
  if (url.startsWith("chat4x://mcp-oauth") && deepLinkWaiter) {
    await Browser.close().catch(() => {})
    deepLinkWaiter(new URLSearchParams(url.split("?")[1] ?? ""))
    deepLinkWaiter = undefined
  }
}

/** Called once at boot: routes chat4x:// deep links (OAuth callbacks) back into the app. */
export function initNative(opts: { onAuthChanged: () => void }) {
  onAuthChanged = opts.onAuthChanged
  void App.addListener("appUrlOpen", ({ url }) => {
    void handleAppUrl(url).catch(() => undefined)
  })
  // Android hardware back: close the top-most overlay first, then history,
  // then hand the app to the launcher.
  void App.addListener("backButton", ({ canGoBack }) => {
    if (handleBack()) return
    if (canGoBack) history.back()
    else void App.minimizeApp()
  })

  // iOS keyboard glide: the WebView doesn't resize (Keyboard.resize = none);
  // instead --kb drives an animated padding on keyboard-aware surfaces (see
  // index.css). keyboardWillShow reports the final height before the keyboard
  // animates, so the CSS transition runs alongside it. The synthetic resize
  // events re-run stick-to-bottom logic mid- and post-glide.
  if (Capacitor.getPlatform() === "ios") {
    const setKb = (px: number) => {
      document.documentElement.style.setProperty("--kb", `${px}px`)
      window.dispatchEvent(new Event("resize"))
      window.setTimeout(() => window.dispatchEvent(new Event("resize")), 280)
    }
    void import("@capacitor/keyboard").then(({ Keyboard }) => {
      void Keyboard.addListener("keyboardWillShow", (i) => setKb(i.keyboardHeight))
      void Keyboard.addListener("keyboardWillHide", () => setKb(0))
    })
  }
}

/** GitHub sign-in via the system browser; the callback carries a one-time PKCE-bound code. */
export async function nativeLogin() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  const state = b64url(crypto.getRandomValues(new Uint8Array(32)))
  localStorage.setItem(
    PENDING_AUTH_KEY,
    JSON.stringify({ state, verifier, expiresAt: Date.now() + 10 * 60_000 } satisfies PendingNativeAuth)
  )
  const login = new URL(`${API_BASE}/api/auth/login`)
  login.searchParams.set("mobile", "1")
  login.searchParams.set("app_state", state)
  login.searchParams.set("code_challenge", b64url(new Uint8Array(digest)))
  try {
    await Browser.open({ url: login.toString() })
  } catch (error) {
    localStorage.removeItem(PENDING_AUTH_KEY)
    throw error
  }
}

/** Blob URLs can't open or download inside a WebView — write to cache and share instead. */
export async function shareFile(name: string, data: string) {
  const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ])
  const { uri } = await Filesystem.writeFile({
    path: name,
    data,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  })
  await Share.share({ files: [uri] })
}

/** Await the next chat4x://mcp-oauth deep link (MCP OAuth callback relay). */
export function waitForMcpCallback(timeoutMs = 300_000): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      deepLinkWaiter = undefined
      reject(new Error("Authorization timed out."))
    }, timeoutMs)
    deepLinkWaiter = (params) => {
      clearTimeout(timer)
      resolve(params)
    }
  })
}
