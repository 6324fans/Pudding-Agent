import { execFile } from 'node:child_process'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { ToolContext, ToolHandler, ToolResult } from '../tool-registry.js'
import { loadAppConfig } from '../config.js'
import type { ImageContent } from '../types.js'
import { compressImageForAPI } from '../utils/image-resizer.js'

const execFileAsync = promisify(execFile)
const DEFAULT_ACCESSIBILITY_ELEMENT_LIMIT = 80
const MAX_ACCESSIBILITY_ELEMENT_LIMIT = 200

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

interface AccessibilityElement {
  index: number
  depth: number
  role: string
  x: number
  y: number
  width: number
  height: number
  enabled: string
  focused: string
  name: string
  value: string
  description: string
  help: string
}

interface AccessibilitySnapshot {
  appName: string
  windowTitle: string
  capturedAt: number
  elements: AccessibilityElement[]
}

interface ClickTarget {
  x: number
  y: number
  source: string
  element?: AccessibilityElement
}

let latestAccessibilitySnapshot: AccessibilitySnapshot | null = null

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
      'Get the current macOS foreground application and window summary, capture a screenshot to a PNG file, and return an indexed accessibility tree. ' +
      'Call this before interacting with the desktop. Use returned element_index values with computer_click when possible.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'Optional application name to activate before capturing state.' },
        max_elements: { type: 'number', description: `Maximum accessibility elements to return. Defaults to ${DEFAULT_ACCESSIBILITY_ELEMENT_LIMIT}.` },
      },
    },
  },
  async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const gated = gateComputerUse()
    if (gated) return gated
    const app = String(input.app ?? '').trim()
    const activationError = app
      ? await activateApp(app).then(
        () => null,
        error => errorMessage(error),
      )
      : null
    const maxElements = boundedInteger(optionalNumberArg(input.max_elements), DEFAULT_ACCESSIBILITY_ELEMENT_LIMIT, 1, MAX_ACCESSIBILITY_ELEMENT_LIMIT)
    const [stateResult, screenshotResult, accessibility] = await Promise.all([
      getFrontmostAppState().then(
        state => ({ state }),
        error => ({ error: errorMessage(error) }),
      ),
      captureScreenshot(context.cwd).then(
        screenshot => ({ screenshot }),
        error => ({ error: errorMessage(error) }),
      ),
      getAccessibilityElements(maxElements).then(
        elements => ({ elements }),
        error => ({ error: errorMessage(error) }),
      ),
    ])
    const state = 'state' in stateResult ? stateResult.state : { appName: '', windowTitle: '' }
    const stateError = 'error' in stateResult ? stateResult.error : undefined
    const screenshot = 'screenshot' in screenshotResult ? screenshotResult.screenshot : null
    const screenshotError = 'error' in screenshotResult ? screenshotResult.error : undefined
    const elements = 'elements' in accessibility ? accessibility.elements : []
    const accessibilityError = 'error' in accessibility ? accessibility.error : undefined
    const screenshotImage: { image?: ImageContent; error?: string } = screenshot ? await screenshotToImageContent(screenshot.filePath) : { error: screenshotError ?? 'screenshot capture failed' }
    latestAccessibilitySnapshot = {
      appName: state.appName,
      windowTitle: state.windowTitle,
      capturedAt: Date.now(),
      elements,
    }
    const hasUsableResult = Boolean(screenshotImage.image || elements.length > 0)
    return {
      content: [
        `front_app: ${state.appName || '(unknown)'}`,
        `window_title: ${state.windowTitle || '(unknown)'}`,
        ...(activationError ? [`app_activation_error: ${activationError}`] : []),
        ...(stateError ? [`front_app_error: ${stateError}`] : []),
        ...(screenshot ? [`screenshot: ${screenshot.filePath}`, `size_bytes: ${screenshot.size}`] : [`screenshot_error: ${screenshotError ?? 'unknown screenshot error'}`]),
        `coordinate_system: absolute macOS screen pixels`,
        `elements_captured: ${elements.length}`,
        screenshotImage.image ? 'screenshot_image: attached' : `screenshot_image_error: ${screenshotImage.error}`,
        ...(screenshotImage.image ? [
          'visual_context: the screenshot is attached as a model-visible image; inspect it directly for visible text, layout, and target coordinates.',
          'fallback_targeting: if accessibility_tree_error is present, continue using screenshot-based x/y coordinates with computer_click instead of stopping.',
          'ocr_guidance: do not require a separate OCR tool for visible screenshot text in this result.',
        ] : []),
        ...(accessibilityError ? [`accessibility_tree_error: ${accessibilityError}`] : []),
        ...formatAccessibilityTree(elements),
      ].join('\n'),
      images: screenshotImage.image ? [screenshotImage.image] : undefined,
      isError: hasUsableResult ? undefined : true,
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
    const screenshotImage = await screenshotToImageContent(screenshot.filePath)
    return {
      content: [
        `screenshot: ${screenshot.filePath}`,
        `size_bytes: ${screenshot.size}`,
        screenshotImage.image ? 'screenshot_image: attached' : `screenshot_image_error: ${screenshotImage.error}`,
        ...(screenshotImage.image ? [
          'visual_context: the screenshot is attached as a model-visible image; inspect it directly for visible text, layout, and target coordinates.',
          'ocr_guidance: do not require a separate OCR tool for visible screenshot text in this result.',
        ] : []),
      ].join('\n'),
      images: screenshotImage.image ? [screenshotImage.image] : undefined,
    }
  },
}

