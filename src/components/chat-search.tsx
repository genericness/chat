import { useDeferredValue, useState } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { MessageSquare } from "lucide-react"
import { useNavigate } from "react-router-dom"

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { db } from "@/lib/db"

interface Hit {
  convId: string
  title: string
  snippet?: string
}

interface ChatSearchProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ChatSearch({ open, onOpenChange }: ChatSearchProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query)

  // ponytail: linear scan over local messages; add an index if libraries get huge.
  const hits = useLiveQuery(async () => {
    if (!open) return [] as Hit[]
    const q = deferredQuery.trim().toLowerCase()
    if (!q) {
      const recent = await db.conversations
        .orderBy("updatedAt")
        .reverse()
        .filter((c) => !c.deletedAt)
        .limit(10)
        .toArray()
      return recent.map<Hit>((c) => ({ convId: c.id, title: c.title }))
    }
    const byId = new Map<string, Hit>()
    const convs = await db.conversations
      .filter((c) => !c.deletedAt && c.title.toLowerCase().includes(q))
      .limit(10)
      .toArray()
    for (const c of convs) byId.set(c.id, { convId: c.id, title: c.title })

    const msgs = await db.messages
      .filter((m) => m.content.toLowerCase().includes(q))
      .limit(15)
      .toArray()
    const missingIds = [
      ...new Set(msgs.filter((m) => !byId.has(m.convId)).map((m) => m.convId)),
    ]
    const missingConvs = await db.conversations.bulkGet(missingIds)
    const convById = new Map<string, NonNullable<(typeof missingConvs)[number]>>()
    for (const conv of missingConvs) {
      if (conv && !conv.deletedAt) convById.set(conv.id, conv)
    }
    for (const m of msgs) {
      if (byId.has(m.convId)) continue
      const conv = convById.get(m.convId)
      if (!conv) continue
      const at = m.content.toLowerCase().indexOf(q)
      const snippet = `${at > 20 ? "…" : ""}${m.content.slice(Math.max(0, at - 20), at + 60)}`
      byId.set(m.convId, { convId: m.convId, title: conv.title, snippet })
    }
    return [...byId.values()]
  }, [open, deferredQuery])

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setQuery("")
      }}
      title="Search chats"
      description="Search across all conversations"
    >
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search chats…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList className="max-h-80">
          <CommandEmpty>No matches</CommandEmpty>
          {hits?.map((h) => (
            <CommandItem
              key={h.convId}
              value={h.convId}
              onSelect={() => {
                onOpenChange(false)
                setQuery("")
                navigate(`/c/${h.convId}`)
              }}
              className="gap-2"
            >
              <MessageSquare className="shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm">{h.title}</span>
                {h.snippet && (
                  <span className="truncate text-xs text-muted-foreground">
                    {h.snippet}
                  </span>
                )}
              </div>
            </CommandItem>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
