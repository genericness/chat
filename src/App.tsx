import { useEffect, useState } from "react"
import { Menu } from "lucide-react"
import { Outlet, useNavigate } from "react-router-dom"

import { AppSidebar } from "@/components/app-sidebar"
import { ChatSearch } from "@/components/chat-search"
import { Onboarding } from "@/components/onboarding"
import { SettingsDialog } from "@/components/settings-dialog"
import { Button } from "@/components/ui/button"
import { useBackClose } from "@/hooks/use-back-close"
import { useMediaQuery } from "@/hooks/use-media-query"
import { usePrefs } from "@/lib/profiles"
import { cn } from "@/lib/utils"

export function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const prefs = usePrefs()
  const navigate = useNavigate()

  // First run: no endpoints yet. Desktop gets the setup wizard; phones go
  // straight to Settings, which auto-opens the endpoint editor when empty.
  const isMobile = useMediaQuery("(max-width: 767px)")
  const needsSetup = !prefs.onboardedAt && prefs.profiles.length === 0
  const openSettings = () =>
    needsSetup && !isMobile ? setWizardOpen(true) : setSettingsOpen(true)

  useBackClose(sidebarOpen, () => setSidebarOpen(false))
  useBackClose(settingsOpen, () => setSettingsOpen(false))
  useBackClose(searchOpen, () => setSearchOpen(false))
  useBackClose(wizardOpen, () => setWizardOpen(false))

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

  // Touch screens below md: swipe in from the left edge to open the drawer,
  // swipe left anywhere (the drawer/backdrop own the screen) to close it.
  useEffect(() => {
    let start: { x: number; y: number; edge: boolean } | null = null
    const onStart = (e: TouchEvent) => {
      if (matchMedia("(min-width: 768px)").matches) return
      const t = e.touches[0]
      start = { x: t.clientX, y: t.clientY, edge: t.clientX < 24 }
    }
    const onMove = (e: TouchEvent) => {
      if (!start) return
      const { x, y, edge } = start
      const t = e.touches[0]
      const dx = t.clientX - x
      const dy = t.clientY - y
      if (Math.abs(dx) < 60 || Math.abs(dx) < 1.5 * Math.abs(dy)) return
      start = null
      setSidebarOpen((open) => {
        if (!open && dx > 0 && edge) return true
        if (open && dx < 0) return false
        return open
      })
    }
    const onEnd = () => {
      start = null
    }
    document.addEventListener("touchstart", onStart, { passive: true })
    document.addEventListener("touchmove", onMove, { passive: true })
    document.addEventListener("touchend", onEnd, { passive: true })
    return () => {
      document.removeEventListener("touchstart", onStart)
      document.removeEventListener("touchmove", onMove)
      document.removeEventListener("touchend", onEnd)
    }
  }, [])

  return (
    <div className="kb-pad flex h-svh overflow-hidden pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      <AppSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onOpenSettings={openSettings}
        onOpenSearch={() => setSearchOpen(true)}
        needsSetup={needsSetup}
      />
      <main className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex items-center p-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            className={cn(needsSetup && "text-primary ring-2 ring-primary/50")}
          >
            <Menu />
          </Button>
          {needsSetup && (
            <span className="ml-1 text-sm font-medium text-primary">
              Set up here
            </span>
          )}
        </div>
        <Outlet />
      </main>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <ChatSearch open={searchOpen} onOpenChange={setSearchOpen} />
      <Onboarding open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  )
}
