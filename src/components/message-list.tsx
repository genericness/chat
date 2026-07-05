import { useEffect, useRef } from "react"

import { ReplyGroup } from "@/components/compare-group"
import { MessageBubble } from "@/components/message"
import type { Message } from "@/lib/db"

type Item = { key: string; msg: Message } | { key: string; group: Message[] }

export function MessageList({ messages }: { messages: Message[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    if (stick.current) {
      ref.current?.scrollTo({ top: ref.current.scrollHeight })
    }
  }, [messages])

  // Group assistant replies by the user message they answer.
  const items: Item[] = []
  const groups = new Map<string, Message[]>()
  for (const m of messages) {
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
    <div
      ref={ref}
      className="flex-1 overflow-y-auto"
      onScroll={() => {
        const el = ref.current
        if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
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
            />
          )
        )}
      </div>
    </div>
  )
}
