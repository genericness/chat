// Wires the web platform into @chat/core: the Dexie-backed CoreStore,
// localStorage prefs, toasts, the artifact panel, and the E2B tool suite.
// Must be the first app import in main.tsx so configureCore runs before
// anything touches prefs or the store.
import {
  configureCore,
  type AttachmentMeta,
  type CoreStore,
  type McpAuthRequiredError,
} from "@chat/core"
import Dexie from "dexie"
import { toast } from "sonner"

import { db, type Attachment } from "@/lib/db"
import { killConversationSandboxes } from "@/lib/e2b"
import { CODE_TOOL_DEFS, COMPUTER_TOOL_DEFS, E2B_TOOL_NAMES, executeE2bTool } from "@/lib/e2b-tools"
import { authorizeMcpServer } from "@/lib/mcp-oauth"
import { openArtifactPanel } from "@/lib/panel"
import { getPrefs, PREFS_KEY } from "@/lib/profiles"

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function toMeta(a: Attachment): AttachmentMeta {
  return {
    id: a.id,
    convId: a.convId,
    name: a.name,
    mime: a.mime,
    size: a.blob.size,
    createdAt: a.createdAt,
    syncedAt: a.syncedAt,
  }
}

async function att(id: string): Promise<Attachment> {
  const a = await db.attachments.get(id)
  if (!a) throw new Error(`attachment ${id} is missing`)
  return a
}

const webStore: CoreStore = {
  conversations: {
    get: (id) => db.conversations.get(id),
    put: async (c) => {
      await db.conversations.put(c)
    },
    update: async (id, patch) => {
      await db.conversations.update(id, patch)
    },
    delete: (id) => db.conversations.delete(id),
    all: () => db.conversations.toArray(),
  },
  messages: {
    get: (id) => db.messages.get(id),
    add: async (m) => {
      await db.messages.add(m)
    },
    update: async (id, patch) => {
      await db.messages.update(id, patch)
    },
    bulkPut: async (ms) => {
      await db.messages.bulkPut(ms)
    },
    bulkDelete: (ids) => db.messages.bulkDelete(ids),
    byConv: (convId) => db.messages.where("convId").equals(convId).sortBy("seq"),
    byReplyTo: (replyTo) => db.messages.where("replyTo").equals(replyTo).toArray(),
    streaming: () => db.messages.where("status").equals("streaming").toArray(),
    deleteByConv: async (convId) => {
      await db.messages.where("convId").equals(convId).delete()
    },
    lastSeq: async (convId) =>
      (
        await db.messages
          .where("[convId+seq]")
          .between([convId, Dexie.minKey], [convId, Dexie.maxKey])
          .last()
      )?.seq,
  },
  attachments: {
    add: async (meta, data) => {
      await db.attachments.add({ ...meta, blob: data as Blob })
    },
    meta: async (id) => {
      const a = await db.attachments.get(id)
      return a && toMeta(a)
    },
    metaByConv: async (convId) =>
      (await db.attachments.where("convId").equals(convId).toArray()).map(toMeta),
    asDataUrl: async (id) => blobToDataUrl((await att(id)).blob),
    asText: async (id) => (await att(id)).blob.text(),
    body: async (id) => (await att(id)).blob,
    putFromDownload: async (meta, res) => {
      await db.attachments.put({ ...meta, blob: await res.blob() })
    },
    markSynced: async (id) => {
      await db.attachments.update(id, { syncedAt: Date.now() })
    },
    bulkDelete: (ids) => db.attachments.bulkDelete(ids),
    deleteByConv: async (convId) => {
      await db.attachments.where("convId").equals(convId).delete()
    },
  },
  // Dexie's transaction zone auto-joins the inner store calls.
  transaction: (fn) =>
    db.transaction("rw", db.conversations, db.messages, db.attachments, () => fn(webStore)),
}

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

configureCore({
  store: webStore,
  prefs: {
    get: () => localStorage.getItem(PREFS_KEY),
    set: (v) => localStorage.setItem(PREFS_KEY, v),
  },
  onError: (m) => toast.error(m),
  onMcpAuthRequired: toastAuthRequired,
  onArtifact: openArtifactPanel,
  onConversationStop: (convId) => void killConversationSandboxes(convId),
  extraTools: {
    defs: ({ vision }) => {
      if (!getPrefs().e2bKey) return []
      // screenshots are useless to a model that can't see them
      return vision !== false ? [...CODE_TOOL_DEFS, ...COMPUTER_TOOL_DEFS] : [...CODE_TOOL_DEFS]
    },
    names: E2B_TOOL_NAMES,
    execute: async (name, args, ctx) => {
      // Only execute if the tool was actually offered (key present); a model
      // that invents the name otherwise gets told, never a silent sandbox.
      if (!getPrefs().e2bKey) return `Error: "${name}" is unavailable — no E2B API key is configured.`
      return executeE2bTool(name, args, ctx)
    },
  },
})
