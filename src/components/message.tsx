import { memo, useEffect, useMemo, useState } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import {
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  Copy,
  FileText,
  LayoutTemplate,
  Loader2,
  Pencil,
  RefreshCw,
  Wrench,
  X,
} from "lucide-react"

import { Markdown } from "@/components/markdown"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { answerQuestion } from "@/lib/agent-tools"
import { db, type Message, type PendingQuestion } from "@/lib/db"
import { editResend, regenerate } from "@/lib/generation"
import { haptic } from "@/lib/haptics"
import { openArtifactPanel } from "@/lib/panel"
import { useStreamedMessage } from "@/lib/stream-state"
import { cn } from "@/lib/utils"

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m ${s}s`
}

/** Generation stats under an assistant reply: hover on desktop, tap on touch. */
function StatsBadge({ stats }: { stats: NonNullable<Message["stats"]> }) {
  const secs = stats.durationMs / 1000
  const tps =
    stats.completionTokens && secs > 0
      ? (stats.completionTokens / secs).toFixed(1)
      : null
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        nativeButton={false}
        render={
          <span className="cursor-default px-1 text-xs text-muted-foreground/70 tabular-nums">
            {fmtDuration(stats.durationMs)}
            {tps ? ` · ${tps} tok/s` : ""}
          </span>
        }
      />
      <PopoverContent className="w-auto gap-0.5 px-3 py-2 text-xs" side="top">
        <span>{fmtDuration(stats.durationMs)} to generate</span>
        {stats.completionTokens != null ? (
          <>
            <span>{stats.completionTokens.toLocaleString()} output tokens</span>
            {tps && <span>{tps} tokens/sec</span>}
            {stats.promptTokens != null && (
              <span className="text-muted-foreground">
                {stats.promptTokens.toLocaleString()} prompt ·{" "}
                {(stats.totalTokens ?? 0).toLocaleString()} total
              </span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">token usage not reported</span>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Streamed chain-of-thought: expanded while the model is thinking, collapsed after. */
export function Reasoning({ message }: { message: Message }) {
  if (!message.reasoning) return null
  const thinking = message.status === "streaming" && !message.content
  return (
    <details
      key={thinking ? "live" : "settled"} // remount to collapse once the answer starts
      open={thinking || undefined}
      className="group/think my-1 rounded-lg border border-border/50 bg-muted/30 px-3 py-2"
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground select-none [&::-webkit-details-marker]:hidden">
        <Brain className="size-3.5" />
        {thinking ? "Thinking…" : "Thought process"}
        <ChevronDown className="size-3 transition-transform group-open/think:rotate-180" />
      </summary>
      <div className="mt-2 border-t border-border/40 pt-2 text-sm **:text-muted-foreground">
        <Markdown text={message.reasoning} streaming={thinking} />
      </div>
    </details>
  )
}

export function ArtifactCards({ message }: { message: Message }) {
  if (!message.artifacts?.length) return null
  return (
    <div className="flex flex-wrap gap-2">
      {message.artifacts.map((a) => (
        <button
          key={a.artifactId}
          className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border/70 bg-card/40 px-3.5 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-card/60"
          onClick={() => openArtifactPanel(message.convId, a.artifactId)}
        >
          <LayoutTemplate className="size-5 shrink-0 text-primary" />
          <span className="flex flex-col">
            <span className="text-sm font-medium">{a.title}</span>
            <span className="text-xs text-muted-foreground">Click to open preview</span>
          </span>
        </button>
      ))}
    </div>
  )
}

export function QuestionCard({ q }: { q: PendingQuestion }) {
  const [selected, setSelected] = useState<string[]>([])
  const [text, setText] = useState("")

  const submit = (answer: string) => {
    if (answer.trim()) answerQuestion(q.toolCallId, answer.trim())
  }

  return (
    <div className="flex max-w-xl flex-col gap-3 rounded-xl border border-primary/40 bg-card/60 p-4">
      <p className="text-sm font-medium">{q.question}</p>
      {q.options && q.options.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {q.options.map((opt) => (
            <Button
              key={opt}
              variant={selected.includes(opt) ? "secondary" : "outline"}
              size="sm"
              className={cn("rounded-full", selected.includes(opt) && "border-primary/50")}
              onClick={() => {
                if (q.multiple) {
                  setSelected((s) =>
                    s.includes(opt) ? s.filter((x) => x !== opt) : [...s, opt]
                  )
                } else {
                  submit(opt)
                }
              }}
            >
              {opt}
            </Button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit(text || selected.join(", "))
          }}
          placeholder={q.multiple ? "Or type an answer…" : "Type an answer…"}
          className="h-8"
        />
        <Button
          size="icon-sm"
          className="shrink-0 rounded-full"
          aria-label="Send answer"
          disabled={!text.trim() && selected.length === 0}
          onClick={() => submit(text || selected.join(", "))}
        >
          <ArrowUp />
        </Button>
      </div>
    </div>
  )
}

/** Pull a display detail out of (possibly still-streaming, partial) JSON args. */
function chipLabel(c: NonNullable<Message["toolCalls"]>[number]): string {
  // MCP tools are qualified "server__tool"; show the tool part.
  let label = c.name.split("__").pop() ?? c.name
  const detail =
    /"(?:query|title)"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(c.args)?.[1] ??
    /"question"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(c.args)?.[1]
  if (detail) label += `: “${detail.slice(0, 60)}”`
  // Writing an artifact can take a while — show the document growing.
  if (
    (c.status === "streaming" || c.status === "running") &&
    /artifact/.test(c.name) &&
    c.args.length > 512
  ) {
    label += ` · ${(c.args.length / 1024).toFixed(1)} KB`
  }
  return label
}

export function ToolChips({ calls }: { calls: NonNullable<Message["toolCalls"]> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {calls.map((c, i) => (
        <span
          key={c.id + i}
          className="flex max-w-80 items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground"
        >
          {c.status === "streaming" || c.status === "running" ? (
            <Loader2 className="size-3 shrink-0 animate-spin text-primary" />
          ) : c.status === "error" ? (
            <X className="size-3 shrink-0 text-destructive" />
          ) : (
            <Wrench className="size-3 shrink-0 text-primary" />
          )}
          <span className="truncate">{chipLabel(c)}</span>
        </span>
      ))}
    </div>
  )
}

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
        haptic()
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
  sources,
}: {
  message: Message
  canRegenerate?: boolean
  /** Search results for citation links; defaults to the message's own. */
  sources?: Message["searchResults"]
}) {
  message = useStreamedMessage(message)
  const citeSources = message.searchResults ?? sources
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
        <div className="flex opacity-0 transition-opacity group-hover/msg:opacity-100 pointer-coarse:opacity-100">
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
      <Reasoning message={message} />
      {message.toolCalls && message.toolCalls.length > 0 && (
        <ToolChips calls={message.toolCalls} />
      )}
      <ArtifactCards message={message} />
      {message.pendingQuestion && message.status === "streaming" && (
        <QuestionCard key={message.pendingQuestion.toolCallId} q={message.pendingQuestion} />
      )}
      <div>
        <Markdown
          text={message.content}
          streaming={message.status === "streaming"}
          sources={citeSources}
        />
        {message.status === "streaming" &&
          !message.content &&
          !message.reasoning &&
          !message.pendingQuestion && (
            <span className="mt-1 inline-block h-4 w-2 animate-pulse rounded-xs bg-primary/70" />
          )}
      </div>
      {message.searchResults && message.status !== "streaming" && (
        <Sources results={message.searchResults} />
      )}
      {message.status === "error" && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {message.error}
        </p>
      )}
      {message.status !== "streaming" && (
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/msg:opacity-100 pointer-coarse:opacity-100">
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
          {message.stats && <StatsBadge stats={message.stats} />}
        </div>
      )}
    </div>
  )
})
