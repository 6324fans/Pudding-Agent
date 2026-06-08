import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { ToolRegistry } from '../tool-registry.js'
import type { ModelProvider } from '../model-provider.js'
import type { ModelConfig } from '../types.js'
import type { ToolExecutionEvent, PermissionCallback } from '../tool-runner.js'
import { runSubSession } from '../sub-session.js'
import type { RuntimeModelResolution } from '../model-resolution.js'

export interface AgentToolDeps {
  provider: ModelProvider
  toolRegistry: ToolRegistry
  modelConfig: ModelConfig
  cwd: string
  onToolEvent?: (event: ToolExecutionEvent) => void
  onPermissionRequest?: PermissionCallback
  isSubAgent?: boolean
  resolveModel?: (modelId: string) => RuntimeModelResolution
  onAgentProgress?: (agentToolUseId: string, event: { toolName: string; toolStatus: 'start' | 'complete' | 'error'; toolInput?: Record<string, unknown>; toolResult?: { content: string; isError?: boolean }; toolCount: number }) => void
  onAgentText?: (agentToolUseId: string, text: string) => void
  onAgentComplete?: (agentToolUseId: string, result: { content: string; turns: number; toolsUsed: string[] }) => void
  agentAbortControllers?: Map<string, AbortController>
  backgroundTasks?: import('../background-tasks.js').BackgroundTaskManager
  registerBackgroundTrigger?: (toolUseId: string, resolve: () => void) => void
  /** Bubble sub-agent token usage up to the host session for aggregation. */
  onUsage?: (usage: { inputTokens: number; outputTokens: number; cacheCreationInputTokens?: number; cacheReadInputTokens?: number }) => void
}

