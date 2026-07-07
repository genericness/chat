import type { SearchResult } from "./db-types"
import { coreFetch } from "./config"
import { getPrefs } from "./profiles"

export async function exaSearch(query: string): Promise<SearchResult[]> {
  const key = getPrefs().exaKey
  if (!key) throw new Error("Add your Exa API key in Settings to use web search.")
  if (!query.trim()) throw new Error("Web search needs some text to search for.")

  const res = await coreFetch("/api/exa/search", {
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

export interface PageContent {
  url: string
  title: string
  text: string
  author?: string
  publishedDate?: string
  error?: string
}

/** Fetch the live contents of specific URLs via Exa's Contents API. */
export async function exaContents(urls: string[]): Promise<PageContent[]> {
  const key = getPrefs().exaKey
  if (!key) throw new Error("Add your Exa API key in Settings to fetch page contents.")
  const cleaned = urls.map((u) => u.trim()).filter(Boolean)
  if (!cleaned.length) throw new Error("No URL provided.")

  const res = await coreFetch("/api/exa/contents", {
    method: "POST",
    headers: { "content-type": "application/json", "x-exa-key": key },
    body: JSON.stringify({
      urls: cleaned,
      text: { maxCharacters: 12000 },
      livecrawl: "preferred",
    }),
  })
  if (!res.ok) {
    throw new Error(
      res.status === 401 ? "Exa rejected the API key." : `Exa contents failed (${res.status}).`
    )
  }
  const json = (await res.json()) as {
    results?: {
      url: string
      title?: string
      text?: string
      author?: string
      publishedDate?: string
    }[]
    statuses?: { id: string; status: string; error?: { tag?: string } }[]
  }
  const failed = new Map(
    (json.statuses ?? [])
      .filter((s) => s.status !== "success")
      .map((s) => [s.id, s.error?.tag ?? "could not fetch"])
  )
  const ok = (json.results ?? []).map<PageContent>((r) => ({
    url: r.url,
    title: r.title || r.url,
    text: r.text ?? "",
    author: r.author,
    publishedDate: r.publishedDate,
  }))
  // Surface URLs that Exa couldn't retrieve so the model knows.
  const gotUrls = new Set(ok.map((r) => r.url))
  for (const [url, err] of failed) {
    if (!gotUrls.has(url)) ok.push({ url, title: url, text: "", error: err })
  }
  return ok
}

export function pageContentsBlock(pages: PageContent[]): string {
  return pages
    .map((p) =>
      p.error
        ? `# ${p.url}\n(could not fetch: ${p.error})`
        : `# ${p.title}\n${p.url}${p.publishedDate ? `\nPublished: ${p.publishedDate}` : ""}\n\n${p.text}`
    )
    .join("\n\n---\n\n")
}

export function searchContextBlock(results: SearchResult[]): string {
  const entries = results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.text}`)
    .join("\n\n")
  return `\n\nWeb search results:\n${entries}\n\nUse these results where relevant and cite them inline as [n].`
}
