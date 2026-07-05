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
import { fetchOpenRouterMeta, lookupMeta } from "@/hooks/use-models"
import { exaSearch, searchContextBlock } from "@/lib/exa"
import {
  ApiError,
  streamChatCompletion,
  type ChatMessage,
  type CompletionResult,
  type ContentPart,
  type ToolDef,
} from "@/lib/openai"
import { activeProfile, getPrefs, type Profile } from "@/lib/profiles"
import { gatherTools } from "@/lib/tools"

// Module singleton: survives route changes; Dexie is the source of truth for UI.
const controllers = new Map<string, AbortController>()

// Artifacts easily exceed 8K output tokens; models that reject a high cap get
// one bare retry (see requestRound), so err on the generous side.
const DEFAULT_MAX_TOKENS = 32768
// Generous: agentic builds chain ask → create → edit → edit → … before answering.
const MAX_TOOL_ROUNDS = 12

function isValidJson(s: string): boolean {
  try {
    JSON.parse(s || "{}")
    return true
  } catch {
    return false
  }
}

function lastUserText(transcript: ChatMessage[]): string {
  for (let i = transcript.length - 1; i >= 0; i--) {
    const m = transcript[i]
    if (m.role === "user") {
      if (typeof m.content === "string") return m.content
      return m.content.find((p): p is ContentPart & { type: "text" } => p.type === "text")?.text ?? ""
    }
  }
  return ""
}

