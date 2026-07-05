import { toast } from "sonner"

import { AGENT_TOOL_DEFS, AGENT_TOOL_NAMES, executeAgentTool } from "@/lib/agent-tools"
import type { SearchResult } from "@/lib/db"
import { exaSearch, searchContextBlock } from "@/lib/exa"
import { connectMcp, McpAuthRequiredError } from "@/lib/mcp"
import { authorizeMcpServer } from "@/lib/mcp-oauth"
import type { ToolDef } from "@/lib/openai"
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
}

export interface GatherOptions {
  webSearch: boolean
  convId: string
  msgId: string
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

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

export async function gatherTools(opts: GatherOptions): Promise<GatheredTools> {
  const defs: ToolDef[] = [...AGENT_TOOL_DEFS]
  const sources: SearchResult[] = []
  // qualified tool name → executor
  const mcpRoutes = new Map<string, (args: unknown, signal: AbortSignal) => Promise<string>>()

  if (opts.webSearch) defs.push(WEB_SEARCH_DEF)

  for (const server of getPrefs().mcpServers ?? []) {
    if (!server.enabled) continue
    try {
      const { conn, tools } = await connectMcp(server)
      for (const tool of tools) {
        const qualified = `${slug(server.name)}__${tool.name}`.slice(0, 64)
        if (mcpRoutes.has(qualified) || qualified === "web_search" || AGENT_TOOL_NAMES.has(qualified))
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

    if (name === "web_search") {
      const query = String((args as { query?: unknown }).query ?? "")
      const results = await exaSearch(query)
      sources.push(...results)
      return searchContextBlock(results)
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

  return { defs, execute, sources }
}
