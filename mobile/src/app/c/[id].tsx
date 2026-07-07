import { sendMessage, type AttachmentInput } from "@chat/core"
import { asc, eq } from "drizzle-orm"
import { useLiveQuery } from "drizzle-orm/expo-sqlite"
import { router, Stack, useLocalSearchParams } from "expo-router"
import { useMemo } from "react"
import { FlatList, KeyboardAvoidingView, Platform, View } from "react-native"

import { Composer } from "@/components/composer"
import { MessageRow } from "@/components/message"
import { db, messages } from "@/lib/db"
import { rowToMessage } from "@/lib/store"

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const convId = !id || id === "new" ? null : id

  const { data: rows } = useLiveQuery(
    db
      .select()
      .from(messages)
      .where(eq(messages.convId, convId ?? "∅"))
      .orderBy(asc(messages.seq)),
    [convId]
  )

  const visible = useMemo(() => {
    const all = (rows ?? []).map(rowToMessage)
    // ponytail: single-model target on mobile, so no compare/promote UI —
    // show user messages plus active or streaming assistant replies.
    return all.filter((m) => m.role === "user" || m.active || m.status === "streaming")
  }, [rows])

  const streaming = visible.some((m) => m.status === "streaming")

  const onSend = async (text: string, files: AttachmentInput[], webSearch: boolean) => {
    const newId = await sendMessage(convId, text, files, { webSearch })
    if (!convId) router.setParams({ id: newId })
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <Stack.Screen options={{ title: "" }} />
      <FlatList
        className="flex-1"
        data={[...visible].reverse()}
        inverted
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <MessageRow message={item} />}
        contentContainerClassName="pt-3 pb-2"
      />
      <View className="pb-safe">
        <Composer convId={convId} streaming={streaming} onSend={onSend} />
      </View>
    </KeyboardAvoidingView>
  )
}
