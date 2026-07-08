import { useEffect, useRef, useState } from "react"
import { Check, Copy, ExternalLink, Loader2, LogIn } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { signOutChatGPT, startChatGPTLogin } from "@/lib/chatgpt"
import { usePrefs } from "@/lib/profiles"

// Device-code sign-in for the ChatGPT preset (settings + onboarding): fetch a
// short code, send the user to the verification page, poll until approved.
// Replaces the API-key field — a ChatGPT profile has no key.

export function ChatGPTSignIn() {
  const auth = usePrefs().chatgptAuth
  const [pending, setPending] = useState<{ userCode: string; verificationUrl: string } | null>(
    null
  )
  const [starting, setStarting] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => () => abortRef.current?.abort(), [])

  const begin = async () => {
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setStarting(true)
    try {
      const login = await startChatGPTLogin(ctrl.signal)
      setPending({ userCode: login.userCode, verificationUrl: login.verificationUrl })
      await login.done
      toast.success("Signed in with ChatGPT")
    } catch (err) {
      if (!ctrl.signal.aborted) {
        toast.error(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setStarting(false)
      setPending(null)
    }
  }

  const cancel = () => {
    abortRef.current?.abort()
    setPending(null)
    setStarting(false)
  }

  if (auth) {
    return (
      <div className="grid gap-1.5">
        <Label>ChatGPT account</Label>
        <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/40 px-3 py-2">
          <Check className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate text-sm">
            {auth.email ?? "Signed in"}
            {auth.plan && (
              <span className="text-muted-foreground">
                {" "}
                · {auth.plan.charAt(0).toUpperCase() + auth.plan.slice(1)}
              </span>
            )}
          </span>
          <Button variant="ghost" size="sm" onClick={() => signOutChatGPT()}>
            Sign out
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Usage comes out of this account's ChatGPT plan. Tokens are stored in
          this browser only.
        </p>
      </div>
    )
  }

  if (pending) {
    return (
      <div className="grid gap-1.5">
        <Label>ChatGPT account</Label>
        <div className="flex flex-col gap-2.5 rounded-lg border border-border/70 bg-card/40 p-3">
          <p className="text-sm">
            Enter this code on the ChatGPT device page to approve the sign-in:
          </p>
          <div className="flex items-center justify-center gap-2">
            <span className="font-mono text-xl font-semibold tracking-[0.2em]">
              {pending.userCode}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Copy code"
              onClick={() => {
                void navigator.clipboard.writeText(pending.userCode)
                toast.success("Code copied")
              }}
            >
              <Copy />
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="justify-center gap-2"
            render={<a href={pending.verificationUrl} target="_blank" rel="noreferrer" />}
            nativeButton={false}
          >
            <ExternalLink data-icon="inline-start" />
            Open ChatGPT device page
          </Button>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Waiting for approval…
            </span>
            <Button variant="ghost" size="xs" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-1.5">
      <Label>ChatGPT account</Label>
      <Button
        variant="outline"
        className="justify-center gap-2"
        disabled={starting}
        onClick={() => void begin()}
      >
        {starting ? <Loader2 className="animate-spin" /> : <LogIn />}
        Sign in with ChatGPT
      </Button>
      <p className="text-xs text-muted-foreground">
        No API key — models come with your ChatGPT plan (Plus/Pro). You'll get a
        short code to enter on ChatGPT's device page.
      </p>
    </div>
  )
}
