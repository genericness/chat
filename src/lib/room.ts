// Group-chat client: one WebSocket to the room's Durable Object. Rooms are
// server-authoritative (not Dexie), so this holds live state in memory and
// renders straight from the socket feed.
//
// If this client is the room's runner (the host's browser), it also makes the
// model call with the host's own key and streams the reply back — the key never
// leaves here, only the generated text does.
import { API_BASE, getAuthToken } from "@/lib/api-base"
import { streamChatCompletion, type ChatMessage } from "@/lib/openai"
import { activeProfile, getPrefs } from "@/lib/profiles"

export interface RoomMessage {
  seq: number
  mid: string
  kind: "user" | "assistant"
  authorId: string
  authorName: string
  content: string
  createdAt: number
  /** For assistant messages: the model that produced it. */
  model?: string | null
}

export interface RoomMember {
  id: string
  name: string
  kind: string
  isHost: boolean
}

export interface RoomState {
  status: "connecting" | "open" | "closed" | "error"
  messages: RoomMessage[]
  streaming: { runId: string; content: string; model?: string | null } | null
  members: RoomMember[]
  paused: boolean
  /** The model the host has selected for this room. */
  model: string | null
  me: { id: string; isHost: boolean } | null
  error?: string
}

interface WireMessage {
  seq: number
  mid: string
  kind: "user" | "assistant"
  author_id: string
  author_name: string
  content: string
  created_at: number
  model: string | null
}

const norm = (m: WireMessage): RoomMessage => ({
  seq: m.seq,
  mid: m.mid,
  kind: m.kind,
  authorId: m.author_id,
  authorName: m.author_name,
  content: m.content,
  createdAt: m.created_at,
  model: m.model,
})

export class RoomClient {
  private ws?: WebSocket
  private runAbort?: AbortController
  private listeners = new Set<() => void>()
  private state: RoomState = {
    status: "connecting",
    messages: [],
    streaming: null,
    members: [],
    paused: false,
    model: null,
    me: null,
  }

  constructor(private token: string, private guestName?: string) {}

  subscribe = (cb: () => void) => {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  getSnapshot = () => this.state

  post(content: string) {
    if (content.trim()) this.send({ type: "post", content })
  }
  setPaused(paused: boolean) {
    this.send({ type: "pause", paused })
  }
  setModel(model: string) {
    if (model) this.send({ type: "set_model", model })
  }
  close() {
    this.runAbort?.abort()
    this.ws?.close()
  }

  private set(patch: Partial<RoomState>) {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l()
  }

  private send(obj: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj))
  }

  connect() {
    if (this.ws) return
    const base = (API_BASE || location.origin).replace(/^http/, "ws")
    const params = new URLSearchParams()
    if (this.guestName) params.set("name", this.guestName)
    const tok = getAuthToken()
    if (tok) params.set("token", tok)
    const qs = params.toString()
    const ws = new WebSocket(`${base}/api/rooms/${this.token}/ws${qs ? `?${qs}` : ""}`)
    this.ws = ws
    ws.onopen = () => this.set({ status: "open" })
    ws.onerror = () => this.set({ status: "error", error: "Connection failed" })
    ws.onclose = () => {
      if (this.state.status !== "closed") this.set({ status: "closed" })
    }
    ws.onmessage = (ev) => this.onWire(ev.data)
  }

  private onWire(raw: string) {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    switch (msg.type) {
      case "welcome":
        this.set({
          me: msg.you as RoomState["me"],
          paused: Boolean(msg.paused),
          model: (msg.model as string | null) ?? null,
        })
        return
      case "model":
        this.set({ model: (msg.model as string | null) ?? null })
        return
      case "history":
        this.set({ messages: (msg.messages as WireMessage[]).map(norm) })
        return
      case "message":
        this.set({ messages: [...this.state.messages, norm(msg.message as WireMessage)] })
        return
      case "presence":
        this.set({ members: msg.members as RoomMember[] })
        return
      case "paused":
        this.set({ paused: Boolean(msg.paused) })
        return
      case "assistant_start":
        this.set({ streaming: { runId: String(msg.runId), content: "", model: (msg.model as string | null) ?? null } })
        return
      case "assistant_delta": {
        const s = this.state.streaming
        if (s && s.runId === msg.runId) {
          this.set({ streaming: { ...s, content: s.content + String(msg.chunk) } })
        }
        return
      }
      case "assistant_done": {
        const message = msg.message ? [norm(msg.message as WireMessage)] : []
        this.set({ streaming: null, messages: [...this.state.messages, ...message] })
        return
      }
      case "assistant_error":
        this.set({ streaming: null })
        return
      case "run":
        void this.runModel(String(msg.runId), msg.messages as ChatMessage[])
        return
      case "closed":
        this.set({ status: "closed", error: "This room was closed by the host." })
        return
    }
  }

  // Runner only: make the model call with the host's key, stream the reply back.
  private async runModel(runId: string, messages: ChatMessage[]) {
    const prefs = getPrefs()
    const profile = activeProfile(prefs)
    const model = prefs.selectedModels?.[0] || profile?.defaultModel
    if (!profile || !model) {
      this.send({ type: "assistant_error", runId, message: "Host has no model selected." })
      return
    }
    // Report the model up front so every reply is labelled with what made it.
    this.send({ type: "assistant_start", runId, model })
    this.runAbort = new AbortController()
    let full = ""
    let buf = ""
    let timer: ReturnType<typeof setTimeout> | undefined
    const flush = () => {
      timer = undefined
      if (buf) {
        this.send({ type: "assistant_delta", runId, chunk: buf })
        buf = ""
      }
    }
    try {
      await streamChatCompletion({
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
        model,
        messages,
        signal: this.runAbort.signal,
        onDelta: (t) => {
          full += t
          buf += t
          timer ??= setTimeout(flush, 80)
        },
      })
      if (timer) clearTimeout(timer)
      flush()
      this.send({ type: "assistant_done", runId, content: full })
    } catch (e) {
      if (timer) clearTimeout(timer)
      this.send({
        type: "assistant_error",
        runId,
        message: e instanceof Error ? e.message : "Generation failed",
      })
    }
  }
}

export async function createRoom(title: string, joinMode: "guests" | "members"): Promise<string> {
  const { apiFetch } = await import("@/lib/api-base")
  const res = await apiFetch("/api/rooms", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, joinMode }),
  })
  if (!res.ok) {
    if (res.status === 401) throw new Error("Sign in with GitHub to host a room")
    throw new Error("Could not create room")
  }
  const { token } = (await res.json()) as { token: string }
  return token
}

export async function closeRoom(token: string): Promise<void> {
  const { apiFetch } = await import("@/lib/api-base")
  await apiFetch(`/api/rooms/${token}`, { method: "DELETE", credentials: "same-origin" })
}

export async function fetchRoomMeta(token: string): Promise<{ title: string; joinMode: string }> {
  const { apiFetch } = await import("@/lib/api-base")
  const res = await apiFetch(`/api/rooms/${token}`)
  if (!res.ok) throw new Error("Room not found or closed")
  return (await res.json()) as { title: string; joinMode: string }
}

export function roomUrl(token: string): string {
  return `${location.origin}/r/${token}`
}
