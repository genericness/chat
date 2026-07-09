import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowDown, ArrowUp, Check, Copy, Loader2, LogIn, Pause, Play, Users, X } from "lucide-react"

import { Markdown } from "@/components/markdown"
import { ModelPicker } from "@/components/model-picker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useMe } from "@/hooks/use-me"
import { activeProfile, usePrefs } from "@/lib/profiles"
import { RoomClient, closeRoom, fetchRoomMeta, roomUrl } from "@/lib/room"
import { cn } from "@/lib/utils"

export function RoomPage() {
  const { token } = useParams<{ token: string }>()
  const { data: me, isLoading: meLoading } = useMe()
  const [meta, setMeta] = useState<{ title: string; joinMode: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guestName, setGuestName] = useState("")
  const [joined, setJoined] = useState(false)

  useEffect(() => {
    let live = true
    fetchRoomMeta(token!)
      .then((m) => live && setMeta(m))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Room not found"))
    return () => {
      live = false
    }
  }, [token])

  if (error) {
    return (
      <Centered>
        <p className="text-lg font-medium">Room unavailable</p>
        <p className="text-sm text-muted-foreground">{error}</p>
        <a href="/" className="mt-2 text-sm text-primary hover:underline">
          Go to chat
        </a>
      </Centered>
    )
  }
  if (!meta || meLoading) {
    return (
      <Centered>
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </Centered>
    )
  }

  const signedIn = !!me
  if (!signedIn && !joined) {
    if (meta.joinMode === "members") {
      return (
        <Centered>
          <p className="text-lg font-medium">{meta.title}</p>
          <p className="text-sm text-muted-foreground">
            This room requires signing in with GitHub.
          </p>
          <Button className="mt-2" onClick={() => (location.href = "/api/auth/login")}>
            <LogIn data-icon="inline-start" />
            Sign in with GitHub
          </Button>
        </Centered>
      )
    }
    return (
      <Centered>
        <p className="text-lg font-medium">{meta.title}</p>
        <p className="text-sm text-muted-foreground">Join as a guest — pick a display name.</p>
        <form
          className="mt-2 flex w-full max-w-xs gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (guestName.trim()) setJoined(true)
          }}
        >
          <Input
            autoFocus
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            placeholder="Your name"
            maxLength={40}
          />
          <Button type="submit" disabled={!guestName.trim()}>
            Join
          </Button>
        </form>
      </Centered>
    )
  }

  return (
    <RoomLive
      token={token!}
      title={meta.title}
      guestName={signedIn ? undefined : guestName.trim()}
    />
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100svh] flex-col items-center justify-center gap-2 px-6 text-center">
      {children}
    </div>
  )
}

