import { Children, isValidElement, memo, useMemo, useRef, useState, type ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import rehypeHighlight from "rehype-highlight"
import rehypeKatex from "rehype-katex"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import { Check, Copy } from "lucide-react"

import "katex/dist/katex.min.css"
import "highlight.js/styles/github-dark.css"

import { Button } from "@/components/ui/button"
import type { SearchResult } from "@/lib/db"
import { cn } from "@/lib/utils"

interface HastNode {
  type: string
  tagName?: string
  value?: string
  children?: HastNode[]
  properties?: Record<string, unknown>
}

/** Turns bare [n] in prose into links to the nth search source (code stays untouched). */
function makeCitationPlugin(sources: SearchResult[]) {
  const SKIP = new Set(["code", "pre", "a"])
  return () => (tree: HastNode) => {
    const walk = (node: HastNode) => {
      if (!node.children || (node.tagName && SKIP.has(node.tagName))) return
      node.children = node.children.flatMap((child) => {
        if (child.type !== "text" || !child.value || !/\[\d+\]/.test(child.value)) {
          walk(child)
          return [child]
        }
        const parts: HastNode[] = []
        let last = 0
        for (const m of child.value.matchAll(/\[(\d+)\]/g)) {
          const src = sources[Number(m[1]) - 1]
          if (!src) continue
          if (m.index > last) parts.push({ type: "text", value: child.value.slice(last, m.index) })
          parts.push({
            type: "element",
            tagName: "a",
            properties: {
              href: src.url,
              target: "_blank",
              rel: "noreferrer",
              title: src.title,
              className: ["citation"],
            },
            children: [{ type: "text", value: m[0] }],
          })
          last = m.index + m[0].length
        }
        if (!parts.length) return [child]
        if (last < child.value.length) parts.push({ type: "text", value: child.value.slice(last) })
        return parts
      })
    }
    walk(tree)
  }
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  const child = Children.toArray(children)[0]
  const lang =
    (isValidElement(child) &&
      /language-([\w-]+)/.exec(
        (child.props as { className?: string }).className ?? ""
      )?.[1]) ||
    "text"

  const copy = () => {
    void navigator.clipboard.writeText(ref.current?.innerText ?? "")
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    // no overflow-hidden here — it would give the sticky header nothing to stick to
    <div className="not-prose my-3 rounded-lg border border-border/70 bg-black/30">
      {/* opaque bg (= container tint composited on the page bg) so code doesn't show through while stuck */}
      <div className="sticky top-0 flex items-center justify-between rounded-t-lg border-b border-border/50 bg-[color-mix(in_srgb,var(--background)_70%,black)] py-0.5 pr-1 pl-3">
        <span className="font-mono text-xs text-muted-foreground">{lang}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={copy}
          aria-label="Copy code"
          className="text-muted-foreground"
        >
          {copied ? <Check className="text-primary" /> : <Copy />}
        </Button>
      </div>
      <pre ref={ref} className="overflow-x-auto p-3 font-mono text-[0.85rem] leading-relaxed">
        {children}
      </pre>
    </div>
  )
}

// ponytail: react-markdown re-parses the whole message at ~10Hz while streaming;
// render the tail as plain text if very long messages ever jank.
export default memo(function MarkdownImpl({
  text,
  streaming = false,
  sources,
}: {
  text: string
  streaming?: boolean
  sources?: SearchResult[]
}) {
  const rehypePlugins = useMemo(
    () => [
      rehypeHighlight,
      rehypeKatex,
      ...(sources?.length ? [makeCitationPlugin(sources)] : []),
    ],
    [sources]
  )
  return (
    <div
      className={cn(
        "prose prose-invert max-w-none wrap-anywhere text-[0.95rem] leading-relaxed prose-p:my-2.5 prose-headings:mt-5 prose-headings:mb-2.5 prose-code:rounded-md prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:font-normal prose-code:before:content-none prose-code:after:content-none prose-li:my-0.5 prose-table:text-sm",
        streaming && "md-streaming"
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={rehypePlugins}
        components={{
          pre: CodeBlock,
          a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
