import { createParser } from "eventsource-parser"

// Chat-completions ⇄ Codex Responses translation.
//
// The ChatGPT-backed Codex API (chatgpt.com/backend-api/codex) only speaks the
// Responses protocol and runs stateless (store: false): encrypted reasoning
// items must be requested via `include` and echoed back alongside their
// function calls on the next round, or the backend rejects the request. The
// app speaks chat-completions, so the echo rides the same opaque rail the
// client already preserves for Gemini's thought_signature: the full output
// item list is stashed in tool_calls[0].extra_content.chatgpt.items and
// replayed verbatim when the transcript comes back.

interface ChatContentPart {
  type: string
  text?: string
  image_url?: { url?: string }
}

interface ChatToolCall {
  id?: string
  function?: { name?: string; arguments?: string }
  extra_content?: { chatgpt?: { items?: unknown[] } }
}

interface ChatMessage {
  role: string
  content: string | ChatContentPart[] | null
  tool_calls?: ChatToolCall[]
  tool_call_id?: string
}

export interface ChatCompletionsBody {
  model: string
  messages: ChatMessage[]
  tools?: { type?: string; function?: { name?: string; description?: string; parameters?: unknown } }[]
  tool_choice?: { type?: string; function?: { name?: string } }
}

const DEFAULT_INSTRUCTIONS =
  "You are a helpful assistant powered by the user's ChatGPT account. Answer the user's request directly and helpfully."

const EFFORTS = new Set(["none", "low", "medium", "high", "xhigh"])

/** "gpt-5.5:high" → the base slug plus a reasoning-effort override. */
export function splitModelEffort(model: string): { model: string; effort?: string } {
  const i = model.lastIndexOf(":")
  if (i > 0 && EFFORTS.has(model.slice(i + 1))) {
    return { model: model.slice(0, i), effort: model.slice(i + 1) }
  }
  return { model }
}

function textOf(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content
  if (!content) return ""
  return content
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n")
}

function userParts(content: ChatMessage["content"]): unknown[] {
  if (typeof content === "string" || !content) {
    return [{ type: "input_text", text: content ?? "" }]
  }
  const parts: unknown[] = []
  for (const p of content) {
    if (p.type === "text") parts.push({ type: "input_text", text: p.text ?? "" })
    else if (p.type === "image_url" && p.image_url?.url) {
      parts.push({ type: "input_image", detail: "auto", image_url: p.image_url.url })
    }
  }
  return parts
}

/** The stateless backend rejects server-side item ids — strip before replay. */
function stripId(item: unknown): unknown {
  if (item && typeof item === "object" && !Array.isArray(item) && "id" in item) {
    const { id: _id, ...rest } = item as Record<string, unknown>
    return rest
  }
  return item
}

export function chatToResponses(body: ChatCompletionsBody): Record<string, unknown> {
  const { model, effort } = splitModelEffort(body.model)
  const systems: string[] = []
  const input: unknown[] = []

  for (const m of body.messages ?? []) {
    if (m.role === "system") {
      const t = textOf(m.content)
      if (t) systems.push(t)
    } else if (m.role === "user") {
      input.push({ type: "message", role: "user", content: userParts(m.content) })
    } else if (m.role === "assistant") {
      // A prior Codex round: replay its raw output items (reasoning included).
      const echoed = m.tool_calls?.[0]?.extra_content?.chatgpt?.items
      if (Array.isArray(echoed) && echoed.length) {
        for (const item of echoed) input.push(stripId(item))
        continue
      }
      const text = textOf(m.content)
      if (text) {
        input.push({ type: "message", role: "assistant", content: [{ type: "output_text", text }] })
      }
      for (const tc of m.tool_calls ?? []) {
        input.push({
          type: "function_call",
          call_id: tc.id ?? "",
          name: tc.function?.name ?? "",
          arguments: tc.function?.arguments ?? "{}",
        })
      }
    } else if (m.role === "tool") {
      input.push({ type: "function_call_output", call_id: m.tool_call_id ?? "", output: textOf(m.content) })
    }
  }

  const out: Record<string, unknown> = {
    model,
    instructions: systems.length ? systems.join("\n\n") : DEFAULT_INSTRUCTIONS,
    input,
    stream: true,
    // Stateless operation is required; reasoning must be configured and its
    // encrypted content requested, or the stream produces no assistant text.
    store: false,
    reasoning: { effort: effort ?? "medium", summary: "auto" },
    text: { verbosity: "medium" },
    include: ["reasoning.encrypted_content"],
    // temperature / max_tokens intentionally dropped: the backend rejects
    // output-token caps outright and reasoning models reject temperature.
  }

  const tools = (body.tools ?? [])
    .filter((t) => t.type === "function" && t.function?.name)
    .map((t) => ({
      type: "function",
      name: t.function!.name,
      description: t.function!.description,
      parameters: t.function!.parameters,
    }))
  if (tools.length) out.tools = tools
  if (body.tool_choice?.type === "function" && body.tool_choice.function?.name) {
    out.tool_choice = { type: "function", name: body.tool_choice.function.name }
  }
  return out
}

