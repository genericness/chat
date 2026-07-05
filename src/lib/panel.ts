import { useSyncExternalStore } from "react"

// Which artifact the preview panel is showing. Module store so tool executors
// (non-React) can open it the moment an artifact is created.
export interface PanelState {
  convId: string
  artifactId: string
}

let state: PanelState | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function openArtifactPanel(convId: string, artifactId: string) {
  state = { convId, artifactId }
  emit()
}

export function closeArtifactPanel() {
  state = null
  emit()
}

export function useArtifactPanel(): PanelState | null {
  return useSyncExternalStore((cb) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  }, () => state)
}
