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

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string | ContentPart[]
}

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
  temperature?: number
  maxTokens?: number
  signal: AbortSignal
  onDelta: (text: string) => void
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

export async function streamChatCompletion(req: CompletionRequest): Promise<void> {
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

  // Non-streaming server: a single JSON completion instead of SSE.
  if (!res.headers.get("content-type")?.includes("text/event-stream")) {
    const json = await res.json()
    if (json.error) throw new ApiError(errorMessage(json, "Request failed"))
    req.onDelta(json.choices?.[0]?.message?.content ?? "")
    return
  }

  let streamError: string | null = null
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
        choices?: { delta?: { content?: string } }[]
      }
      if (obj.error) {
        streamError = errorMessage(obj, "Provider returned an error mid-stream")
        return
      }
      const delta = obj.choices?.[0]?.delta?.content
      if (delta) req.onDelta(delta)
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
}
