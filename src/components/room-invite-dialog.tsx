import { useEffect, useState } from "react"
import { Check, Copy, Loader2, X } from "lucide-react"
import { toast } from "sonner"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  addRoomMember,
  getRoomMembers,
  removeRoomMember,
  roomUrl,
  setRoomJoinMode,
} from "@/lib/room"

interface Props {
  token: string
  isHost: boolean
  joinMode: "guests" | "members"
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RoomInviteDialog({ token, isHost, joinMode: initialMode, open, onOpenChange }: Props) {
  const [mode, setMode] = useState<"guests" | "members">(initialMode)
  const [members, setMembers] = useState<string[]>([])
  const [login, setLogin] = useState("")
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => setMode(initialMode), [initialMode])
  useEffect(() => {
    if (open && isHost) getRoomMembers(token).then((r) => setMembers(r.members)).catch(() => {})
  }, [open, isHost, token])

  const copy = () => {
    void navigator.clipboard.writeText(roomUrl(token))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const toggleMode = async (inviteOnly: boolean) => {
    const next = inviteOnly ? "members" : "guests"
    setMode(next)
    try {
      await setRoomJoinMode(token, next)
    } catch {
      toast.error("Could not change who can join")
      setMode(next === "members" ? "guests" : "members")
    }
  }

  const add = async () => {
    const clean = login.trim().replace(/^@/, "")
    if (!clean) return
    setBusy(true)
    try {
      const added = await addRoomMember(token, clean)
      setMembers((m) => (m.includes(added) ? m : [...m, added]))
      setLogin("")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add")
    } finally {
      setBusy(false)
    }
  }

  const remove = async (l: string) => {
    setMembers((m) => m.filter((x) => x !== l))
    await removeRoomMember(token, l).catch(() => {})
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite people</DialogTitle>
          <DialogDescription>
            {mode === "members"
              ? "Only people you invite by GitHub username can join."
              : "Anyone with this link can join."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex gap-2">
            <Input readOnly value={roomUrl(token)} className="font-mono text-xs" />
            <Button variant="outline" size="icon" aria-label="Copy link" onClick={copy}>
              {copied ? <Check className="text-primary" /> : <Copy />}
            </Button>
          </div>

          {isHost && (
            <>
              <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                <div className="min-w-0">
                  <Label htmlFor="invite-only">Invite-only</Label>
                  <p className="text-xs text-muted-foreground">
                    Require GitHub sign-in and an invite to join.
                  </p>
                </div>
                <Switch
                  id="invite-only"
                  checked={mode === "members"}
                  onCheckedChange={toggleMode}
                />
              </div>

              {mode === "members" && (
                <div className="flex flex-col gap-2">
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void add()
                    }}
                  >
                    <Input
                      value={login}
                      onChange={(e) => setLogin(e.target.value)}
                      placeholder="GitHub username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                    <Button type="submit" size="sm" disabled={busy || !login.trim()}>
                      {busy ? <Loader2 className="animate-spin" /> : "Add"}
                    </Button>
                  </form>
                  {members.length > 0 ? (
                    <ul className="flex flex-col gap-1">
                      {members.map((m) => (
                        <li
                          key={m}
                          className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 text-sm"
                        >
                          <span className="truncate">{m}</span>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Remove ${m}`}
                            className="text-muted-foreground"
                            onClick={() => void remove(m)}
                          >
                            <X />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No one invited yet. Add a GitHub username above.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
