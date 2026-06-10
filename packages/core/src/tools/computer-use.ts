import { execFile } from 'node:child_process'
import { mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { ToolContext, ToolHandler, ToolResult } from '../tool-registry.js'
import { loadAppConfig } from '../config.js'

const execFileAsync = promisify(execFile)

export const COMPUTER_USE_TOOL_NAMES = [
  'computer_get_app_state',
  'computer_list_apps',
  'computer_screenshot',
  'computer_click',
  'computer_drag',
  'computer_type_text',
  'computer_press_key',
  'computer_scroll',
  'computer_open_app',
] as const

type ComputerUseToolName = typeof COMPUTER_USE_TOOL_NAMES[number]

export function isComputerUseToolName(name: string): name is ComputerUseToolName {
  return (COMPUTER_USE_TOOL_NAMES as readonly string[]).includes(name)
}

export function isComputerUseEnabled(config: Record<string, any> = loadAppConfig()): boolean {
  return config.computerUse?.enabled === true
}

export function createComputerUseTools(): ToolHandler[] {
  return [
    computerGetAppStateTool,
    computerListAppsTool,
    computerScreenshotTool,
    computerClickTool,
    computerDragTool,
    computerTypeTextTool,
    computerPressKeyTool,
    computerScrollTool,
    computerOpenAppTool,
  ]
}

function gateComputerUse(): ToolResult | null {
  if (!isComputerUseEnabled()) {
    return {
      content: 'Computer Use is disabled in Settings > Tools. Enable it before using computer control tools.',
      isError: true,
    }
  }
  if (process.platform !== 'darwin') {
    return {
      content: `Computer Use currently supports macOS only. Current platform: ${process.platform}.`,
      isError: true,
    }
  }
  return null
}

const computerGetAppStateTool: ToolHandler = {
  definition: {
    name: 'computer_get_app_state',
    description:
      'Get the current macOS foreground application and window summary, then capture a screenshot to a PNG file. ' +
      'Use this before interacting with the desktop. Requires Computer Use to be enabled in Settings > Tools.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  async execute(_input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const gated = gateComputerUse()
    if (gated) return gated
    const [state, screenshot] = await Promise.all([
      getFrontmostAppState(),
      captureScreenshot(context.cwd),
    ])
    return {
      content: [
        `front_app: ${state.appName || '(unknown)'}`,
        `window_title: ${state.windowTitle || '(unknown)'}`,
        `screenshot: ${screenshot.filePath}`,
        `size_bytes: ${screenshot.size}`,
      ].join('\n'),
    }
  },
}

const computerListAppsTool: ToolHandler = {
  definition: {
    name: 'computer_list_apps',
    description:
      'List visible macOS applications that are currently running. Use before computer_open_app when you need the exact app name.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  async execute(): Promise<ToolResult> {
    const gated = gateComputerUse()
    if (gated) return gated
    const stdout = await runAppleScript([
      'tell application "System Events"',
      'set appNames to name of application processes whose background only is false',
      'return appNames',
      'end tell',
    ])
    const apps = stdout.split(',').map(app => app.trim()).filter(Boolean)
    return { content: apps.length > 0 ? apps.map(app => `- ${app}`).join('\n') : 'No visible running applications found.' }
  },
}

const computerScreenshotTool: ToolHandler = {
  definition: {
    name: 'computer_screenshot',
    description:
      'Capture the current macOS screen to a PNG file and return its path. ' +
      'Use computer_get_app_state when you also need the active app/window.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  async execute(_input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const gated = gateComputerUse()
    if (gated) return gated
    const screenshot = await captureScreenshot(context.cwd)
    return { content: `screenshot: ${screenshot.filePath}\nsize_bytes: ${screenshot.size}` }
  },
}

const computerClickTool: ToolHandler = {
  definition: {
    name: 'computer_click',
    description:
      'Click a screen coordinate on macOS using System Events. Coordinates are absolute screen pixels. ' +
      'Call computer_get_app_state first when you need to inspect the current screen.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Absolute screen X coordinate.' },
        y: { type: 'number', description: 'Absolute screen Y coordinate.' },
        click_count: { type: 'number', description: 'Number of clicks. Defaults to 1.' },
      },
      required: ['x', 'y'],
    },
  },
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const gated = gateComputerUse()
    if (gated) return gated
    const x = numberArg(input.x, 'x')
    const y = numberArg(input.y, 'y')
    const count = Math.max(1, Math.min(3, Math.floor(optionalNumberArg(input.click_count) ?? 1)))
    for (let i = 0; i < count; i++) {
      await runAppleScript([`tell application "System Events" to click at {${x}, ${y}}`])
    }
    return { content: `Clicked at (${x}, ${y}) ${count} time${count === 1 ? '' : 's'}.` }
  },
}

