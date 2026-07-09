import { useState } from "react"

import { usePrefs, setPrefs, type SavedPrompt } from "@/lib/profiles"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Pencil, Plus, Trash2 } from "lucide-react"

const EMPTY = { name: "", prompt: "" }

/** Manage named system prompts. Attach one to a chat from its Chat settings. */
export function PromptLibrary() {
  const prompts = usePrefs().savedPrompts ?? []
  const [editing, setEditing] = useState<string | "new" | null>(null)
  const [draft, setDraft] = useState(EMPTY)

  const startNew = () => {
    setDraft(EMPTY)
    setEditing("new")
  }
  const startEdit = (p: SavedPrompt) => {
    setDraft({ name: p.name, prompt: p.prompt })
    setEditing(p.id)
  }
  const save = () => {
    const name = draft.name.trim()
    const prompt = draft.prompt.trim()
    if (!name || !prompt) return
    const next =
      editing === "new"
        ? [...prompts, { id: crypto.randomUUID(), name, prompt }]
        : prompts.map((p) => (p.id === editing ? { ...p, name, prompt } : p))
    setPrefs({ savedPrompts: next })
    setEditing(null)
  }
  const remove = (id: string) => setPrefs({ savedPrompts: prompts.filter((p) => p.id !== id) })

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <Label>Prompt library</Label>
        {editing === null && (
          <Button variant="outline" size="sm" onClick={startNew}>
            <Plus data-icon="inline-start" />
            New prompt
          </Button>
        )}
      </div>

      {editing !== null ? (
        <div className="grid gap-2 rounded-lg border border-border p-3">
          <Input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Name (e.g. Terse code reviewer)"
          />
          <Textarea
            value={draft.prompt}
            onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
            placeholder="System prompt text…"
            className="min-h-24"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={!draft.name.trim() || !draft.prompt.trim()} onClick={save}>
              Save
            </Button>
          </div>
        </div>
      ) : prompts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Save system prompts you reuse, then attach one to any chat from its
          settings.
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {prompts.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{p.name}</div>
                <div className="truncate text-xs text-muted-foreground">{p.prompt}</div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Edit ${p.name}`}
                onClick={() => startEdit(p)}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-destructive"
                aria-label={`Delete ${p.name}`}
                onClick={() => remove(p.id)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
