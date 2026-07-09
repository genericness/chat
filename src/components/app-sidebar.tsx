import { useState } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import {
  ArrowDown,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Search,
  Settings,
  Trash2,
} from "lucide-react"
import { NavLink, useNavigate, useParams } from "react-router-dom"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { db, deleteConversation, renameConversation } from "@/lib/db"
import { cn } from "@/lib/utils"

interface AppSidebarProps {
  open: boolean
  onClose: () => void
  onOpenSettings: () => void
  onOpenSearch: () => void
  needsSetup?: boolean
}

export function AppSidebar({
  open,
  onClose,
  onOpenSettings,
  onOpenSearch,
  needsSetup,
}: AppSidebarProps) {
  const navigate = useNavigate()
  const { id: activeId } = useParams<{ id: string }>()
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")

  const conversations = useLiveQuery(() =>
    db.conversations
      .orderBy("updatedAt")
      .reverse()
      .filter((c) => !c.deletedAt)
      .toArray()
  )
  const streamingConvIds = useLiveQuery(async () => {
    const rows = await db.messages.where("status").equals("streaming").toArray()
    return new Set(rows.map((m) => m.convId))
  })

  const commitRename = async () => {
    if (renamingId && renameValue.trim()) {
      await renameConversation(renamingId, renameValue.trim())
    }
    setRenamingId(null)
  }

  const remove = async (id: string) => {
    await deleteConversation(id)
    if (id === activeId) navigate("/")
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[min(18rem,85vw)] flex-col border-r border-sidebar-border bg-sidebar pl-[env(safe-area-inset-left)] text-sidebar-foreground transition-transform md:static md:z-auto md:w-64 md:translate-x-0 md:pl-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-2">
          <NavLink to="/" className="font-pixel text-lg tracking-tight text-primary">
            chat
          </NavLink>
        </div>

        <div className="flex flex-col gap-1 px-2 pt-2">
          <Button
            variant="secondary"
            className="justify-start gap-2 rounded-full"
            onClick={() => {
              navigate("/")
              onClose()
            }}
          >
            <MessageSquarePlus />
            New chat
          </Button>
          <Button
            variant="ghost"
            className="justify-start gap-2 rounded-full"
            onClick={() => {
              onOpenSearch()
              onClose()
            }}
          >
            <Search />
            Search chats
            <kbd className="ml-auto text-xs text-muted-foreground/70 pointer-coarse:hidden">⌘K</kbd>
          </Button>
        </div>

        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          <p className="px-4 pb-1 text-xs font-medium text-muted-foreground">
            Recent
          </p>
          <ScrollArea className="min-h-0 flex-1 px-2">
            {conversations?.length === 0 && (
              <p className="px-2 py-3 text-sm text-muted-foreground/70">
                No chats yet
              </p>
            )}
            <div className="flex flex-col gap-0.5 pb-2">
              {conversations?.map((c) =>
                renamingId === c.id ? (
                  <Input
                    key={c.id}
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename()
                      if (e.key === "Escape") setRenamingId(null)
                    }}
                    className="h-8"
                  />
                ) : (
                  <div
                    key={c.id}
                    className={cn(
                      "group/row flex items-center rounded-lg hover:bg-sidebar-accent",
                      c.id === activeId && "bg-sidebar-accent"
                    )}
                  >
                    <NavLink
                      to={`/c/${c.id}`}
                      onClick={onClose}
                      className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-sm"
                      title={c.title}
                    >
                      <span className="min-w-0 flex-1 truncate">{c.title}</span>
                      {streamingConvIds?.has(c.id) && (
                        <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
                      )}
                    </NavLink>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="mr-1 opacity-0 group-hover/row:opacity-100 aria-expanded:opacity-100 pointer-coarse:opacity-100"
                            aria-label="Chat actions"
                          >
                            <MoreHorizontal />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem
                          onClick={() => {
                            setRenameValue(c.title)
                            setRenamingId(c.id)
                          }}
                        >
                          <Pencil /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => remove(c.id)}
                        >
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="border-t border-sidebar-border p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {needsSetup && (
            <div className="flex items-center gap-2 px-2 pb-2 text-primary">
              <ArrowDown className="size-8 shrink-0 animate-bounce" strokeWidth={2.5} />
              <span className="text-sm font-medium leading-tight">
                Set up here to
                <br />
                add your first model
              </span>
            </div>
          )}
          <Button
            variant={needsSetup ? "secondary" : "ghost"}
            className={cn(
              "w-full justify-start gap-2",
              needsSetup && "ring-2 ring-primary/60"
            )}
            onClick={onOpenSettings}
          >
            <Settings />
            {needsSetup ? "Get started" : "Settings"}
          </Button>
        </div>
      </aside>
    </>
  )
}
