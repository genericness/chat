import { lazy, memo, Suspense } from "react"

import type { SearchResult } from "@/lib/db"
import { cn } from "@/lib/utils"

export interface MarkdownProps {
  text: string
  streaming?: boolean
  sources?: SearchResult[]
}

const loadMarkdownRenderer = () => import("@/components/markdown-renderer")
const MarkdownRenderer = lazy(() =>
  loadMarkdownRenderer().then((module) => ({ default: module.MarkdownRenderer }))
)

/** Warm the renderer when a conversation link signals user intent. */
export function preloadMarkdown() {
  void loadMarkdownRenderer()
}

/**
 * Keep streaming text visible while the full markdown parser is still loading.
 * React renders `text` as a text node, so the fallback cannot execute generated HTML.
 */
function MarkdownFallback({ text, streaming }: MarkdownProps) {
  return (
    <div
      className={cn(
        "max-w-none whitespace-pre-wrap break-words text-[0.95rem] leading-relaxed",
        streaming && "markdown-stream-tail"
      )}
      data-markdown-fallback=""
      aria-busy={streaming || undefined}
    >
      {text}
    </div>
  )
}

const STREAM_TAIL_CHARS = 384

/** Keep the actively changing block as plain text; parse only stable blocks. */
function splitStreamingText(text: string): [prefix: string, tail: string] {
  if (text.length <= STREAM_TAIL_CHARS) return ["", text]
  const latestSafeOffset = text.length - STREAM_TAIL_CHARS
  let offset = 0
  let safeOffset = 0
  let fence: string | undefined

  for (const line of text.match(/.*(?:\n|$)/g) ?? []) {
    if (!line) continue
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
    let closedFence = false
    if (marker) {
      if (!fence) fence = marker
      else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = undefined
        closedFence = true
      }
    }
    offset += line.length
    if (!fence && offset <= latestSafeOffset && (/^\s*$/.test(line) || closedFence)) {
      safeOffset = offset
    }
  }

  return [text.slice(0, safeOffset), text.slice(safeOffset)]
}

export const Markdown = memo(function Markdown(props: MarkdownProps) {
  if (props.streaming) {
    const [prefix, tail] = splitStreamingText(props.text)
    return (
      <>
        {prefix && (
          <Suspense fallback={<MarkdownFallback text={prefix} />}>
            <MarkdownRenderer text={prefix} sources={props.sources} />
          </Suspense>
        )}
        {tail && <MarkdownFallback text={tail} streaming />}
      </>
    )
  }

  return (
    <Suspense fallback={<MarkdownFallback {...props} />}>
      <MarkdownRenderer {...props} />
    </Suspense>
  )
})
