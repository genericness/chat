import { useEffect, useState } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { Check, Loader2, LogIn, Pencil, Plug, Plus, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import { IS_NATIVE } from "@/lib/api-base"
import { db, deleteAllConversations } from "@/lib/db"

import { useLogout, useMe } from "@/hooks/use-me"
import { CHATGPT_DEFAULT_MODEL, isChatGPTBaseUrl } from "@/lib/chatgpt"
import { testEndpoint, type EndpointTestResult } from "@/lib/endpoint-test"
import { authorizeMcpServer, disconnectMcpServer } from "@/lib/mcp-oauth"

import { ChatGPTSignIn } from "@/components/chatgpt-sign-in"

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
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useMediaQuery } from "@/hooks/use-media-query"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { runSync } from "@/lib/sync"
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

// Phone layout shows one section at a time; desktop stacks them all.
const SECTIONS = ["Endpoints", "Tools", "Account", "General"] as const
type Section = (typeof SECTIONS)[number]

function AccountSection() {
  const { data: me, isLoading } = useMe()
  const logout = useLogout()
  const prefs = usePrefs()

  return (
    <div className="grid gap-1.5">
      <Label>Account</Label>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : me ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-card/40 px-3 py-2">
          <div className="flex items-center gap-2.5">
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
          <div className="flex items-center justify-between gap-2 border-t border-border/50 pt-2">
            <div className="flex flex-col">
              <span className="text-sm">Sync chats to this account</span>
              <span className="text-xs text-muted-foreground">
                {prefs.syncEnabled && prefs.lastSyncAt
                  ? `Last synced ${new Date(prefs.lastSyncAt).toLocaleTimeString()}`
                  : "Endpoints and API keys are never synced."}
              </span>
            </div>
            <Switch
              checked={!!prefs.syncEnabled}
              onCheckedChange={(on) => {
                setPrefs({ syncEnabled: on })
                if (on) void runSync()
              }}
              aria-label="Sync chats"
            />
          </div>
        </div>
      ) : (
        <>
          <Button
            variant="outline"
            className="justify-center gap-2"
            {...(IS_NATIVE
              ? { onClick: () => void import("@/lib/native").then((m) => m.nativeLogin()) }
              : { render: <a href="/api/auth/login" />, nativeButton: false })}
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
  const [test, setTest] = useState<
    { state: "idle" | "testing" } | { state: "done"; result: EndpointTestResult }
  >({ state: "idle" })
  const isMobile = useMediaQuery("(max-width: 639px)")
  const [section, setSection] = useState<Section>("Endpoints")
  const show = (s: Section) => !isMobile || section === s
  useEffect(() => {
    if (open) setSection("Endpoints")
  }, [open])

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
  const isChatGPT = isChatGPTBaseUrl(normalizeBaseUrl(draft.baseUrl))
  const isHttp =
    draft.baseUrl.startsWith("http://") &&
    !/^http:\/\/(localhost|127\.0\.0\.1)/.test(draft.baseUrl)
  const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)/.test(draft.baseUrl)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Full-screen page on phones, centered card on sm+. Header stays put;
          only the body scrolls, so Close is always reachable. */}
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[85svh] flex-col gap-0 p-0 max-sm:top-0 max-sm:left-0 max-sm:h-svh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:max-w-lg"
      >
        <div className="flex flex-col gap-3 border-b border-border/70 p-4 max-sm:pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="flex items-start justify-between gap-3">
            <DialogHeader className="min-w-0">
              <DialogTitle>Settings</DialogTitle>
              <DialogDescription>
                Endpoints and keys are stored only in this browser — never sent to
                this app's server, never synced.
              </DialogDescription>
            </DialogHeader>
            <DialogClose
              render={
                <Button variant="ghost" size="icon-sm" aria-label="Close settings" />
              }
            >
              <X />
            </DialogClose>
          </div>
          <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 sm:hidden">
            {SECTIONS.map((s) => (
              <Button
                key={s}
                variant={section === s ? "secondary" : "ghost"}
                size="sm"
                className="shrink-0 rounded-full"
                aria-pressed={section === s}
                onClick={() => setSection(s)}
              >
                {s}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto overscroll-contain p-4 max-sm:pb-[calc(max(1rem,env(safe-area-inset-bottom))+var(--kb,0px))]">
          {show("General") && (
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
          )}

          {show("Endpoints") && (
            <>
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
                        // ChatGPT signs in instead of taking a key.
                        ...(isChatGPTBaseUrl(pr.baseUrl) && {
                          apiKey: "",
                          defaultModel: d.defaultModel || CHATGPT_DEFAULT_MODEL,
                        }),
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
              {isChatGPT ? (
                <ChatGPTSignIn />
              ) : (
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
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="profile-model">Default model</Label>
                <Input
                  id="profile-model"
                  value={draft.defaultModel}
                  onChange={(e) =>
                    setDraft({ ...draft, defaultModel: e.target.value })
                  }
                  placeholder="openrouter/auto"
                  list="endpoint-models"
                />
                {test.state === "done" && test.result.ok && (
                  <datalist id="endpoint-models">
                    {test.result.models.slice(0, 200).map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                )}
              </div>

              <div className="flex items-center gap-2.5">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!draft.baseUrl.trim() || test.state === "testing"}
                  onClick={async () => {
                    setTest({ state: "testing" })
                    setTest({
                      state: "done",
                      result: await testEndpoint(
                        normalizeBaseUrl(draft.baseUrl),
                        draft.apiKey.trim()
                      ),
                    })
                  }}
                >
                  {test.state === "testing" ? (
                    <Loader2 data-icon="inline-start" className="animate-spin" />
                  ) : (
                    <Plug data-icon="inline-start" />
                  )}
                  Test
                </Button>
                {test.state === "done" &&
                  (test.result.ok ? (
                    <span className="text-sm text-primary">
                      ✓ {test.result.models.length} models available
                    </span>
                  ) : (
                    <span className="text-sm text-destructive">{test.result.detail}</span>
                  ))}
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
            </>
          )}

          {show("Account") && <AccountSection />}

          {show("Tools") && (
            <>
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
              server-side. Models that support tool calling decide when to
              search; others get results injected up front.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="e2b-key">E2B API key (code execution & computer use)</Label>
            <Input
              id="e2b-key"
              type="password"
              value={prefs.e2bKey ?? ""}
              onChange={(e) => setPrefs({ e2bKey: e.target.value || undefined })}
              placeholder="e2b_…"
            />
            <p className="text-xs text-muted-foreground">
              Lets tool-capable models run code in cloud sandboxes and drive a
              virtual desktop you can watch live. Get a key at e2b.dev — usage is
              billed by E2B. Stored in this browser only, sent directly to E2B.
            </p>
          </div>

          <McpSection />
            </>
          )}

          {show("General") && <DeleteAllChats />}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DeleteAllChats() {
  const count = useLiveQuery(() =>
    db.conversations.filter((c) => !c.deletedAt).count()
  )
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    try {
      const n = await deleteAllConversations()
      toast.success(`Deleted ${n} chat${n === 1 ? "" : "s"}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete chats")
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <div className="grid gap-1.5 border-t border-border pt-4">
      <Label className="text-destructive">Danger zone</Label>
      {confirming ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="min-w-40 flex-1 text-sm">
            Delete all {count ?? ""} chats? This can't be undone.
          </span>
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={run} disabled={busy}>
            {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Trash2 data-icon="inline-start" />}
            Delete all
          </Button>
        </div>
      ) : (
        <>
          <Button
            variant="destructive"
            size="sm"
            className="justify-start"
            disabled={!count}
            onClick={() => setConfirming(true)}
          >
            <Trash2 data-icon="inline-start" />
            Delete all chats
          </Button>
          <p className="text-xs text-muted-foreground">
            Removes every conversation on this device{" "}
            {count ? `(${count})` : ""}. With sync on, they're removed from your
            other devices too.
          </p>
        </>
      )}
    </div>
  )
}

const EMPTY_MCP_DRAFT = { name: "", url: "", authToken: "" }

function McpSection() {
  const prefs = usePrefs()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState(EMPTY_MCP_DRAFT)
  const servers = prefs.mcpServers ?? []

  const save = () => {
    setPrefs({
      mcpServers: [
        ...servers,
        {
          id: crypto.randomUUID(),
          name: draft.name.trim(),
          url: draft.url.trim(),
          authToken: draft.authToken.trim() || undefined,
          enabled: true,
        },
      ],
    })
    setDraft(EMPTY_MCP_DRAFT)
    setAdding(false)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>MCP servers</Label>
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus data-icon="inline-start" />
          Add server
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Tools from these servers are offered to models that support tool
        calling. Servers must speak the Streamable HTTP transport and allow
        browser (CORS) access. Servers that require OAuth get a Connect button;
        all tokens stay in this browser.
      </p>

      {servers.map((s) => (
        <div
          key={s.id}
          className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/40 px-3 py-2"
        >
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-1.5 truncate text-sm font-medium">
              {s.name}
              {s.oauth?.tokens && (
                <Badge variant="secondary" className="gap-1 text-xs">
                  <Check className="size-3" /> authorized
                </Badge>
              )}
            </span>
            <span className="truncate text-xs text-muted-foreground">{s.url}</span>
          </div>
          {s.oauth?.tokens ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => disconnectMcpServer(s.id)}
            >
              Disconnect
            </Button>
          ) : (
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                toast.promise(authorizeMcpServer(s), {
                  loading: `Connecting to "${s.name}"…`,
                  success: `Connected to "${s.name}"`,
                  error: (e: unknown) => (e instanceof Error ? e.message : String(e)),
                })
              }}
            >
              <LogIn data-icon="inline-start" />
              Connect
            </Button>
          )}
          <Switch
            checked={s.enabled}
            onCheckedChange={(on) =>
              setPrefs({
                mcpServers: servers.map((x) => (x.id === s.id ? { ...x, enabled: on } : x)),
              })
            }
            aria-label={`Enable ${s.name}`}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-destructive"
            aria-label={`Delete ${s.name}`}
            onClick={() => setPrefs({ mcpServers: servers.filter((x) => x.id !== s.id) })}
          >
            <Trash2 />
          </Button>
        </div>
      ))}

      {adding && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/60 p-3">
          <div className="grid gap-1.5">
            <Label htmlFor="mcp-name">Name</Label>
            <Input
              id="mcp-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="deepwiki"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mcp-url">URL</Label>
            <Input
              id="mcp-url"
              value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              placeholder="https://mcp.example.com/mcp"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mcp-token">Bearer token (optional)</Label>
            <Input
              id="mcp-token"
              type="password"
              value={draft.authToken}
              onChange={(e) => setDraft({ ...draft, authToken: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!draft.name.trim() || !/^https?:\/\//.test(draft.url.trim())}
              onClick={save}
            >
              Add server
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
