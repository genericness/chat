import { useEffect, useRef, useState } from "react"
import { ArrowDown } from "lucide-react"

import { ReplyGroup } from "@/components/compare-group"
import { MessageBubble } from "@/components/message"
import { Button } from "@/components/ui/button"
import type { Message } from "@/lib/db"

type Item = { key: string; msg: Message } | { key: string; group: Message[] }

export function MessageList({ messages }: { messages: Message[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [atBottom, setAtBottom] = useState(true)

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
          {items.map((item) =>
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
