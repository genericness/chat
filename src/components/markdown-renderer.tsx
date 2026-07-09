import { lazy, memo, Suspense } from "react"

import { MarkdownDocument } from "@/components/markdown-document"
import type { MarkdownProps } from "@/components/markdown"

const MathMarkdown = lazy(() =>
  import("@/components/markdown-math").then((module) => ({ default: module.MathMarkdown }))
)

function containsMath(text: string): boolean {
  // Ignore complete code fences and inline code so snippets containing dollar
  // signs do not download the math renderer. Incomplete streaming fences may
  // conservatively preload it, which is preferable to hiding streamed text.
  const prose = text
    .replace(/(```|~~~)[\s\S]*?\1/g, "")
    .replace(/`[^`\n]*`/g, "")
  return (
    /(^|[^\\])\$\$[\s\S]+?\$\$/.test(prose) ||
    /(^|[^\\])\$(?![$\s])(?:\\.|[^$\n])+?\$(?!\$)/.test(prose)
  )
}

export const MarkdownRenderer = memo(function MarkdownRenderer(props: MarkdownProps) {
  if (!containsMath(props.text)) return <MarkdownDocument {...props} />

  return (
    <Suspense fallback={<MarkdownDocument {...props} />}>
      <MathMarkdown {...props} />
    </Suspense>
  )
})
