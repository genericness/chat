import { createParser } from "eventsource-parser"

export interface ContentPartText {
  type: "text"
  text: string
}
export interface ContentPartImage {
  type: "image_url"
  image_url: { url: string }
}
export type ContentPart = ContentPartText | ContentPartImage

export interface ToolCall {
  id: string
  type: "function"
  function: { name: string; arguments: string }
  // Gemini thinking models attach a thought_signature here (extra_content.google.
  // thought_signature) that MUST be echoed back verbatim on the next request or
  // the API 400s. We preserve it opaquely through the round-trip.
  extra_content?: unknown
}

export interface ToolDef {
  type: "function"
  function: { name: string; description?: string; parameters?: unknown }
}

export type ChatMessage =
  | { role: "system" | "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string }

export class ApiError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

export interface CompletionRequest {
  baseUrl: string
  apiKey: string
  model: string
  messages: ChatMessage[]
  tools?: ToolDef[]
  toolChoice?: { type: "function"; function: { name: string } }
  temperature?: number
  maxTokens?: number
  signal: AbortSignal
  onDelta: (text: string) => void
  /** Chain-of-thought deltas (`reasoning_content` / `reasoning`), when the model emits them. */
  onReasoning?: (text: string) => void
  /** Fired as tool-call arguments stream in, with the accumulated calls so far. */
  onToolCallDelta?: (calls: ToolCall[]) => void
}

export interface Usage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export interface CompletionResult {
  toolCalls: ToolCall[]
  /** "length" means the output was cut off by the max-tokens limit. */
  finishReason?: string
  /** Token usage, when the provider reports it. */
  usage?: Usage
}

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const err = (payload as { error?: unknown }).error
    if (typeof err === "string") return err
    if (err && typeof err === "object") {
      const msg = (err as { message?: unknown }).message
      if (typeof msg === "string") return msg
    }
  }
  return fallback
}

interface ToolCallDelta {
  index?: number
  id?: string
  function?: { name?: string; arguments?: string }
  extra_content?: unknown
}

/** Streamed tool_call fragments arrive keyed by index; concatenate as they come. */
function accumulateToolCalls(acc: ToolCall[], deltas: ToolCallDelta[] | undefined) {
  for (const d of deltas ?? []) {
    const i = d.index ?? 0
    acc[i] ??= { id: "", type: "function", function: { name: "", arguments: "" } }
    if (d.id) acc[i].id = d.id
    if (d.extra_content !== undefined) acc[i].extra_content = d.extra_content // Gemini thought_signature
    if (d.function?.name) acc[i].function.name += d.function.name
    if (d.function?.arguments) acc[i].function.arguments += d.function.arguments
  }
}

export async function streamChatCompletion(req: CompletionRequest): Promise<CompletionResult> {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (req.apiKey) headers.authorization = `Bearer ${req.apiKey}`
  // Anthropic's OpenAI-compat endpoint rejects browser CORS without this opt-in.
  if (/^https:\/\/api\.anthropic\.com/.test(req.baseUrl)) {
    headers["anthropic-dangerous-direct-browser-access"] = "true"
    headers["x-api-key"] = req.apiKey
  }

  let res: Response
  try {
    res = await fetch(`${req.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      signal: req.signal,
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        stream: true,
        // ask for a final usage chunk so we can show token counts / tok/s
        stream_options: { include_usage: true },
        ...(req.tools?.length && { tools: req.tools }),
        ...(req.toolChoice && { tool_choice: req.toolChoice }),
        ...(req.temperature !== undefined && { temperature: req.temperature }),
        ...(req.maxTokens !== undefined && { max_tokens: req.maxTokens }),
      }),
    })
  } catch (err) {
    if (req.signal.aborted) throw err
    // Bare TypeError = network/CORS/mixed-content; give a hint instead of "Failed to fetch".
    throw new ApiError(
      `Could not reach ${req.baseUrl}. Check the URL, CORS settings on the server, and that http:// endpoints are only used from localhost.`
    )
  }

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      detail = errorMessage(await res.json(), detail)
    } catch {
      // keep status text
    }
    throw new ApiError(detail, res.status)
  }

  const toolCalls: ToolCall[] = []

  // Non-streaming server: a single JSON completion instead of SSE.
  if (!res.headers.get("content-type")?.includes("text/event-stream")) {
    const json = await res.json()
    if (json.error) throw new ApiError(errorMessage(json, "Request failed"))
    const choice = json.choices?.[0]
    const message = choice?.message
    const reasoning = message?.reasoning_content ?? message?.reasoning
    if (reasoning) req.onReasoning?.(reasoning)
    if (message?.content) req.onDelta(message.content)
    return {
      toolCalls: (message?.tool_calls ?? []) as ToolCall[],
      finishReason: choice?.finish_reason ?? undefined,
      usage: json.usage as Usage | undefined,
    }
  }

  let streamError: string | null = null
  let finishReason: string | undefined
  let usage: Usage | undefined
  const parser = createParser({
    onEvent(event) {
      if (event.data === "[DONE]") return
      let json: unknown
      try {
        json = JSON.parse(event.data)
      } catch {
        return // ignore malformed keep-alives
      }
      const obj = json as {
        error?: unknown
        usage?: Usage
        choices?: {
          finish_reason?: string | null
          delta?: {
            content?: string
            reasoning_content?: string
            reasoning?: string
            tool_calls?: ToolCallDelta[]
          }
        }[]
      }
      if (obj.error) {
        streamError = errorMessage(obj, "Provider returned an error mid-stream")
        return
      }
      // The usage chunk arrives last, usually with an empty choices array.
      if (obj.usage) usage = obj.usage
      const choice = obj.choices?.[0]
      if (choice?.finish_reason) finishReason = choice.finish_reason
      const delta = choice?.delta
      const reasoning = delta?.reasoning_content ?? delta?.reasoning
      if (reasoning) req.onReasoning?.(reasoning)
      if (delta?.content) req.onDelta(delta.content)
      if (delta?.tool_calls?.length) {
        accumulateToolCalls(toolCalls, delta.tool_calls)
        req.onToolCallDelta?.(toolCalls.filter(Boolean))
      }
    },
  })

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parser.feed(decoder.decode(value, { stream: true }))
    if (streamError) {
      await reader.cancel().catch(() => {})
      throw new ApiError(streamError)
    }
  }
  if (streamError) throw new ApiError(streamError)

  return {
    toolCalls: toolCalls
      .filter(Boolean)
      .map((tc, i) => ({ ...tc, id: tc.id || `call_${i}` })),
    finishReason,
    usage,
  }
}