const computerDragTool: ToolHandler = {
  definition: {
    name: 'computer_drag',
    description:
      'Drag from one absolute screen coordinate to another on macOS using System Events.',
    inputSchema: {
      type: 'object',
      properties: {
        from_x: { type: 'number' },
        from_y: { type: 'number' },
        to_x: { type: 'number' },
        to_y: { type: 'number' },
      },
      required: ['from_x', 'from_y', 'to_x', 'to_y'],
    },
  },
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const gated = gateComputerUse()
    if (gated) return gated
    const fromX = numberArg(input.from_x, 'from_x')
    const fromY = numberArg(input.from_y, 'from_y')
    const toX = numberArg(input.to_x, 'to_x')
    const toY = numberArg(input.to_y, 'to_y')
    await runAppleScript([`tell application "System Events" to drag from {${fromX}, ${fromY}} to {${toX}, ${toY}}`])
    return { content: `Dragged from (${fromX}, ${fromY}) to (${toX}, ${toY}).` }
  },
}

const computerTypeTextTool: ToolHandler = {
  definition: {
    name: 'computer_type_text',
    description:
      'Type literal text into the currently focused macOS control. Use for short text entry after focusing the target.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Literal text to type.' },
      },
      required: ['text'],
    },
  },
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const gated = gateComputerUse()
    if (gated) return gated
    const text = String(input.text ?? '')
    if (!text) return { content: 'Error: text is required', isError: true }
    await runAppleScript([`tell application "System Events" to keystroke ${appleString(text)}`])
    return { content: `Typed ${text.length} character${text.length === 1 ? '' : 's'}.` }
  },
}

const computerPressKeyTool: ToolHandler = {
  definition: {
    name: 'computer_press_key',
    description:
      'Press a key or simple key combination in the focused macOS app. Examples: Return, Escape, Tab, Cmd+C, Cmd+Shift+P, ArrowDown.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key name or combination.' },
      },
      required: ['key'],
    },
  },
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const gated = gateComputerUse()
    if (gated) return gated
    const key = String(input.key ?? '').trim()
    if (!key) return { content: 'Error: key is required', isError: true }
    await runAppleScript([keyToAppleScript(key)])
    return { content: `Pressed ${key}.` }
  },
}

const computerScrollTool: ToolHandler = {
  definition: {
    name: 'computer_scroll',
    description:
      'Scroll the focused macOS window by sending page/arrow key events. Direction can be up, down, left, or right.',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
        amount: { type: 'number', description: 'Number of key events to send. Defaults to 3.' },
      },
      required: ['direction'],
    },
  },
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const gated = gateComputerUse()
    if (gated) return gated
    const direction = String(input.direction ?? '').toLowerCase()
    const keyCode = ({ up: 116, down: 121, left: 123, right: 124 } as Record<string, number>)[direction]
    if (!keyCode) return { content: 'Error: direction must be up, down, left, or right', isError: true }
    const amount = Math.max(1, Math.min(20, Math.floor(optionalNumberArg(input.amount) ?? 3)))
    await runAppleScript(['tell application "System Events"', `repeat ${amount} times`, `key code ${keyCode}`, 'end repeat', 'end tell'])
    return { content: `Scrolled ${direction} (${amount} event${amount === 1 ? '' : 's'}).` }
  },
}

