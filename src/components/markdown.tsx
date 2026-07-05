import { Children, isValidElement, memo, useRef, useState, type ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import rehypeHighlight from "rehype-highlight"
import rehypeKatex from "rehype-katex"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import { Check, Copy } from "lucide-react"

import "katex/dist/katex.min.css"
import "highlight.js/styles/github-dark.css"

import { Button } from "@/components/ui/button"

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

// ponytail: react-markdown re-parses the whole message at ~10Hz while streaming;
// render the tail as plain text if very long messages ever jank.
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-invert max-w-none text-[0.95rem] leading-relaxed prose-p:my-2.5 prose-headings:mt-5 prose-headings:mb-2.5 prose-code:rounded-md prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:font-normal prose-code:before:content-none prose-code:after:content-none prose-li:my-0.5 prose-table:text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeHighlight, rehypeKatex]}
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
