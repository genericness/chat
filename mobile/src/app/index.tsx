import { deleteConversation } from "@chat/core"
import { desc, isNull } from "drizzle-orm"
import { useLiveQuery } from "drizzle-orm/expo-sqlite"
import { Link, router, Stack } from "expo-router"
import { Alert, FlatList, Pressable, Text, View } from "react-native"

import { conversations, db } from "@/lib/db"

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return "now"
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export default function ConversationList() {
  const { data } = useLiveQuery(
    db
      .select()
      .from(conversations)
      .where(isNull(conversations.deletedAt))
      .orderBy(desc(conversations.updatedAt))
  )

  const confirmDelete = (id: string, title: string) => {
    Alert.alert("Delete chat?", title, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void deleteConversation(id) },
    ])
  }

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          headerRight: () => (
            <Link href="/settings" asChild>
              <Pressable hitSlop={8}>
                <Text className="text-xl text-foreground">⋯</Text>
              </Pressable>
            </Link>
          ),
        }}
      />
      <FlatList
        data={data ?? []}
        keyExtractor={(c) => c.id}
        contentContainerClassName="pb-24"
        ListEmptyComponent={
          <View className="items-center pt-24">
            <Text className="text-muted">No chats yet — tap + to start</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            className="border-b border-border px-4 py-3.5 active:bg-card"
            onPress={() => router.push(`/c/${item.id}`)}
            onLongPress={() => confirmDelete(item.id, item.title)}
          >
            <View className="flex-row items-center justify-between gap-3">
              <Text className="flex-1 text-base text-foreground" numberOfLines={1}>
                {item.title}
              </Text>
              <Text className="text-xs text-muted">{timeAgo(item.updatedAt)}</Text>
            </View>
          </Pressable>
        )}
      />
      <Pressable
        className="absolute bottom-8 right-6 h-14 w-14 items-center justify-center rounded-full bg-foreground active:opacity-80"
        onPress={() => router.push("/c/new")}
      >
        <Text className="text-2xl font-bold text-background">+</Text>
      </Pressable>
    </View>
  )
}
