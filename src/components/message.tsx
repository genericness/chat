import { memo, useEffect, useMemo, useState } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { Check, Copy, FileText, Pencil, RefreshCw } from "lucide-react"

import { Markdown } from "@/components/markdown"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { db, type Message } from "@/lib/db"
import { editResend, regenerate } from "@/lib/generation"

export function Sources({ results }: { results: NonNullable<Message["searchResults"]> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {results.map((r, i) => (
        <a
          key={r.url + i}
          href={r.url}
          target="_blank"
          rel="noreferrer"
          title={r.title}
          className="flex max-w-56 items-center gap-1.5 rounded-full border border-border/70 bg-card/40 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
        >
          <span className="shrink-0 font-mono text-primary">[{i + 1}]</span>
          <span className="truncate">{new URL(r.url).hostname.replace(/^www\./, "")}</span>
        </a>
      ))}
    </div>
  )
}

function AttachmentThumbs({ ids }: { ids: string[] }) {
  const atts = useLiveQuery(
    async () => (await db.attachments.bulkGet(ids)).filter((a) => a !== undefined),
    [ids.join()]
  )
  const urls = useMemo(
    () =>
      (atts ?? []).map((a) =>
        a.mime.startsWith("image/") ? URL.createObjectURL(a.blob) : undefined
      ),
    [atts]
  )
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls])

  if (!atts?.length) return null
  return (
    <div className="flex max-w-[85%] flex-wrap justify-end gap-2">
      {atts.map((a, i) =>
        urls[i] ? (
          <img
            key={a.id}
            src={urls[i]}
            alt={a.name}
            className="max-h-48 rounded-xl border border-border/70 object-cover"
          />
        ) : (
          <div
            key={a.id}
            className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-muted px-2.5 py-1.5"
          >
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <span className="max-w-40 truncate text-xs">{a.name}</span>
          </div>
        )
      )}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className="text-muted-foreground"
      aria-label="Copy message"
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? <Check className="text-primary" /> : <Copy />}
    </Button>
  )
}

export const MessageBubble = memo(function MessageBubble({
  message,
  canRegenerate = false,
}: {
  message: Message
  canRegenerate?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")

  if (message.role === "user") {
    if (editing) {
      return (
        <div className="flex flex-col items-end gap-2">
          <Textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="min-h-20 w-full max-w-[85%]"
          />
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!draft.trim()}
              onClick={() => {
                setEditing(false)
                void editResend(message.id, draft.trim())
              }}
            >
              Save & send
            </Button>
          </div>
        </div>
      )
    }
    return (
      <div className="group/msg flex flex-col items-end gap-1">
        {message.attachmentIds && <AttachmentThumbs ids={message.attachmentIds} />}
        {message.content && (
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-[0.95rem] whitespace-pre-wrap">
            {message.content}
          </div>
        )}
        <div className="flex opacity-0 transition-opacity group-hover/msg:opacity-100">
          <CopyButton text={message.content} />
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            aria-label="Edit message"
            onClick={() => {
              setDraft(message.content)
              setEditing(true)
            }}
          >
            <Pencil />
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="group/msg flex flex-col gap-1">
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
      {message.status !== "streaming" && (
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/msg:opacity-100">
          <CopyButton text={message.content} />
          {canRegenerate && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              aria-label="Regenerate response"
              onClick={() => void regenerate(message.id)}
            >
              <RefreshCw />
            </Button>
          )}
          {message.status === "stopped" && message.content && (
            <span className="text-xs text-muted-foreground">stopped</span>
          )}
        </div>
      )}
    </div>
  )
})
