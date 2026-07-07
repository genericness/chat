import { drizzle } from "drizzle-orm/expo-sqlite"
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { openDatabaseSync } from "expo-sqlite"

// enableChangeListener powers drizzle's useLiveQuery reactivity.
export const sqlite = openDatabaseSync("chat.db", { enableChangeListener: true })

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  systemPrompt: text("system_prompt"),
  settings: text("settings", { mode: "json" }),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  deletedAt: integer("deleted_at"),
})

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    convId: text("conv_id").notNull(),
    seq: integer("seq").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    attachmentIds: text("attachment_ids", { mode: "json" }),
    searchResults: text("search_results", { mode: "json" }),
    model: text("model"),
    profileId: text("profile_id"),
    replyTo: text("reply_to"),
    reasoning: text("reasoning"),
    toolCalls: text("tool_calls", { mode: "json" }),
    artifacts: text("artifacts", { mode: "json" }),
    pendingQuestion: text("pending_question", { mode: "json" }),
    stats: text("stats", { mode: "json" }),
    active: integer("active", { mode: "boolean" }).notNull(),
    status: text("status").notNull(),
    error: text("error"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("msg_conv_seq").on(t.convId, t.seq),
    index("msg_reply_to").on(t.replyTo),
    index("msg_status").on(t.status),
  ]
)

export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    convId: text("conv_id").notNull(),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    data: text("data").notNull(), // base64
    createdAt: integer("created_at").notNull(),
    syncedAt: integer("synced_at"),
  },
  (t) => [index("att_conv").on(t.convId)]
)

export const db = drizzle(sqlite, { schema: { conversations, messages, attachments } })

// ponytail: hand-rolled DDL bootstrap; switch to drizzle-kit migrations when the schema first changes
export function initDb() {
  sqlite.execSync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      system_prompt TEXT,
      settings TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conv_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      attachment_ids TEXT,
      search_results TEXT,
      model TEXT,
      profile_id TEXT,
      reply_to TEXT,
      reasoning TEXT,
      tool_calls TEXT,
      artifacts TEXT,
      pending_question TEXT,
      stats TEXT,
      active INTEGER NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS msg_conv_seq ON messages (conv_id, seq);
    CREATE INDEX IF NOT EXISTS msg_reply_to ON messages (reply_to);
    CREATE INDEX IF NOT EXISTS msg_status ON messages (status);
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      conv_id TEXT NOT NULL,
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      synced_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS att_conv ON attachments (conv_id);
  `)
}
