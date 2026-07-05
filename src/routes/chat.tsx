import { useLiveQuery } from "dexie-react-hooks"
import { useParams } from "react-router-dom"

import { ArtifactPanel } from "@/components/artifact-panel"
import { Composer } from "@/components/composer"
import { MessageList } from "@/components/message-list"
import { ShinyText } from "@/components/shiny-text"
import { db, type Message } from "@/lib/db"

export function ChatPage() {
  const { id } = useParams<{ id: string }>()
  const messages = useLiveQuery(
    () =>
      id
        ? db.messages.where("convId").equals(id).sortBy("seq")
        : Promise.resolve([] as Message[]),
    [id]
  )

  if (!id) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4 pb-16">
        <div className="relative flex w-full flex-col items-center gap-8">
          {/* glow anchored to the greeting+composer group so it stays centered behind the input */}
          <div
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-1/2 h-[360px] w-[min(92vw,46rem)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/15 blur-[100px]"
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
        <MessageList messages={messages ?? []} />
        <div className="flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Composer convId={id} />
        </div>
      </div>
      <ArtifactPanel convId={id} />
    </div>
  )
}
