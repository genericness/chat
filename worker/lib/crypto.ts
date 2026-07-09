const encoder = new TextEncoder()
const decoder = new TextDecoder()
let derived: { secret: string; key: Promise<CryptoKey> } | undefined

function deriveKey(secret: string): Promise<CryptoKey> {
  if (derived?.secret === secret) return derived.key
  const key = crypto.subtle
    .digest("SHA-256", encoder.encode(secret))
    .then((hash) =>
      crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"])
    )
  derived = { secret, key }
  return key
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function encryptToken(secret: string, plaintext: string): Promise<string> {
  const key = await deriveKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plaintext))
  )
  const out = new Uint8Array(iv.length + ciphertext.length)
  out.set(iv, 0)
  out.set(ciphertext, iv.length)
  return toBase64Url(out)
}

export async function decryptToken(secret: string, value: string): Promise<string | null> {
  try {
    const key = await deriveKey(secret)
    const data = fromBase64Url(value)
    const iv = data.slice(0, 12)
    const ciphertext = data.slice(12)
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext)
    return decoder.decode(plaintext)
  } catch {
    return null
  }
}

export function randomToken(bytes: number): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function sha256Base64Url(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(value))
  return toBase64Url(new Uint8Array(hash))
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