function injectSearchResults(
  transcript: ChatMessage[],
  results: NonNullable<Message["searchResults"]>
) {
  for (let i = transcript.length - 1; i >= 0; i--) {
    const m = transcript[i]
    if (m.role !== "user") continue
    const block = searchContextBlock(results)
    if (typeof m.content === "string") m.content += block
    else {
      const textPart = m.content.find((p): p is ContentPart & { type: "text" } => p.type === "text")
      if (textPart) textPart.text += block
      else m.content.unshift({ type: "text", text: block })
    }
    return
  }
}

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
  models: string[]
} {
  const prefs = getPrefs()
  const profile =
    prefs.profiles.find((p) => p.id === conv?.settings?.profileId) ??
    activeProfile(prefs)
  if (!profile) throw new Error("Add an endpoint in Settings first.")
  // A per-conversation override pins a single model; otherwise the picker
  // selection applies, and 2+ picked models means compare mode.
  const models = conv?.settings?.model
    ? [conv.settings.model]
    : [...new Set(prefs.selectedModels ?? [])]
  if (!models.length && profile.defaultModel) models.push(profile.defaultModel)
  if (!models.length) throw new Error(`Pick a model for “${profile.name}” first.`)
  return { profile, model: models[0], models }
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
  let text = m.content
  // Search results captured at send time replay deterministically on regen/edit.
  if (m.searchResults?.length) text += searchContextBlock(m.searchResults)
  if (!m.attachmentIds?.length) return text
  const atts = (await db.attachments.bulkGet(m.attachmentIds)).filter(
    (a) => a !== undefined
  )
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
  opts: { profile: Profile; model: string; active: boolean; webSearch?: boolean }
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
  let roundBuf = ""
  let reasonBuf = ""
  let timer: number | undefined
  // Executed/settled calls live in `journal`; calls whose arguments are still
  // streaming show up in `liveJournal` so the UI has progress before a round ends.
  const journal: NonNullable<Message["toolCalls"]> = []
  let liveJournal: NonNullable<Message["toolCalls"]> = []
  const patch = () => ({
    content: buf,
    reasoning: reasonBuf || undefined,
    toolCalls: journal.length || liveJournal.length ? [...journal, ...liveJournal] : undefined,
  })
  const flush = () => {
    timer = undefined
    void db.messages.update(msg.id, patch())
  }
  const schedule = () => {
    if (timer === undefined) timer = window.setTimeout(flush, 100)
  }
  const onDelta = (text: string) => {
    if (!roundBuf && buf) buf += "\n\n" // visual break between tool rounds
    roundBuf += text
    buf += text
    schedule()
  }
  const onReasoning = (text: string) => {
    reasonBuf += text
    schedule()
  }
  const onToolCallDelta = (calls: import("@/lib/openai").ToolCall[]) => {
    liveJournal = calls.map((c, i) => ({
      id: c.id || `live_${i}`,
      name: c.function.name,
      args: c.function.arguments,
      status: "streaming" as const,
    }))
    schedule()
  }

  const userMax = conv?.settings?.maxTokens
  const requestRound = async (
    transcript: ChatMessage[],
    tools: ToolDef[]
  ): Promise<CompletionResult> => {
    const doRequest = (maxTokens?: number) =>
      streamChatCompletion({
        baseUrl: opts.profile.baseUrl,
        apiKey: opts.profile.apiKey,
        model: opts.model,
        messages: transcript,
        tools: tools.length ? tools : undefined,
        temperature: conv?.settings?.temperature,
        maxTokens,
        signal: controller.signal,
        onDelta,
        onReasoning,
        onToolCallDelta,
      })
    try {
      // Without a generous default, some providers cap output low (Anthropic
      // compat, Ollama) and cut responses off mid-sentence.
      return await doRequest(userMax ?? DEFAULT_MAX_TOKENS)
    } catch (err) {
      // Models that reject the param (over their cap, or want
      // max_completion_tokens) get one bare retry — only if we defaulted it.
      const rejected =
        err instanceof ApiError &&
        err.status === 400 &&
        /max_?(completion_)?tokens/i.test(err.message)
      if (userMax === undefined && rejected && !controller.signal.aborted) {
        return doRequest(undefined)
      }
      throw err
    }
  }

  void (async () => {
    try {
      const meta = lookupMeta(
        await fetchOpenRouterMeta().catch(() => undefined),
        opts.model
      )
      const toolsAllowed = meta?.supportsTools !== false
      const gathered = toolsAllowed
        ? await gatherTools({ webSearch: !!opts.webSearch, convId, msgId: msg.id })
        : { defs: [], execute: async () => "", sources: [] as NonNullable<Message["searchResults"]> }

      // Metadata says no tools but search was requested → classic inject mode.
      if (!toolsAllowed && opts.webSearch) {
        const results = await exaSearch(lastUserText(context))
        injectSearchResults(context, results)
        gathered.sources.push(...results)
      }

      const transcript: ChatMessage[] = [...context]
      let tools = gathered.defs

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        roundBuf = ""
        if (round === MAX_TOOL_ROUNDS - 1) tools = [] // force a final text answer
        let result: CompletionResult
        try {
          result = await requestRound(transcript, tools)
        } catch (err) {
          const toolsRejected =
            tools.length > 0 &&
            err instanceof ApiError &&
            err.status === 400 &&
            /tool/i.test(err.message)
          if (!toolsRejected || controller.signal.aborted) throw err
          // Endpoint rejected the tools param: degrade gracefully — inject the
          // search results the tool would have fetched, then retry bare.
          tools = []
          if (opts.webSearch) {
            const results = await exaSearch(lastUserText(transcript))
            injectSearchResults(transcript, results)
            gathered.sources.push(...results)
          }
          result = await requestRound(transcript, [])
        }
        liveJournal = [] // round settled — real entries replace the streaming ones
        if (!result.toolCalls.length) {
          if (result.finishReason === "length") {
            buf += "\n\n*(response was cut off by the max tokens limit)*"
          }
          break
        }

        for (const tc of result.toolCalls) {
          journal.push({
            id: tc.id,
            name: tc.function.name,
            args: tc.function.arguments,
            status: "running",
          })
        }
        await db.messages.update(msg.id, { toolCalls: [...journal] })
        // Truncated/malformed argument JSON must never go back to the provider —
        // Anthropic and others 400 on it. Sanitize in the transcript, then report
        // the failure to the model via the tool result so it can retry smaller.
        transcript.push({
          role: "assistant",
          content: roundBuf || null,
          tool_calls: result.toolCalls.map((tc) =>
            isValidJson(tc.function.arguments)
              ? tc
              : { ...tc, function: { ...tc.function, arguments: "{}" } }
          ),
        })

        for (const tc of result.toolCalls) {
          const entry = journal.find((j) => j.id === tc.id && j.status === "running")
          let output: string
          if (!isValidJson(tc.function.arguments)) {
            output =
              result.finishReason === "length"
                ? `Error: the ${tc.function.name} call was cut off by the output token limit before its arguments were complete. Produce a more compact version (the user can also raise max tokens in chat settings), then call the tool again.`
                : `Error: the ${tc.function.name} arguments were not valid JSON. Call the tool again with corrected arguments.`
            if (entry) entry.status = "error"
          } else {
            try {
              output = await gathered.execute(
                tc.function.name,
                tc.function.arguments,
                controller.signal,
                tc.id
              )
              if (entry) entry.status = "done"
            } catch (err) {
              if (controller.signal.aborted) throw err
              output = `Error: ${err instanceof Error ? err.message : String(err)}`
              if (entry) entry.status = "error"
            }
          }
          transcript.push({ role: "tool", tool_call_id: tc.id, content: output })
          await db.messages.update(msg.id, { toolCalls: [...journal] })
        }
      }

      window.clearTimeout(timer)
      await db.messages.update(msg.id, {
        ...patch(),
        status: "done",
        ...(gathered.sources.length && { searchResults: gathered.sources }),
      })
    } catch (err) {
      window.clearTimeout(timer)
      liveJournal = [] // drop never-executed streaming entries from the final state
      if (controller.signal.aborted) {
        await db.messages.update(msg.id, {
          ...patch(),
          status: "stopped",
          pendingQuestion: undefined,
        })
      } else {
        const message = err instanceof Error ? err.message : String(err)
        await db.messages.update(msg.id, {
          ...patch(),
          status: "error",
          error: message,
          pendingQuestion: undefined,
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
  // Re-offer web search if the original reply used it as a tool (inject mode
  // replays automatically via the user message's stored results).
  const userMsg = await db.messages.get(msg.replyTo)
  const webSearch =
    !userMsg?.searchResults?.length &&
    (!!msg.searchResults?.length ||
      (msg.toolCalls ?? []).some((t) => t.name === "web_search"))
  await db.messages.update(assistantMsgId, { active: false })
  await startAssistant(msg.convId, msg.replyTo, { ...target, active: true, webSearch })
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
  files: File[] = [],
  opts: { webSearch?: boolean } = {}
): Promise<string> {
  let conv = convId ? await db.conversations.get(convId) : undefined
  const target = resolveTarget(conv) // throws before any writes if unconfigured

  // Tool mode: models that support tool calling get a web_search tool and
  // decide when to use it. If any target model is known not to support tools,
  // search up front and inject the results for everyone (shared context).
  let searchResults: Message["searchResults"]
  let toolWebSearch = false
  if (opts.webSearch) {
    if (!getPrefs().exaKey) {
      throw new Error("Add your Exa API key in Settings to use web search.")
    }
    const metaMap = await fetchOpenRouterMeta().catch(() => undefined)
    const anyWithoutTools = target.models.some(
      (m) => lookupMeta(metaMap, m)?.supportsTools === false
    )
    if (anyWithoutTools) searchResults = await exaSearch(text)
    else toolWebSearch = true
  }

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
    searchResults: searchResults?.length ? searchResults : undefined,
    active: true,
    status: "done",
    createdAt: Date.now(),
  }
  await db.messages.add(userMsg)

  if (target.models.length > 1) {
    // Compare: all candidates start inactive; the user promotes one to continue.
    for (const model of target.models) {
      await startAssistant(conv.id, userMsg.id, {
        profile: target.profile,
        model,
        active: false,
        webSearch: toolWebSearch,
      })
    }
  } else {
    await startAssistant(conv.id, userMsg.id, {
      ...target,
      active: true,
      webSearch: toolWebSearch,
    })
  }
  return conv.id
}
