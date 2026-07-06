// E2B-backed agent tools: sandboxed code execution and desktop computer use.
// Screenshots can't ride in OpenAI-compat tool results (text only), so they go
// through an image side channel that generation.ts injects as user messages.
import { getCodeSandbox, getDesktop, type ComputerAction } from "@/lib/e2b"
import type { ToolDef } from "@/lib/openai"
import { openComputerPanel } from "@/lib/panel"

export const CODE_TOOL_DEFS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "run_code",
      description:
        "Execute Python code in a persistent Jupyter-style cloud sandbox (state carries across calls in this conversation). Returns stdout, stderr, the last expression value, and captures charts/images. Use it to compute, test logic, process data, or prototype before shipping an artifact.",
      parameters: {
        type: "object",
        properties: { code: { type: "string", description: "Python code to execute" } },
        required: ["code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description:
        "Run a shell command in the sandbox (same machine as run_code). Use for pip/npm installs, file inspection, or build steps. 2 minute limit per command.",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write a text file in the sandbox filesystem.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a text file from the sandbox filesystem (max ~50KB returned).",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
]

export const COMPUTER_TOOL_DEFS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "computer_start",
      description:
        "Start a virtual Linux desktop you can see and control. The user watches it live. Returns the exact screen size; a screenshot at that same pixel size follows as the next user message. Use computer_action to interact.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "computer_action",
      description:
        "Perform one action on the virtual desktop, then receive a fresh screenshot as the next user message. Coordinates are pixels from the top-left of the screenshot you were given (which is 1:1 with the real screen), where x grows right and y grows down.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["click", "double_click", "right_click", "move", "type", "press", "scroll", "wait"],
          },
          x: { type: "number", description: "for click/double_click/right_click/move" },
          y: { type: "number" },
          text: { type: "string", description: "for type" },
          keys: { type: "string", description: "for press, e.g. 'enter' or 'ctrl+l'" },
          amount: { type: "number", description: "for scroll: positive = down, negative = up" },
          ms: { type: "number", description: "for wait (max 10000)" },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "computer_screenshot",
      description: "Take a fresh screenshot of the virtual desktop (delivered as the next user message).",
      parameters: { type: "object", properties: {} },
    },
  },
]

/**
 * Re-encode the PNG screenshot as JPEG (smaller = fewer tokens) at its NATIVE
 * size. Do not resize: the model clicks based on the pixels it sees, so the
 * image must stay 1:1 with the desktop's coordinate space, or clicks miss.
 */
async function toJpegDataUrl(png: Uint8Array): Promise<string> {
  const bitmap = await createImageBitmap(new Blob([png as BlobPart], { type: "image/png" }))
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0)
  bitmap.close()
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 })
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

const clip = (s: string, max = 8000) =>
  s.length > max ? `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]` : s

export interface E2bToolContext {
  convId: string
  /** Screenshot data URLs for generation.ts to inject as user messages. */
  pushImage: (dataUrl: string) => void
}

/** Returns null when `name` isn't an E2B tool. */
export async function executeE2bTool(
  name: string,
  args: Record<string, unknown>,
  ctx: E2bToolContext
): Promise<string | null> {
  if (name === "run_code") {
    const sb = await getCodeSandbox(ctx.convId)
    const r = await sb.runCode(String(args.code ?? ""))
    for (const png of r.images) ctx.pushImage(`data:image/png;base64,${png}`)
    const parts = [
      r.error && `Error: ${r.error}`,
      r.stdout && `stdout:\n${clip(r.stdout)}`,
      r.stderr && `stderr:\n${clip(r.stderr)}`,
      r.text && `result: ${clip(r.text)}`,
      r.images.length && `${r.images.length} image output(s) attached as the next user message.`,
    ].filter(Boolean)
    return parts.join("\n\n") || "(no output)"
  }

  if (name === "run_command") {
    const sb = await getCodeSandbox(ctx.convId)
    const r = await sb.runCommand(String(args.command ?? ""))
    return [
      `exit code: ${r.exitCode}`,
      r.stdout && `stdout:\n${clip(r.stdout)}`,
      r.stderr && `stderr:\n${clip(r.stderr)}`,
    ]
      .filter(Boolean)
      .join("\n\n")
  }

  if (name === "write_file") {
    const sb = await getCodeSandbox(ctx.convId)
    await sb.writeFile(String(args.path ?? ""), String(args.content ?? ""))
    return `Wrote ${String(args.path)}`
  }

  if (name === "read_file") {
    const sb = await getCodeSandbox(ctx.convId)
    return clip(await sb.readFile(String(args.path ?? "")), 50_000)
  }

  if (name === "computer_start") {
    const desktop = await getDesktop(ctx.convId)
    openComputerPanel(ctx.convId, desktop.streamUrl)
    ctx.pushImage(await toJpegDataUrl(await desktop.screenshot()))
    return `Desktop running at ${desktop.screenSize.width}x${desktop.screenSize.height}. The user is watching a live stream. Screenshot attached as the next user message.`
  }

  if (name === "computer_action") {
    const desktop = await getDesktop(ctx.convId)
    await desktop.act(args as unknown as ComputerAction)
    await new Promise((r) => setTimeout(r, 500)) // let the UI settle
    ctx.pushImage(await toJpegDataUrl(await desktop.screenshot()))
    return `Done (${String(args.action)}). Screenshot attached as the next user message.`
  }

  if (name === "computer_screenshot") {
    const desktop = await getDesktop(ctx.convId)
    ctx.pushImage(await toJpegDataUrl(await desktop.screenshot()))
    return "Screenshot attached as the next user message."
  }

  return null
}

export const E2B_TOOL_NAMES = new Set(
  [...CODE_TOOL_DEFS, ...COMPUTER_TOOL_DEFS].map((t) => t.function.name)
)
