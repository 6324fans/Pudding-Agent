import { z } from 'zod'
import type { ModelCapabilityProfile } from './model-profile.js'

export type MessageRole = 'user' | 'assistant' | 'system'

export interface TextContent {
  type: 'text'
  text: string
}

export interface ToolUseContent {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResultContent {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
  metadata?: ToolResultMetadata
}

export interface ImageContent {
  type: 'image'
  source: {
    type: 'base64'
    media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
    data: string
  }
}

export interface ThinkingContent {
  type: 'thinking'
  thinking: string
  signature?: string
}

export type ContentBlock = TextContent | ToolUseContent | ToolResultContent | ImageContent | ThinkingContent

export interface Message {
  id: string
  role: MessageRole
  content: ContentBlock[]
  timestamp: number
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface ToolResultMetadata {
  suppressedToolCall?: {
    reason: 'missing_required_arguments'
    missing: string[]
  }
  fileRead?: {
    filePath: string
    offset: number
    limit: number
    totalLines: number
    content: string
  }
  mutations?: Array<{
    filePath: string
    kind: 'edit' | 'multi_edit' | 'write'
  }>
  command?: {
    shell: 'bash' | 'powershell'
    command: string
    exitCode: number | null
  }
}

export interface StreamChunk {
  type:
    | 'text_delta'
    | 'thinking_delta'
    | 'thinking_end'
    | 'tool_use_start'
    | 'tool_use_delta'
    | 'tool_use_end'
    | 'message_end'
    | 'compact_start'
    | 'compact_progress'
    | 'compact_complete'
    | 'compact_skipped'
    | 'compact_failed'
  text?: string
  signature?: string
  toolUse?: { id: string; name: string; input: string }
  usage?: {
    inputTokens: number
    outputTokens: number
    cacheCreationInputTokens?: number
    cacheReadInputTokens?: number
  }
  compactInfo?: {
    originalCount: number
    keptCount: number
    summarizedCount: number
    memoriesExtracted: number
  }
  compactSkipped?: {
    reason: 'too_short' | 'no_session' | 'in_progress'
    messageCount: number
  }
  compactFailed?: {
    reason: 'aborted' | 'empty_response' | 'stream_error'
    message?: string
  }
}

export interface PromptSegment {
  content: string
  cacheable: boolean
}

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface ModelConfig {
  model: string
  maxTokens: number
  temperature?: number
  systemPrompt?: string | PromptSegment[]
  effort?: ReasoningEffort
  contextWindow?: number
  compressAt?: number
  /**
   * Runtime model capability profile. When omitted, runtime behavior stays on
   * the standard defaults.
   */
  modelProfile?: ModelCapabilityProfile
  /**
   * Legacy pre-compaction cleanup. Defaults to false because the product
   * prioritizes evidence retention over token conservation.
   */
  toolResultRetention?: {
    microCompact?: boolean
    keptToolResultChars?: number
    keptErrorToolResultChars?: number
    summaryToolResultChars?: number
    summaryErrorToolResultChars?: number
    summaryTotalToolResultChars?: number
  }
  /**
   * Stable identifier for cache routing. Same value across calls of the
   * same role (main session / PM / specific worker role / skill router) so
   * providers can route requests to the same prompt-cache shard.
   *
   * Anthropic ignores this (uses explicit cache_control); OpenAI Chat /
   * Responses pass it as `prompt_cache_key`.
   */
  cacheKey?: string
  /**
   * End-user identifier for OpenAI's `user` field — improves cache routing
   * and helps with abuse signals. Usually the session id.
   */
  cacheUser?: string
  /**
   * Progress hook for provider-level stream retries. Providers call this only
   * while retrying is still protocol-safe: before any chunk has been yielded.
   */
  onStreamRetry?: (
    attempt: number,
    error: Error,
    delayMs: number,
    maxRetries: number,
  ) => void
}

export interface SessionConfig {
  id: string
  projectName: string
  cwd: string
  modelConfig: ModelConfig
}

export const AppConfigSchema = z.object({
  defaultProvider: z.enum(['anthropic', 'openai', 'custom', 'ollama']).default('anthropic'),
  anthropicApiKey: z.string().optional(),
  openaiApiKey: z.string().optional(),
  customEndpoint: z.string().optional(),
  ollamaEndpoint: z.string().default('http://localhost:11434'),
  defaultModel: z.string().default('claude-sonnet-4-6'),
  theme: z.enum(['dark', 'light']).default('dark'),
})

export type AppConfig = z.infer<typeof AppConfigSchema>
