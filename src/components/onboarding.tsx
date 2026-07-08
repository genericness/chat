import { useState } from "react"
import { ArrowLeft, ArrowRight, Check, CircleAlert, Loader2, Plug } from "lucide-react"

import { ShinyText } from "@/components/shiny-text"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { fmtContext, fmtPricePerM, lookupMeta, useOpenRouterMeta } from "@/hooks/use-models"
import { testEndpoint, type EndpointTestResult } from "@/lib/endpoint-test"
import { normalizeBaseUrl, PRESETS, setPrefs } from "@/lib/profiles"
import { cn } from "@/lib/utils"

const STEPS = ["Welcome", "Endpoint", "Search & tools", "System prompt"] as const

export function Onboarding({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0)

  // endpoint draft
  const [draft, setDraft] = useState({ name: "", baseUrl: "", apiKey: "", defaultModel: "" })
  const [test, setTest] = useState<{ state: "idle" | "testing" } | { state: "done"; result: EndpointTestResult }>({ state: "idle" })
  const [modelQuery, setModelQuery] = useState("")
  const { data: meta } = useOpenRouterMeta()

  // extras drafts
  const [exaKey, setExaKey] = useState("")
  const [e2bKey, setE2bKey] = useState("")
  const [mcp, setMcp] = useState({ name: "", url: "" })
  const [systemPrompt, setSystemPrompt] = useState("")

  if (!open) return null

  const models = test.state === "done" && test.result.ok ? test.result.models : []
  const preset = PRESETS.find((p) => normalizeBaseUrl(p.baseUrl) === normalizeBaseUrl(draft.baseUrl))

  const runTest = async () => {
    setTest({ state: "testing" })
    setTest({ state: "done", result: await testEndpoint(normalizeBaseUrl(draft.baseUrl), draft.apiKey.trim()) })
  }

  const saveEndpoint = () => {
    if (!draft.baseUrl.trim()) return
    const id = crypto.randomUUID()
    setPrefs({
      profiles: [
        {
          id,
          name: draft.name.trim() || preset?.name || "My endpoint",
          baseUrl: normalizeBaseUrl(draft.baseUrl),
          apiKey: draft.apiKey.trim(),
          defaultModel: draft.defaultModel.trim() || undefined,
        },
      ],
      activeProfileId: id,
      ...(draft.defaultModel.trim() && { selectedModels: [draft.defaultModel.trim()] }),
    })
  }

  const saveExtras = () => {
    if (exaKey.trim()) setPrefs({ exaKey: exaKey.trim() })
    if (e2bKey.trim()) setPrefs({ e2bKey: e2bKey.trim() })
    if (mcp.name.trim() && /^https?:\/\//.test(mcp.url.trim())) {
      setPrefs({
        mcpServers: [
          { id: crypto.randomUUID(), name: mcp.name.trim(), url: mcp.url.trim(), enabled: true },
        ],
      })
    }
  }

  const finish = () => {
    if (systemPrompt.trim()) setPrefs({ globalSystemPrompt: systemPrompt.trim() })
    setPrefs({ onboardedAt: Date.now() })
    onClose()
  }

  const next = () => {
    if (step === 1 && draft.baseUrl.trim()) saveEndpoint()
    if (step === 2) saveExtras()
    if (step === STEPS.length - 1) finish()
    else setStep(step + 1)
  }

  const skipAll = () => {
    setPrefs({ onboardedAt: Date.now() })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background px-4 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] sm:items-center">
      <div
        aria-hidden
        className="pointer-events-none fixed top-1/2 left-1/2 h-[420px] w-[min(92vw,50rem)] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(ellipse_closest-side,color-mix(in_oklch,var(--primary),transparent_82%),transparent)]"
      />
      <div className="relative flex w-full max-w-xl flex-col gap-6 rounded-2xl border border-border/70 bg-card/40 p-6 backdrop-blur-md sm:p-8">
        <div className="flex items-center justify-between">
          <span className="font-pixel text-lg tracking-tight text-primary">chat</span>
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
              {STEPS.map((s, i) => (
                <span
                  key={s}
                  className={cn(
                    "h-1.5 w-6 rounded-full transition-colors",
                    i <= step ? "bg-primary" : "bg-muted"
                  )}
                />
              ))}
            </div>
            <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={skipAll}>
              Skip setup
            </Button>
          </div>
        </div>

        {step === 0 && (
          <div className="flex flex-col gap-4">
            <h1 className="text-2xl font-medium tracking-tight sm:text-3xl">
              <ShinyText text="Welcome to chat" />
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              A bring-your-own-key client for any OpenAI-compatible API — stream from OpenRouter,
              OpenAI, Anthropic, Groq, local Ollama, and more. Compare models side by side, search
              the web, connect MCP tools, and let models build small apps right in the chat.
            </p>
            <p className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
              Your API keys and chats stay in this browser. Keys are never sent to this app's
              server, never synced, never logged.
            </p>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-lg font-medium">Connect your first endpoint</h2>
              <p className="text-sm text-muted-foreground">
                Pick a provider, paste your key, and test the connection. You can add more later in
                Settings.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((pr) => (
                <Button
                  key={pr.name}
                  variant={preset?.name === pr.name ? "secondary" : "outline"}
                  size="xs"
                  onClick={() => {
                    setDraft((d) => ({ ...d, name: pr.name, baseUrl: pr.baseUrl }))
                    setTest({ state: "idle" })
                  }}
                >
                  {pr.name}
                </Button>
              ))}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ob-url">Base URL</Label>
              <Input
                id="ob-url"
                value={draft.baseUrl}
                onChange={(e) => {
                  setDraft({ ...draft, baseUrl: e.target.value })
                  setTest({ state: "idle" })
                }}
                placeholder="https://openrouter.ai/api/v1"
              />
              {preset?.hint && <p className="text-xs text-muted-foreground">{preset.hint}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ob-key">API key</Label>
              <Input
                id="ob-key"
                type="password"
                value={draft.apiKey}
                onChange={(e) => {
                  setDraft({ ...draft, apiKey: e.target.value })
                  setTest({ state: "idle" })
                }}
                placeholder="sk-… (leave empty for local servers)"
              />
            </div>

            <div className="flex items-center gap-2.5">
              <Button
                variant="outline"
                size="sm"
                disabled={!draft.baseUrl.trim() || test.state === "testing"}
                onClick={() => void runTest()}
              >
                {test.state === "testing" ? (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                ) : (
                  <Plug data-icon="inline-start" />
                )}
                Test connection
              </Button>
              {test.state === "done" &&
                (test.result.ok ? (
                  <span className="flex items-center gap-1.5 text-sm text-primary">
                    <Check className="size-4" /> {test.result.models.length} models available
                  </span>
                ) : (
                  <span className="flex items-start gap-1.5 text-sm text-destructive">
                    <CircleAlert className="mt-0.5 size-4 shrink-0" /> {test.result.detail}
                  </span>
                ))}
            </div>

            {models.length > 0 && (
              <div className="grid gap-1.5">
                <Label>Default model</Label>
                <Command shouldFilter className="rounded-lg border border-border">
                  <CommandInput
                    placeholder="Search models…"
                    value={modelQuery}
                    onValueChange={setModelQuery}
                  />
                  <CommandList className="max-h-44">
                    <CommandEmpty>No matches</CommandEmpty>
                    {models.map((id) => {
                      const m = lookupMeta(meta, id)
                      const bits = [id, fmtContext(m?.contextLength), fmtPricePerM(m?.pricing?.prompt)]
                        .filter(Boolean)
                        .join(" · ")
                      return (
                        <CommandItem
                          key={id}
                          value={`${id} ${m?.name ?? ""}`}
                          onSelect={() => setDraft({ ...draft, defaultModel: id })}
                          className="gap-2"
                        >
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-sm">{m?.name ?? id}</span>
                            <span className="truncate text-xs text-muted-foreground">{bits}</span>
                          </div>
                          {draft.defaultModel === id && <Check className="shrink-0 text-primary" />}
                        </CommandItem>
                      )
                    })}
                  </CommandList>
                </Command>
              </div>
            )}
            {test.state === "done" && !test.result.ok && test.result.reason === "no-models" && (
              <div className="grid gap-1.5">
                <Label htmlFor="ob-model">Default model (manual)</Label>
                <Input
                  id="ob-model"
                  value={draft.defaultModel}
                  onChange={(e) => setDraft({ ...draft, defaultModel: e.target.value })}
                  placeholder="e.g. llama3.2"
                />
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-lg font-medium">Web search & tools</h2>
              <p className="text-sm text-muted-foreground">
                Both optional — you can set these up any time in Settings.
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ob-exa">Exa API key (web search)</Label>
              <Input
                id="ob-exa"
                type="password"
                value={exaKey}
                onChange={(e) => setExaKey(e.target.value)}
                placeholder="exa-…"
              />
              <p className="text-xs text-muted-foreground">
                Enables the web-search toggle on the composer, with cited sources. Get a key at
                exa.ai — stored in this browser only.
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ob-e2b">E2B API key (code & computer use)</Label>
              <Input
                id="ob-e2b"
                type="password"
                value={e2bKey}
                onChange={(e) => setE2bKey(e.target.value)}
                placeholder="e2b_…"
              />
              <p className="text-xs text-muted-foreground">
                Models can run code in cloud sandboxes and drive a virtual desktop
                you watch live. Get a key at e2b.dev — usage billed by E2B.
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label>MCP server (optional)</Label>
              <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
                <Input
                  aria-label="MCP server name"
                  value={mcp.name}
                  onChange={(e) => setMcp({ ...mcp, name: e.target.value })}
                  placeholder="name"
                />
                <Input
                  aria-label="MCP server URL"
                  value={mcp.url}
                  onChange={(e) => setMcp({ ...mcp, url: e.target.value })}
                  placeholder="https://mcp.example.com/mcp"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Tools from Model Context Protocol servers are offered to tool-capable models.
                OAuth-protected servers will prompt to connect on first use.
              </p>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-lg font-medium">Default system prompt</h2>
              <p className="text-sm text-muted-foreground">
                Applied to every new chat unless overridden per conversation. Leave empty for
                provider defaults.
              </p>
            </div>
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="You are a concise, helpful assistant…"
              className="min-h-28"
            />
          </div>
        )}

        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className={cn(step === 0 && "invisible")}
            onClick={() => setStep(step - 1)}
          >
            <ArrowLeft data-icon="inline-start" />
            Back
          </Button>
          <div className="flex items-center gap-2">
            {step > 0 && step < STEPS.length - 1 && (
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setStep(step + 1)}>
                Skip
              </Button>
            )}
            <Button size="sm" onClick={next} disabled={step === 1 && !!draft.baseUrl.trim() && test.state === "testing"}>
              {step === 0 ? "Get started" : step === STEPS.length - 1 ? "Start chatting" : "Next"}
              <ArrowRight data-icon="inline-end" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
