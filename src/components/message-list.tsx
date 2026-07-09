import { useEffect, useRef, useState } from "react"
import Dexie from "dexie"
import { useLiveQuery } from "dexie-react-hooks"
import { ArrowDown } from "lucide-react"

import { ReplyGroup } from "@/components/compare-group"
import { MessageBubble } from "@/components/message"
import { Button } from "@/components/ui/button"
import { db, type Message } from "@/lib/db"

type Item = { key: string; msg: Message } | { key: string; group: Message[] }

export function MessageList({ convId }: { convId: string }) {
  const messages =
    useLiveQuery(
      () =>
        db.messages
          .where("[convId+seq]")
          .between([convId, Dexie.minKey], [convId, Dexie.maxKey])
          .toArray(),
      [convId]
    ) ?? []
  const ref = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const frame = useRef<number | undefined>(undefined)
  const stick = useRef(true)
  const [atBottom, setAtBottom] = useState(true)

  // Active streams update outside Dexie on animation frames. Observe the
  // rendered content so only a stuck viewport follows those size changes.
  useEffect(() => {
    stick.current = true
    setAtBottom(true)
    const schedule = () => {
      if (!stick.current || frame.current !== undefined) return
      frame.current = window.requestAnimationFrame(() => {
        frame.current = undefined
        const el = ref.current
        if (el) el.scrollTo({ top: el.scrollHeight })
      })
    }
    const observer = new ResizeObserver(schedule)
    if (contentRef.current) observer.observe(contentRef.current)
    window.addEventListener("resize", schedule)
    schedule()
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", schedule)
      if (frame.current !== undefined) window.cancelAnimationFrame(frame.current)
      frame.current = undefined
    }
  }, [convId])

  // Group assistant replies by the user message they answer.
  const items: Item[] = []
  const groups = new Map<string, Message[]>()
  const userById = new Map<string, Message>()
  let lastUserId: string | undefined
  for (const m of messages) {
    if (m.role === "user") {
      userById.set(m.id, m)
      lastUserId = m.id
    }
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

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={ref}
        className="flex-1 overflow-y-auto overscroll-contain"
        onScroll={() => {
          const el = ref.current
          if (!el) return
          const next = el.scrollHeight - el.scrollTop - el.clientHeight < 120
          if (next !== stick.current) {
            stick.current = next
            setAtBottom(next)
          }
        }}
      >
        <div ref={contentRef} className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6">
          {items.map((item) => (
            <div key={item.key} className="message-row">
              {"msg" in item ? (
                <MessageBubble message={item.msg} />
              ) : (
                <ReplyGroup
                  group={item.group}
                  canRegenerate={item.group[0]?.replyTo === lastUserId}
                  sources={userById.get(item.group[0]?.replyTo ?? "")?.searchResults}
                />
              )}
            </div>
          ))}
          <div ref={bottomRef} aria-hidden />
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
            bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" })
          }}
        >
          <ArrowDown className="size-4" />
        </Button>
      )}
    </div>
  )
}
