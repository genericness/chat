import { useEffect, useRef } from "react"

import { pushBackHandler } from "@/lib/back-stack"

/** While `open`, the Android hardware back button calls `close` instead of
 * navigating or leaving the app. */
export function useBackClose(open: boolean, close: () => void) {
  const ref = useRef(close)
  ref.current = close
  useEffect(() => (open ? pushBackHandler(() => ref.current()) : undefined), [open])
}