const computerOpenAppTool: ToolHandler = {
  definition: {
    name: 'computer_open_app',
    description: 'Open or activate a macOS application by name, for example "Safari", "Chrome", or "Visual Studio Code".',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'Application name.' },
      },
      required: ['app'],
    },
  },
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const gated = gateComputerUse()
    if (gated) return gated
    const app = String(input.app ?? '').trim()
    if (!app) return { content: 'Error: app is required', isError: true }
    await runAppleScript([`tell application ${appleString(app)} to activate`])
    return { content: `Activated ${app}.` }
  },
}

async function captureScreenshot(cwd: string): Promise<{ filePath: string; size: number }> {
  const dir = path.join(tmpdir(), 'puddingagent-computer-use')
  await mkdir(dir, { recursive: true })
  const filePath = path.join(dir, `screenshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`)
  await execFileAsync('/usr/sbin/screencapture', ['-x', filePath], { cwd })
  const info = await stat(filePath)
  return { filePath, size: info.size }
}

async function getFrontmostAppState(): Promise<{ appName: string; windowTitle: string }> {
  const script = [
    'tell application "System Events"',
    'set frontApp to first application process whose frontmost is true',
    'set appName to name of frontApp',
    'set windowTitle to ""',
    'try',
    'set windowTitle to name of front window of frontApp',
    'end try',
    'return appName & linefeed & windowTitle',
    'end tell',
  ]
  const stdout = await runAppleScript(script)
  const [appName = '', windowTitle = ''] = stdout.split(/\r?\n/)
  return { appName: appName.trim(), windowTitle: windowTitle.trim() }
}

async function runAppleScript(lines: string[]): Promise<string> {
  const args = lines.flatMap(line => ['-e', line])
  const { stdout } = await execFileAsync('/usr/bin/osascript', args)
  return String(stdout ?? '').trim()
}

function numberArg(value: unknown, name: string): number {
  const parsed = optionalNumberArg(value)
  if (parsed === undefined) throw new Error(`${name} must be a number`)
  return parsed
}

function optionalNumberArg(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Math.round(Number(value))
  return undefined
}

function appleString(value: string): string {
  return JSON.stringify(value)
}

function keyToAppleScript(input: string): string {
  const parts = input.split('+').map(part => part.trim()).filter(Boolean)
  const key = parts.pop()
  if (!key) throw new Error('key is required')

  const modifiers = parts.map(modifierToAppleScript).filter(Boolean)
  const suffix = modifiers.length > 0 ? ` using {${modifiers.join(', ')}}` : ''
  const code = KEY_CODES[normalizeKey(key)]
  if (code !== undefined) return `tell application "System Events" to key code ${code}${suffix}`
  if (key.length === 1) return `tell application "System Events" to keystroke ${appleString(key.toLowerCase())}${suffix}`
  throw new Error(`Unsupported key: ${input}`)
}

function modifierToAppleScript(value: string): string {
  switch (normalizeKey(value)) {
    case 'cmd':
    case 'command':
    case 'meta':
      return 'command down'
    case 'ctrl':
    case 'control':
      return 'control down'
    case 'alt':
    case 'option':
      return 'option down'
    case 'shift':
      return 'shift down'
    default:
      throw new Error(`Unsupported modifier: ${value}`)
  }
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[\s_-]/g, '')
}

const KEY_CODES: Record<string, number> = {
  return: 36,
  enter: 36,
  tab: 48,
  escape: 53,
  esc: 53,
  space: 49,
  delete: 51,
  backspace: 51,
  forwarddelete: 117,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
  arrowleft: 123,
  left: 123,
  arrowright: 124,
  right: 124,
  arrowdown: 125,
  down: 125,
  arrowup: 126,
  up: 126,
}
