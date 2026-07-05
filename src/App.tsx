import { useState } from "react"
import { Menu } from "lucide-react"

import { AppSidebar } from "@/components/app-sidebar"
import { Composer } from "@/components/composer"
import { ShinyText } from "@/components/shiny-text"
import { Button } from "@/components/ui/button"

export function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-svh overflow-hidden">
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
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

        <div className="relative flex flex-1 flex-col items-center justify-center gap-8 px-4 pb-16">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(45%_38%_at_50%_60%,color-mix(in_oklch,var(--primary),transparent_84%)_0%,transparent_70%)]"
          />
          <h1 className="relative text-center text-3xl font-medium tracking-tight sm:text-4xl">
            <ShinyText text="Hi, what's on your mind?" />
          </h1>
          <Composer className="relative" />
        </div>
      </main>
    </div>
  )
}
