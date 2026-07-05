import { useState } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { Download, ExternalLink, RotateCw, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { latestArtifact } from "@/lib/agent-tools"
import { closeArtifactPanel, useArtifactPanel } from "@/lib/panel"

export function ArtifactPanel({ convId }: { convId: string }) {
  const panel = useArtifactPanel()
  const [reloadKey, setReloadKey] = useState(0)

  const artifact = useLiveQuery(
    () =>
      panel && panel.convId === convId
        ? latestArtifact(convId, panel.artifactId)
        : Promise.resolve(undefined),
    [panel?.artifactId, panel?.convId, convId]
  )

  if (!panel || panel.convId !== convId || !artifact) return null

  const openInTab = () => {
    const url = URL.createObjectURL(new Blob([artifact.html], { type: "text/html" }))
    window.open(url, "_blank")
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([artifact.html], { type: "text/html" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `${artifact.artifactId}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <aside className="fixed inset-0 z-40 flex flex-col bg-background md:static md:z-auto md:w-[46%] md:min-w-96 md:border-l md:border-border">
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {artifact.title}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Reload preview"
          onClick={() => setReloadKey((k) => k + 1)}
        >
          <RotateCw />
        </Button>
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
      {/* no allow-same-origin: generated code must never reach our localStorage keys */}
      <iframe
        key={reloadKey}
        srcDoc={artifact.html}
        sandbox="allow-scripts allow-forms allow-modals allow-popups"
        title={artifact.title}
        className="min-h-0 flex-1 w-full border-0 bg-white"
      />
    </aside>
  )
}
