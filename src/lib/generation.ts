import { toast } from "sonner"

import {
  createConversation,
  db,
  nextSeq,
  touchConversation,
  type Conversation,
  type Message,
} from "@/lib/db"
import { streamChatCompletion, type ChatMessage } from "@/lib/openai"
import { activeProfile, getPrefs, type Profile } from "@/lib/profiles"

// Module singleton: survives route changes; Dexie is the source of truth for UI.
const controllers = new Map<string, AbortController>()

export function stopGeneration(msgId: string) {
  controllers.get(msgId)?.abort()
}

export async function stopConversation(convId: string) {
  const streaming = await db.messages
    .where("status")
    .equals("streaming")
    .filter((m) => m.convId === convId)
    .toArray()
  for (const m of streaming) stopGeneration(m.id)
}

function resolveTarget(conv: Conversation | undefined): {
  profile: Profile
  model: string
} {
  const prefs = getPrefs()
  const profile =
    prefs.profiles.find((p) => p.id === conv?.settings?.profileId) ??
    activeProfile(prefs)
  if (!profile) throw new Error("Add an endpoint in Settings first.")
  const model = conv?.settings?.model ?? profile.defaultModel
  if (!model) throw new Error(`Pick a model for “${profile.name}” first.`)
  return { profile, model }
}

async function buildContext(convId: string, uptoSeq: number): Promise<ChatMessage[]> {
  const conv = await db.conversations.get(convId)
  const rows = await db.messages.where("convId").equals(convId).sortBy("seq")
  const context: ChatMessage[] = []

  const systemPrompt = conv?.systemPrompt ?? getPrefs().globalSystemPrompt
  if (systemPrompt?.trim()) context.push({ role: "system", content: systemPrompt })

  for (const m of rows) {
    if (m.seq >= uptoSeq) break
    if (m.role === "user") {
      context.push({ role: "user", content: m.content })
    } else if (m.active && (m.status === "done" || m.status === "stopped") && m.content) {
      context.push({ role: "assistant", content: m.content })
    }
  }
  return context
}

export async function startAssistant(
  convId: string,
  replyTo: string,
  opts: { profile: Profile; model: string; active: boolean }
): Promise<string> {
  const conv = await db.conversations.get(convId)
  const msg: Message = {
    id: crypto.randomUUID(),
    convId,
    seq: await nextSeq(convId),
    role: "assistant",
    content: "",
    model: opts.model,
    profileId: opts.profile.id,
    replyTo,
    active: opts.active,
    status: "streaming",
    createdAt: Date.now(),
  }
  await db.messages.add(msg)
  await touchConversation(convId)

  const context = await buildContext(convId, msg.seq)
  const controller = new AbortController()
  controllers.set(msg.id, controller)

  // Throttled write-through: at most ~10 IDB writes/sec per stream.
  let buf = ""
  let timer: number | undefined
  const flush = () => {
    timer = undefined
    void db.messages.update(msg.id, { content: buf })
  }
  const onDelta = (text: string) => {
    buf += text
    if (timer === undefined) timer = window.setTimeout(flush, 100)
  }

  void (async () => {
    try {
      await streamChatCompletion({
        baseUrl: opts.profile.baseUrl,
        apiKey: opts.profile.apiKey,
        model: opts.model,
        messages: context,
        temperature: conv?.settings?.temperature,
        maxTokens: conv?.settings?.maxTokens,
        signal: controller.signal,
        onDelta,
      })
      window.clearTimeout(timer)
      await db.messages.update(msg.id, { content: buf, status: "done" })
    } catch (err) {
      window.clearTimeout(timer)
      if (controller.signal.aborted) {
        await db.messages.update(msg.id, { content: buf, status: "stopped" })
      } else {
        const message = err instanceof Error ? err.message : String(err)
        await db.messages.update(msg.id, {
          content: buf,
          status: "error",
          error: message,
        })
        toast.error(message)
      }
    } finally {
      controllers.delete(msg.id)
      await touchConversation(convId)
    }
  })()

  return msg.id
}

/** Send a user message; creates the conversation when convId is null. Returns the convId. */
export async function sendMessage(convId: string | null, text: string): Promise<string> {
  let conv = convId ? await db.conversations.get(convId) : undefined
  const target = resolveTarget(conv) // throws before any writes if unconfigured

  if (!conv) {
    conv = await createConversation(text)
  }

  const userMsg: Message = {
    id: crypto.randomUUID(),
    convId: conv.id,
    seq: await nextSeq(conv.id),
    role: "user",
    content: text,
    active: true,
    status: "done",
    createdAt: Date.now(),
  }
  await db.messages.add(userMsg)

  await startAssistant(conv.id, userMsg.id, { ...target, active: true })
  return conv.id
}
