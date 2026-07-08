// Android hardware back: overlays (drawer, dialogs, panels, sheets) register a
// close handler while open; native.ts pops the most recent one before falling
// back to history/app-minimize. Plain module — no Capacitor imports — so web
// bundles can use it freely.
type Close = () => void

const stack: Close[] = []

/** Register a close handler while an overlay is open. Returns unregister. */
export function pushBackHandler(close: Close): () => void {
  stack.push(close)
  return () => {
    const i = stack.lastIndexOf(close)
    if (i !== -1) stack.splice(i, 1)
  }
}

/** Close the top-most open overlay. True if something handled the press. */
export function handleBack(): boolean {
  const top = stack[stack.length - 1]
  if (!top) return false
  top()
  return true
}
