import type { SearchResult } from "@/lib/db"
import { getPrefs } from "@/lib/profiles"

export async function exaSearch(query: string): Promise<SearchResult[]> {
  const key = getPrefs().exaKey
  if (!key) throw new Error("Add your Exa API key in Settings to use web search.")
  if (!query.trim()) throw new Error("Web search needs some text to search for.")

  const res = await fetch("/api/exa/search", {
    method: "POST",
    headers: { "content-type": "application/json", "x-exa-key": key },
    body: JSON.stringify({
      query,
      numResults: 5,
      contents: { text: { maxCharacters: 1500 } },
    }),
  })
  if (!res.ok) {
    throw new Error(res.status === 401 ? "Exa rejected the API key." : `Exa search failed (${res.status}).`)
  }
  const json = (await res.json()) as {
    results?: { title?: string; url: string; text?: string }[]
  }
  return (json.results ?? []).map((r) => ({
    title: r.title || r.url,
    url: r.url,
    text: r.text ?? "",
  }))
}

export function searchContextBlock(results: SearchResult[]): string {
  const entries = results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.text}`)
    .join("\n\n")
  return `\n\nWeb search results:\n${entries}\n\nUse these results where relevant and cite them inline as [n].`
}
