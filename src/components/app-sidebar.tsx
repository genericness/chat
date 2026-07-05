import { useState } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { MessageSquarePlus, MoreHorizontal, Pencil, Search, Settings, Trash2 } from "lucide-react"
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
}

export function AppSidebar({ open, onClose, onOpenSettings }: AppSidebarProps) {
  const navigate = useNavigate()
  const { id: activeId } = useParams<{ id: string }>()
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")

  const conversations = useLiveQuery(() =>
    db.conversations.orderBy("updatedAt").reverse().toArray()
  )

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
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform md:static md:z-auto md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center px-4 pt-4 pb-2">
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
          <Button variant="ghost" className="justify-start gap-2 rounded-full">
            <Search />
            Search chats
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
                      className="min-w-0 flex-1 truncate px-2 py-1.5 text-sm"
                      title={c.title}
                    >
                      {c.title}
                    </NavLink>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="mr-1 opacity-0 group-hover/row:opacity-100 aria-expanded:opacity-100"
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

        <div className="border-t border-sidebar-border p-2">
          <Button
            variant="ghost"
            className="w-full justify-start gap-2"
            onClick={onOpenSettings}
          >
            <Settings />
            Settings
          </Button>
        </div>
      </aside>
    </>
  )
}