export function createAgentTool(deps: AgentToolDeps): ToolHandler {
  return {
    definition: {
      name: 'Agent',
      description:
        'Dispatch a sub-agent to handle a task independently. Available types:\n' +
        '- explore: Fast read-only search for locating code (no modifications)\n' +
        '- plan: Analyze code and write implementation plans\n' +
        '- refactor: Improve code structure without changing behavior (no bash)\n' +
        '- security-auditor: Analyze code for vulnerabilities\n' +
        '- frontend-designer: Convert designs into components\n' +
        '- general: Full tool access for complex multi-step tasks (default)' +
        '\n\nWhen to use: open-ended questions spanning the codebase, tasks matching a specialized agent type, genuinely independent parallel work.' +
        '\nWhen NOT to use: target file already known (use file_read directly), specific symbol lookup (use grep), single-file edits.' +
        '\nWriting the prompt: brief like a smart colleague who just walked in — explain what you\'re accomplishing and why, what you\'ve already learned/ruled out, give enough context for judgment calls. Never delegate understanding.' +
        '\nIMPORTANT: Agent result is NOT visible to the user. You must relay a summary of findings or changes.' +
        '\nSet run_in_background: true for long-running tasks. The agent runs independently and you receive a <task-notification> when it completes.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The task description for the sub-agent' },
          type: {
            type: 'string',
            enum: ['explore', 'plan', 'refactor', 'security-auditor', 'frontend-designer', 'general'],
            description: 'The type of specialized agent to use (default: general)',
          },
          modelId: { type: 'string', description: 'Model ID to use for this sub-agent (from configured models). Defaults to current session model.' },
          maxTurns: { type: 'number', description: 'Maximum conversation turns. Omit to use the selected agent type default; explicit values override the type default.' },
          run_in_background: {
            type: 'boolean',
            description: 'Run this agent in the background. Returns immediately with a task_id. You will receive a <task-notification> when it completes.',
          },
        },
        required: ['prompt'],
      },
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      if (deps.isSubAgent) {
        return { content: 'Sub-agents cannot dispatch further sub-agents.', isError: true }
      }

      const prompt = input.prompt as string
      const maxTurns = typeof input.maxTurns === 'number' ? input.maxTurns : undefined
      const agentType = (input.type as string) || 'general'
      const requestedModelId = input.modelId as string | undefined
      const toolUseId = context.toolUseId || 'unknown'

      let effectiveProvider = deps.provider
      let effectiveModelConfig = deps.modelConfig
      let modelWarning: string | undefined

      if (requestedModelId) {
        const resolved = deps.resolveModel?.(requestedModelId)
        if (resolved?.status === 'resolved') {
          effectiveProvider = resolved.provider
          effectiveModelConfig = resolved.modelConfig
          modelWarning = resolved.warning
        } else {
          modelWarning = resolved?.warning ?? `Requested model "${requestedModelId}" was not found; using the main session model.`
        }
      }

      const agentAbort = new AbortController()
      deps.agentAbortControllers?.set(toolUseId, agentAbort)

      const onParentAbort = () => agentAbort.abort()
      context.signal?.addEventListener('abort', onParentAbort)
      if (context.signal?.aborted) {
        agentAbort.abort()
      }

      if (input.run_in_background && deps.backgroundTasks) {
        const task = deps.backgroundTasks.registerAgent(prompt, agentType)

        deps.backgroundTasks.acquireAgentSlot().then(() => {
          return runSubSession({
            prompt,
            provider: effectiveProvider,
            toolRegistry: deps.toolRegistry,
            modelConfig: effectiveModelConfig,
            cwd: deps.cwd,
            maxTurns,
            agentType,
            signal: agentAbort.signal,
            onToolEvent: deps.onToolEvent,
            onPermissionRequest: deps.onPermissionRequest,
            onAgentProgress: (event) => deps.onAgentProgress?.(toolUseId, event),
            onAgentText: (text) => deps.onAgentText?.(toolUseId, text),
            onUsage: (u) => deps.onUsage?.(u),
          })
        }).then(result => {
          if (result.status && result.status !== 'completed') {
            deps.backgroundTasks!.failAgent(task.id, describeSubSessionFailure(result))
            return
          }
          deps.onAgentComplete?.(toolUseId, result)
          deps.backgroundTasks!.completeAgent(task.id, { result: result.content, turns: result.turns, toolsUsed: result.toolsUsed })
        }).catch(err => {
          deps.backgroundTasks!.failAgent(task.id, err instanceof Error ? err.message : String(err))
        }).finally(() => {
          deps.agentAbortControllers?.delete(toolUseId)
          context.signal?.removeEventListener('abort', onParentAbort)
        })

        return {
          content: [
            `Background agent started.`,
            `Task ID: ${task.id}`,
            `Type: ${agentType}`,
            modelWarning ? `Model warning: ${modelWarning}` : '',
            `Prompt: ${prompt}`,
            `You will receive a <task-notification> when it completes.`,
          ].filter(Boolean).join('\n'),
        }
      }

      try {
        let backgroundResolver: (() => void) | undefined
        const backgroundSignal = new Promise<void>(resolve => {
          backgroundResolver = resolve
        })
        deps.registerBackgroundTrigger?.(toolUseId, () => {
          backgroundResolver?.()
        })

        const sessionPromise = runSubSession({
          prompt,
          provider: effectiveProvider,
          toolRegistry: deps.toolRegistry,
          modelConfig: effectiveModelConfig,
          cwd: deps.cwd,
          maxTurns,
          agentType,
          signal: agentAbort.signal,
          onToolEvent: deps.onToolEvent,
          onPermissionRequest: deps.onPermissionRequest,
          onAgentProgress: (event) => deps.onAgentProgress?.(toolUseId, event),
          onAgentText: (text) => deps.onAgentText?.(toolUseId, text),
          onUsage: (u) => deps.onUsage?.(u),
        })

        const raceResult = await Promise.race([
          sessionPromise.then(r => ({ type: 'done' as const, result: r })),
          backgroundSignal.then(() => ({ type: 'backgrounded' as const, result: undefined })),
        ])

        if (raceResult.type === 'backgrounded') {
          const task = deps.backgroundTasks!.registerAgent(prompt, agentType)
          sessionPromise.then(result => {
            if (result.status && result.status !== 'completed') {
              deps.backgroundTasks!.failAgent(task.id, describeSubSessionFailure(result))
              return
            }
            deps.onAgentComplete?.(toolUseId, result)
            deps.backgroundTasks!.completeAgent(task.id, { result: result.content, turns: result.turns, toolsUsed: result.toolsUsed })
          }).catch(err => {
            deps.backgroundTasks!.failAgent(task.id, err instanceof Error ? err.message : String(err))
          })
          return {
            content: [
              `Agent moved to background.`,
              `Task ID: ${task.id}`,
              modelWarning ? `Model warning: ${modelWarning}` : '',
              `You will receive a <task-notification> when it completes.`,
            ].filter(Boolean).join('\n'),
          }
        }

        if (raceResult.result!.status && raceResult.result!.status !== 'completed') {
          return {
            content: `Sub-agent error: ${describeSubSessionFailure(raceResult.result!)}`,
            isError: true,
          }
        }

        deps.onAgentComplete?.(toolUseId, raceResult.result!)
        const resultContent = modelWarning
          ? `Model warning: ${modelWarning}\n\n${raceResult.result!.content}`
          : raceResult.result!.content
        return { content: resultContent }
      } catch (error) {
        return {
          content: `Sub-agent error: ${error instanceof Error ? error.message : String(error)}`,
          isError: true,
        }
      } finally {
        deps.agentAbortControllers?.delete(toolUseId)
        context.signal?.removeEventListener('abort', onParentAbort)
      }
    },
  }
}

function describeSubSessionFailure(result: { status?: string; turns: number; content: string }): string {
  if (result.status === 'max_turns_exhausted') {
    return `Sub-agent reached max turns without completing after ${result.turns} turns.`
  }
  if (result.status === 'aborted') {
    return 'Sub-agent was aborted before completing before max turns were reached.'
  }
  return result.content || 'Sub-agent failed before completing.'
}
