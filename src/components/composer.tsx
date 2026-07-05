import { useState } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { ArrowUp, ChevronDown, Plus, Square } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { db, type Message } from "@/lib/db"
import { sendMessage, stopConversation } from "@/lib/generation"
import { activeProfile, usePrefs } from "@/lib/profiles"
import { cn } from "@/lib/utils"

interface ComposerProps {
  convId?: string
  className?: string
}

export function Composer({ convId, className }: ComposerProps) {
  const [text, setText] = useState("")
  const navigate = useNavigate()
  const prefs = usePrefs()
  const profile = activeProfile(prefs)

  const streaming = useLiveQuery(
    () =>
      convId
        ? db.messages
            .where("status")
            .equals("streaming")
            .filter((m) => m.convId === convId)
            .toArray()
        : Promise.resolve([] as Message[]),
    [convId]
  )
  const isStreaming = (streaming?.length ?? 0) > 0

  const send = async () => {
    const t = text.trim()
    if (!t || isStreaming) return
    setText("")
    try {
      const id = await sendMessage(convId ?? null, t)
      if (!convId) navigate(`/c/${id}`)
    } catch (err) {
      setText(t)
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className={cn("w-full max-w-2xl", className)}>
      <div className="flex items-end gap-1.5 rounded-4xl border border-border/70 bg-card/40 p-2 shadow-lg backdrop-blur-sm transition-colors focus-within:border-input">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 rounded-full text-muted-foreground"
          aria-label="Add attachment"
        >
          <Plus className="size-5" />
        </Button>
        <textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder="Ask anything"
          className="max-h-44 flex-1 resize-none self-center bg-transparent px-1 py-1.5 text-[0.95rem] outline-none field-sizing-content placeholder:text-muted-foreground"
        />
        <Button
          variant="ghost"
          size="sm"
          className="max-w-40 shrink-0 gap-1 rounded-full text-muted-foreground"
        >
          <span className="truncate">{profile?.defaultModel ?? "model"}</span>
          <ChevronDown className="size-3.5 shrink-0" />
        </Button>
        {isStreaming ? (
          <Button
            size="icon"
            variant="secondary"
            className="shrink-0 rounded-full"
            onClick={() => convId && void stopConversation(convId)}
            aria-label="Stop generating"
          >
            <Square className="size-4 fill-current" />
          </Button>
        ) : (
          <Button
            size="icon"
            className="shrink-0 rounded-full"
            disabled={!text.trim()}
            onClick={() => void send()}
            aria-label="Send"
          >
            <ArrowUp className="size-5" />
          </Button>
        )}
      </div>
    </div>
  )
}
