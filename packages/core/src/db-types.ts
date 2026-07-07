// The chat data model. Storage itself is platform-owned (Dexie on web,
// SQLite on mobile) behind the CoreStore port; these types are the contract.

export interface ConversationSettings {
  temperature?: number
  maxTokens?: number
  model?: string
  profileId?: string
}

export interface Conversation {
  id: string
  title: string
  systemPrompt?: string
  settings?: ConversationSettings
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

export interface SearchResult {
  title: string
  url: string
  text: string
}

export type MessageStatus = "streaming" | "done" | "stopped" | "error"

export interface ToolCallRecord {
  id: string
  name: string
  args: string
  /** streaming = arguments still being generated; running = executing */
  status: "streaming" | "running" | "done" | "error"
}

export interface MessageStats {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  /** Wall-clock generation time in milliseconds. */
  durationMs: number
}

/** Full artifact state as of this message — latest snapshot in the thread wins. */
export interface ArtifactSnapshot {
  artifactId: string
  title: string
  /** Rendered preview document (for multi-file builds, the bundled output). */
  html: string
  /** Source tree for the code browser (present for built multi-file artifacts). */
  files?: { path: string; content: string }[]
}

export interface PendingQuestion {
  toolCallId: string
  question: string
  options?: string[]
  multiple?: boolean
}

export interface Message {
  id: string
  convId: string
  seq: number
  role: "user" | "assistant"
  content: string
  attachmentIds?: string[]
  searchResults?: SearchResult[]
  model?: string
  profileId?: string
  replyTo?: string
  reasoning?: string
  toolCalls?: ToolCallRecord[]
  artifacts?: ArtifactSnapshot[]
  pendingQuestion?: PendingQuestion
  stats?: MessageStats
  active: boolean
  status: MessageStatus
  error?: string
  createdAt: number
}

/** Attachment metadata; the bytes themselves live behind the CoreStore port
 * (a Blob on web, base64/file-path on mobile). */
export interface AttachmentMeta {
  id: string
  convId: string
  name: string
  mime: string
  /** Byte size of the stored data. */
  size: number
  createdAt: number
  syncedAt?: number
}
