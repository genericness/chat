// E2B-backed agent tools: sandboxed code execution and desktop computer use.
// Screenshots can't ride in OpenAI-compat tool results (text only), so they go
// through an image side channel that generation.ts injects as user messages.
import { saveArtifactSnapshot, withArtifactRuntime } from "@chat/core"
import { getCodeSandbox, getDesktop, type ComputerAction } from "@/lib/e2b"
import type { ToolDef } from "@chat/core"
import { openArtifactPanel, openComputerPanel } from "@/lib/panel"

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
  {
    type: "function",
    function: {
      name: "build_artifact",
      description:
        "Build a real multi-file React/TypeScript app from files you wrote in the sandbox and show it in the live preview panel with a browsable source view. Workflow: (1) write a project into a directory with write_file — a package.json listing react, react-dom and any npm deps, and source files with an entry at src/main.tsx (or .jsx) that mounts to <div id=\"root\">; import CSS from the entry if you want styles. The preview has no real page URL, so use HashRouter or MemoryRouter for routing, never BrowserRouter. (2) Call build_artifact with that dir. It runs npm install and bundles with esbuild into one self-contained page (no CDN needed), then displays the app and its source to the user. Reuse the same id + dir to rebuild after edits (node_modules is cached). For a quick single-file page, prefer create_artifact instead.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "kebab-case artifact id, stable across rebuilds" },
          title: { type: "string" },
          dir: { type: "string", description: "project root in the sandbox, e.g. /home/user/app" },
          entry: {
            type: "string",
            description: "entry file relative to dir; auto-detected (src/main.tsx…) if omitted",
          },
        },
        required: ["id", "title", "dir"],
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
  msgId: string
  /** Screenshot data URLs for generation.ts to inject as user messages. */
  pushImage: (dataUrl: string) => void
}

const BUILD_DIR_OUT = "/tmp/artifact_build"

// Bundle a project the model wrote into the sandbox: npm install + esbuild →
// one self-contained HTML page, plus the source tree for the code browser.
async function buildReactArtifact(
  convId: string,
  msgId: string,
  args: { id: string; title: string; dir: string; entry?: string }
): Promise<string> {
  const sb = await getCodeSandbox(convId)
  const dir = args.dir.replace(/'/g, "")
  const entry = (args.entry ?? "").replace(/'/g, "")

  // One shell pass: ensure package.json, install, detect entry, bundle.
  const script = `set -e
cd '${dir}'
[ -f package.json ] || echo '{"private":true,"dependencies":{"react":"^18","react-dom":"^18"}}' > package.json
npm install --no-audit --no-fund --loglevel=error >/dev/null 2>&1
ENTRY='${entry}'
if [ -z "$ENTRY" ]; then for c in src/main.tsx src/main.jsx src/index.tsx src/index.jsx main.tsx main.jsx index.tsx App.tsx; do [ -f "$c" ] && ENTRY="$c" && break; done; fi
if [ -z "$ENTRY" ]; then echo "NO_ENTRY"; exit 1; fi
rm -rf ${BUILD_DIR_OUT} && mkdir -p ${BUILD_DIR_OUT}
npx --yes esbuild "$ENTRY" --bundle --format=iife --jsx=automatic --loader:.js=jsx --minify --outfile=${BUILD_DIR_OUT}/bundle.js 2>&1
echo "ENTRY_USED:$ENTRY"`
  const built = await sb.runCommand(script)
  if (built.exitCode !== 0 || /error|Cannot|NO_ENTRY/i.test(built.stdout + built.stderr)) {
    return `Build failed:\n${(built.stdout + built.stderr).slice(-3000)}\n\nFix the code and call build_artifact again, or ship a single-file version with create_artifact.`
  }

  const js = await sb.readFile(`${BUILD_DIR_OUT}/bundle.js`)
  let css = ""
  try {
    css = await sb.readFile(`${BUILD_DIR_OUT}/bundle.css`)
  } catch {
    // no CSS emitted — fine
  }

  // Collect the source tree (Python handles the walk + JSON in one call).
  let files: { path: string; content: string }[] = []
  try {
    const walk = await sb.runCode(
      `import os,json\n` +
        `root=${JSON.stringify(dir)}\n` +
        `skip={'node_modules','dist','build','.git','__pycache__','.next'}\n` +
        `out={}\n` +
        `for dp,dns,fns in os.walk(root):\n` +
        `    dns[:]=[d for d in dns if d not in skip]\n` +
        `    for f in fns:\n` +
        `        p=os.path.join(dp,f)\n` +
        `        try:\n` +
        `            if os.path.getsize(p)>100000: continue\n` +
        `            out[os.path.relpath(p,root)]=open(p,encoding='utf-8').read()\n` +
        `        except Exception: pass\n` +
        `print(json.dumps(out))`
    )
    const parsed = JSON.parse(walk.stdout.trim() || "{}") as Record<string, string>
    files = Object.entries(parsed)
      .filter(([p]) => p !== "package-lock.json")
      .map(([path, content]) => ({ path, content }))
      .sort((a, b) => a.path.localeCompare(b.path))
  } catch {
    // code browser just won't have the tree; preview still works
  }

  const html = withArtifactRuntime(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${
      css ? `<style>${css}</style>` : ""
    }</head><body><div id="root"></div><script>${js}</script></body></html>`
  )

  await saveArtifactSnapshot(msgId, { artifactId: args.id, title: args.title, html, files })
  openArtifactPanel(convId, args.id)
  return `Built and rendered "${args.title}" (${(js.length / 1024).toFixed(0)} KB bundle, ${files.length} source files). The user is viewing the running app and can browse the source.`
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

  if (name === "build_artifact") {
    return buildReactArtifact(ctx.convId, ctx.msgId, {
      id: String(args.id ?? "app"),
      title: String(args.title ?? "App"),
      dir: String(args.dir ?? "/home/user/app"),
      entry: args.entry ? String(args.entry) : undefined,
    })
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
