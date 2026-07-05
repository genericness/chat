import { useLiveQuery } from "dexie-react-hooks"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { db, type ConversationSettings } from "@/lib/db"
import { usePrefs } from "@/lib/profiles"

interface ChatSettingsProps {
  convId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ChatSettings({ convId, open, onOpenChange }: ChatSettingsProps) {
  const prefs = usePrefs()
  const conv = useLiveQuery(() => db.conversations.get(convId), [convId])

  if (!conv) return null
  const settings = conv.settings ?? {}

  const patch = (s: Partial<ConversationSettings>) =>
    void db.conversations.update(convId, { settings: { ...settings, ...s } })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Chat settings</DialogTitle>
          <DialogDescription>
            Overrides for this conversation only. Empty fields fall back to your
            defaults.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="cs-system">System prompt</Label>
            <Textarea
              id="cs-system"
              value={conv.systemPrompt ?? ""}
              onChange={(e) =>
                void db.conversations.update(convId, {
                  systemPrompt: e.target.value || undefined,
                })
              }
              placeholder={prefs.globalSystemPrompt || "You are a helpful assistant."}
              className="min-h-24"
            />
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label>Temperature</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {settings.temperature ?? "default"}
                </span>
                {settings.temperature !== undefined && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => patch({ temperature: undefined })}
                  >
                    Reset
                  </Button>
                )}
              </div>
            </div>
            <Slider
              min={0}
              max={2}
              step={0.1}
              value={[settings.temperature ?? 1]}
              onValueChange={(v) =>
                patch({ temperature: Array.isArray(v) ? v[0] : v })
              }
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="cs-maxtok">Max tokens</Label>
            <Input
              id="cs-maxtok"
              type="number"
              min={1}
              value={settings.maxTokens ?? ""}
              onChange={(e) =>
                patch({
                  maxTokens: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              placeholder="8192 (default)"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="cs-model">Model override</Label>
            <Input
              id="cs-model"
              value={settings.model ?? ""}
              onChange={(e) => patch({ model: e.target.value || undefined })}
              placeholder="from model picker"
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Endpoint</Label>
            <Select
              value={settings.profileId ?? ""}
              onValueChange={(v) =>
                patch({ profileId: (v as string) || undefined })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Active endpoint</SelectItem>
                {prefs.profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
