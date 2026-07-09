import { useState } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { Check, Copy, Loader2, TriangleAlert } from "lucide-react"
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
import { db } from "@/lib/db"
import { createShare, deleteShare, shareUrl } from "@/lib/share"
import { haptic } from "@/lib/haptics"

interface ShareDialogProps {
  convId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ShareDialog({ convId, open, onOpenChange }: ShareDialogProps) {
  const conv = useLiveQuery(() => db.conversations.get(convId), [convId])
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const token = conv?.shareToken

  const create = async () => {
    setBusy(true)
    try {
      await createShare(convId)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not share")
    } finally {
      setBusy(false)
    }
  }

  const revoke = async () => {
    if (!token) return
    setBusy(true)
    try {
      await deleteShare(convId, token)
      toast.success("Public link revoked")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not revoke")
    } finally {
      setBusy(false)
    }
  }

  const copy = () => {
    if (!token) return
    void navigator.clipboard.writeText(shareUrl(token))
    haptic()
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share chat</DialogTitle>
          <DialogDescription>
            {token
              ? "Anyone with this link can read this conversation."
              : "Create a public, read-only link to this conversation."}
          </DialogDescription>
        </DialogHeader>

        {token ? (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Input readOnly value={shareUrl(token)} className="font-mono text-xs" />
              <Button variant="outline" size="icon" aria-label="Copy link" onClick={copy}>
                {copied ? <Check className="text-primary" /> : <Copy />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              This is a snapshot taken when you shared — new messages won't appear
              until you re-share. Attachments and your system prompt are not
              included.
            </p>
            <div className="flex justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={create} disabled={busy}>
                {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
                Update snapshot
              </Button>
              <Button variant="destructive" size="sm" onClick={revoke} disabled={busy}>
                Revoke link
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
              <div className="text-amber-200/90">
                This uploads the conversation text to our server and makes it
                readable by <strong>anyone with the link</strong> — it leaves
                your browser. Don't share chats with private or sensitive
                content. You can revoke the link later, but copies may already
                exist.
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Shared: the chat title and message text. Not shared: attachments,
              your system prompt, API keys, or any per-chat settings. Requires
              signing in with GitHub.
            </p>
            <Button onClick={create} disabled={busy} className="self-end">
              {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
              Create public link
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