function RoomLive({
  token,
  title,
  guestName,
}: {
  token: string
  title: string
  guestName?: string
}) {
  const navigate = useNavigate()
  const prefs = usePrefs()
  const profile = activeProfile(prefs)
  const [client] = useState(() => new RoomClient(token, guestName))
  useEffect(() => {
    client.connect()
    return () => client.close()
  }, [client])
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot)

  const isHost = state.me?.isHost ?? false
  const hostModel = prefs.selectedModels?.[0] || profile?.defaultModel
  // Host publishes its selected model to the room so everyone sees it.
  useEffect(() => {
    if (isHost && state.status === "open" && hostModel) client.setModel(hostModel)
  }, [client, isHost, state.status, hostModel])

  const [text, setText] = useState("")
  const [copied, setCopied] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)

  const scrollToBottom = () => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight })
  }
  const onScroll = () => {
    const el = scrollRef.current
    if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120)
  }
  // Only stick to the bottom if the reader is already there — don't yank
  // someone reading history while others talk over each other.
  useEffect(() => {
    if (atBottom) scrollToBottom()
  }, [state.messages, state.streaming, atBottom])

  if (state.status === "closed") {
    return (
      <Centered>
        <p className="text-lg font-medium">Room closed</p>
        <p className="text-sm text-muted-foreground">
          {state.error ?? "You've left this room."}
        </p>
        <a href="/" className="mt-2 text-sm text-primary hover:underline">
          Go to chat
        </a>
      </Centered>
    )
  }

  const send = () => {
    if (!text.trim()) return
    client.post(text)
    setText("")
    setAtBottom(true) // your own message always pulls you to the bottom
  }
  const copyInvite = () => {
    void navigator.clipboard.writeText(roomUrl(token))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  const endRoom = async () => {
    await closeRoom(token).catch(() => {})
    navigate("/")
  }

  return (
    <div className="kb-pad flex h-[100dvh] flex-col overflow-hidden pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      <header className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:gap-2 sm:px-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold">{title}</h1>
            {state.paused && (
              <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-400">
                paused
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="size-3 shrink-0" />
            {state.members.length}
            <span className="mx-0.5">·</span>
            <span className={cn("truncate", state.status === "open" && "text-primary")}>
              {state.status === "open" ? "connected" : state.status}
            </span>
            {!isHost && state.model && (
              <>
                <span className="mx-0.5">·</span>
                <span className="truncate" title={state.model}>
                  {state.model}
                </span>
              </>
            )}
          </div>
        </div>
        {isHost && <ModelPicker profile={profile} />}
        <Button variant="outline" size="sm" className="shrink-0" onClick={copyInvite}>
          {copied ? <Check className="text-primary" /> : <Copy />}
          <span className="hidden sm:inline">Invite</span>
        </Button>
        {isHost && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            aria-label={state.paused ? "Resume agent" : "Pause agent"}
            onClick={() => client.setPaused(!state.paused)}
          >
            {state.paused ? <Play /> : <Pause />}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn("shrink-0", isHost && "text-destructive")}
          aria-label={isHost ? "Close room" : "Leave room"}
          onClick={isHost ? endRoom : () => navigate("/")}
        >
          <X />
        </Button>
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="h-full overflow-y-auto overscroll-contain"
        >
          <div className="mx-auto w-full max-w-3xl px-4 py-6">
            {state.messages.length === 0 && !state.streaming && (
              <p className="mt-10 text-center text-sm text-muted-foreground">
                No messages yet. Say hi — everyone here talks to the same assistant.
              </p>
            )}
            <div className="flex flex-col gap-5">
              {state.messages.map((m) =>
                m.kind === "user" ? (
                  <div key={m.mid} className="flex flex-col items-end gap-1">
                    <span className="px-1 text-xs text-muted-foreground">{m.authorName}</span>
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-[0.95rem] whitespace-pre-wrap">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div key={m.mid} className="flex flex-col gap-1">
                    <span className="px-1 text-xs text-muted-foreground">{m.model || "Assistant"}</span>
                    <Markdown text={m.content} />
                  </div>
                )
              )}
              {state.streaming && (
                <div className="flex flex-col gap-1">
                  <span className="px-1 text-xs text-muted-foreground">
                    {state.streaming.model || "Assistant"}
                  </span>
                  {state.streaming.content ? (
                    <Markdown text={state.streaming.content} streaming />
                  ) : (
                    <span className="inline-block h-4 w-2 animate-pulse rounded-xs bg-primary/70" />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        {!atBottom && (
          <Button
            size="sm"
            variant="secondary"
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-md"
            onClick={() => {
              scrollToBottom()
              setAtBottom(true)
            }}
          >
            <ArrowDown data-icon="inline-start" />
            New messages
          </Button>
        )}
      </div>

      <div className="shrink-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-2xl border border-border bg-card px-3 py-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send()
              }
            }}
            placeholder={state.status === "open" ? "Message the group" : "Connecting…"}
            disabled={state.status !== "open"}
            rows={1}
            className="max-h-40 min-h-8 flex-1 resize-none bg-transparent py-1 text-base leading-6 outline-none field-sizing-content placeholder:text-muted-foreground disabled:opacity-60 sm:text-[0.95rem]"
          />
          <Button size="icon" className="shrink-0 rounded-full" aria-label="Send" disabled={!text.trim()} onClick={send}>
            <ArrowUp className="size-5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
