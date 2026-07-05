import { useState } from "react"
import { Check, Pencil, Plus, Trash2 } from "lucide-react"

import { useLogout, useMe } from "@/hooks/use-me"

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-4" aria-hidden>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 2.87-.39c.97 0 1.95.13 2.87.39 2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.73.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.77 1.05.77 2.12 0 1.53-.01 2.76-.01 3.14 0 .3.2.66.8.55A11.52 11.52 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  )
}

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

function AccountSection() {
  const { data: me, isLoading } = useMe()
  const logout = useLogout()

  return (
    <div className="grid gap-1.5">
      <Label>Account</Label>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : me ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-border/70 bg-card/40 px-3 py-2">
          <img
            src={me.avatarUrl}
            alt={me.login}
            className="size-7 rounded-full"
          />
          <span className="min-w-0 flex-1 truncate text-sm">
            {me.name ?? me.login}
            <span className="text-muted-foreground"> · @{me.login}</span>
          </span>
          <Button variant="ghost" size="sm" onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
      ) : (
        <>
          <Button
            variant="outline"
            className="justify-center gap-2"
            render={<a href="/api/auth/login" />}
          >
            <GithubIcon />
            Sign in with GitHub
          </Button>
          <p className="text-xs text-muted-foreground">
            Only needed for optional chat sync across devices. API keys are
            never synced.
          </p>
        </>
      )}
    </div>
  )
}

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

          <AccountSection />

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
