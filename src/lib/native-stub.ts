/**
 * Web-build replacement for Capacitor entry points. Vite aliases native-only
 * dynamic imports here so their SDK chunks are not published with the website.
 */

const unavailable = () => Promise.reject(new Error("Native API unavailable in the web build."))

export function initNative() {}
export const nativeLogin = unavailable
export const shareFile = unavailable
export const waitForMcpCallback = unavailable

export const Browser = {
  open: unavailable,
  close: () => Promise.resolve(),
}

export const ImpactStyle = { Light: "LIGHT", Medium: "MEDIUM" } as const
export const Haptics = {
  impact: () => Promise.resolve(),
  selectionStart: () => Promise.resolve(),
  selectionChanged: () => Promise.resolve(),
  selectionEnd: () => Promise.resolve(),
}