const computerClickTool: ToolHandler = {
  definition: {
    name: 'computer_click',
    description:
      'Click a macOS accessibility element by element_index from computer_get_app_state, or click absolute screen coordinates. ' +
      'Prefer element_index because it is more reliable than estimating coordinates from a screenshot path.',
    inputSchema: {
      type: 'object',
      properties: {
        element_index: { type: ['string', 'number'], description: 'Element index returned by computer_get_app_state, for example "12".' },
        x: { type: 'number', description: 'Absolute screen X coordinate.' },
        y: { type: 'number', description: 'Absolute screen Y coordinate.' },
        click_count: { type: 'number', description: 'Number of clicks. Defaults to 1.' },
      },
    },
  },
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const gated = gateComputerUse()
    if (gated) return gated
    const target = resolveClickTarget(input)
    if ('content' in target) return target
    const { x, y } = target
    const count = Math.max(1, Math.min(3, Math.floor(optionalNumberArg(input.click_count) ?? 1)))
    for (let i = 0; i < count; i++) {
      await runAppleScript([`tell application "System Events" to click at {${x}, ${y}}`])
    }
    return { content: `Clicked ${target.source} at (${x}, ${y}) ${count} time${count === 1 ? '' : 's'}.` }
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
      'Scroll the focused macOS window by sending page/arrow key events. Optionally focus an element_index from computer_get_app_state first.',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
        amount: { type: 'number', description: 'Number of key events to send. Defaults to 3.' },
        element_index: { type: ['string', 'number'], description: 'Optional element index to click/focus before scrolling.' },
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
    const focusTarget = hasValue(input.element_index) ? resolveElementTarget(input.element_index) : null
    if (focusTarget && 'content' in focusTarget) return focusTarget
    if (focusTarget) {
      await runAppleScript([`tell application "System Events" to click at {${focusTarget.x}, ${focusTarget.y}}`])
    }
    await runAppleScript(['tell application "System Events"', `repeat ${amount} times`, `key code ${keyCode}`, 'end repeat', 'end tell'])
    const focused = focusTarget ? ` after focusing ${focusTarget.source}` : ''
    return { content: `Scrolled ${direction}${focused} (${amount} event${amount === 1 ? '' : 's'}).` }
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
    await activateApp(app)
    return { content: `Activated ${app}.` }
  },
}

async function activateApp(app: string): Promise<void> {
  await runAppleScript([`tell application ${appleString(app)} to activate`])
}

async function captureScreenshot(cwd: string): Promise<{ filePath: string; size: number }> {
  const dir = path.join(tmpdir(), 'puddingagent-computer-use')
  await mkdir(dir, { recursive: true })
  const filePath = path.join(dir, `screenshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`)
  await execFileAsync('/usr/sbin/screencapture', ['-x', filePath], { cwd })
  const info = await stat(filePath)
  return { filePath, size: info.size }
}