/** Model-list shapes the backend has used; unknown entries are ignored. */
export function extractModelSlugs(value: unknown): string[] {
  const record = value as Record<string, unknown> | null
  const lists = Array.isArray(value)
    ? [value]
    : record && typeof record === "object"
      ? [record.models, record.data, record.items, record.available_models].filter(Array.isArray)
      : []
  const out: string[] = []
  const seen = new Set<string>()
  for (const list of lists) {
    for (const item of list as unknown[]) {
      const rec = item as Record<string, unknown> | null
      const candidate =
        typeof item === "string"
          ? item
          : rec && typeof rec === "object"
            ? rec.slug ?? rec.id ?? rec.model ?? rec.name
            : undefined
      if (typeof candidate !== "string") continue
      const slug = candidate.trim()
      if (!slug || seen.has(slug)) continue
      seen.add(slug)
      out.push(slug)
    }
  }
  return out
}

interface ResponsesEvent {
  type?: string
  delta?: string
  output_index?: number
  message?: string
  item?: { type?: string; call_id?: string; name?: string; arguments?: string }
  response?: {
    output?: unknown[]
    usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }
    incomplete_details?: { reason?: string }
    error?: { message?: string }
  }
}

/** Translates a Codex Responses SSE stream into chat.completion.chunk SSE. */
export function responsesToChatChunks(
  upstream: ReadableStream<Uint8Array>,
  model: string
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const id = `chatcmpl-${crypto.randomUUID()}`
  const created = Math.floor(Date.now() / 1000)

  // Responses function calls arrive keyed by output_index; chat chunks key
  // tool_calls by a dense per-choice index.
  const fnIndex = new Map<number, number>()
  const fnArgsSent = new Map<number, number>()
  let done = false

  let enqueue: (text: string) => void = () => {}
  const chunk = (payload: unknown) => enqueue(`data: ${JSON.stringify(payload)}\n\n`)
  const deltaChunk = (
    delta: Record<string, unknown>,
    finishReason: string | null = null,
    usage?: Record<string, unknown>
  ) =>
    chunk({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
      ...(usage && { usage }),
    })

  const handle = (ev: ResponsesEvent) => {
    switch (ev.type) {
      case "response.output_text.delta":
        if (ev.delta) deltaChunk({ content: ev.delta })
        break
      case "response.reasoning_summary_text.delta":
      case "response.reasoning_text.delta":
        if (ev.delta) deltaChunk({ reasoning: ev.delta })
        break
      case "response.output_item.added":
        if (ev.item?.type === "function_call" && ev.output_index !== undefined) {
          const idx = fnIndex.size
          fnIndex.set(ev.output_index, idx)
          const args = ev.item.arguments ?? ""
          fnArgsSent.set(idx, args.length)
          deltaChunk({
            tool_calls: [
              {
                index: idx,
                id: ev.item.call_id ?? `call_${idx}`,
                type: "function",
                function: { name: ev.item.name ?? "", arguments: args },
              },
            ],
          })
        }
        break
      case "response.function_call_arguments.delta": {
        const idx = ev.output_index !== undefined ? fnIndex.get(ev.output_index) : undefined
        if (idx !== undefined && ev.delta) {
          fnArgsSent.set(idx, (fnArgsSent.get(idx) ?? 0) + ev.delta.length)
          deltaChunk({ tool_calls: [{ index: idx, function: { arguments: ev.delta } }] })
        }
        break
      }
      case "response.output_item.done": {
        // Safety net for backends that skip argument deltas.
        const idx = ev.output_index !== undefined ? fnIndex.get(ev.output_index) : undefined
        if (idx !== undefined && ev.item?.arguments && !fnArgsSent.get(idx)) {
          fnArgsSent.set(idx, ev.item.arguments.length)
          deltaChunk({ tool_calls: [{ index: idx, function: { arguments: ev.item.arguments } }] })
        }
        break
      }
      case "response.completed":
      case "response.incomplete": {
        const r = ev.response ?? {}
        const output = Array.isArray(r.output) ? r.output : []
        const hasCalls = output.some(
          (i) => (i as Record<string, unknown> | null)?.type === "function_call"
        )
        if (hasCalls) {
          // Stash the raw output items for the client to echo back next round.
          deltaChunk({
            tool_calls: [{ index: 0, extra_content: { chatgpt: { items: output.map(stripId) } } }],
          })
        }
        const usage = r.usage && {
          prompt_tokens: r.usage.input_tokens ?? 0,
          completion_tokens: r.usage.output_tokens ?? 0,
          total_tokens: r.usage.total_tokens ?? 0,
        }
        const reason =
          ev.type === "response.incomplete"
            ? r.incomplete_details?.reason === "max_output_tokens"
              ? "length"
              : "stop"
            : hasCalls
              ? "tool_calls"
              : "stop"
        deltaChunk({}, reason, usage || undefined)
        enqueue("data: [DONE]\n\n")
        done = true
        break
      }
      case "response.failed":
        chunk({ error: { message: ev.response?.error?.message ?? "ChatGPT request failed" } })
        break
      case "error":
        chunk({ error: { message: ev.message ?? "ChatGPT stream error" } })
        break
    }
  }

  const parser = createParser({
    onEvent(event) {
      let json: unknown
      try {
        json = JSON.parse(event.data)
      } catch {
        return
      }
      handle(json as ResponsesEvent)
    },
  })

  return upstream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(part, controller) {
        enqueue = (text) => controller.enqueue(encoder.encode(text))
        parser.feed(decoder.decode(part, { stream: true }))
      },
      flush(controller) {
        enqueue = (text) => controller.enqueue(encoder.encode(text))
        if (!done) {
          // Upstream ended without response.completed — surface it as an error
          // rather than silently truncating.
          chunk({ error: { message: "ChatGPT stream ended unexpectedly" } })
          enqueue("data: [DONE]\n\n")
        }
      },
    })
  )
}
