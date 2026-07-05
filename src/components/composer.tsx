import { ArrowUp, ChevronDown, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface ComposerProps {
  className?: string
}

export function Composer({ className }: ComposerProps) {
  return (
    <div className={cn("w-full max-w-2xl", className)}>
      <div className="flex items-end gap-1.5 rounded-4xl border border-border/70 bg-card/40 p-2 shadow-lg backdrop-blur-sm transition-colors focus-within:border-input">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 rounded-full text-muted-foreground"
          aria-label="Add attachment"
        >
          <Plus className="size-5" />
        </Button>
        <textarea
          rows={1}
          placeholder="Ask anything"
          className="max-h-44 flex-1 resize-none self-center bg-transparent px-1 py-1.5 text-[0.95rem] outline-none field-sizing-content placeholder:text-muted-foreground"
        />
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 gap-1 rounded-full text-muted-foreground"
        >
          model
          <ChevronDown className="size-3.5" />
        </Button>
        <Button
          size="icon"
          className="shrink-0 rounded-full"
          disabled
          aria-label="Send"
        >
          <ArrowUp className="size-5" />
        </Button>
      </div>
    </div>
  )
}
