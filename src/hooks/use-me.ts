import { useQuery, useQueryClient } from "@tanstack/react-query"

export interface Me {
  id: number
  login: string
  name: string | null
  avatarUrl: string
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Me | null> => {
      const res = await fetch("/api/me", { credentials: "same-origin" })
      if (res.status === 401) return null
      if (!res.ok) throw new Error("me failed")
      return res.json()
    },
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" })
    qc.setQueryData(["me"], null)
  }
}
