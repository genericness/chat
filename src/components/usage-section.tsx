import { useMemo } from "react"
import { useLiveQuery } from "dexie-react-hooks"

import { db } from "@/lib/db"
import { lookupMeta, useOpenRouterMeta } from "@/hooks/use-models"
import { Label } from "@/components/ui/label"

interface Row {
  model: string
  messages: number
  promptTokens: number
  completionTokens: number
  /** undefined = no pricing known for this model (e.g. a local endpoint) */
  cost?: number
}

function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

function fmtCost(n: number): string {
  return n < 0.01 ? `<$0.01` : `$${n.toFixed(2)}`
}

/** Token usage + estimated cost, across all chats or scoped to one thread. */
export function UsageSection({ convId }: { convId?: string }) {
  const meta = useOpenRouterMeta().data
  // Only assistant messages carry token stats.
  const stats = useLiveQuery(
    () =>
      (convId
        ? db.messages.where("convId").equals(convId)
        : db.messages
      )
        .filter((m) => m.role === "assistant" && !!m.stats)
        .toArray(),
    [convId]
  )

  const { rows, totalCost, hasUnpriced } = useMemo(() => {
    const byModel = new Map<string, Row>()
    for (const m of stats ?? []) {
      const key = m.model ?? "unknown"
      const row = byModel.get(key) ?? {
        model: key,
        messages: 0,
        promptTokens: 0,
        completionTokens: 0,
        cost: 0,
      }
      row.messages++
      row.promptTokens += m.stats!.promptTokens ?? 0
      row.completionTokens += m.stats!.completionTokens ?? 0
      const price = lookupMeta(meta, key)?.pricing
      const pIn = parseFloat(price?.prompt ?? "")
      const pOut = parseFloat(price?.completion ?? "")
      if (Number.isFinite(pIn) && Number.isFinite(pOut) && row.cost !== undefined) {
        row.cost += (m.stats!.promptTokens ?? 0) * pIn + (m.stats!.completionTokens ?? 0) * pOut
      } else {
        row.cost = undefined // pricing unknown for at least one message on this model
      }
      byModel.set(key, row)
    }
    const rows = [...byModel.values()].sort(
      (a, b) => b.promptTokens + b.completionTokens - (a.promptTokens + a.completionTokens)
    )
    const totalCost = rows.reduce((s, r) => s + (r.cost ?? 0), 0)
    const hasUnpriced = rows.some((r) => r.cost === undefined)
    return { rows, totalCost, hasUnpriced }
  }, [stats, meta])

  return (
    <div className="grid gap-2">
      <Label>Usage</Label>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {convId
            ? "No usage in this chat yet. Token counts appear here once a reply reports them."
            : "No usage yet. Token counts and estimated cost appear here as you chat."}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-3 py-1.5 text-left font-medium">Model</th>
                  <th className="px-3 py-1.5 text-right font-medium">Msgs</th>
                  <th className="px-3 py-1.5 text-right font-medium">In</th>
                  <th className="px-3 py-1.5 text-right font-medium">Out</th>
                  <th className="px-3 py-1.5 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.model} className="border-b border-border/50 last:border-0">
                    <td className="max-w-52 truncate px-3 py-1.5" title={r.model}>
                      {r.model}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.messages}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                      {fmtTokens(r.promptTokens)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                      {fmtTokens(r.completionTokens)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.cost === undefined ? "—" : fmtCost(r.cost)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-medium">
                  <td className="px-3 py-1.5" colSpan={4}>
                    Estimated total
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtCost(totalCost)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Estimated from OpenRouter's public prices and the tokens each provider
            reported. Your actual bill comes from your provider.
            {hasUnpriced && " Rows marked — have no known price (e.g. local endpoints)."}
          </p>
        </>
      )}
    </div>
  )
}
