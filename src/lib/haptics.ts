// Light tactile feedback on native. The literal env guard mirrors main.tsx so
// web bundles drop the @capacitor/haptics chunk entirely; on web this is a
// no-op. Failures (e.g. haptics unavailable) are ignored.
export function haptic(style: "light" | "medium" = "light") {
  if (import.meta.env.VITE_API_BASE) {
    void import("@capacitor/haptics")
      .then(({ Haptics, ImpactStyle }) =>
        Haptics.impact({
          style: style === "medium" ? ImpactStyle.Medium : ImpactStyle.Light,
        })
      )
      .catch(() => {})
  }
}

// Selection-tick while a reply streams in. Rate-limited globally so compare
// mode (several concurrent streams) doesn't turn into a continuous buzz.
let lastTick = 0

export function streamTick() {
  if (import.meta.env.VITE_API_BASE) {
    const now = Date.now()
    if (now - lastTick < 150) return
    lastTick = now
    void import("@capacitor/haptics")
      .then(({ Haptics }) => Haptics.selectionChanged())
      .catch(() => {})
  }
}
