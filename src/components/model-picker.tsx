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
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { useBackClose } from "@/hooks/use-back-close"
import { useMediaQuery } from "@/hooks/use-media-query"
import {
  fmtContext,
  lookupMeta,
  useEndpointModels,
  useOpenRouterMeta,
  type ModelMeta,
} from "@/hooks/use-models"
import { haptic } from "@/lib/haptics"
import { setPrefs, usePrefs, type Profile } from "@/lib/profiles"
import { cn } from "@/lib/utils"

export function modelDisplayName(id: string, meta?: ModelMeta): string {
  return meta?.name ?? id
}

function MetaLine({ id, meta }: { id: string; meta?: ModelMeta }) {
  const bits = [id, fmtContext(meta?.contextLength)].filter(Boolean)
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
  const endpoint = useEndpointModels(profile, open)
  const { data: meta } = useOpenRouterMeta(open)
  const isMobile = useMediaQuery("(max-width: 767px)")
  useBackClose(open, () => setOpen(false))

  const selected = prefs.selectedModels ?? []
  const current = selected[0] ?? profile?.defaultModel

  // Endpoint list when available; always include already-selected + default ids.
  const ids = [
    ...new Set([...(endpoint.data ?? []), ...selected, ...(profile?.defaultModel ? [profile.defaultModel] : [])]),
  ]

  const toggle = (id: string, multi: boolean) => {
    haptic()
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

  const chip = (
    <Button
      variant="ghost"
      size="sm"
      className="max-w-28 shrink-0 gap-1 rounded-full text-muted-foreground sm:max-w-44"
    >
      <span className="truncate">{chipLabel}</span>
      <ChevronDown className="size-3.5 shrink-0" />
    </Button>
  )

  const command = (
    <Command>
      <CommandInput
        placeholder="Search models…"
        value={search}
        onValueChange={setSearch}
      />
      <CommandList className={isMobile ? "max-h-[55svh]" : "max-h-72"}>
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
              // hide CommandItem's built-in trailing check so the compare
              // circle sits flush right instead of being pushed off the edge
              className="gap-2 [&>svg:last-child]:hidden"
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
  )

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={chip} />
        <SheetContent aria-label="Choose model" onDismiss={() => setOpen(false)}>
          {command}
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={chip} />
      <PopoverContent className="w-80 p-0" align="end">
        {command}
      </PopoverContent>
    </Popover>
  )
}
