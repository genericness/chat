import bash from "highlight.js/lib/languages/bash"
import c from "highlight.js/lib/languages/c"
import cpp from "highlight.js/lib/languages/cpp"
import csharp from "highlight.js/lib/languages/csharp"
import css from "highlight.js/lib/languages/css"
import diff from "highlight.js/lib/languages/diff"
import go from "highlight.js/lib/languages/go"
import java from "highlight.js/lib/languages/java"
import javascript from "highlight.js/lib/languages/javascript"
import json from "highlight.js/lib/languages/json"
import markdown from "highlight.js/lib/languages/markdown"
import python from "highlight.js/lib/languages/python"
import ruby from "highlight.js/lib/languages/ruby"
import rust from "highlight.js/lib/languages/rust"
import sql from "highlight.js/lib/languages/sql"
import typescript from "highlight.js/lib/languages/typescript"
import xml from "highlight.js/lib/languages/xml"
import yaml from "highlight.js/lib/languages/yaml"
import { createLowlight } from "lowlight"

interface HastNode {
  type: string
  tagName?: string
  value?: string
  children?: HastNode[]
  properties?: Record<string, unknown>
}

// Keep the languages people most often paste into a general-purpose coding chat.
// Unknown fences remain readable plain code instead of pulling every grammar into
// the bundle. Each grammar also registers its own aliases (tsx, jsx, html, sh…).
const lowlight = createLowlight({
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  go,
  java,
  javascript,
  json,
  markdown,
  python,
  ruby,
  rust,
  sql,
  typescript,
  xml,
  yaml,
})

function codeLanguage(node: HastNode): string | false | undefined {
  const classes = node.properties?.className
  if (!Array.isArray(classes)) return
  for (const value of classes) {
    if (value === "no-highlight" || value === "nohighlight") return false
    if (typeof value !== "string") continue
    const match = /^(?:lang|language)-(.+)$/.exec(value)
    if (match) return match[1]
  }
}

function textContent(node: HastNode): string {
  if (node.type === "text") return node.value ?? ""
  return node.children?.map(textContent).join("") ?? ""
}

function highlightCode(node: HastNode) {
  const lang = codeLanguage(node)
  if (!lang || !lowlight.registered(lang)) return

  const classes = Array.isArray(node.properties?.className)
    ? [...node.properties.className]
    : []
  if (!classes.includes("hljs")) classes.unshift("hljs")
  node.properties = { ...node.properties, className: classes }
  node.children = lowlight.highlight(lang, textContent(node)).children as HastNode[]
}

/** Rehype plugin that produces safe HAST nodes; it never injects raw HTML. */
export function rehypeCuratedHighlight() {
  return (tree: HastNode) => {
    const walk = (node: HastNode) => {
      if (node.tagName === "pre") {
        const code = node.children?.find((child) => child.tagName === "code")
        if (code) highlightCode(code)
        return
      }
      node.children?.forEach(walk)
    }
    walk(tree)
  }
}
