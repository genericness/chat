import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ArrowDown } from "lucide-react"

import { ReplyGroup } from "@/components/compare-group"
import { MessageBubble } from "@/components/message"
import { Button } from "@/components/ui/button"
import type { Message } from "@/lib/db"

type Item = { key: string; msg: Message } | { key: string; group: Message[] }

// ponytail: windowed render, not virtualization — long chats mount only the
// tail. Reach for react-virtuoso only if 40 mounted items ever jank.
const INITIAL_ITEMS = 40

export function MessageList({ messages }: { messages: Message[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  const [showAll, setShowAll] = useState(false)
  // Frozen at first render so the window only grows; a moving "last N" slice
  // would drop items off the top mid-read whenever a new message lands.
  const startRef = useRef(-1)
  const anchor = useRef<{ top: number; height: number } | null>(null)

  useEffect(() => {
    if (stick.current) {
      ref.current?.scrollTo({ top: ref.current.scrollHeight })
    }
  }, [messages])

  // Keep the latest message in view when the viewport shrinks (soft keyboard,
  // orientation change) while stuck to the bottom.
  useEffect(() => {
    const onResize = () => {
      if (stick.current) ref.current?.scrollTo({ top: ref.current.scrollHeight })
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  // Group assistant replies by the user message they answer.
  const items: Item[] = []
  const groups = new Map<string, Message[]>()
  const userById = new Map<string, Message>()
  for (const m of messages) {
    if (m.role === "user") userById.set(m.id, m)
    if (m.role === "assistant" && m.replyTo) {
      let g = groups.get(m.replyTo)
      if (!g) {
        g = []
        groups.set(m.replyTo, g)
        items.push({ key: `g-${m.replyTo}`, group: g })
      }
      g.push(m)
    } else {
      items.push({ key: m.id, msg: m })
    }
  }
  const lastUserId = [...messages].reverse().find((m) => m.role === "user")?.id

  if (items.length && startRef.current < 0) {
    startRef.current = Math.max(0, items.length - INITIAL_ITEMS)
  }
  const start =
    showAll || startRef.current < 0
      ? 0
      : Math.min(startRef.current, Math.max(0, items.length - INITIAL_ITEMS))
  const visible = start > 0 ? items.slice(start) : items

  // Keep the viewport anchored on the same message when the earlier ones
  // expand above it. Absolute, from values captured at click time — browsers
  // disagree on what scrollTop is mid-update, and Safari has no native
  // scroll anchoring at all.
  useLayoutEffect(() => {
    const el = ref.current
    if (el && anchor.current) {
      el.scrollTop = anchor.current.top + (el.scrollHeight - anchor.current.height)
      anchor.current = null
    }
  }, [showAll])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={ref}
        className="flex-1 overflow-y-auto overscroll-contain"
        onScroll={() => {
          const el = ref.current
          if (el) {
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
            setAtBottom(stick.current)
          }
        }}
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6">
          {start > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="mx-auto text-muted-foreground"
              onClick={() => {
                const el = ref.current
                if (el) anchor.current = { top: el.scrollTop, height: el.scrollHeight }
                setShowAll(true)
              }}
            >
              Show {start} earlier {start === 1 ? "message" : "messages"}
            </Button>
          )}
          {visible.map((item) =>
            "msg" in item ? (
              <MessageBubble key={item.key} message={item.msg} />
            ) : (
              <ReplyGroup
                key={item.key}
                group={item.group}
                canRegenerate={item.group[0]?.replyTo === lastUserId}
                sources={userById.get(item.group[0]?.replyTo ?? "")?.searchResults}
              />
            )
          )}
        </div>
      </div>
      {!atBottom && (
        <Button
          variant="secondary"
          size="icon"
          className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border/70 shadow-lg"
          aria-label="Scroll to bottom"
          onClick={() => {
            stick.current = true
            setAtBottom(true)
            ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" })
          }}
        >
          <ArrowDown className="size-4" />
        </Button>
      )}
    </div>
  )
}
