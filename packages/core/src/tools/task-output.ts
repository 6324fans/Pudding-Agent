import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { BackgroundTaskManager } from '../background-tasks.js'

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 600_000
const POLL_INTERVAL_MS = 100

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function readTimeout(input: unknown): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return DEFAULT_TIMEOUT_MS
  return Math.max(0, Math.min(MAX_TIMEOUT_MS, Math.floor(input)))
}

export function createTaskOutputTool(mgr: BackgroundTaskManager): ToolHandler {
  return {
    definition: {
      name: 'task_output',
      description:
        'Get raw stdout/stderr output of a shell or agent background task. ' +
        'Use block=true (default) to wait for new output or task completion and avoid polling. ' +
        'Use block=false for an immediate snapshot. ' +
        'NOT for team tasks — use background_events instead for teams. ' +
        'Use tail param to avoid flooding context with large outputs.',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'The background task ID' },
          block: { type: 'boolean', description: 'Wait for new output or task completion (default: true)', default: true },
          timeout: { type: 'number', description: 'Max wait time in ms (default: 30000, max: 600000)', default: DEFAULT_TIMEOUT_MS },
          tail: { type: 'number', description: 'Only return last N lines' },
        },
        required: ['task_id'],
      },
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const taskId = input.task_id as string
      const block = input.block !== false
      const timeout = readTimeout(input.timeout)
      const tail = input.tail as number | undefined
      const task = mgr.getTask(taskId)
      if (!task) return { content: `Error: task ${taskId} not found`, isError: true }

      const initialOutput = mgr.getOutput(taskId)
      let waitTimedOut = false

      if (block && task.status === 'running' && timeout > 0) {
        const deadline = Date.now() + timeout
        while (Date.now() < deadline) {
          if (context.signal?.aborted) {
            return { content: `Aborted while waiting for task ${taskId}`, isError: true }
          }

          const current = mgr.getTask(taskId)
          if (!current || current.status !== 'running') break
          if (mgr.getOutput(taskId) !== initialOutput) break

          await sleep(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())))
        }

        const current = mgr.getTask(taskId)
        waitTimedOut = Boolean(current && current.status === 'running' && mgr.getOutput(taskId) === initialOutput)
      }

      const current = mgr.getTask(taskId)
      if (!current) return { content: `Error: task ${taskId} disappeared`, isError: true }

      const output = mgr.getOutput(taskId, tail)
      const status = waitTimedOut ? `${current.status} (wait timed out)` : current.status
      const command = current.command ? ` (command: ${current.command})` : ''
      const header = `Task ${taskId}: ${status}${command}\nExit code: ${current.exitCode ?? 'still running'}\n---\n`
      return { content: header + (output || '(no output yet)') }
    },
  }
}
