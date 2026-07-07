import type { AttachmentMeta, Conversation, Message } from "./db-types"

/** New attachment content handed to sendMessage; `data` is platform-opaque
 * (web: File/Blob; mobile: base64 string or file path). */
export interface AttachmentInput {
  name?: string
  mime?: string
  data: unknown
}

/**
 * The storage port. Web backs it with Dexie/IndexedDB, mobile with
 * expo-sqlite. The UI observes storage directly (live queries) — the core
 * only writes through this interface and never holds state of its own.
 */
export interface CoreStore {
  conversations: {
    get(id: string): Promise<Conversation | undefined>
    /** Upsert. */
    put(c: Conversation): Promise<void>
    update(id: string, patch: Partial<Conversation>): Promise<void>
    delete(id: string): Promise<void>
    /** Every row, including sync tombstones (deletedAt set). */
    all(): Promise<Conversation[]>
  }
  messages: {
    get(id: string): Promise<Message | undefined>
    add(m: Message): Promise<void>
    /**
     * Patch a message. CONTRACT: a key explicitly set to `undefined` CLEARS
     * the stored field (Dexie semantics — the pendingQuestion/toolCalls
     * lifecycle relies on it); implementations map undefined → delete/NULL,
     * never "skip". Writes must apply in call (FIFO) order: the streaming
     * flush is fire-and-forget and the final status write must not be
     * overtaken by it.
     */
    update(id: string, patch: Partial<Message>): Promise<void>
    bulkPut(ms: Message[]): Promise<void>
    bulkDelete(ids: string[]): Promise<void>
    /** All messages of a conversation, ordered by seq. */
    byConv(convId: string): Promise<Message[]>
    byReplyTo(replyTo: string): Promise<Message[]>
    /** All messages with status "streaming" (across conversations). */
    streaming(): Promise<Message[]>
    deleteByConv(convId: string): Promise<void>
    /** Highest seq in the conversation, or undefined when it has none. */
    lastSeq(convId: string): Promise<number | undefined>
  }
  attachments: {
    add(meta: Omit<AttachmentMeta, "size">, data: unknown): Promise<void>
    meta(id: string): Promise<AttachmentMeta | undefined>
    metaByConv(convId: string): Promise<AttachmentMeta[]>
    /** data: URL (for OpenAI multimodal image parts). */
    asDataUrl(id: string): Promise<string>
    /** Text content (for inlining non-image files into the prompt). */
    asText(id: string): Promise<string>
    /** Raw bytes as a fetch body (sync upload). */
    body(id: string): Promise<BodyInit>
    /** Persist the body of a sync download. */
    putFromDownload(meta: Omit<AttachmentMeta, "size">, res: Response): Promise<void>
    markSynced(id: string): Promise<void>
    bulkDelete(ids: string[]): Promise<void>
    deleteByConv(convId: string): Promise<void>
  }
  /**
   * Run fn atomically, all store calls inside going through `s`. Transaction
   * bodies contain only store operations (no fetch/timers/file readers), so
   * Dexie's commit-on-foreign-await rule is safe and SQLite implementations
   * can use a plain exclusive transaction.
   */
  transaction(fn: (s: CoreStore) => Promise<void>): Promise<void>
}
