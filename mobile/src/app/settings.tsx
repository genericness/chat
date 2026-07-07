import {
  disconnectMcpServer,
  getPrefs,
  normalizeBaseUrl,
  PRESETS,
  runSync,
  setPrefs,
  testEndpoint,
  updateMcpServer,
  type McpServerConfig,
  type Profile,
} from "@chat/core"
import { useEffect, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native"

import { getToken, signIn, signOut } from "@/lib/auth"
import { mobileFetch } from "@/lib/fetch"
import { authorizeMcpServer } from "@/lib/mcp-oauth"
import { usePrefs } from "@/lib/use-prefs"

interface Me {
  login: string
  name?: string
}

function AccountSection({ prefs }: { prefs: ReturnType<typeof usePrefs> }) {
  const [me, setMe] = useState<Me | null | "loading">(getToken() ? "loading" : null)

  const refresh = async () => {
    if (!getToken()) return setMe(null)
    try {
      const res = await mobileFetch("/api/me")
      setMe(res.ok ? ((await res.json()) as Me) : null)
    } catch {
      setMe(null)
    }
  }
  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doSignIn = async () => {
    if (await signIn()) {
      await refresh()
      if (getPrefs().syncEnabled) void runSync()
    }
  }

  return (
    <View className="mb-6">
      <Text className="mb-2 text-xs uppercase text-muted">Account & sync</Text>
      {me === "loading" ? (
        <ActivityIndicator size="small" color="#a1a1aa" className="self-start" />
      ) : me ? (
        <View className="rounded-xl border border-border bg-card/50 px-4 py-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-foreground">@{me.login}</Text>
            <Pressable
              hitSlop={8}
              onPress={() => {
                void signOut().then(() => setMe(null))
              }}
            >
              <Text className="text-xs text-muted">sign out</Text>
            </Pressable>
          </View>
          <View className="mt-3 flex-row items-center justify-between">
            <View className="flex-1 pr-3">
              <Text className="text-foreground">Sync chats</Text>
              <Text className="text-xs text-muted">
                Conversations sync across devices. Keys never leave this device.
              </Text>
            </View>
            <Switch
              value={!!prefs.syncEnabled}
              onValueChange={(v) => {
                setPrefs({ syncEnabled: v })
                if (v) void runSync()
              }}
            />
          </View>
        </View>
      ) : (
        <Pressable
          className="items-center rounded-xl border border-border bg-card/50 py-3"
          onPress={() => void doSignIn()}
        >
          <Text className="text-foreground">Sign in with GitHub</Text>
        </Pressable>
      )}
    </View>
  )
}

function Field(props: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  secure?: boolean
  multiline?: boolean
}) {
  return (
    <View className="mb-3">
      <Text className="mb-1 text-xs uppercase text-muted">{props.label}</Text>
      <TextInput
        className={`rounded-lg border border-border bg-card px-3 py-2.5 text-foreground ${props.multiline ? "min-h-20" : ""}`}
        value={props.value}
        onChangeText={props.onChange}
        placeholder={props.placeholder}
        placeholderTextColor="#71717a"
        secureTextEntry={props.secure}
        multiline={props.multiline}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  )
}

