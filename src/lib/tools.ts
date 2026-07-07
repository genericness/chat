import { toast } from "sonner"

import { AGENT_TOOL_DEFS, AGENT_TOOL_NAMES, executeAgentTool } from "@/lib/agent-tools"
import type { SearchResult } from "@/lib/db"
import { CODE_TOOL_DEFS, COMPUTER_TOOL_DEFS, E2B_TOOL_NAMES, executeE2bTool } from "@/lib/e2b-tools"
import { exaContents, exaSearch, pageContentsBlock, searchContextBlock } from "@chat/core"
import { connectMcp, McpAuthRequiredError } from "@chat/core"
import { authorizeMcpServer } from "@/lib/mcp-oauth"
import type { ToolDef } from "@chat/core"
import { getPrefs } from "@/lib/profiles"

/** Popups need a user gesture, so mid-send auth failures surface as an actionable toast. */
function toastAuthRequired(err: McpAuthRequiredError) {
  toast.error(`MCP server "${err.server.name}" needs authorization`, {
    id: `mcp-auth-${err.server.id}`, // dedupe repeat failures
    duration: 10_000,
    action: {
      label: "Connect",
      onClick: () => {
        void authorizeMcpServer(err.server, err.wwwAuthenticate)
          .then(() => toast.success(`Connected to "${err.server.name}" — send again to use its tools.`))
          .catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
      },
    },
  })
}

export interface GatheredTools {
  defs: ToolDef[]
  /** Executes a tool by its (qualified) name; returns text for the model. */
  execute: (
    name: string,
    argsJson: string,
    signal: AbortSignal,
    toolCallId: string
  ) => Promise<string>
  /** web_search results collected along the way, for the sources UI. */
  sources: SearchResult[]
  /** Screenshot/image data URLs queued by tools, injected as user messages. */
  drainImages: () => string[]
}

export interface GatherOptions {
  webSearch: boolean
  convId: string
  msgId: string
  /** Model can accept image inputs (gates computer-use tools). */
  vision?: boolean
}

const WEB_SEARCH_DEF: ToolDef = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the web for current information. Returns the top results with title, URL, and page text.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
      },
      required: ["query"],
    },
  },
}

const FETCH_URL_DEF: ToolDef = {
  type: "function",
  function: {
    name: "fetch_url",
    description:
      "Fetch the live, full text of one or more web pages by URL. Use this when the user gives you a link or you already know the exact page to read, instead of searching. Returns each page's main content as markdown.",
    parameters: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          description: "One or more page URLs to read",
        },
      },
      required: ["urls"],
    },
  },
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

export async function gatherTools(opts: GatherOptions): Promise<GatheredTools> {
  const defs: ToolDef[] = [...AGENT_TOOL_DEFS]
  const sources: SearchResult[] = []
  const images: string[] = []
  // qualified tool name → executor
  const mcpRoutes = new Map<string, (args: unknown, signal: AbortSignal) => Promise<string>>()

  if (opts.webSearch) defs.push(WEB_SEARCH_DEF)
  // fetch_url is available whenever an Exa key is set, even without the search
  // toggle — reading a link the user pastes is its own capability.
  if (getPrefs().exaKey) defs.push(FETCH_URL_DEF)
  if (getPrefs().e2bKey) {
    defs.push(...CODE_TOOL_DEFS)
    // screenshots are useless to a model that can't see them
    if (opts.vision !== false) defs.push(...COMPUTER_TOOL_DEFS)
  }

  for (const server of getPrefs().mcpServers ?? []) {
    if (!server.enabled) continue
    try {
      const { conn, tools } = await connectMcp(server)
      for (const tool of tools) {
        const qualified = `${slug(server.name)}__${tool.name}`.slice(0, 64)
        if (
          mcpRoutes.has(qualified) ||
          qualified === "web_search" ||
          qualified === "fetch_url" ||
          AGENT_TOOL_NAMES.has(qualified)
        )
          continue
        mcpRoutes.set(qualified, (args, signal) => conn.callTool(tool.name, args, signal))
        defs.push({
          type: "function",
          function: {
            name: qualified,
            description: tool.description,
            parameters: tool.inputSchema ?? { type: "object", properties: {} },
          },
        })
      }
    } catch (err) {
      if (err instanceof McpAuthRequiredError) toastAuthRequired(err)
      else toast.error(err instanceof Error ? err.message : `MCP "${server.name}" failed`)
    }
  }

  const execute = async (
    name: string,
    argsJson: string,
    signal: AbortSignal,
    toolCallId: string
  ) => {
    let args: unknown = {}
    try {
      args = argsJson ? JSON.parse(argsJson) : {}
    } catch {
      // pass raw string through so the model can see what went wrong
      args = { input: argsJson }
    }

    const agentResult = await executeAgentTool(name, args as Record<string, unknown>, {
      convId: opts.convId,
      msgId: opts.msgId,
      toolCallId,
      signal,
    })
    if (agentResult !== null) return agentResult

    if (E2B_TOOL_NAMES.has(name)) {
      // Only execute if the tool was actually offered (key present); a model
      // that invents the name otherwise gets told, never a silent sandbox.
      if (!getPrefs().e2bKey) return `Error: "${name}" is unavailable — no E2B API key is configured.`
      const r = await executeE2bTool(name, args as Record<string, unknown>, {
        convId: opts.convId,
        msgId: opts.msgId,
        pushImage: (url) => images.push(url),
      })
      if (r !== null) return r
    }

    if (name === "web_search") {
      const query = String((args as { query?: unknown }).query ?? "")
      if (!query.trim()) return "Error: query must not be empty — call web_search again with a search query."
      const results = await exaSearch(query)
      sources.push(...results)
      return searchContextBlock(results)
    }

    if (name === "fetch_url") {
      const a = args as { urls?: unknown; url?: unknown }
      const urls = Array.isArray(a.urls)
        ? a.urls.map(String)
        : [a.urls, a.url].filter((v): v is string => typeof v === "string")
      if (!urls.length) return "Error: provide one or more urls."
      const pages = await exaContents(urls)
      // Lightweight source pills for the UI; the model gets the full text below.
      for (const p of pages) {
        if (!p.error) sources.push({ title: p.title, url: p.url, text: p.text.slice(0, 200) })
      }
      return pageContentsBlock(pages)
    }

    const route = mcpRoutes.get(name)
    if (!route) return `Error: unknown tool "${name}"`
    try {
      return await route(args, signal)
    } catch (err) {
      // Token expired mid-conversation: tell the user how to fix it, tell the model why it failed.
      if (err instanceof McpAuthRequiredError) toastAuthRequired(err)
      throw err
    }
  }

  return { defs, execute, sources, drainImages: () => images.splice(0, images.length) }
}
