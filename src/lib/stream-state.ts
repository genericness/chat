import { useCallback, useSyncExternalStore } from "react"

import type { Message } from "@/lib/db"

export type StreamMessageState = Pick<
  Message,
  "content" | "reasoning" | "toolCalls" | "status" | "error" | "stats" | "searchResults"
>

const streams = new Map<string, StreamMessageState>()
const listeners = new Map<string, Set<() => void>>()
const cleanupTimers = new Map<string, number>()
const dirty = new Set<string>()
let frame: number | undefined

function notifyOnFrame(id: string) {
  if (!listeners.get(id)?.size) return
  dirty.add(id)
  if (frame !== undefined) return
  frame = window.requestAnimationFrame(() => {
    frame = undefined
    const ids = [...dirty]
    dirty.clear()
    for (const key of ids) {
      for (const listener of listeners.get(key) ?? []) listener()
    }
  })
}

function cancelCleanup(id: string) {
  const timer = cleanupTimers.get(id)
  if (timer !== undefined) window.clearTimeout(timer)
  cleanupTimers.delete(id)
}

export function beginStreamMessage(message: Message) {
  cancelCleanup(message.id)
  streams.set(message.id, {
    content: message.content,
    reasoning: message.reasoning,
    toolCalls: message.toolCalls,
    status: message.status,
    error: message.error,
    stats: message.stats,
    searchResults: message.searchResults,
  })
  notifyOnFrame(message.id)
}

export function updateStreamMessage(id: string, patch: Partial<StreamMessageState>) {
  const current = streams.get(id)
  if (!current) return
  streams.set(id, { ...current, ...patch })
  notifyOnFrame(id)
}

/** Keep the final overlay briefly so Dexie's live query can observe the durable write. */
export function settleStreamMessage(
  id: string,
  patch: Partial<StreamMessageState>,
  cleanupDelayMs = 2_000
) {
  updateStreamMessage(id, patch)
  cancelCleanup(id)
  cleanupTimers.set(
    id,
    window.setTimeout(() => {
      cleanupTimers.delete(id)
      streams.delete(id)
      notifyOnFrame(id)
    }, cleanupDelayMs)
  )
}

export function useStreamedMessage(message: Message): Message {
  const subscribe = useCallback(
    (listener: () => void) => {
      let set = listeners.get(message.id)
      if (!set) {
        set = new Set()
        listeners.set(message.id, set)
      }
      set.add(listener)
      return () => {
        set?.delete(listener)
        if (set?.size === 0) listeners.delete(message.id)
      }
    },
    [message.id]
  )
  const getSnapshot = useCallback(() => streams.get(message.id), [message.id])
  const streamed = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return streamed ? { ...message, ...streamed } : message
}
