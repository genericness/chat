import { useEffect, useRef, useState } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { Code2, Download, ExternalLink, Eye, File, Monitor, Power, RotateCw, X } from "lucide-react"

import { Markdown } from "@/components/markdown"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useBackClose } from "@/hooks/use-back-close"
import { latestArtifact } from "@/lib/agent-tools"
import { IS_NATIVE } from "@/lib/api-base"
import type { ArtifactSnapshot } from "@/lib/db"
import { killConversationSandboxes } from "@/lib/e2b"
import { closeArtifactPanel, useArtifactPanel } from "@/lib/panel"
import { cn } from "@/lib/utils"

const LANGS: Record<string, string> = {
  tsx: "tsx", ts: "typescript", jsx: "jsx", js: "javascript", json: "json",
  css: "css", html: "html", md: "markdown", py: "python", svg: "xml",
}

function CodeBrowser({ files }: { files: NonNullable<ArtifactSnapshot["files"]> }) {
  // Default to the entry-ish file if present, else the first.
  const [sel, setSel] = useState(
    () => files.find((f) => /main\.(tsx|jsx|ts|js)$/.test(f.path))?.path ?? files[0]?.path
  )
  const current = files.find((f) => f.path === sel) ?? files[0]
  const lang = LANGS[current?.path.split(".").pop() ?? ""] ?? "text"

  return (
    <div className="flex min-h-0 flex-1">
      <ScrollArea className="w-44 shrink-0 border-r border-border bg-card/30">
        <div className="flex flex-col p-1.5">
          {files.map((f) => (
            <button
              key={f.path}
              onClick={() => setSel(f.path)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs",
                f.path === current?.path
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50"
              )}
              title={f.path}
            >
              <File className="size-3 shrink-0" />
              <span className="truncate">{f.path}</span>
            </button>
          ))}
        </div>
      </ScrollArea>
      <div className="min-w-0 flex-1 overflow-auto p-3">
        {current && <Markdown text={`\`\`\`${lang}\n${current.content}\n\`\`\``} />}
      </div>
    </div>
  )
}

function Elapsed({ since }: { since: number }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000))
  return (
    <span className="font-mono text-xs text-muted-foreground">
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
    </span>
  )
}

const PANEL_CLASS =
  "fixed inset-0 z-40 flex flex-col bg-background pb-[env(safe-area-inset-bottom)] md:static md:z-auto md:w-[46%] md:min-w-96 md:border-l md:border-border"
const HEADER_CLASS =
  "flex items-center gap-1 border-b border-border px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]"

export function ArtifactPanel({ convId }: { convId: string }) {
  const panel = useArtifactPanel()
  const [reloadKey, setReloadKey] = useState(0)
  const [view, setView] = useState<"preview" | "code">("preview")
  useBackClose(!!panel && panel.convId === convId, closeArtifactPanel)

  // Swipe right on the header dismisses the full-screen panel on touch.
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const headerTouch = {
    onTouchStart: (e: React.TouchEvent) => {
      swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    },
    onTouchMove: (e: React.TouchEvent) => {
      if (!swipe.current) return
      const dx = e.touches[0].clientX - swipe.current.x
      const dy = e.touches[0].clientY - swipe.current.y
      if (dx > 60 && dx > 1.5 * Math.abs(dy)) {
        swipe.current = null
        closeArtifactPanel()
      }
    },
    onTouchEnd: () => {
      swipe.current = null
    },
  }

  const artifact = useLiveQuery(
    () =>
      panel?.kind === "artifact" && panel.convId === convId
        ? latestArtifact(convId, panel.artifactId)
        : Promise.resolve(undefined),
    [panel?.kind, panel?.kind === "artifact" ? panel.artifactId : "", panel?.convId, convId]
  )

  if (!panel || panel.convId !== convId) return null

  if (panel.kind === "computer") {
    return (
      <aside className={PANEL_CLASS}>
        <div className={HEADER_CLASS} {...headerTouch}>
          <Monitor className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">Computer</span>
          <span className="mr-1 flex items-center gap-1.5">
            <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
            <Elapsed since={panel.startedAt} />
          </span>
          <Button
            variant="ghost"
            size="xs"
            className="text-destructive"
            onClick={() => {
              void killConversationSandboxes(convId)
              closeArtifactPanel()
            }}
          >
            <Power data-icon="inline-start" />
            Stop sandbox
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Close preview" onClick={closeArtifactPanel}>
            <X />
          </Button>
        </div>
        <iframe
          src={panel.streamUrl}
          title="Virtual desktop stream"
          className="min-h-0 w-full flex-1 border-0 bg-black"
          allow="fullscreen"
        />
      </aside>
    )
  }

  if (!artifact) return null

  const shareNative = () =>
    void import("@/lib/native").then((m) =>
      m.shareFile(`${artifact.artifactId}.html`, artifact.html)
    )

  const openInTab = () => {
    if (IS_NATIVE) return shareNative()
    const url = URL.createObjectURL(new Blob([artifact.html], { type: "text/html" }))
    window.open(url, "_blank")
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const download = () => {
    if (IS_NATIVE) return shareNative()
    const url = URL.createObjectURL(new Blob([artifact.html], { type: "text/html" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `${artifact.artifactId}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  const hasCode = !!artifact.files?.length

  return (
    <aside className={PANEL_CLASS}>
      <div className={HEADER_CLASS} {...headerTouch}>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {artifact.title}
        </span>
        {hasCode && (
          <div className="mr-1 flex rounded-lg border border-border p-0.5">
            <Button
              variant={view === "preview" ? "secondary" : "ghost"}
              size="xs"
              onClick={() => setView("preview")}
            >
              <Eye data-icon="inline-start" />
              Preview
            </Button>
            <Button
              variant={view === "code" ? "secondary" : "ghost"}
              size="xs"
              onClick={() => setView("code")}
            >
              <Code2 data-icon="inline-start" />
              Code
            </Button>
          </div>
        )}
        {view === "preview" && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Reload preview"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            <RotateCw />
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" aria-label="Open in new tab" onClick={openInTab}>
          <ExternalLink />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Download html" onClick={download}>
          <Download />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close preview"
          onClick={closeArtifactPanel}
        >
          <X />
        </Button>
      </div>
      {hasCode && view === "code" ? (
        <CodeBrowser files={artifact.files!} />
      ) : (
        /* no allow-same-origin: generated code must never reach our localStorage keys */
        <iframe
          key={reloadKey}
          srcDoc={artifact.html}
          sandbox="allow-scripts allow-forms allow-modals allow-popups"
          title={artifact.title}
          className="min-h-0 w-full flex-1 border-0 bg-white"
        />
      )}
    </aside>
  )
}
