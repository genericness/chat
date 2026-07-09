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

/** Called once at boot: routes chat4x:// deep links (OAuth callbacks) back into the app. */
export function initNative(opts: { onAuthChanged: () => void }) {
  onAuthChanged = opts.onAuthChanged
  void App.addListener("appUrlOpen", ({ url }) => {
    if (!url.startsWith("chat4x://")) return
    void Browser.close().catch(() => {}) // dismiss the in-app browser tab
    if (url.startsWith("chat4x://auth")) {
      const token = /[#&]token=([^&]+)/.exec(url)?.[1]
      if (token) {
        setAuthToken(token)
        onAuthChanged?.()
      }
    } else if (url.startsWith("chat4x://mcp-oauth")) {
      deepLinkWaiter?.(new URLSearchParams(url.split("?")[1] ?? ""))
      deepLinkWaiter = undefined
    }
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

/** GitHub sign-in via the system browser tab; the worker deep-links the bearer token back. */
export function nativeLogin() {
  void Browser.open({ url: `${API_BASE}/api/auth/login?mobile=1` })
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
