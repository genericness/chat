import { useLiveQuery } from "dexie-react-hooks"
import { useParams } from "react-router-dom"

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
      <div className="relative flex flex-1 flex-col items-center justify-center gap-8 px-4 pb-16">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(45%_38%_at_50%_60%,color-mix(in_oklch,var(--primary),transparent_84%)_0%,transparent_70%)]"
        />
        <h1 className="relative text-center text-3xl font-medium tracking-tight sm:text-4xl">
          <ShinyText text="Hi, what's on your mind?" />
        </h1>
        <Composer className="relative" />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <MessageList messages={messages ?? []} />
      <div className="flex justify-center px-4 pb-4">
        <Composer convId={id} />
      </div>
    </div>
  )
}