async function screenshotToImageContent(filePath: string): Promise<{ image?: ImageContent; error?: string }> {
  try {
    const raw = await readFile(filePath)
    const compressed = await compressImageForAPI(raw.toString('base64'), 'image/png')
    return {
      image: {
        type: 'image',
        source: {
          type: 'base64',
          media_type: compressed.mediaType,
          data: compressed.data,
        },
      },
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
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

async function getAccessibilityElements(maxElements: number): Promise<AccessibilityElement[]> {
  const stdout = await runAppleScript(buildAccessibilityTreeScript(maxElements), {
    maxBufferBytes: 1024 * 1024,
    timeoutMs: 8000,
  })
  return parseAccessibilityRows(stdout)
}

function buildAccessibilityTreeScript(maxElements: number): string[] {
  return [
    'global collectedRows',
    'global collectedCount',
    'global collectedLimit',
    'set collectedRows to {}',
    'set collectedCount to 0',
    `set collectedLimit to ${maxElements}`,
    'on replaceText(theText, searchString, replacementString)',
    'set oldDelimiters to AppleScript\'s text item delimiters',
    'set AppleScript\'s text item delimiters to searchString',
    'set textItems to text items of theText',
    'set AppleScript\'s text item delimiters to replacementString',
    'set replacedText to textItems as text',
    'set AppleScript\'s text item delimiters to oldDelimiters',
    'return replacedText',
    'end replaceText',
    'on cleanText(valueText)',
    'try',
    'if valueText is missing value then return ""',
    'set outputText to valueText as text',
    'set outputText to my replaceText(outputText, (ASCII character 9), " ")',
    'set outputText to my replaceText(outputText, (ASCII character 10), " ")',
    'set outputText to my replaceText(outputText, (ASCII character 13), " ")',
    'return outputText',
    'on error',
    'return ""',
    'end try',
    'end cleanText',
    'on collectElement(theElement, depth)',
    'global collectedRows',
    'global collectedCount',
    'global collectedLimit',
    'if collectedCount >= collectedLimit then return',
    'set roleText to ""',
    'set nameText to ""',
    'set valueText to ""',
    'set descriptionText to ""',
    'set helpText to ""',
    'set enabledText to ""',
    'set focusedText to ""',
    'set xText to ""',
    'set yText to ""',
    'set widthText to ""',
    'set heightText to ""',
    'try',
    'set roleText to my cleanText(role of theElement)',
    'end try',
    'try',
    'set nameText to my cleanText(name of theElement)',
    'end try',
    'try',
    'set valueText to my cleanText(value of theElement)',
    'end try',
    'try',
    'set descriptionText to my cleanText(description of theElement)',
    'end try',
    '-- Some applications expose AXHelp, but AppleScript does not provide a portable "help of" property here.',
    'try',
    'set enabledText to enabled of theElement as text',
    'end try',
    'try',
    'set focusedText to focused of theElement as text',
    'end try',
    'try',
    'set elementPosition to position of theElement',
    'set elementSize to size of theElement',
    'set xText to item 1 of elementPosition as text',
    'set yText to item 2 of elementPosition as text',
    'set widthText to item 1 of elementSize as text',
    'set heightText to item 2 of elementSize as text',
    'end try',
    'if xText is not "" and yText is not "" and widthText is not "" and heightText is not "" then',
    'set rowIndex to collectedCount',
    'set rowText to (rowIndex as text) & (ASCII character 9) & (depth as text) & (ASCII character 9) & roleText & (ASCII character 9) & xText & (ASCII character 9) & yText & (ASCII character 9) & widthText & (ASCII character 9) & heightText & (ASCII character 9) & enabledText & (ASCII character 9) & focusedText & (ASCII character 9) & nameText & (ASCII character 9) & valueText & (ASCII character 9) & descriptionText & (ASCII character 9) & helpText',
    'set end of collectedRows to rowText',
    'set collectedCount to collectedCount + 1',
    'end if',
    'try',
    'tell application "System Events" to set childElements to UI elements of theElement',
    'repeat with childElement in childElements',
    'if collectedCount >= collectedLimit then exit repeat',
    'my collectElement(childElement, depth + 1)',
    'end repeat',
    'end try',
    'end collectElement',
    'tell application "System Events"',
    'set frontApp to first application process whose frontmost is true',
    'try',
    'set frontWindow to front window of frontApp',
    'my collectElement(frontWindow, 0)',
    'on error',
    'my collectElement(frontApp, 0)',
    'end try',
    'end tell',
    'set AppleScript\'s text item delimiters to linefeed',
    'return collectedRows as text',
  ]
}

function parseAccessibilityRows(stdout: string): AccessibilityElement[] {
  return stdout.split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line): AccessibilityElement | null => {
      const fields = line.split('\t')
      if (fields.length < 13) return null
      const [index, depth, role, x, y, width, height, enabled, focused, name, value, description, help] = fields
      const parsed = {
        index: numberField(index),
        depth: numberField(depth),
        x: numberField(x),
        y: numberField(y),
        width: numberField(width),
        height: numberField(height),
      }
      if (Object.values(parsed).some(value => value === undefined)) return null
      if (parsed.width! <= 0 || parsed.height! <= 0) return null
      return {
        index: parsed.index!,
        depth: parsed.depth!,
        role: cleanDisplayText(role),
        x: parsed.x!,
        y: parsed.y!,
        width: parsed.width!,
        height: parsed.height!,
        enabled: cleanDisplayText(enabled),
        focused: cleanDisplayText(focused),
        name: cleanDisplayText(name),
        value: cleanDisplayText(value),
        description: cleanDisplayText(description),
        help: cleanDisplayText(help),
      }
    })
    .filter((element): element is AccessibilityElement => Boolean(element))
}

function formatAccessibilityTree(elements: AccessibilityElement[]): string[] {
  if (elements.length === 0) return ['accessibility_tree: (empty or unavailable)']
  return [
    'accessibility_tree:',
    ...elements.map(element => formatAccessibilityElement(element)),
  ]
}

function formatAccessibilityElement(element: AccessibilityElement): string {
  const indent = '  '.repeat(Math.min(element.depth, 4))
  const flags = [
    element.enabled ? `enabled=${element.enabled}` : '',
    element.focused ? `focused=${element.focused}` : '',
  ].filter(Boolean)
  const labels = [
    element.name ? `name=${quoteForDisplay(element.name)}` : '',
    element.value ? `value=${quoteForDisplay(element.value)}` : '',
    element.description ? `description=${quoteForDisplay(element.description)}` : '',
    element.help ? `help=${quoteForDisplay(element.help)}` : '',
  ].filter(Boolean)
  return `${indent}[${element.index}] role=${element.role || '(unknown)'} frame=(${element.x},${element.y},${element.width},${element.height}) ${[...flags, ...labels].join(' ')}`.trimEnd()
}

function resolveClickTarget(input: Record<string, unknown>): ClickTarget | ToolResult {
  if (hasValue(input.element_index)) return resolveElementTarget(input.element_index)
  const x = optionalNumberArg(input.x)
  const y = optionalNumberArg(input.y)
  if (x === undefined || y === undefined) {
    return {
      content: 'Error: provide element_index from computer_get_app_state, or provide both x and y coordinates.',
      isError: true,
    }
  }
  return { x, y, source: 'coordinate target' }
}

function resolveElementTarget(value: unknown): ClickTarget | ToolResult {
  const index = optionalElementIndexArg(value)
  if (index === undefined) {
    return { content: 'Error: element_index must be a non-negative number from computer_get_app_state.', isError: true }
  }
  if (!latestAccessibilitySnapshot) {
    return { content: 'Error: element_index requires a recent computer_get_app_state result in this session.', isError: true }
  }
  const element = latestAccessibilitySnapshot.elements.find(candidate => candidate.index === index)
  if (!element) {
    return {
      content: `Error: element_index ${index} was not found in the latest computer_get_app_state result. Call computer_get_app_state again and use one of the returned indexes.`,
      isError: true,
    }
  }
  const x = Math.round(element.x + element.width / 2)
  const y = Math.round(element.y + element.height / 2)
  return {
    x,
    y,
    source: `element_index ${element.index}${elementLabel(element) ? ` ${quoteForDisplay(elementLabel(element))}` : ''}`,
    element,
  }
}

async function runAppleScript(lines: string[], options: { maxBufferBytes?: number; timeoutMs?: number } = {}): Promise<string> {
  const args = lines.flatMap(line => ['-e', line])
  try {
    const { stdout } = await execFileAsync('/usr/bin/osascript', args, {
      ...(options.maxBufferBytes ? { maxBuffer: options.maxBufferBytes } : {}),
      ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
    })
    return String(stdout ?? '').trim()
  } catch (err) {
    throw new Error(formatAppleScriptError(err))
  }
}

function formatAppleScriptError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (message.includes('-1743') || /not authorized|not permitted|not allowed/i.test(message)) {
    return [
      'Computer Use is not authorized by macOS.',
      'Enable Pudding-Agent in System Settings > Privacy & Security > Automation > System Events.',
      'Also enable Pudding-Agent in Accessibility and Screen Recording if the action clicks, types, scrolls, or reads the screen.',
      `Original error: ${message}`,
    ].join('\n')
  }
  return message
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function numberArg(value: unknown, name: string): number {
  const parsed = optionalNumberArg(value)
  if (parsed === undefined) throw new Error(`${name} must be a number`)
  return parsed
}

function numberField(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return Math.round(parsed)
}

function optionalNumberArg(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Math.round(Number(value))
  return undefined
}

function optionalElementIndexArg(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value
  if (typeof value === 'string') {
    const match = value.trim().match(/^\[?#?(\d+)\]?$/)
    if (match) return Number(match[1])
  }
  return undefined
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  const resolved = value ?? fallback
  return Math.max(min, Math.min(max, Math.floor(resolved)))
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim().length > 0
}

function cleanDisplayText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 160)
}

function elementLabel(element: AccessibilityElement): string {
  return element.name || element.value || element.description || element.help || element.role
}

function quoteForDisplay(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
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

export const computerUseTestInternals = {
  buildAccessibilityTreeScript,
}
