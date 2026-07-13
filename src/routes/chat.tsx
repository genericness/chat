import { useMemo, useRef } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { useParams } from "react-router-dom"

import { ArtifactPanel } from "@/components/artifact-panel"
import { Composer } from "@/components/composer"
import { MessageList } from "@/components/message-list"
import { ShinyText } from "@/components/shiny-text"
import { db, type Message } from "@/lib/db"

export function ChatPage() {
  const { id } = useParams<{ id: string }>()
  const live = useLiveQuery(
    () =>
      id
        ? db.messages.where("convId").equals(id).sortBy("seq")
        : Promise.resolve([] as Message[]),
    [id]
  )

  // The 100ms streaming write-through re-runs the query above, which returns
  // all-new row objects and defeats MessageBubble's memo — every settled
  // message re-rendered (and sources-bearing ones re-parsed markdown) at 10Hz.
  // Reuse the previous object when a row hasn't visibly changed; fields that
  // settle (stats, searchResults, toolCalls) always land with a status flip.
  const rowCache = useRef(new Map<string, Message>())
  const messages = useMemo(() => {
    const prev = rowCache.current
    const next = new Map<string, Message>()
    const rows = (live ?? []).map((m) => {
      const old = prev.get(m.id)
      const row =
        old &&
        old.status !== "streaming" &&
        old.status === m.status &&
        old.active === m.active &&
        old.content === m.content &&
        old.reasoning === m.reasoning
          ? old
          : m
      next.set(m.id, row)
      return row
    })
    rowCache.current = next
    return rows
  }, [live])

  if (!id) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4 pb-16">
        <div className="relative flex w-full flex-col items-center gap-8">
          {/* glow anchored to the greeting+composer group so it stays centered behind the input;
              radial gradient, not blur() — large blurs flicker in WKWebView when overlays animate */}
          <div
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-1/2 h-[360px] w-[min(92vw,46rem)] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(ellipse_closest-side,color-mix(in_oklch,var(--primary),transparent_82%),transparent)]"
          />
          <h1 className="relative text-center text-3xl font-medium tracking-tight sm:text-4xl">
            <ShinyText text="Hi, what's on your mind?" />
          </h1>
          <Composer className="relative" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col">
        <MessageList key={id} messages={messages} />
        <div className="flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Composer convId={id} />
        </div>
      </div>
      <ArtifactPanel convId={id} />
    </div>
  )
}
