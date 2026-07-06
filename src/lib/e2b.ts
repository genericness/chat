// E2B sandbox lifecycle: one code sandbox and one desktop per conversation,
// created lazily, killed on stop or by E2B's server-side timeout (the cost
// backstop). SDKs are loaded lazily so the main bundle stays lean. The user's
// key lives in localStorage and goes browser-direct to E2B (CORS: allow *).
import { getPrefs } from "@/lib/profiles"

export interface CodeRunResult {
  stdout: string
  stderr: string
  text?: string
  /** base64 PNGs of rich outputs (charts etc.) */
  images: string[]
  error?: string
}

export interface CodeSandboxHandle {
  runCode(code: string): Promise<CodeRunResult>
  runCommand(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }>
  writeFile(path: string, content: string): Promise<void>
  readFile(path: string): Promise<string>
  kill(): Promise<void>
}

export type ComputerAction =
  | { action: "click" | "double_click" | "right_click" | "move"; x: number; y: number }
  | { action: "type"; text: string }
  | { action: "press"; keys: string }
  | { action: "scroll"; amount: number }
  | { action: "wait"; ms?: number }

export interface DesktopHandle {
  screenshot(): Promise<Uint8Array>
  act(a: ComputerAction): Promise<void>
  streamUrl: string
  screenSize: { width: number; height: number }
  kill(): Promise<void>
}

interface E2bMock {
  createCode(): Promise<CodeSandboxHandle>
  createDesktop(): Promise<DesktopHandle>
}

const CODE_TIMEOUT_MS = 2 * 60_000
const DESKTOP_TIMEOUT_MS = 2 * 60_000
// Small enough to send screenshots at native size without huge token cost,
// so the model's click coordinates line up with what it sees.
const DESKTOP_RESOLUTION: [number, number] = [1024, 768]

function apiKey(): string {
  const key = getPrefs().e2bKey
  if (!key) throw new Error("Add your E2B API key in Settings to use sandboxes.")
  return key
}

function mock(): E2bMock | undefined {
  return import.meta.env.DEV
    ? (window as unknown as { __e2bMock?: E2bMock }).__e2bMock
    : undefined
}

async function createCodeSandbox(): Promise<CodeSandboxHandle> {
  const m = mock()
  if (m) return m.createCode()
  const { Sandbox } = await import("@e2b/code-interpreter")
  const sb = await Sandbox.create({ apiKey: apiKey(), timeoutMs: CODE_TIMEOUT_MS })
  const refresh = () => void sb.setTimeout(CODE_TIMEOUT_MS).catch(() => {})
  return {
    async runCode(code) {
      refresh()
      const ex = await sb.runCode(code)
      return {
        stdout: ex.logs.stdout.join(""),
        stderr: ex.logs.stderr.join(""),
        text: ex.text,
        images: ex.results.map((r) => r.png).filter((p): p is string => !!p),
        error: ex.error ? `${ex.error.name}: ${ex.error.value}` : undefined,
      }
    },
    async runCommand(command) {
      refresh()
      const r = await sb.commands.run(command, { timeoutMs: 120_000 })
      return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }
    },
    async writeFile(path, content) {
      refresh()
      await sb.files.write(path, content)
    },
    async readFile(path) {
      refresh()
      return sb.files.read(path)
    },
    kill: async () => {
      await sb.kill().catch(() => {})
    },
  }
}

async function createDesktopSandbox(): Promise<DesktopHandle> {
  const m = mock()
  if (m) return m.createDesktop()
  const { Sandbox } = await import("@e2b/desktop")
  // Computer use is coordinate-sensitive: the model clicks based on what it
  // sees, so the screenshot it receives MUST match the desktop's pixel space.
  // We keep a modest native resolution and send screenshots un-resized (see
  // e2b-tools) so image coords == click coords exactly.
  const sb = await Sandbox.create({
    apiKey: apiKey(),
    resolution: DESKTOP_RESOLUTION,
    timeoutMs: DESKTOP_TIMEOUT_MS,
  })
  await sb.stream.start({ requireAuth: true })
  const streamUrl = sb.stream.getUrl({ authKey: sb.stream.getAuthKey(), viewOnly: true })
  const size = await sb.getScreenSize().catch(() => null)
  return {
    async screenshot() {
      return sb.screenshot()
    },
    async act(a) {
      switch (a.action) {
        case "click":
          return sb.leftClick(a.x, a.y)
        case "double_click":
          return sb.doubleClick(a.x, a.y)
        case "right_click":
          return sb.rightClick(a.x, a.y)
        case "move":
          return sb.moveMouse(a.x, a.y)
        case "type":
          return sb.write(a.text)
        case "press":
          return sb.press(a.keys.split("+"))
        case "scroll":
          return sb.scroll(a.amount > 0 ? "down" : "up", Math.abs(a.amount))
        case "wait":
          return sb.wait(Math.min(a.ms ?? 1000, 10_000))
      }
    },
    streamUrl,
    screenSize: size
      ? { width: size.width, height: size.height }
      : { width: DESKTOP_RESOLUTION[0], height: DESKTOP_RESOLUTION[1] },
    kill: async () => {
      await sb.stream.stop().catch(() => {})
      await sb.kill().catch(() => {})
    },
  }
}

// Per-conversation instances, shared across tool rounds and sends.
const codeSandboxes = new Map<string, Promise<CodeSandboxHandle>>()
const desktops = new Map<string, Promise<DesktopHandle>>()

export function getCodeSandbox(convId: string): Promise<CodeSandboxHandle> {
  let p = codeSandboxes.get(convId)
  if (!p) {
    p = createCodeSandbox()
    p.catch(() => codeSandboxes.delete(convId))
    codeSandboxes.set(convId, p)
  }
  return p
}

export function getDesktop(convId: string): Promise<DesktopHandle> {
  let p = desktops.get(convId)
  if (!p) {
    p = createDesktopSandbox()
    p.catch(() => desktops.delete(convId))
    desktops.set(convId, p)
  }
  return p
}

export function hasDesktop(convId: string): boolean {
  return desktops.has(convId)
}

export async function killAllSandboxes(): Promise<void> {
  await Promise.all([...codeSandboxes.keys(), ...desktops.keys()].map(killConversationSandboxes))
}

export async function killConversationSandboxes(convId: string): Promise<void> {
  const code = codeSandboxes.get(convId)
  const desk = desktops.get(convId)
  codeSandboxes.delete(convId)
  desktops.delete(convId)
  await Promise.all([
    code?.then((s) => s.kill()).catch(() => {}),
    desk?.then((s) => s.kill()).catch(() => {}),
  ])
}
