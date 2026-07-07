import { store } from "./config"
import type { Conversation } from "./db-types"
import { getPrefs } from "./profiles"

export function autoTitle(text: string): string {
  const line = text.trim().split("\n")[0]
  return line.length > 60 ? `${line.slice(0, 60)}…` : line || "New chat"
}

export async function createConversation(firstText: string): Promise<Conversation> {
  const now = Date.now()
  const conv: Conversation = {
    id: crypto.randomUUID(),
    title: autoTitle(firstText),
    createdAt: now,
    updatedAt: now,
  }
  await store().conversations.put(conv)
  return conv
}

export async function touchConversation(id: string) {
  await store().conversations.update(id, { updatedAt: Date.now() })
}

export async function renameConversation(id: string, title: string) {
  await store().conversations.update(id, { title, updatedAt: Date.now() })
}

export async function deleteConversation(id: string) {
  // With sync on, keep a tombstone row so the delete propagates; the sync
  // loop purges it after telling the server.
  await store().transaction(async (s) => {
    await s.messages.deleteByConv(id)
    await s.attachments.deleteByConv(id)
    if (getPrefs().syncEnabled) {
      await s.conversations.update(id, { deletedAt: Date.now(), updatedAt: Date.now() })
    } else {
      await s.conversations.delete(id)
    }
  })
}

/** Delete every conversation (tombstoning each when sync is on so it propagates). */
export async function deleteAllConversations() {
  const convs = (await store().conversations.all()).filter((c) => !c.deletedAt)
  for (const c of convs) await deleteConversation(c.id)
  return convs.length
}

export async function nextSeq(convId: string): Promise<number> {
  return ((await store().messages.lastSeq(convId)) ?? -1) + 1
}

/** Make one reply the active branch among all siblings answering the same user message. */
export async function promoteReply(msgId: string) {
  const msg = await store().messages.get(msgId)
  if (!msg?.replyTo) return
  await store().transaction(async (s) => {
    for (const sib of await s.messages.byReplyTo(msg.replyTo!)) {
      if (sib.active) await s.messages.update(sib.id, { active: false })
    }
    await s.messages.update(msgId, { active: true })
  })
}

/** Recover messages stranded in "streaming" by a closed tab. Run once on boot. */
export async function runJanitor() {
  for (const m of await store().messages.streaming()) {
    await store().messages.update(m.id, { status: "stopped" })
  }
}
