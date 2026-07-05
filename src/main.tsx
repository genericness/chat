import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "@fontsource-variable/inter"
import "@fontsource-variable/jetbrains-mono"
import "@fontsource/pixelify-sans"
import "./index.css"

import { App } from "@/App"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider delay={150}>
      <App />
    </TooltipProvider>
    <Toaster position="bottom-right" />
  </StrictMode>
)
