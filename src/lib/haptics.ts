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
