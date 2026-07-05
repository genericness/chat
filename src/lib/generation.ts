import { toast } from "sonner"

import {
  autoTitle,
  createConversation,
  db,
  nextSeq,
  touchConversation,
  type Conversation,
  type Message,
} from "@/lib/db"
import { streamChatCompletion, type ChatMessage, type ContentPart } from "@/lib/openai"
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
  const model =
    conv?.settings?.model ?? prefs.selectedModels?.[0] ?? profile.defaultModel
  if (!model) throw new Error(`Pick a model for “${profile.name}” first.`)
  return { profile, model }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** Images become OpenAI multimodal parts; other files are inlined as fenced text. */
async function userContent(m: Message): Promise<string | ContentPart[]> {
  if (!m.attachmentIds?.length) return m.content
  const atts = (await db.attachments.bulkGet(m.attachmentIds)).filter(
    (a) => a !== undefined
  )
  let text = m.content
  const imageParts: ContentPart[] = []
  for (const a of atts) {
    if (a.mime.startsWith("image/")) {
      imageParts.push({ type: "image_url", image_url: { url: await blobToDataUrl(a.blob) } })
    } else {
      text += `\n\n[Attached file: ${a.name}]\n\`\`\`\n${await a.blob.text()}\n\`\`\``
    }
  }
  if (!imageParts.length) return text
  return [{ type: "text", text }, ...imageParts]
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
      context.push({ role: "user", content: await userContent(m) })
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

/** Demote the current reply and stream a fresh sibling for the same user message. */
export async function regenerate(assistantMsgId: string) {
  const msg = await db.messages.get(assistantMsgId)
  if (!msg || msg.role !== "assistant" || !msg.replyTo) return
  const conv = await db.conversations.get(msg.convId)
  const prefs = getPrefs()
  // Prefer the endpoint/model that produced the original reply; fall back to current target.
  const sameProfile = prefs.profiles.find((p) => p.id === msg.profileId)
  const target = sameProfile && msg.model
    ? { profile: sameProfile, model: msg.model }
    : resolveTarget(conv)
  await db.messages.update(assistantMsgId, { active: false })
  await startAssistant(msg.convId, msg.replyTo, { ...target, active: true })
}

/** Rewrite a user message, drop everything after it, and resend. */
export async function editResend(userMsgId: string, newText: string) {
  const msg = await db.messages.get(userMsgId)
  if (!msg || msg.role !== "user") return
  const conv = await db.conversations.get(msg.convId)
  const target = resolveTarget(conv)

  const after = await db.messages
    .where("convId")
    .equals(msg.convId)
    .filter((m) => m.seq > msg.seq)
    .toArray()
  for (const m of after) stopGeneration(m.id)

  await db.transaction("rw", db.messages, db.attachments, db.conversations, async () => {
    const attachmentIds = after.flatMap((m) => m.attachmentIds ?? [])
    if (attachmentIds.length) await db.attachments.bulkDelete(attachmentIds)
    await db.messages.bulkDelete(after.map((m) => m.id))
    await db.messages.update(userMsgId, { content: newText })
    if (msg.seq === 0) {
      await db.conversations.update(msg.convId, { title: autoTitle(newText) })
    }
  })

  await startAssistant(msg.convId, userMsgId, { ...target, active: true })
}

/** Send a user message; creates the conversation when convId is null. Returns the convId. */
export async function sendMessage(
  convId: string | null,
  text: string,
  files: File[] = []
): Promise<string> {
  let conv = convId ? await db.conversations.get(convId) : undefined
  const target = resolveTarget(conv) // throws before any writes if unconfigured

  if (!conv) {
    conv = await createConversation(text)
  }

  const attachmentIds: string[] = []
  for (const f of files) {
    const id = crypto.randomUUID()
    await db.attachments.add({
      id,
      convId: conv.id,
      name: f.name || "pasted-image.png",
      mime: f.type || "application/octet-stream",
      blob: f,
      createdAt: Date.now(),
    })
    attachmentIds.push(id)
  }

  const userMsg: Message = {
    id: crypto.randomUUID(),
    convId: conv.id,
    seq: await nextSeq(conv.id),
    role: "user",
    content: text,
    attachmentIds: attachmentIds.length ? attachmentIds : undefined,
    active: true,
    status: "done",
    createdAt: Date.now(),
  }
  await db.messages.add(userMsg)

  await startAssistant(conv.id, userMsg.id, { ...target, active: true })
  return conv.id
}
