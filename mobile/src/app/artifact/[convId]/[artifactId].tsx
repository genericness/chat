import { asc, eq } from "drizzle-orm"
import { useLiveQuery } from "drizzle-orm/expo-sqlite"
import { Stack, useLocalSearchParams } from "expo-router"
import { useMemo } from "react"
import { Linking, Text, View } from "react-native"
import { WebView } from "react-native-webview"

import { db, messages } from "@/lib/db"
import { rowToMessage } from "@/lib/store"

export default function ArtifactScreen() {
  const { convId, artifactId } = useLocalSearchParams<{ convId: string; artifactId: string }>()

  // Live: edit_artifact snapshots update the preview as they stream in.
  const { data: rows } = useLiveQuery(
    db
      .select()
      .from(messages)
      .where(eq(messages.convId, convId ?? "∅"))
      .orderBy(asc(messages.seq)),
    [convId]
  )

  const snap = useMemo(() => {
    const msgs = (rows ?? []).map(rowToMessage)
    for (let i = msgs.length - 1; i >= 0; i--) {
      const snaps = msgs[i].artifacts
      if (!snaps) continue
      for (let j = snaps.length - 1; j >= 0; j--) {
        if (snaps[j].artifactId === artifactId) return snaps[j]
      }
    }
    return undefined
  }, [rows, artifactId])

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ title: snap?.title ?? "Artifact" }} />
      {snap ? (
        <WebView
          key={snap.html.length} // re-mount on edits so state resets like the web panel
          source={{ html: snap.html }}
          // Like the web's sandboxed iframe: the WebView has no bridge into the
          // app (no injectedJavaScript, no onMessage), so artifact code can
          // never reach SecureStore keys. Top-frame navigations (link clicks)
          // open in the system browser instead of hijacking the preview.
          originWhitelist={["*"]}
          allowFileAccess={false}
          setSupportMultipleWindows={false}
          onShouldStartLoadWithRequest={(req) => {
            if (req.url.startsWith("http") && req.isTopFrame) {
              void Linking.openURL(req.url)
              return false
            }
            return true
          }}
        />
      ) : (
        <View className="flex-1 items-center justify-center">
          <Text className="text-muted">Artifact not found</Text>
        </View>
      )}
    </View>
  )
}
