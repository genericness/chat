import { StrictMode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "react-router-dom"

import "@fontsource-variable/inter"
import "@fontsource-variable/jetbrains-mono"
import "@fontsource/pixelify-sans"
import "./index.css"

// Platform wiring for @chat/core — must precede every other app import.
import "@/lib/core-setup"

import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { runJanitor } from "@/lib/db"
import { killAllSandboxes } from "@/lib/e2b"
import { initSync } from "@/lib/sync"
import { router } from "@/router"

void runJanitor()
initSync()

// Best-effort: tear down E2B sandboxes if the tab closes mid-session (E2B's
// server-side timeout is the real backstop).
window.addEventListener("pagehide", () => void killAllSandboxes())

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delay={150}>
        <RouterProvider router={router} />
      </TooltipProvider>
      <Toaster position="bottom-right" />
    </QueryClientProvider>
  </StrictMode>
)
