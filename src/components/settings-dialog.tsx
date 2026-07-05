import { useState } from "react"
import { Check, Pencil, Plus, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
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
import { Textarea } from "@/components/ui/textarea"
import {
  normalizeBaseUrl,
  PRESETS,
  setPrefs,
  usePrefs,
  type Profile,
} from "@/lib/profiles"
import { cn } from "@/lib/utils"

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const EMPTY_DRAFT = { name: "", baseUrl: "", apiKey: "", defaultModel: "" }

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const prefs = usePrefs()
  const [editing, setEditing] = useState<string | "new" | null>(
    prefs.profiles.length === 0 ? "new" : null
  )
  const [draft, setDraft] = useState(EMPTY_DRAFT)

  const startEdit = (p: Profile) => {
    setDraft({
      name: p.name,
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      defaultModel: p.defaultModel ?? "",
    })
    setEditing(p.id)
  }

  const startNew = () => {
    setDraft(EMPTY_DRAFT)
    setEditing("new")
  }

  const save = () => {
    const profile: Profile = {
      id: editing === "new" ? crypto.randomUUID() : (editing as string),
      name: draft.name.trim(),
      baseUrl: normalizeBaseUrl(draft.baseUrl),
      apiKey: draft.apiKey.trim(),
      defaultModel: draft.defaultModel.trim() || undefined,
    }
    const profiles =
      editing === "new"
        ? [...prefs.profiles, profile]
        : prefs.profiles.map((p) => (p.id === editing ? profile : p))
    setPrefs({
      profiles,
      activeProfileId: prefs.activeProfileId ?? profile.id,
    })
    setEditing(null)
  }

  const remove = (id: string) => {
    const profiles = prefs.profiles.filter((p) => p.id !== id)
    setPrefs({
      profiles,
      activeProfileId:
        prefs.activeProfileId === id ? profiles[0]?.id : prefs.activeProfileId,
    })
  }

  const preset = PRESETS.find(
    (p) => normalizeBaseUrl(p.baseUrl) === normalizeBaseUrl(draft.baseUrl)
  )
  const isHttp =
    draft.baseUrl.startsWith("http://") &&
    !/^http:\/\/(localhost|127\.0\.0\.1)/.test(draft.baseUrl)
  const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)/.test(draft.baseUrl)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Endpoints and keys are stored only in this browser — never sent to
            this app's server, never synced.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="global-system">Default system prompt</Label>
            <Textarea
              id="global-system"
              value={prefs.globalSystemPrompt ?? ""}
              onChange={(e) =>
                setPrefs({ globalSystemPrompt: e.target.value || undefined })
              }
              placeholder="Applied to every new chat unless overridden per conversation."
              className="min-h-20"
            />
          </div>

          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Endpoints</h3>
            <Button variant="outline" size="sm" onClick={startNew}>
              <Plus data-icon="inline-start" />
              Add endpoint
            </Button>
          </div>

          {prefs.profiles.length === 0 && editing === null && (
            <p className="text-sm text-muted-foreground">
              Add an endpoint to start chatting.
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            {prefs.profiles.map((p) => (
              <div
                key={p.id}
                className={cn(
                  "flex items-center gap-2 rounded-lg border border-border/70 bg-card/40 px-3 py-2",
                  p.id === prefs.activeProfileId && "border-primary/50"
                )}
              >
                <button
                  className="flex min-w-0 flex-1 cursor-pointer flex-col text-left"
                  onClick={() => setPrefs({ activeProfileId: p.id })}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {p.name}
                    {p.id === prefs.activeProfileId && (
                      <Badge variant="secondary" className="gap-1 text-xs">
                        <Check className="size-3" /> active
                      </Badge>
                    )}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {p.baseUrl}
                    {p.defaultModel ? ` · ${p.defaultModel}` : ""}
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => startEdit(p)}
                  aria-label={`Edit ${p.name}`}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive"
                  onClick={() => remove(p.id)}
                  aria-label={`Delete ${p.name}`}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>

          {editing !== null && (
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/60 p-3">
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((pr) => (
                  <Button
                    key={pr.name}
                    variant={preset?.name === pr.name ? "secondary" : "outline"}
                    size="xs"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        name: d.name || pr.name,
                        baseUrl: pr.baseUrl,
                      }))
                    }
                  >
                    {pr.name}
                  </Button>
                ))}
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="profile-name">Name</Label>
                <Input
                  id="profile-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="OpenRouter"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="profile-url">Base URL</Label>
                <Input
                  id="profile-url"
                  value={draft.baseUrl}
                  onChange={(e) =>
                    setDraft({ ...draft, baseUrl: e.target.value })
                  }
                  placeholder="https://openrouter.ai/api/v1"
                />
                {preset?.hint && (
                  <p className="text-xs text-muted-foreground">{preset.hint}</p>
                )}
                {isLocalhost && (
                  <p className="text-xs text-muted-foreground">
                    localhost endpoints work from the deployed site in Chrome
                    and Firefox, but not Safari.
                  </p>
                )}
                {isHttp && (
                  <p className="text-xs text-destructive">
                    Browsers block plain http:// hosts (other than localhost)
                    from an https site. Run the app locally or put the endpoint
                    behind https.
                  </p>
                )}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="profile-key">API key</Label>
                <Input
                  id="profile-key"
                  type="password"
                  value={draft.apiKey}
                  onChange={(e) =>
                    setDraft({ ...draft, apiKey: e.target.value })
                  }
                  placeholder="sk-… (leave empty for local servers)"
                />
                <p className="text-xs text-muted-foreground">
                  Stored in localStorage on this device only.
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="profile-model">Default model</Label>
                <Input
                  id="profile-model"
                  value={draft.defaultModel}
                  onChange={(e) =>
                    setDraft({ ...draft, defaultModel: e.target.value })
                  }
                  placeholder="openrouter/auto"
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!draft.name.trim() || !draft.baseUrl.trim()}
                  onClick={save}
                >
                  Save endpoint
                </Button>
              </div>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="exa-key">Exa API key (web search)</Label>
            <Input
              id="exa-key"
              type="password"
              value={prefs.exaKey ?? ""}
              onChange={(e) => setPrefs({ exaKey: e.target.value || undefined })}
              placeholder="exa-…"
            />
            <p className="text-xs text-muted-foreground">
              Stored in this browser only. Sent per-request through this app's
              proxy (Exa blocks direct browser calls) — never stored or logged
              server-side.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
