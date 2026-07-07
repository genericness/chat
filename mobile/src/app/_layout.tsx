import "../global.css"

import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useEffect, useState } from "react"
import { View } from "react-native"

import { initCore } from "@/lib/setup"

export default function RootLayout() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    void initCore().then(() => setReady(true))
  }, [])
  if (!ready) return <View className="flex-1 bg-background" />
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#09090b" },
          headerTintColor: "#fafafa",
          headerShadowVisible: false,
          contentStyle: { backgroundColor: "#09090b" },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Chats" }} />
        <Stack.Screen name="c/[id]" options={{ title: "" }} />
        <Stack.Screen name="settings" options={{ title: "Settings", presentation: "modal" }} />
      </Stack>
    </>
  )
}
