import { Check, ChevronLeft, ChevronRight, Square } from "lucide-react"

import { Markdown } from "@/components/markdown"
import { MessageBubble, Sources } from "@/components/message"
import { Button } from "@/components/ui/button"
import { promoteReply, type Message, type SearchResult } from "@/lib/db"
import { stopGeneration } from "@/lib/generation"
import { cn } from "@/lib/utils"

function CompareCard({ message }: { message: Message }) {
  const settled = message.status === "done" || message.status === "stopped"
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card/40 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-1.5">
        <span className="truncate font-mono text-xs text-muted-foreground">
          {message.model}
        </span>
        {message.status === "streaming" && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Stop ${message.model}`}
            onClick={() => stopGeneration(message.id)}
          >
            <Square className="size-3 fill-current" />
          </Button>
        )}
      </div>
      <div className="max-h-96 flex-1 overflow-y-auto px-3 py-2">
        {message.status === "error" ? (
          <p className="text-sm text-destructive">{message.error}</p>
        ) : (
          <>
            <Markdown text={message.content} />
            {message.status === "streaming" && (
              <span className="mt-1 inline-block h-4 w-2 animate-pulse rounded-xs bg-primary/70" />
            )}
          </>
        )}
      </div>
      <div className="border-t border-border/50 p-2">
        <Button
          size="sm"
          variant="secondary"
          className="w-full"
          disabled={!settled}
          onClick={() => void promoteReply(message.id)}
        >
          <Check data-icon="inline-start" />
          Use this response
        </Button>
      </div>
    </div>
  )
}

/**
 * Renders all assistant replies to one user message:
 * 1 reply → plain bubble; N with an active one → bubble + version pager;
 * N with none active → side-by-side compare cards with Promote.
 */
export function ReplyGroup({
  group,
  canRegenerate,
  sources,
}: {
  group: Message[]
  canRegenerate: boolean
  sources?: SearchResult[]
}) {
  const footer = sources?.length ? <Sources results={sources} /> : null

  if (group.length === 1) {
    return (
      <div className="flex flex-col gap-2">
        <MessageBubble message={group[0]} canRegenerate={canRegenerate} />
        {footer}
      </div>
    )
  }

  const active = group.find((m) => m.active)
  if (!active) {
    return (
      <div className="flex flex-col gap-2">
        <div
          className={cn(
            "grid gap-3",
            group.length === 2 ? "md:grid-cols-2" : "md:grid-cols-2 xl:grid-cols-3"
          )}
        >
          {group.map((m) => (
            <CompareCard key={m.id} message={m} />
          ))}
        </div>
        {footer}
      </div>
    )
  }

  const idx = group.indexOf(active)
  return (
    <div className="flex flex-col gap-1">
      <MessageBubble message={active} canRegenerate={canRegenerate} />
      {footer}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={idx === 0}
          aria-label="Previous response"
          onClick={() => void promoteReply(group[idx - 1].id)}
        >
          <ChevronLeft />
        </Button>
        {idx + 1}/{group.length}
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={idx === group.length - 1}
          aria-label="Next response"
          onClick={() => void promoteReply(group[idx + 1].id)}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  )
}
