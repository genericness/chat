// Public share links. Publishing a chat is the ONE way chat content leaves
// this browser other than opt-in sync, so it is strictly per-chat and gated
// behind an explicit warning in the UI. The snapshot is text-only: title +
// visible messages (role, content, model). No system prompt, no settings, no
// attachments, no keys (keys never touch messages anyway).
import { apiFetch } from "@/lib/api-base"
import { db } from "@/lib/db"

export interface ShareSnapshot {
  title: string
  messages: { role: string; content: string; model?: string }[]
}

async function buildSnapshot(convId: string): Promise<ShareSnapshot> {
  const conv = await db.conversations.get(convId)
  if (!conv) throw new Error("conversation not found")
  const messages = await db.messages.where("convId").equals(convId).sortBy("seq")
  return {
    title: conv.title,
    messages: messages
      .filter((m) => m.active && m.content)
      .map((m) => ({ role: m.role, content: m.content, model: m.model })),
  }
}

/** Publish (or update) a chat's public snapshot; stores the token locally. */
export async function createShare(convId: string): Promise<string> {
  const snapshot = await buildSnapshot(convId)
  const res = await apiFetch("/api/share", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ convId, snapshot }),
  })
  if (!res.ok) {
    if (res.status === 401) throw new Error("Sign in with GitHub to share a chat")
    if (res.status === 413) throw new Error("This chat is too large to share")
    throw new Error("Could not create share link")
  }
  const { token } = (await res.json()) as { token: string }
  await db.conversations.update(convId, { shareToken: token })
  return token
}

/** Revoke a chat's public link. */
export async function deleteShare(convId: string, token: string): Promise<void> {
  const res = await apiFetch(`/api/share/${token}`, {
    method: "DELETE",
    credentials: "same-origin",
  })
  if (!res.ok && res.status !== 404) throw new Error("Could not revoke share link")
  await db.conversations.update(convId, { shareToken: undefined })
}

export function shareUrl(token: string): string {
  return `${location.origin}/s/${token}`
}

export async function fetchSharedChat(token: string): Promise<ShareSnapshot> {
  const res = await apiFetch(`/api/share/${token}`)
  if (!res.ok) throw new Error("This shared chat was not found or has been revoked")
  const { snapshot } = (await res.json()) as { snapshot: ShareSnapshot }
  return snapshot
}
