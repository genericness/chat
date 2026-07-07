import { stopConversation, type AttachmentInput } from "@chat/core"
import * as ImagePicker from "expo-image-picker"
import { useState } from "react"
import { ActivityIndicator, Alert, Image, Pressable, Text, TextInput, View } from "react-native"

import { usePrefs } from "@/lib/use-prefs"

interface PendingFile {
  name: string
  mime: string
  base64: string
}

interface ComposerProps {
  convId: string | null
  streaming: boolean
  onSend: (text: string, files: AttachmentInput[], webSearch: boolean) => Promise<void>
}

export function Composer({ convId, streaming, onSend }: ComposerProps) {
  const [text, setText] = useState("")
  const [pending, setPending] = useState<PendingFile[]>([])
  const [webSearch, setWebSearch] = useState(false)
  const [sending, setSending] = useState(false)
  const prefs = usePrefs()

  const pickImage = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      base64: true,
      quality: 0.8,
      allowsMultipleSelection: true,
    })
    if (res.canceled) return
    setPending((p) => [
      ...p,
      ...res.assets
        .filter((a) => a.base64)
        .map((a) => ({
          name: a.fileName ?? "photo.jpg",
          mime: a.mimeType ?? "image/jpeg",
          base64: a.base64!,
        })),
    ])
  }

  const send = async () => {
    const t = text.trim()
    if ((!t && !pending.length) || streaming || sending) return
    setText("")
    const files = pending.map((f) => ({ name: f.name, mime: f.mime, data: f.base64 }))
    setPending([])
    setSending(true)
    try {
      await onSend(t, files, webSearch)
    } catch (err) {
      setText(t)
      Alert.alert("Error", err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <View className="border-t border-border bg-background px-3 pb-2 pt-2">
      {pending.length > 0 && (
        <View className="mb-2 flex-row flex-wrap gap-2">
          {pending.map((f, i) => (
            <Pressable key={i} onPress={() => setPending((p) => p.filter((_, idx) => idx !== i))}>
              <Image
                source={{ uri: `data:${f.mime};base64,${f.base64}` }}
                className="h-14 w-14 rounded-lg"
              />
            </Pressable>
          ))}
        </View>
      )}
      <View className="flex-row items-end gap-2">
        <Pressable className="h-10 w-10 items-center justify-center" onPress={pickImage} hitSlop={4}>
          <Text className="text-2xl text-muted">+</Text>
        </Pressable>
        <TextInput
          className="max-h-32 min-h-10 flex-1 rounded-2xl border border-border bg-card px-4 py-2.5 text-[15px] text-foreground"
          placeholder="Ask anything"
          placeholderTextColor="#71717a"
          multiline
          value={text}
          onChangeText={setText}
        />
        {prefs.exaKey ? (
          <Pressable
            className={`h-10 w-10 items-center justify-center rounded-full ${webSearch ? "bg-accent/25" : ""}`}
            onPress={() => setWebSearch((v) => !v)}
            hitSlop={4}
          >
            <Text className="text-lg">🌐</Text>
          </Pressable>
        ) : null}
        {streaming ? (
          <Pressable
            className="h-10 w-10 items-center justify-center rounded-full bg-card"
            onPress={() => convId && void stopConversation(convId)}
          >
            <Text className="text-base text-foreground">■</Text>
          </Pressable>
        ) : (
          <Pressable
            className="h-10 w-10 items-center justify-center rounded-full bg-foreground active:opacity-80"
            onPress={() => void send()}
            disabled={sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#09090b" />
            ) : (
              <Text className="text-lg font-bold text-background">↑</Text>
            )}
          </Pressable>
        )}
      </View>
    </View>
  )
}
