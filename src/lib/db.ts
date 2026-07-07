import Dexie, { type EntityTable } from "dexie"

import type { Conversation, Message } from "@chat/core"

// The data-model types and store-backed helpers live in @chat/core (shared
// with mobile); re-export so the rest of the app keeps importing them from
// here. The Dexie schema below is the web implementation of the CoreStore
// port (see core-setup.ts) — DO NOT change it without a migration plan.
export type {
  ArtifactSnapshot,
  Conversation,
  ConversationSettings,
  Message,
  MessageStats,
  MessageStatus,
  PendingQuestion,
  SearchResult,
  ToolCallRecord,
} from "@chat/core"
export {
  autoTitle,
  createConversation,
  deleteAllConversations,
  deleteConversation,
  nextSeq,
  promoteReply,
  renameConversation,
  runJanitor,
  touchConversation,
} from "@chat/core"

export interface Attachment {
  id: string
  convId: string
  name: string
  mime: string
  blob: Blob
  createdAt: number
  syncedAt?: number
}

export const db = new Dexie("chat") as Dexie & {
  conversations: EntityTable<Conversation, "id">
  messages: EntityTable<Message, "id">
  attachments: EntityTable<Attachment, "id">
}

db.version(1).stores({
  conversations: "id, updatedAt",
  messages: "id, convId, [convId+seq], replyTo, status",
  attachments: "id, convId",
})
