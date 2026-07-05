import { useState } from "react"
import { Check, ChevronDown, CircleDashed } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  fmtContext,
  fmtPricePerM,
  lookupMeta,
  useEndpointModels,
  useOpenRouterMeta,
  type ModelMeta,
} from "@/hooks/use-models"
import { setPrefs, usePrefs, type Profile } from "@/lib/profiles"
import { cn } from "@/lib/utils"

export function modelDisplayName(id: string, meta?: ModelMeta): string {
  return meta?.name ?? id
}

function MetaLine({ id, meta }: { id: string; meta?: ModelMeta }) {
  const bits = [
    id,
    fmtContext(meta?.contextLength),
    fmtPricePerM(meta?.pricing?.prompt) &&
      `${fmtPricePerM(meta?.pricing?.prompt)} in · ${fmtPricePerM(meta?.pricing?.completion) ?? "$0/M"} out`,
  ].filter(Boolean)
  return (
    <span className="truncate text-xs text-muted-foreground">
      {bits.join(" · ")}
    </span>
  )
}

export function ModelPicker({ profile }: { profile?: Profile }) {
  const prefs = usePrefs()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const endpoint = useEndpointModels(profile)
  const { data: meta } = useOpenRouterMeta()

  const selected = prefs.selectedModels ?? []
  const current = selected[0] ?? profile?.defaultModel

  // Endpoint list when available; always include already-selected + default ids.
  const ids = [
    ...new Set([...(endpoint.data ?? []), ...selected, ...(profile?.defaultModel ? [profile.defaultModel] : [])]),
  ]

  const toggle = (id: string, multi: boolean) => {
    if (multi) {
      const next = selected.includes(id)
        ? selected.filter((s) => s !== id)
        : [...selected, id]
      setPrefs({ selectedModels: next })
    } else {
      setPrefs({ selectedModels: [id] })
      setOpen(false)
    }
  }

  const chipLabel =
    selected.length > 1
      ? `${selected.length} models`
      : current
        ? modelDisplayName(current, lookupMeta(meta, current))
        : "model"

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="max-w-28 shrink-0 gap-1 rounded-full text-muted-foreground sm:max-w-44"
          >
            <span className="truncate">{chipLabel}</span>
            <ChevronDown className="size-3.5 shrink-0" />
          </Button>
        }
      />
      <PopoverContent className="w-80 p-0" align="end">
        <Command>
          <CommandInput
            placeholder="Search models…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="max-h-72">
            <CommandEmpty>
              {search.trim() ? (
                <button
                  className="w-full cursor-pointer rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => toggle(search.trim(), false)}
                >
                  Use “{search.trim()}”
                </button>
              ) : endpoint.isLoading ? (
                "Loading models…"
              ) : (
                "Type a model id"
              )}
            </CommandEmpty>
            {ids.map((id) => {
              const m = lookupMeta(meta, id)
              const isSelected = selected.includes(id)
              return (
                <CommandItem
                  key={id}
                  value={`${id} ${m?.name ?? ""}`}
                  onSelect={() => toggle(id, false)}
                  className="gap-2"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm">
                      {modelDisplayName(id, m)}
                    </span>
                    <MetaLine id={id} meta={m} />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className={cn(
                      "shrink-0",
                      isSelected ? "text-primary" : "text-muted-foreground/50"
                    )}
                    aria-label={isSelected ? "Remove from compare" : "Add to compare"}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggle(id, true)
                    }}
                  >
                    {isSelected ? <Check /> : <CircleDashed />}
                  </Button>
                </CommandItem>
              )
            })}
          </CommandList>
          {selected.length > 1 && (
            <div className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
              {selected.length} models selected — next send compares them side by side
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  )
}
