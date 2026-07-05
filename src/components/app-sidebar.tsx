import { MessageSquarePlus, Search, Settings } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

interface AppSidebarProps {
  open: boolean
  onClose: () => void
}

export function AppSidebar({ open, onClose }: AppSidebarProps) {
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
          <a href="/" className="font-pixel text-lg tracking-tight text-primary">
            chat
          </a>
        </div>

        <div className="flex flex-col gap-1 px-2 pt-2">
          <Button
            variant="secondary"
            className="justify-start gap-2 rounded-full"
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
            <p className="px-2 py-3 text-sm text-muted-foreground/70">
              No chats yet
            </p>
          </ScrollArea>
        </div>

        <div className="border-t border-sidebar-border p-2">
          <Button variant="ghost" className="w-full justify-start gap-2">
            <Settings />
            Settings
          </Button>
        </div>
      </aside>
    </>
  )
}
