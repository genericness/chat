import {
  Children,
  isValidElement,
  memo,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react"
import { Check, Copy } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import "highlight.js/styles/github-dark.css"

import { rehypeCuratedHighlight } from "@/components/markdown-highlight"
import type { MarkdownProps } from "@/components/markdown"
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

type ReactMarkdownProps = ComponentProps<typeof ReactMarkdown>
type RemarkPlugins = NonNullable<ReactMarkdownProps["remarkPlugins"]>
type RehypePlugins = NonNullable<ReactMarkdownProps["rehypePlugins"]>

const NO_REMARK_PLUGINS: RemarkPlugins = []
const NO_REHYPE_PLUGINS: RehypePlugins = []

interface MarkdownDocumentProps extends MarkdownProps {
  extraRemarkPlugins?: RemarkPlugins
  extraRehypePlugins?: RehypePlugins
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
        for (const match of child.value.matchAll(/\[(\d+)\]/g)) {
          const source = sources[Number(match[1]) - 1]
          if (!source) continue
          if (match.index > last) {
            parts.push({ type: "text", value: child.value.slice(last, match.index) })
          }
          parts.push({
            type: "element",
            tagName: "a",
            properties: {
              href: source.url,
              target: "_blank",
              rel: "noreferrer",
              title: source.title,
              className: ["citation"],
            },
            children: [{ type: "text", value: match[0] }],
          })
          last = match.index + match[0].length
        }
        if (!parts.length) return [child]
        if (last < child.value.length) {
          parts.push({ type: "text", value: child.value.slice(last) })
        }
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
    <div className="not-prose my-3 overflow-hidden rounded-lg border border-border/70 bg-black/30">
      <div className="flex items-center justify-between border-b border-border/50 py-0.5 pr-1 pl-3">
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

export const MarkdownDocument = memo(function MarkdownDocument({
  text,
  streaming = false,
  sources,
  extraRemarkPlugins = NO_REMARK_PLUGINS,
  extraRehypePlugins = NO_REHYPE_PLUGINS,
}: MarkdownDocumentProps) {
  const rehypePlugins = useMemo(
    () => [
      rehypeCuratedHighlight,
      ...extraRehypePlugins,
      ...(sources?.length ? [makeCitationPlugin(sources)] : []),
    ],
    [extraRehypePlugins, sources]
  )
  const remarkPlugins = useMemo(
    () => [remarkGfm, ...extraRemarkPlugins],
    [extraRemarkPlugins]
  )

  return (
    <div
      className={cn(
        "prose prose-invert max-w-none text-[0.95rem] leading-relaxed prose-p:my-2.5 prose-headings:mt-5 prose-headings:mb-2.5 prose-code:rounded-md prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:font-normal prose-code:before:content-none prose-code:after:content-none prose-li:my-0.5 prose-table:text-sm",
        streaming && "md-streaming"
      )}
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
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