function ProfileEditor({ profile, onDone }: { profile: Profile | null; onDone: () => void }) {
  const [name, setName] = useState(profile?.name ?? "")
  const [baseUrl, setBaseUrl] = useState(profile?.baseUrl ?? "")
  const [apiKey, setApiKey] = useState(profile?.apiKey ?? "")
  const [defaultModel, setDefaultModel] = useState(profile?.defaultModel ?? "")
  const [models, setModels] = useState<string[]>([])
  const [testing, setTesting] = useState(false)

  const test = async () => {
    setTesting(true)
    try {
      const r = await testEndpoint(normalizeBaseUrl(baseUrl), apiKey)
      if (r.ok) setModels(r.models)
      else Alert.alert("Endpoint test", r.detail)
    } finally {
      setTesting(false)
    }
  }

  const save = () => {
    if (!baseUrl.trim()) return Alert.alert("Base URL is required")
    const prefs = getPrefs()
    const next: Profile = {
      id: profile?.id ?? crypto.randomUUID(),
      name: name.trim() || new URL(normalizeBaseUrl(baseUrl)).hostname,
      baseUrl: normalizeBaseUrl(baseUrl),
      apiKey,
      defaultModel: defaultModel.trim() || undefined,
    }
    const rest = prefs.profiles.filter((p) => p.id !== next.id)
    setPrefs({ profiles: [...rest, next], activeProfileId: next.id })
    onDone()
  }

  return (
    <View className="mb-6 rounded-xl border border-border bg-card/50 p-4">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3">
        {PRESETS.map((p) => (
          <Pressable
            key={p.name}
            className={`mr-2 rounded-full border px-3 py-1.5 ${baseUrl === p.baseUrl ? "border-accent bg-accent/20" : "border-border"}`}
            onPress={() => {
              setBaseUrl(p.baseUrl)
              if (!name) setName(p.name)
            }}
          >
            <Text className="text-sm text-foreground">{p.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Field label="Name" value={name} onChange={setName} placeholder="OpenRouter" />
      <Field label="Base URL" value={baseUrl} onChange={setBaseUrl} placeholder="https://…/v1" />
      <Field label="API key" value={apiKey} onChange={setApiKey} secure placeholder="sk-…" />
      <Field
        label="Default model"
        value={defaultModel}
        onChange={setDefaultModel}
        placeholder="e.g. anthropic/claude-sonnet-4.5"
      />
      {models.length > 0 && (
        <ScrollView className="mb-3 max-h-44 rounded-lg border border-border">
          {models.map((m) => (
            <Pressable
              key={m}
              className={`border-b border-border px-3 py-2 ${m === defaultModel ? "bg-accent/20" : ""}`}
              onPress={() => setDefaultModel(m)}
            >
              <Text className="text-sm text-foreground">{m}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      <View className="flex-row gap-2">
        <Pressable
          className="flex-1 items-center rounded-lg border border-border py-2.5"
          onPress={() => void test()}
          disabled={testing}
        >
          {testing ? (
            <ActivityIndicator size="small" color="#a1a1aa" />
          ) : (
            <Text className="text-foreground">Test & list models</Text>
          )}
        </Pressable>
        <Pressable className="flex-1 items-center rounded-lg bg-foreground py-2.5" onPress={save}>
          <Text className="font-semibold text-background">Save</Text>
        </Pressable>
      </View>
      <Pressable className="mt-2 items-center py-1" onPress={onDone}>
        <Text className="text-sm text-muted">Cancel</Text>
      </Pressable>
    </View>
  )
}

export default function Settings() {
  const prefs = usePrefs()
  const [editing, setEditing] = useState<Profile | null | "new">(null)

  const removeProfile = (p: Profile) => {
    Alert.alert("Remove endpoint?", p.name, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          const rest = prefs.profiles.filter((x) => x.id !== p.id)
          setPrefs({
            profiles: rest,
            activeProfileId:
              prefs.activeProfileId === p.id ? rest[0]?.id : prefs.activeProfileId,
          })
        },
      },
    ])
  }

  return (
    <ScrollView className="flex-1 bg-background px-4 pt-4" keyboardShouldPersistTaps="handled">
      <AccountSection prefs={prefs} />
      <Text className="mb-2 text-xs uppercase text-muted">Endpoints</Text>
      {prefs.profiles.map((p) =>
        editing !== "new" && editing?.id === p.id ? (
          <ProfileEditor key={p.id} profile={p} onDone={() => setEditing(null)} />
        ) : (
          <Pressable
            key={p.id}
            className="mb-2 flex-row items-center justify-between rounded-xl border border-border bg-card/50 px-4 py-3"
            onPress={() => setEditing(p)}
            onLongPress={() => removeProfile(p)}
          >
            <View className="flex-1">
              <Text className="text-foreground">{p.name}</Text>
              <Text className="text-xs text-muted" numberOfLines={1}>
                {p.defaultModel ?? p.baseUrl}
              </Text>
            </View>
            {prefs.activeProfileId === p.id ? (
              <Text className="text-xs text-accent">active</Text>
            ) : (
              <Pressable
                hitSlop={8}
                onPress={() => setPrefs({ activeProfileId: p.id })}
              >
                <Text className="text-xs text-muted">set active</Text>
              </Pressable>
            )}
          </Pressable>
        )
      )}
      {editing === "new" ? (
        <ProfileEditor profile={null} onDone={() => setEditing(null)} />
      ) : (
        <Pressable
          className="mb-6 items-center rounded-xl border border-dashed border-border py-3"
          onPress={() => setEditing("new")}
        >
          <Text className="text-muted">+ Add endpoint</Text>
        </Pressable>
      )}

      <Text className="mb-2 text-xs uppercase text-muted">Web search</Text>
      <Field
        label="Exa API key"
        value={prefs.exaKey ?? ""}
        onChange={(v) => setPrefs({ exaKey: v || undefined })}
        secure
        placeholder="Enables web_search + fetch_url tools"
      />

      <Text className="mb-2 mt-2 text-xs uppercase text-muted">Chat</Text>
      <Field
        label="Global system prompt"
        value={prefs.globalSystemPrompt ?? ""}
        onChange={(v) => setPrefs({ globalSystemPrompt: v || undefined })}
        multiline
        placeholder="Applied to every conversation without its own prompt"
      />

      <Text className="mb-2 mt-2 text-xs uppercase text-muted">MCP servers</Text>
      <McpSection servers={prefs.mcpServers ?? []} />
      <View className="h-16" />
    </ScrollView>
  )
}

function McpSection({ servers }: { servers: McpServerConfig[] }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [token, setToken] = useState("")

  const add = () => {
    if (!url.trim()) return Alert.alert("Server URL is required")
    const server: McpServerConfig = {
      id: crypto.randomUUID(),
      name: name.trim() || new URL(url.trim()).hostname,
      url: url.trim(),
      authToken: token.trim() || undefined,
      enabled: true,
    }
    setPrefs({ mcpServers: [...(getPrefs().mcpServers ?? []), server] })
    setAdding(false)
    setName("")
    setUrl("")
    setToken("")
  }

  const remove = (s: McpServerConfig) => {
    Alert.alert("Remove server?", s.name, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () =>
          setPrefs({ mcpServers: (getPrefs().mcpServers ?? []).filter((x) => x.id !== s.id) }),
      },
    ])
  }

  const connect = (s: McpServerConfig) => {
    void authorizeMcpServer(s)
      .then(() => Alert.alert("Connected", `"${s.name}" is authorized.`))
      .catch((e) => Alert.alert("Error", e instanceof Error ? e.message : String(e)))
  }

  return (
    <View className="mb-4">
      {servers.map((s) => (
        <Pressable
          key={s.id}
          className="mb-2 rounded-xl border border-border bg-card/50 px-4 py-3"
          onLongPress={() => remove(s)}
        >
          <View className="flex-row items-center justify-between">
            <View className="flex-1 pr-3">
              <Text className="text-foreground">{s.name}</Text>
              <Text className="text-xs text-muted" numberOfLines={1}>
                {s.url}
              </Text>
            </View>
            <Switch
              value={s.enabled}
              onValueChange={(v) => updateMcpServer(s.id, { enabled: v })}
            />
          </View>
          <View className="mt-2 flex-row gap-4">
            {s.oauth?.tokens ? (
              <Pressable hitSlop={6} onPress={() => disconnectMcpServer(s.id)}>
                <Text className="text-xs text-muted">disconnect oauth</Text>
              </Pressable>
            ) : (
              !s.authToken && (
                <Pressable hitSlop={6} onPress={() => connect(s)}>
                  <Text className="text-xs text-accent">connect (oauth)</Text>
                </Pressable>
              )
            )}
          </View>
        </Pressable>
      ))}
      {adding ? (
        <View className="mb-2 rounded-xl border border-border bg-card/50 p-4">
          <Field label="Name" value={name} onChange={setName} placeholder="My server" />
          <Field label="URL" value={url} onChange={setUrl} placeholder="https://…/mcp" />
          <Field label="Bearer token (optional)" value={token} onChange={setToken} secure />
          <View className="flex-row gap-2">
            <Pressable
              className="flex-1 items-center rounded-lg border border-border py-2.5"
              onPress={() => setAdding(false)}
            >
              <Text className="text-muted">Cancel</Text>
            </Pressable>
            <Pressable className="flex-1 items-center rounded-lg bg-foreground py-2.5" onPress={add}>
              <Text className="font-semibold text-background">Add</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          className="items-center rounded-xl border border-dashed border-border py-3"
          onPress={() => setAdding(true)}
        >
          <Text className="text-muted">+ Add MCP server</Text>
        </Pressable>
      )}
    </View>
  )
}
