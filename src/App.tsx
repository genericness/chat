import { useEffect, useState } from "react"
import { Menu } from "lucide-react"
import { Outlet, useNavigate } from "react-router-dom"

import { AppSidebar } from "@/components/app-sidebar"
import { ChatSearch } from "@/components/chat-search"
import { Onboarding } from "@/components/onboarding"
import { SettingsDialog } from "@/components/settings-dialog"
import { Button } from "@/components/ui/button"

export function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === "k") {
        e.preventDefault()
        setSearchOpen((v) => !v)
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault()
        navigate("/")
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [navigate])

  return (
    <div className="flex h-svh overflow-hidden">
      <AppSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
      />
      <main className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex items-center p-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu />
          </Button>
        </div>
        <Outlet />
      </main>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <ChatSearch open={searchOpen} onOpenChange={setSearchOpen} />
      <Onboarding />
    </div>
  )
}
