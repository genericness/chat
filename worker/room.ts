import { DurableObject } from "cloudflare:workers"
import type { Bindings } from "./types"

// One Durable Object per group-chat room. It's a message relay + transcript
// store — it never sees an API key. The host's browser (the "runner") makes
// the model call with its own key and streams the reply back through here,
// which fans it out to everyone. Single-threaded per room → message ordering
// for free.

interface Identity {
  id: string
  name: string
  kind: "member" | "guest"
  isHost: boolean
  isRunner: boolean
  lastPostAt: number
}

interface StoredMessage {
  seq: number
  mid: string
  kind: "user" | "assistant"
  author_id: string
  author_name: string
  content: string
  created_at: number
  model: string | null
  // sql.exec<T>() requires T to be an index-signature record.
  [key: string]: SqlStorageValue
}

const MAX_PARTICIPANTS = 25
const MAX_CONTENT = 8000
const MIN_POST_INTERVAL_MS = 400
const MODEL_CONTEXT_MESSAGES = 40

export class Room extends DurableObject<Bindings> {
  private generating = false
  private currentRunId: string | null = null
  private currentRunModel: string | null = null
  // In-memory: a paused room stays active (people keep chatting) so it won't
  // hibernate; if it ever evicts while empty, unpausing is moot.
  private pausedFlag = false
  // The model the host has selected for this room, for display to everyone.
  private roomModel: string | null = null

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          mid TEXT NOT NULL,
          kind TEXT NOT NULL,
          author_id TEXT NOT NULL,
          author_name TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          model TEXT
        )
      `)
      // Older rooms predate the model column; add it if missing.
      try {
        ctx.storage.sql.exec("ALTER TABLE messages ADD COLUMN model TEXT")
      } catch {
        /* column already exists */
      }
    })
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 })
    }
    if (this.ctx.getWebSockets().length >= MAX_PARTICIPANTS) {
      return new Response("room full", { status: 409 })
    }
    const identity: Identity = {
      id: request.headers.get("x-room-uid") ?? crypto.randomUUID(),
      name: (request.headers.get("x-room-name") ?? "Someone").slice(0, 40),
      kind: request.headers.get("x-room-kind") === "member" ? "member" : "guest",
      isHost: request.headers.get("x-room-host") === "1",
      isRunner: false,
      lastPostAt: 0,
    }

    const pair = new WebSocketPair()
    const server = pair[1]
    this.ctx.acceptWebSocket(server)

    // First host connection becomes the runner (the one asked to generate).
    identity.isRunner = identity.isHost && !this.runnerSocket()
    server.serializeAttachment(identity)

    this.sendTo(server, {
      type: "welcome",
      you: { id: identity.id, isHost: identity.isHost },
      paused: this.isPaused(),
      model: this.roomModel,
    })
    this.sendTo(server, { type: "history", messages: this.history() })
    this.broadcastPresence()
    if (identity.isRunner) this.maybeRun()

    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw))
    } catch {
      return
    }
    const att = ws.deserializeAttachment() as Identity | null
    if (!att) return

    switch (msg.type) {
      case "post":
        return this.onPost(ws, att, String(msg.content ?? ""))
      case "assistant_start":
        // The runner reports the model it's about to use, so every reply is
        // labelled with what actually produced it.
        if (att.isRunner && msg.runId === this.currentRunId) {
          this.currentRunModel = msg.model ? String(msg.model) : null
          this.broadcast({ type: "assistant_start", runId: msg.runId, model: this.currentRunModel })
        }
        return
      case "assistant_delta":
        if (att.isRunner && msg.runId === this.currentRunId) {
          this.broadcast({ type: "assistant_delta", runId: msg.runId, chunk: String(msg.chunk ?? "") })
        }
        return
      case "assistant_done":
        if (att.isRunner && msg.runId === this.currentRunId) this.onAssistantDone(String(msg.content ?? ""))
        return
      case "assistant_error":
        if (att.isRunner && msg.runId === this.currentRunId) {
          this.generating = false
          this.currentRunId = null
          this.currentRunModel = null
          this.broadcast({ type: "assistant_error", message: String(msg.message ?? "Generation failed") })
          this.maybeRun()
        }
        return
      case "set_model":
        // Only the host (the runner's owner) chooses the room's model.
        if (att.isHost && msg.model) {
          this.roomModel = String(msg.model)
          this.broadcast({ type: "model", model: this.roomModel })
        }
        return
      case "pause":
        if (att.isHost) {
          this.setPaused(Boolean(msg.paused))
          this.broadcast({ type: "paused", paused: this.isPaused() })
          this.maybeRun()
        }
        return
    }
  }

  async webSocketClose(ws: WebSocket) {
    // If the runner left, hand the role to another host tab (if any) and let
    // any unanswered messages get picked up.
    const att = ws.deserializeAttachment() as Identity | null
    if (att?.isRunner) {
      this.generating = false
      this.currentRunId = null
      const next = this.ctx.getWebSockets().find((s) => {
        const a = s.deserializeAttachment() as Identity | null
        return a?.isHost && s !== ws
      })
      if (next) {
        const a = next.deserializeAttachment() as Identity
        next.serializeAttachment({ ...a, isRunner: true })
      }
    }
    this.broadcastPresence()
    this.maybeRun()
  }

  /** Called by the worker's DELETE handler to tear the room down. */
  async closeRoom() {
    this.broadcast({ type: "closed" })
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1000, "room closed")
      } catch {
        /* ignore */
      }
    }
    this.ctx.storage.sql.exec("DELETE FROM messages")
  }

  // --- internals ---

  private onPost(ws: WebSocket, att: Identity, contentRaw: string) {
    const content = contentRaw.trim().slice(0, MAX_CONTENT)
    if (!content) return
    const now = Date.now()
    if (now - att.lastPostAt < MIN_POST_INTERVAL_MS) return // simple flood guard
    ws.serializeAttachment({ ...att, lastPostAt: now })

    const mid = crypto.randomUUID()
    this.ctx.storage.sql.exec(
      "INSERT INTO messages (mid, kind, author_id, author_name, content, created_at) VALUES (?, 'user', ?, ?, ?, ?)",
      mid, att.id, att.name, content, now
    )
    const row = this.ctx.storage.sql
      .exec<StoredMessage>("SELECT * FROM messages WHERE mid = ?", mid)
      .one()
    this.broadcast({ type: "message", message: row })
    this.maybeRun()
  }

  private onAssistantDone(contentRaw: string) {
    const content = contentRaw.trim()
    this.generating = false
    const runId = this.currentRunId
    this.currentRunId = null
    if (content) {
      const mid = crypto.randomUUID()
      this.ctx.storage.sql.exec(
        "INSERT INTO messages (mid, kind, author_id, author_name, content, created_at, model) VALUES (?, 'assistant', 'assistant', 'Assistant', ?, ?, ?)",
        mid, content, Date.now(), this.currentRunModel
      )
      const row = this.ctx.storage.sql
        .exec<StoredMessage>("SELECT * FROM messages WHERE mid = ?", mid)
        .one()
      this.broadcast({ type: "assistant_done", runId, message: row })
    } else {
      this.broadcast({ type: "assistant_done", runId, message: null })
    }
    this.currentRunModel = null
    this.maybeRun()
  }

  private maybeRun() {
    if (this.generating || this.isPaused()) return
    const runner = this.runnerSocket()
    if (!runner) return
    const last = this.ctx.storage.sql
      .exec<StoredMessage>("SELECT * FROM messages ORDER BY seq DESC LIMIT 1")
      .toArray()[0]
    if (!last || last.kind !== "user") return // nothing awaiting a reply

    const rows = this.ctx.storage.sql
      .exec<StoredMessage>("SELECT * FROM messages ORDER BY seq DESC LIMIT ?", MODEL_CONTEXT_MESSAGES)
      .toArray()
      .reverse()
    const messages = [
      {
        role: "system",
        content:
          "You are a helpful assistant in a group chat with multiple people. Each user message is prefixed with the speaker's name. Reply to the group.",
      },
      ...rows.map((r) =>
        r.kind === "assistant"
          ? { role: "assistant", content: r.content }
          : { role: "user", content: `${r.author_name}: ${r.content}` }
      ),
    ]

    this.generating = true
    this.currentRunId = crypto.randomUUID()
    // The runner replies with assistant_start (carrying the model it used),
    // then deltas, then assistant_done — we don't broadcast the start here.
    this.sendTo(runner, { type: "run", runId: this.currentRunId, messages })
  }

  private runnerSocket(): WebSocket | undefined {
    return this.ctx.getWebSockets().find((s) => {
      const a = s.deserializeAttachment() as Identity | null
      return a?.isRunner
    })
  }

  private history(): StoredMessage[] {
    return this.ctx.storage.sql
      .exec<StoredMessage>("SELECT * FROM messages ORDER BY seq")
      .toArray()
  }

  private presence() {
    const seen = new Map<string, { id: string; name: string; kind: string; isHost: boolean }>()
    for (const s of this.ctx.getWebSockets()) {
      const a = s.deserializeAttachment() as Identity | null
      if (a) seen.set(a.id, { id: a.id, name: a.name, kind: a.kind, isHost: a.isHost })
    }
    return [...seen.values()]
  }

  private isPaused(): boolean {
    return this.pausedFlag
  }
  private setPaused(v: boolean) {
    this.pausedFlag = v
  }

  private broadcastPresence() {
    this.broadcast({ type: "presence", members: this.presence() })
  }

  private broadcast(obj: unknown) {
    const s = JSON.stringify(obj)
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(s)
      } catch {
        /* closing */
      }
    }
  }

  private sendTo(ws: WebSocket, obj: unknown) {
    try {
      ws.send(JSON.stringify(obj))
    } catch {
      /* closing */
    }
  }
}
