import { answerQuestion, regenerate, type Message } from "@chat/core"
import { router } from "expo-router"
import { useState } from "react"
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from "react-native"
import Markdown from "react-native-markdown-display"

const mdStyles = {
  body: { color: "#fafafa", fontSize: 15, lineHeight: 22 },
  code_inline: {
    backgroundColor: "#18181b",
    color: "#e4e4e7",
    borderRadius: 4,
    fontFamily: "monospace",
  },
  code_block: {
    backgroundColor: "#18181b",
    color: "#e4e4e7",
    borderColor: "#27272a",
    borderRadius: 8,
    fontFamily: "monospace",
    fontSize: 13,
  },
  fence: {
    backgroundColor: "#18181b",
    color: "#e4e4e7",
    borderColor: "#27272a",
    borderRadius: 8,
    fontFamily: "monospace",
    fontSize: 13,
  },
  blockquote: { backgroundColor: "#18181b", borderColor: "#3f3f46" },
  hr: { backgroundColor: "#27272a" },
  table: { borderColor: "#27272a" },
  th: { color: "#fafafa" },
  link: { color: "#60a5fa" },
} as const

function QuestionCard({ q }: { q: NonNullable<Message["pendingQuestion"]> }) {
  const [selected, setSelected] = useState<string[]>([])
  const [free, setFree] = useState("")
  const submit = (answer: string) => answerQuestion(q.toolCallId, answer)

  return (
    <View className="my-2 rounded-xl border border-border bg-card p-3">
      <Text className="mb-2 text-[15px] text-foreground">{q.question}</Text>
      {(q.options ?? []).map((o) => {
        const on = selected.includes(o)
        return (
          <Pressable
            key={o}
            className={`mb-1.5 rounded-lg border px-3 py-2 ${on ? "border-accent bg-accent/20" : "border-border"}`}
            onPress={() => {
              if (q.multiple) setSelected((s) => (on ? s.filter((x) => x !== o) : [...s, o]))
              else submit(o)
            }}
          >
            <Text className="text-foreground">{o}</Text>
          </Pressable>
        )
      })}
      <View className="mt-1 flex-row gap-2">
        <TextInput
          className="min-h-10 flex-1 rounded-lg border border-border px-3 text-foreground"
          placeholder="Type an answer…"
          placeholderTextColor="#71717a"
          value={free}
          onChangeText={setFree}
          onSubmitEditing={() => free.trim() && submit(free.trim())}
        />
        {(q.multiple || free.trim()) && (
          <Pressable
            className="justify-center rounded-lg bg-foreground px-4"
            onPress={() => {
              const answer = free.trim() || selected.join(", ")
              if (answer) submit(answer)
            }}
          >
            <Text className="font-semibold text-background">Send</Text>
          </Pressable>
        )}
      </View>
    </View>
  )
}

function ToolChips({ calls }: { calls: NonNullable<Message["toolCalls"]> }) {
  return (
    <View className="mb-1 flex-row flex-wrap gap-1.5">
      {calls.map((c) => (
        <View key={c.id} className="flex-row items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1">
          {(c.status === "streaming" || c.status === "running") && (
            <ActivityIndicator size={10} color="#a1a1aa" />
          )}
          <Text className="text-xs text-muted">
            {c.name}
            {c.status === "error" ? " ✕" : c.status === "done" ? " ✓" : ""}
          </Text>
        </View>
      ))}
    </View>
  )
}

function ArtifactCards({ message }: { message: Message }) {
  if (!message.artifacts?.length) return null
  return (
    <View className="mb-1.5 gap-1.5">
      {message.artifacts.map((a) => (
        <Pressable
          key={a.artifactId}
          className="flex-row items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 active:opacity-80"
          onPress={() =>
            router.navigate({
              pathname: "/artifact/[convId]/[artifactId]",
              params: { convId: message.convId, artifactId: a.artifactId },
            })
          }
        >
          <Text className="text-base">🖼️</Text>
          <View className="flex-1">
            <Text className="text-sm font-medium text-foreground">{a.title}</Text>
            <Text className="text-xs text-muted">Tap to open preview</Text>
          </View>
        </Pressable>
      ))}
    </View>
  )
}

function Stats({ stats }: { stats: NonNullable<Message["stats"]> }) {
  const parts: string[] = []
  if (stats.totalTokens) parts.push(`${stats.totalTokens} tok`)
  if (stats.completionTokens && stats.durationMs) {
    parts.push(`${(stats.completionTokens / (stats.durationMs / 1000)).toFixed(1)} tok/s`)
  }
  parts.push(`${(stats.durationMs / 1000).toFixed(1)}s`)
  return <Text className="mt-0.5 text-[11px] text-muted/70">{parts.join(" · ")}</Text>
}

export function MessageRow({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <View className="mb-3 items-end px-4">
        <View className="max-w-[85%] rounded-2xl rounded-br-md bg-card px-4 py-2.5">
          <Text className="text-[15px] leading-[22px] text-foreground">{message.content}</Text>
        </View>
      </View>
    )
  }

  const streaming = message.status === "streaming"
  return (
    <Pressable
      className="mb-3 px-4"
      onLongPress={() => {
        if (streaming) return
        Alert.alert("Response", message.model, [
          { text: "Cancel", style: "cancel" },
          { text: "Regenerate", onPress: () => void regenerate(message.id) },
        ])
      }}
    >
      {message.model && <Text className="mb-0.5 text-xs text-muted">{message.model}</Text>}
      {!!message.toolCalls?.length && <ToolChips calls={message.toolCalls} />}
      <ArtifactCards message={message} />
      {message.pendingQuestion && streaming && <QuestionCard q={message.pendingQuestion} />}
      {message.content ? (
        <Markdown style={mdStyles}>{message.content}</Markdown>
      ) : streaming ? (
        <ActivityIndicator size="small" color="#a1a1aa" className="self-start py-2" />
      ) : null}
      {message.status === "error" && (
        <Text className="mt-1 text-sm text-destructive">{message.error}</Text>
      )}
      {message.status === "stopped" && <Text className="mt-1 text-xs text-muted">stopped</Text>}
      {message.stats && !streaming && <Stats stats={message.stats} />}
    </Pressable>
  )
}
