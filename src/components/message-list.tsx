import { useEffect, useRef } from "react"

import { MessageBubble } from "@/components/message"
import type { Message } from "@/lib/db"

export function MessageList({ messages }: { messages: Message[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    if (stick.current) {
      ref.current?.scrollTo({ top: ref.current.scrollHeight })
    }
  }, [messages])

  const visible = messages.filter((m) => m.role === "user" || m.active)

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
        {visible.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>
    </div>
  )
}
