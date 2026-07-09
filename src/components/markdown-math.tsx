import rehypeKatex from "rehype-katex"
import remarkMath from "remark-math"

import "@/components/markdown-katex-style"

import { MarkdownDocument } from "@/components/markdown-document"
import type { MarkdownProps } from "@/components/markdown"

const REMARK_MATH = [remarkMath]
const REHYPE_KATEX = [rehypeKatex]

export function MathMarkdown(props: MarkdownProps) {
  return (
    <MarkdownDocument
      {...props}
      extraRemarkPlugins={REMARK_MATH}
      extraRehypePlugins={REHYPE_KATEX}
    />
  )
}
