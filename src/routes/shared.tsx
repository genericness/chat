import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { Loader2 } from "lucide-react"

import { Markdown } from "@/components/markdown"
import { fetchSharedChat, type ShareSnapshot } from "@/lib/share"

// Public, auth-free read-only view of a shared chat snapshot.
export function SharedChat() {
  const { token } = useParams<{ token: string }>()
  const [state, setState] = useState<
    { status: "loading" } | { status: "error"; message: string } | { status: "ok"; snapshot: ShareSnapshot }
  >({ status: "loading" })

  useEffect(() => {
    let live = true
    setState({ status: "loading" })
    fetchSharedChat(token!)
      .then((snapshot) => live && setState({ status: "ok", snapshot }))
      .catch((e) => live && setState({ status: "error", message: e instanceof Error ? e.message : "Not found" }))
    return () => {
      live = false
    }
  }, [token])

  if (state.status === "loading") {
    return (
      <div className="flex min-h-[100svh] items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }
  if (state.status === "error") {
    return (
      <div className="flex min-h-[100svh] flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-lg font-medium">Chat unavailable</p>
        <p className="text-sm text-muted-foreground">{state.message}</p>
        <a href="/" className="mt-2 text-sm text-primary hover:underline">
          Go to chat
        </a>
      </div>
    )
  }

  const { snapshot } = state
  return (
    <div className="mx-auto min-h-[100svh] max-w-3xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between gap-4 border-b border-border pb-4">
        <h1 className="text-xl font-semibold">{snapshot.title}</h1>
        <a href="/" className="font-pixel text-lg text-primary">
          chat
        </a>
      </div>
      <p className="mb-6 text-xs text-muted-foreground">
        A read-only shared conversation. Messages below are a snapshot.
      </p>
      <div className="flex flex-col gap-6">
        {snapshot.messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-[0.95rem] whitespace-pre-wrap">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex flex-col gap-1">
              {m.model && <span className="text-xs text-muted-foreground">{m.model}</span>}
              <Markdown text={m.content} />
            </div>
          )
        )}
      </div>
    </div>
  )
}
