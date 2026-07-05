import { useEffect, useState } from "react"
import { Menu } from "lucide-react"
import { Outlet } from "react-router-dom"

import { AppSidebar } from "@/components/app-sidebar"
import { SettingsDialog } from "@/components/settings-dialog"
import { Button } from "@/components/ui/button"
import { usePrefs } from "@/lib/profiles"

export function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const prefs = usePrefs()

  // First run: no endpoints configured yet.
  useEffect(() => {
    if (prefs.profiles.length === 0) setSettingsOpen(true)
  }, [prefs.profiles.length])

  return (
    <div className="flex h-svh overflow-hidden">
      <AppSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <main className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex items-center p-2 md:hidden">
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
    </div>
  )
}
