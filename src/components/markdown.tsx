import { lazy, memo, Suspense } from "react"

import type { SearchResult } from "@/lib/db"

// The markdown pipeline (react-markdown + katex + highlight.js) is ~600KB and
// must not block first paint; plain text stands in while the chunk loads.
const MarkdownImpl = lazy(() => import("@/components/markdown-impl"))

export const Markdown = memo(function Markdown(props: {
  text: string
  streaming?: boolean
  sources?: SearchResult[]
}) {
  return (
    <Suspense
      fallback={
        <div className="text-[0.95rem] leading-relaxed whitespace-pre-wrap">{props.text}</div>
      }
    >
      <MarkdownImpl {...props} />
    </Suspense>
  )
})
