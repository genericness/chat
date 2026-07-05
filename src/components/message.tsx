import { memo } from "react"

import { Markdown } from "@/components/markdown"
import type { Message } from "@/lib/db"

export const MessageBubble = memo(function MessageBubble({
  message,
}: {
  message: Message
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-[0.95rem] whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      {message.model && (
        <span className="text-xs text-muted-foreground">{message.model}</span>
      )}
      <div>
        <Markdown text={message.content} />
        {message.status === "streaming" && (
          <span className="mt-1 inline-block h-4 w-2 animate-pulse rounded-xs bg-primary/70" />
        )}
      </div>
      {message.status === "error" && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {message.error}
        </p>
      )}
      {message.status === "stopped" && message.content && (
        <p className="text-xs text-muted-foreground">stopped</p>
      )}
    </div>
  )
})
