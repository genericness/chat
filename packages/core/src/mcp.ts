import { createParser } from "eventsource-parser"

import { coreFetch } from "./config"
import { getValidToken, type McpOAuth } from "./mcp-auth"

// Minimal MCP client over the Streamable HTTP transport (JSON-RPC 2.0 via POST;
// responses arrive as plain JSON or as an SSE stream). Browser-direct, so the
// server must allow CORS. Tokens stay in localStorage like every other key.

export interface McpServerConfig {
  id: string
  name: string
  url: string
  authToken?: string
  oauth?: McpOAuth
  enabled: boolean
}

/** The server answered 401: an interactive OAuth flow (user gesture) is needed. */
export class McpAuthRequiredError extends Error {
  constructor(
    public server: McpServerConfig,
    public wwwAuthenticate: string | null
  ) {
    super(`"${server.name}" requires authorization`)
  }
}

export interface McpTool {
  name: string
  description?: string
  inputSchema?: unknown
}

interface JsonRpcResponse {
  id?: number | string | null
  result?: unknown
  error?: { code: number; message: string }
}

class McpConnection {
  private sessionId?: string
  private nextId = 1

  constructor(private cfg: McpServerConfig) {}

  private async headers(): Promise<Record<string, string>> {
    // Static token wins; otherwise use (and silently refresh) the OAuth token.
    const bearer = this.cfg.authToken || (await getValidToken(this.cfg.id))
    return {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(this.sessionId && { "mcp-session-id": this.sessionId }),
      ...(bearer && { authorization: `Bearer ${bearer}` }),
    }
  }

  private async post(body: unknown, signal?: AbortSignal): Promise<Response> {
    let res: Response
    try {
      res = await coreFetch(this.cfg.url, {
        method: "POST",
        headers: await this.headers(),
        body: JSON.stringify(body),
        signal,
      })
    } catch (err) {
      if (signal?.aborted) throw err
      throw new Error(
        `Could not reach MCP server "${this.cfg.name}" — check the URL and that it allows browser (CORS) access.`
      )
    }
    if (res.status === 401) {
      throw new McpAuthRequiredError(this.cfg, res.headers.get("www-authenticate"))
    }
    this.sessionId = res.headers.get("mcp-session-id") ?? this.sessionId
    return res
  }

  async notify(method: string): Promise<void> {
    await this.post({ jsonrpc: "2.0", method })
  }

  async rpc(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const id = this.nextId++
    const res = await this.post({ jsonrpc: "2.0", id, method, params }, signal)
    if (!res.ok) {
      throw new Error(`MCP "${this.cfg.name}": ${method} failed (${res.status})`)
    }

    let message: JsonRpcResponse | undefined
    if (res.headers.get("content-type")?.includes("text/event-stream")) {
      // The server may stream notifications first; wait for the reply to our id.
      const parser = createParser({
        onEvent(event) {
          try {
            const parsed = JSON.parse(event.data) as JsonRpcResponse
            if (parsed.id === id) message = parsed
          } catch {
            // ignore non-JSON events
          }
        },
      })
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        parser.feed(decoder.decode(value, { stream: true }))
        if (message) {
          await reader.cancel().catch(() => {})
          break
        }
      }
    } else {
      message = (await res.json()) as JsonRpcResponse
    }

    if (!message) throw new Error(`MCP "${this.cfg.name}": no response to ${method}`)
    if (message.error) throw new Error(`MCP "${this.cfg.name}": ${message.error.message}`)
    return message.result
  }

  async initialize(): Promise<McpTool[]> {
    await this.rpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "chat", version: "1.0.0" },
    })
    await this.notify("notifications/initialized")
    // ponytail: first page only; paginate via nextCursor if a server ever needs it
    const result = (await this.rpc("tools/list", {})) as { tools?: McpTool[] }
    return result.tools ?? []
  }

  async callTool(name: string, args: unknown, signal?: AbortSignal): Promise<string> {
    const result = (await this.rpc("tools/call", { name, arguments: args }, signal)) as {
      content?: { type: string; text?: string }[]
      isError?: boolean
    }
    const text =
      result.content
        ?.map((c) => (c.type === "text" ? c.text : `[${c.type} content]`))
        .filter(Boolean)
        .join("\n") ?? ""
    if (result.isError) throw new Error(text || "tool call failed")
    return text
  }
}

// One cached connection per server config; dropped on failure so the next use reconnects.
const connections = new Map<string, Promise<{ conn: McpConnection; tools: McpTool[] }>>()

function cacheKey(cfg: McpServerConfig): string {
  return `${cfg.id}:${cfg.url}:${cfg.authToken ?? ""}:${cfg.oauth?.tokens?.accessToken ?? ""}`
}

export function connectMcp(cfg: McpServerConfig): Promise<{ conn: McpConnection; tools: McpTool[] }> {
  const key = cacheKey(cfg)
  let promise = connections.get(key)
  if (!promise) {
    const conn = new McpConnection(cfg)
    promise = conn.initialize().then((tools) => ({ conn, tools }))
    promise.catch(() => connections.delete(key))
    connections.set(key, promise)
  }
  return promise
}
