import { useRef, useState } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import {
  ArrowUp,
  FileText,
  Globe,
  Loader2,
  Plus,
  SlidersHorizontal,
  Square,
  X,
} from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { ChatSettings } from "@/components/chat-settings"
import { ModelPicker } from "@/components/model-picker"
import { Button } from "@/components/ui/button"
import { useBackClose } from "@/hooks/use-back-close"
import { db, type Message } from "@/lib/db"
import { sendMessage, stopConversation } from "@/lib/generation"
import { haptic } from "@/lib/haptics"
import { activeProfile, usePrefs } from "@/lib/profiles"
import { cn } from "@/lib/utils"

const MAX_TEXT_FILE = 100 * 1024

interface Pending {
  file: File
  url?: string // object URL for image previews
}

interface ComposerProps {
  convId?: string
  className?: string
}

export function Composer({ convId, className }: ComposerProps) {
  const [text, setText] = useState("")
  const [pending, setPending] = useState<Pending[]>([])
  const [chatSettingsOpen, setChatSettingsOpen] = useState(false)
  const [webSearch, setWebSearch] = useState(false)
  const [sending, setSending] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const prefs = usePrefs()
  const profile = activeProfile(prefs)
  useBackClose(chatSettingsOpen, () => setChatSettingsOpen(false))

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

  // Compare mode: after all candidates settle with none promoted, block sending
  // until the user picks a response to continue the thread from.
  const needsPromote = useLiveQuery(async () => {
    if (!convId) return false
    const msgs = await db.messages.where("convId").equals(convId).sortBy("seq")
    const lastUser = [...msgs].reverse().find((m) => m.role === "user")
    if (!lastUser) return false
    const replies = msgs.filter((m) => m.replyTo === lastUser.id)
    return (
      replies.length > 1 &&
      !replies.some((r) => r.active) &&
      replies.every((r) => r.status !== "streaming") &&
      replies.some((r) => r.status === "done" || r.status === "stopped")
    )
  }, [convId])

  const addFiles = (files: FileList | File[]) => {
    const next: Pending[] = []
    for (const file of files) {
      const isImage = file.type.startsWith("image/")
      if (!isImage && file.size > MAX_TEXT_FILE) {
        toast.error(`${file.name} is too large to inline (max 100KB for text files)`)
        continue
      }
      next.push({ file, url: isImage ? URL.createObjectURL(file) : undefined })
    }
    if (next.length) setPending((p) => [...p, ...next])
  }

  const removePending = (i: number) => {
    setPending((p) => {
      if (p[i]?.url) URL.revokeObjectURL(p[i].url)
      return p.filter((_, idx) => idx !== i)
    })
  }

  const send = async () => {
    const t = text.trim()
    if ((!t && pending.length === 0) || isStreaming || needsPromote || sending) return
    haptic()
    setText("")
    const files = pending.map((p) => p.file)
    pending.forEach((p) => p.url && URL.revokeObjectURL(p.url))
    setPending([])
    setSending(true)
    try {
      const id = await sendMessage(convId ?? null, t, files, { webSearch })
      if (!convId) navigate(`/c/${id}`)
    } catch (err) {
      setText(t)
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={cn("w-full max-w-2xl", className)}>
      <div
        className="flex flex-col rounded-4xl border border-border/70 bg-card/40 p-2 shadow-lg backdrop-blur-sm transition-colors focus-within:border-input"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          addFiles(e.dataTransfer.files)
        }}
      >
        {pending.length > 0 && (
          <div className="flex flex-wrap gap-2 px-2 pt-1 pb-2">
            {pending.map((p, i) => (
              <div
                key={i}
                className="group/att relative overflow-hidden rounded-lg border border-border/70 bg-muted"
              >
                {p.url ? (
                  <img src={p.url} alt={p.file.name} className="size-16 object-cover" />
                ) : (
                  <div className="flex h-16 max-w-40 items-center gap-1.5 px-2">
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate text-xs">{p.file.name}</span>
                  </div>
                )}
                <button
                  className="absolute top-0.5 right-0.5 cursor-pointer rounded-full bg-black/60 p-0.5 opacity-0 transition-opacity group-hover/att:opacity-100 pointer-coarse:p-1 pointer-coarse:opacity-100"
                  onClick={() => removePending(i)}
                  aria-label={`Remove ${p.file.name}`}
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {/* Phones: textarea takes the full top row, controls sit underneath.
            sm+: everything on one row with the textarea flexing. */}
        <div className="flex flex-wrap items-end gap-1 sm:flex-nowrap sm:gap-1.5">
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files)
              e.target.value = ""
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 rounded-full text-muted-foreground"
            aria-label="Add attachment"
            onClick={() => fileInput.current?.click()}
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
            onPaste={(e) => {
              if (e.clipboardData.files.length) {
                e.preventDefault()
                addFiles(e.clipboardData.files)
              }
            }}
            placeholder={needsPromote ? "Pick a response to continue" : "Ask anything"}
            disabled={needsPromote}
            className="order-first max-h-44 min-h-8 w-full resize-none self-center bg-transparent px-2 pt-1.5 pb-1 text-base leading-6 outline-none field-sizing-content placeholder:text-muted-foreground disabled:opacity-60 sm:order-none sm:w-auto sm:flex-1 sm:px-1 sm:py-1 sm:text-[0.95rem]"
          />
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "shrink-0 rounded-full text-muted-foreground",
              webSearch && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary"
            )}
            aria-label={webSearch ? "Web search on" : "Web search off"}
            aria-pressed={webSearch}
            onClick={() => setWebSearch((v) => !v)}
          >
            <Globe className="size-4" />
          </Button>
          {convId && (
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 rounded-full text-muted-foreground"
              aria-label="Chat settings"
              onClick={() => setChatSettingsOpen(true)}
            >
              <SlidersHorizontal className="size-4" />
            </Button>
          )}
          <div aria-hidden className="grow sm:hidden" />
          <ModelPicker profile={profile} />
          {isStreaming ? (
            <Button
              size="icon"
              variant="secondary"
              className="shrink-0 rounded-full"
              onClick={() => {
                if (!convId) return
                haptic("medium")
                void stopConversation(convId)
              }}
              aria-label="Stop generating"
            >
              <Square className="size-4 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="shrink-0 rounded-full"
              disabled={(!text.trim() && pending.length === 0) || !!needsPromote || sending}
              onClick={() => void send()}
              aria-label="Send"
            >
              {sending ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <ArrowUp className="size-5" />
              )}
            </Button>
          )}
        </div>
      </div>
      {convId && (
        <ChatSettings
          convId={convId}
          open={chatSettingsOpen}
          onOpenChange={setChatSettingsOpen}
        />
      )}
    </div>
  )
}
