// Built-in agent tools: ask the user questions mid-generation, and build small
// web apps rendered live in a sandboxed preview panel. Artifact snapshots are
// stored on the assistant message, so they version and sync like everything else.
import { db, type ArtifactSnapshot, type PendingQuestion } from "@/lib/db"
import type { ToolDef } from "@/lib/openai"
import { openArtifactPanel } from "@/lib/panel"

export const AGENT_TOOL_DEFS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "ask_user",
      description:
        "Ask the user a clarifying question and wait for their answer before continuing. Use this when requirements are ambiguous or a decision is the user's to make (style, scope, options). Provide up to 6 short options for one-click answers when sensible; the user can always type a free-form reply instead.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "The question to show the user" },
          options: {
            type: "array",
            items: { type: "string" },
            description: "Optional quick-select answers (max 6, keep them short)",
          },
          multiple: {
            type: "boolean",
            description: "Allow selecting several options (default false)",
          },
        },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_artifact",
      description:
        "Create or completely rewrite a web app/site/visualization, rendered instantly for the user in a live preview panel beside the chat. Provide ONE complete, self-contained HTML document: inline <style> and <script>; external resources only via https CDN urls (e.g. https://cdn.tailwindcss.com, unpkg.com, cdn.jsdelivr.net). It runs in a sandboxed iframe with no network restrictions but no access to the parent page. Use this whenever the user asks for a UI, website, app, game, form, or interactive visualization. Reuse the same id to replace an artifact; prefer edit_artifact for small changes.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "kebab-case identifier, stable across versions" },
          title: { type: "string", description: "Short human-readable title" },
          html: { type: "string", description: "The complete HTML document" },
        },
        required: ["id", "title", "html"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_artifact",
      description:
        "Modify an existing artifact by exact string replacement — much cheaper than rewriting the whole document. `find` must occur EXACTLY ONCE in the current html (include surrounding context to disambiguate). On error, either retry with more context or fall back to create_artifact with the full document.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Artifact id to edit" },
          find: { type: "string", description: "Exact string to replace (must be unique)" },
          replace: { type: "string", description: "Replacement string" },
        },
        required: ["id", "find", "replace"],
      },
    },
  },
]

export const AGENT_TOOL_NAMES = new Set(AGENT_TOOL_DEFS.map((t) => t.function.name))

/** Latest version of an artifact across the conversation. */
export async function latestArtifact(
  convId: string,
  artifactId: string
): Promise<ArtifactSnapshot | undefined> {
  const msgs = await db.messages.where("convId").equals(convId).sortBy("seq")
  for (let i = msgs.length - 1; i >= 0; i--) {
    const snaps = msgs[i].artifacts
    if (!snaps) continue
    for (let j = snaps.length - 1; j >= 0; j--) {
      if (snaps[j].artifactId === artifactId) return snaps[j]
    }
  }
  return undefined
}

async function saveSnapshot(msgId: string, snap: ArtifactSnapshot) {
  const msg = await db.messages.get(msgId)
  const rest = (msg?.artifacts ?? []).filter((a) => a.artifactId !== snap.artifactId)
  await db.messages.update(msgId, { artifacts: [...rest, snap] })
}

// ask_user: the executor parks on a promise resolved by the question card UI.
const pendingAsks = new Map<string, { resolve: (a: string) => void; reject: (e: Error) => void }>()

export function answerQuestion(toolCallId: string, answer: string) {
  pendingAsks.get(toolCallId)?.resolve(answer)
}

export interface AgentToolContext {
  convId: string
  msgId: string
  toolCallId: string
  signal: AbortSignal
}

/** Returns null when `name` isn't a built-in agent tool. */
export async function executeAgentTool(
  name: string,
  args: Record<string, unknown>,
  ctx: AgentToolContext
): Promise<string | null> {
  if (name === "ask_user") {
    const q: PendingQuestion = {
      toolCallId: ctx.toolCallId,
      question: String(args.question ?? ""),
      options: Array.isArray(args.options) ? args.options.map(String).slice(0, 6) : undefined,
      multiple: args.multiple === true,
    }
    await db.messages.update(ctx.msgId, { pendingQuestion: q })
    try {
      const answer = await new Promise<string>((resolve, reject) => {
        pendingAsks.set(ctx.toolCallId, { resolve, reject })
        ctx.signal.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true }
        )
      })
      return `The user answered: ${answer}`
    } finally {
      pendingAsks.delete(ctx.toolCallId)
      await db.messages.update(ctx.msgId, { pendingQuestion: undefined })
    }
  }

  if (name === "create_artifact") {
    const html = String(args.html ?? "")
    if (!html.trim()) return "Error: html is required"
    const snap: ArtifactSnapshot = {
      artifactId: String(args.id || "app"),
      title: String(args.title || "App"),
      html,
    }
    await saveSnapshot(ctx.msgId, snap)
    openArtifactPanel(ctx.convId, snap.artifactId)
    return `Artifact "${snap.artifactId}" (${html.length} chars) is created and now visible to the user. Use edit_artifact for small follow-up changes.`
  }

  if (name === "edit_artifact") {
    const id = String(args.id ?? "")
    const find = String(args.find ?? "")
    const current = await latestArtifact(ctx.convId, id)
    if (!current) return `Error: no artifact with id "${id}" exists — use create_artifact first.`
    if (!find) return "Error: find is required"
    const count = current.html.split(find).length - 1
    if (count === 0) {
      return `Error: find string not found in the artifact. Check whitespace/quotes exactly, or rewrite with create_artifact.`
    }
    if (count > 1) {
      return `Error: find string occurs ${count} times — include more surrounding context so it is unique.`
    }
    const snap: ArtifactSnapshot = {
      ...current,
      html: current.html.replace(find, String(args.replace ?? "")),
    }
    await saveSnapshot(ctx.msgId, snap)
    openArtifactPanel(ctx.convId, id)
    return `Edit applied — the user is seeing the updated artifact (${snap.html.length} chars).`
  }

  return null
}
