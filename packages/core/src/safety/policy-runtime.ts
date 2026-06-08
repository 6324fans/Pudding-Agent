import { readFileSync } from 'node:fs'
import type { FileReadStateCache, MutationSnapshotOptions } from '../file-read-state.js'
import type { ToolResult } from '../tool-registry.js'
import { classifyVerificationCommand } from '../verification/tool-output-classifier.js'
import { VerificationLedger } from '../verification/verification-ledger.js'
import { evaluateFileMutationPolicy } from './file-mutation-policy.js'
import { PolicyEventLedger } from './policy-events.js'

export type SafetyPolicyMode = 'warn' | 'block'
export type SafetyPreToolDecision =
  | { decision: 'allow'; warning?: string }
  | { decision: 'block'; reason: string }

export interface SafetyPolicyRuntimeOptions {
  mode?: SafetyPolicyMode
  now?: () => number
  cwd?: string
}

export interface SafetyToolContext {
  toolName: string
  toolUseId?: string
  input: Record<string, unknown>
  cwd: string
  fileReadState: FileReadStateCache
}

export interface SafetyPostToolContext extends SafetyToolContext {
  result: ToolResult
}

export class SafetyPolicyRuntime {
  readonly policyEvents: PolicyEventLedger
  readonly verificationLedger: VerificationLedger
  readonly mode: SafetyPolicyMode

  constructor(options: SafetyPolicyRuntimeOptions = {}) {
    this.mode = options.mode ?? 'warn'
    this.policyEvents = new PolicyEventLedger({ now: options.now })
    this.verificationLedger = new VerificationLedger({ now: options.now, cwd: options.cwd })
  }

  preToolUse(context: SafetyToolContext): SafetyPreToolDecision {
    const mutationDecision = evaluateFileMutationPolicy({
      toolName: context.toolName,
      input: context.input,
      cwd: context.cwd,
      fileReadState: context.fileReadState,
    })

    if (mutationDecision.decision === 'allow') {
      this.policyEvents.record({
        phase: 'pre_tool_use',
        source: 'FileMutationPolicy',
        decision: 'allow',
        toolName: context.toolName,
        toolUseId: context.toolUseId,
        cwd: context.cwd,
      })
      return { decision: 'allow' }
    }

    const shouldBlock = this.mode === 'block'
    this.policyEvents.record({
      phase: 'pre_tool_use',
      source: 'FileMutationPolicy',
      decision: shouldBlock ? 'block' : 'warn',
      reason: mutationDecision.reason,
      toolName: context.toolName,
      toolUseId: context.toolUseId,
      cwd: context.cwd,
    })

    return shouldBlock
      ? { decision: 'block', reason: mutationDecision.reason }
      : { decision: 'allow', warning: mutationDecision.reason }
  }

  postToolUse(context: SafetyPostToolContext): void {
    const command = context.result.metadata?.command
    if (context.result.isError && !command) return

    if (!context.result.isError) {
      const fileRead = context.result.metadata?.fileRead
      if (fileRead) {
        context.fileReadState.recordRead(
          fileRead.filePath,
          fileRead.offset,
          fileRead.limit,
          fileRead.totalLines,
          fileRead.content
        )
        this.policyEvents.record({
          phase: 'post_tool_use',
          source: 'ToolResultMetadata',
          decision: 'record',
          toolName: context.toolName,
          toolUseId: context.toolUseId,
          cwd: context.cwd,
        })
      }

      for (const mutation of context.result.metadata?.mutations ?? []) {
        try {
          const content = readFileSync(mutation.filePath, 'utf-8')
          context.fileReadState.recordMutationSnapshot(mutation.filePath, content, mutationSnapshotOptions(context.toolName, context.input))
        } catch {
          context.fileReadState.invalidate(mutation.filePath)
        }
        this.verificationLedger.recordMutation({
          filePath: mutation.filePath,
          toolUseId: context.toolUseId ?? '',
        })
        this.policyEvents.record({
          phase: 'post_tool_use',
          source: 'VerificationLedger',
          decision: 'record',
          toolName: context.toolName,
          toolUseId: context.toolUseId,
          cwd: context.cwd,
        })
      }
    }

    if (command) {
      const classified = classifyVerificationCommand(command.command)
      if (classified) {
        this.verificationLedger.recordCommand({
          toolUseId: context.toolUseId ?? '',
          command: command.command,
          kind: classified.kind,
          status: command.exitCode === 0 && !context.result.isError ? 'passed' : 'failed',
          output: context.result.content,
        })
        this.policyEvents.record({
          phase: 'post_tool_use',
          source: 'VerificationLedger',
          decision: 'record',
          toolName: context.toolName,
          toolUseId: context.toolUseId,
          cwd: context.cwd,
        })
      }
    }
  }
}

function mutationSnapshotOptions(toolName: string, input: Record<string, unknown>): MutationSnapshotOptions {
  if (toolName === 'file_edit') {
    const oldText = typeof input.old_string === 'string' ? input.old_string : undefined
    const newText = typeof input.new_string === 'string' ? input.new_string : undefined
    if (oldText !== undefined && newText !== undefined) {
      return { replacements: [{ oldText, newText, replaceAll: input.replace_all === true }] }
    }
  }

  if (toolName === 'multi_edit' && Array.isArray(input.edits)) {
    const replacements = input.edits.flatMap((edit): NonNullable<MutationSnapshotOptions['replacements']> => {
      if (!edit || typeof edit !== 'object') return []
      const record = edit as Record<string, unknown>
      return typeof record.old_string === 'string' && typeof record.new_string === 'string'
        ? [{ oldText: record.old_string, newText: record.new_string }]
        : []
    })
    return replacements.length > 0 ? { replacements } : {}
  }

  return {}
}
