import type {
  ConstraintObservabilitySnapshot,
  ContextInspectPayload,
  ContextRefreshInput,
  ContextRefreshPayload,
  MemorySearchPayload,
} from '@puddingagent/core'
import { create } from 'zustand'
import {
  ipc,
  type ContextFact as LegacyContextFact,
  type ContextInspectSnapshot,
  type ContextProviderHealthItem as LegacyProviderHealthItem,
  type ContextRefreshSnapshot,
  type ContextSection as LegacyContextSection,
  type VerificationInspectSnapshot,
} from '../lib/ipc-client'

export interface ContextRequestState<T> {
  data: T | null
  loading: boolean
  error: string | null
  loadedAt: number | null
}

export type ContextHarvestQueue = ContextInspectPayload['harvestQueue']
export type ContextMemoryReview = {
  accepted: MemorySearchPayload | null
  rejected: ContextInspectPayload['memoryReview']['rejected']
}
export type ContextProviderHealth = ContextInspectPayload['providerHealth']
export type ContextProviderHealthItem = ContextProviderHealth[number]
export type ContextRefreshState = ContextRefreshPayload
type ContextInspectStatePayload = ContextInspectPayload & {
  sessionId?: string
  cwd?: string
  query?: string
}

type ContextRequestKey = 'inspect' | 'harvest' | 'memoryReview' | 'providerHealth' | 'refresh' | 'constraint' | 'verification'

type LoadProjectContextInput = string | { sessionId: string; userMessage?: string }
type LoadInspectInput = string | {
  sessionId: string
  userMessage?: string
  includeExpiredRejected?: boolean
  includeAdvancedDiagnostics?: boolean
}
type RefreshContextInput = string | (ContextRefreshInput & { userMessage?: string })
type LoadProviderHealthInput = string | (ContextRefreshInput & { userMessage?: string })

interface ContextStoreState {
  inspect: ContextRequestState<ContextInspectStatePayload>
  harvest: ContextRequestState<ContextHarvestQueue>
  memoryReview: ContextRequestState<ContextMemoryReview>
  providerHealth: ContextRequestState<ContextProviderHealth>
  refresh: ContextRequestState<ContextRefreshState>
  constraint: ContextRequestState<ConstraintObservabilitySnapshot>
  verification: ContextRequestState<VerificationInspectSnapshot>
  loadProjectContext: (input: LoadProjectContextInput) => Promise<void>
  loadInspect: (input: LoadInspectInput, userMessage?: string) => Promise<void>
  refreshContext: (input: RefreshContextInput, userMessage?: string) => Promise<void>
  loadProviderHealth: (input: LoadProviderHealthInput) => Promise<void>
  refreshProviders: (input: RefreshContextInput) => Promise<void>
  loadVerification: (sessionId: string) => Promise<void>
  acceptMemoryCandidate: (candidateId: string, sessionId: string) => Promise<void>
  rejectMemoryCandidate: (candidateId: string, sessionId: string) => Promise<void>
  reset: () => void
}

const emptyRequest = <T>(): ContextRequestState<T> => ({
  data: null,
  loading: false,
  error: null,
  loadedAt: null,
})

const emptyHarvestSummary: ContextHarvestQueue['summary'] = {
  queued: 0,
  classified: 0,
  distilling: 0,
  validating: 0,
  accepted: 0,
  pending_review: 0,
  rejected: 0,
  skipped: 0,
  failed: 0,
}

const requestTokens: Record<ContextRequestKey, number> = {
  inspect: 0,
  harvest: 0,
  memoryReview: 0,
  providerHealth: 0,
  refresh: 0,
  constraint: 0,
  verification: 0,
}

let activeSessionId: string | null = null

function requestError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function settledError(result: PromiseSettledResult<unknown>): string | null {
  return result.status === 'rejected' ? requestError(result.reason) : null
}

function nextRequestToken(key: ContextRequestKey): number {
  requestTokens[key] += 1
  return requestTokens[key]
}

function isLatestRequest(key: ContextRequestKey, token: number): boolean {
  return requestTokens[key] === token
}

function invalidateRequests(): void {
  for (const key of Object.keys(requestTokens) as ContextRequestKey[]) {
    requestTokens[key] += 1
  }
}

function activateSession(sessionId: string): boolean {
  const changed = activeSessionId !== sessionId
  activeSessionId = sessionId
  return changed
}

function isActiveSession(sessionId: string): boolean {
  return activeSessionId === sessionId
}

function sessionInput(input: LoadProjectContextInput): { sessionId: string; userMessage?: string } {
  return typeof input === 'string' ? { sessionId: input } : { sessionId: input.sessionId, userMessage: input.userMessage }
}

function inspectInput(input: LoadInspectInput, fallbackUserMessage?: string): { sessionId: string; userMessage?: string } {
  return typeof input === 'string'
    ? { sessionId: input, userMessage: fallbackUserMessage }
    : { sessionId: input.sessionId, userMessage: input.userMessage ?? fallbackUserMessage }
}

function refreshInput(input: RefreshContextInput | LoadProviderHealthInput, fallbackUserMessage?: string): { sessionId: string; userMessage?: string } {
  return typeof input === 'string'
    ? { sessionId: input, userMessage: fallbackUserMessage }
    : { sessionId: input.sessionId, userMessage: input.userMessage ?? fallbackUserMessage }
}

function contextRequestFromInspect(inspect: ContextInspectStatePayload, loadedAt: number) {
  return {
    inspect: { data: inspect, loading: false, error: null, loadedAt },
    harvest: { data: inspect.harvestQueue, loading: false, error: null, loadedAt },
    memoryReview: { data: memoryReviewFromInspect(inspect), loading: false, error: null, loadedAt },
    providerHealth: { data: inspect.providerHealth, loading: false, error: null, loadedAt },
    constraint: { data: constraintFromInspect(inspect), loading: false, error: null, loadedAt },
  }
}

function contextRequestErrorState<T>(state: ContextRequestState<T>, message: string): ContextRequestState<T> {
  return { ...state, data: null, loading: false, error: message }
}

function resetContextRequests() {
  return {
    inspect: emptyRequest<ContextInspectStatePayload>(),
    harvest: emptyRequest<ContextHarvestQueue>(),
    memoryReview: emptyRequest<ContextMemoryReview>(),
    providerHealth: emptyRequest<ContextProviderHealth>(),
    refresh: emptyRequest<ContextRefreshState>(),
    constraint: emptyRequest<ConstraintObservabilitySnapshot>(),
  }
}

export const useContextStore = create<ContextStoreState>((set) => ({
  inspect: emptyRequest(),
  harvest: emptyRequest(),
  memoryReview: emptyRequest(),
  providerHealth: emptyRequest(),
  refresh: emptyRequest(),
  constraint: emptyRequest(),
  verification: emptyRequest(),

  loadProjectContext: async (input) => {
    const { sessionId, userMessage } = sessionInput(input)
    const changed = activateSession(sessionId)
    const inspectToken = nextRequestToken('inspect')
    const harvestToken = nextRequestToken('harvest')
    const memoryReviewToken = nextRequestToken('memoryReview')
    const providerHealthToken = nextRequestToken('providerHealth')
    const constraintToken = nextRequestToken('constraint')
    const verificationToken = nextRequestToken('verification')
    if (changed) nextRequestToken('refresh')

    set((state) => ({
      inspect: { ...state.inspect, loading: true, error: null },
      harvest: { ...state.harvest, loading: true, error: null },
      memoryReview: { ...state.memoryReview, loading: true, error: null },
      providerHealth: { ...state.providerHealth, loading: true, error: null },
      constraint: { ...state.constraint, loading: true, error: null },
      verification: { ...state.verification, loading: true, error: null },
      ...(changed ? { refresh: emptyRequest<ContextRefreshState>() } : {}),
    }))

    const [inspectResult, verificationResult] = await Promise.allSettled([
      ipc.context.inspect(sessionId, userMessage),
      ipc.verification.inspect(sessionId),
    ])
    const loadedAt = Date.now()
    const inspectError = settledError(inspectResult)
    const verificationError = settledError(verificationResult)
    const inspect = inspectResult.status === 'fulfilled' ? adaptInspectSnapshot(inspectResult.value) : null

    set((state) => ({
      ...(isActiveSession(sessionId) && isLatestRequest('inspect', inspectToken)
        ? inspect
          ? contextRequestFromInspect(inspect, loadedAt)
          : {
              inspect: contextRequestErrorState(state.inspect, inspectError ?? 'Context inspect failed'),
              harvest: contextRequestErrorState(state.harvest, inspectError ?? 'Context inspect failed'),
              memoryReview: contextRequestErrorState(state.memoryReview, inspectError ?? 'Context inspect failed'),
              providerHealth: contextRequestErrorState(state.providerHealth, inspectError ?? 'Context inspect failed'),
              constraint: contextRequestErrorState(state.constraint, inspectError ?? 'Context inspect failed'),
            }
        : {}),
      ...(isActiveSession(sessionId) && isLatestRequest('verification', verificationToken)
        ? verificationResult.status === 'fulfilled'
          ? { verification: { data: verificationResult.value, loading: false, error: null, loadedAt } }
          : { verification: { ...state.verification, data: null, loading: false, error: verificationError } }
        : {}),
      ...voidUnusedTokens(harvestToken, memoryReviewToken, providerHealthToken, constraintToken),
    }))
  },

  loadInspect: async (input, userMessage) => {
    const { sessionId, userMessage: message } = inspectInput(input, userMessage)
    const changed = activateSession(sessionId)
    const token = nextRequestToken('inspect')
    const harvestToken = nextRequestToken('harvest')
    const memoryReviewToken = nextRequestToken('memoryReview')
    const providerHealthToken = nextRequestToken('providerHealth')
    const constraintToken = nextRequestToken('constraint')
    if (changed) {
      nextRequestToken('refresh')
      nextRequestToken('verification')
    }
    set((state) => ({
      inspect: { ...state.inspect, loading: true, error: null },
      harvest: { ...state.harvest, loading: true, error: null },
      memoryReview: { ...state.memoryReview, loading: true, error: null },
      providerHealth: { ...state.providerHealth, loading: true, error: null },
      constraint: { ...state.constraint, loading: true, error: null },
      ...(changed ? { refresh: emptyRequest<ContextRefreshState>(), verification: emptyRequest<VerificationInspectSnapshot>() } : {}),
    }))
    try {
      const data = adaptInspectSnapshot(await ipc.context.inspect(sessionId, message))
      const loadedAt = Date.now()
      set(() => (
        isActiveSession(sessionId) && isLatestRequest('inspect', token)
          ? {
              ...contextRequestFromInspect(data, loadedAt),
              ...voidUnusedTokens(harvestToken, memoryReviewToken, providerHealthToken, constraintToken),
            }
          : {}
      ))
    } catch (error) {
      const message = requestError(error)
      set((state) => (
        isActiveSession(sessionId) && isLatestRequest('inspect', token)
          ? {
              inspect: contextRequestErrorState(state.inspect, message),
              harvest: contextRequestErrorState(state.harvest, message),
              memoryReview: contextRequestErrorState(state.memoryReview, message),
              providerHealth: contextRequestErrorState(state.providerHealth, message),
              constraint: contextRequestErrorState(state.constraint, message),
              ...voidUnusedTokens(harvestToken, memoryReviewToken, providerHealthToken, constraintToken),
            }
          : {}
      ))
    }
  },

  refreshContext: async (input, userMessage) => {
    const { sessionId, userMessage: message } = refreshInput(input, userMessage)
    const changed = activateSession(sessionId)
    const refreshToken = nextRequestToken('refresh')
    const inspectToken = nextRequestToken('inspect')
    const harvestToken = nextRequestToken('harvest')
    const memoryReviewToken = nextRequestToken('memoryReview')
    const providerHealthToken = nextRequestToken('providerHealth')
    const constraintToken = nextRequestToken('constraint')
    if (changed) nextRequestToken('verification')

    set((state) => ({
      refresh: { ...state.refresh, loading: true, error: null },
      inspect: { ...state.inspect, loading: true, error: null },
      harvest: { ...state.harvest, loading: true, error: null },
      memoryReview: { ...state.memoryReview, loading: true, error: null },
      providerHealth: { ...state.providerHealth, loading: true, error: null },
      constraint: { ...state.constraint, loading: true, error: null },
      ...(changed ? { verification: emptyRequest<VerificationInspectSnapshot>() } : {}),
    }))

    try {
      const data = adaptRefreshSnapshot(await ipc.context.refresh(sessionId, message))
      const inspect = data.inspect
      const loadedAt = Date.now()
      set(() => ({
        ...(isActiveSession(sessionId) && isLatestRequest('refresh', refreshToken)
          ? { refresh: { data: data.refresh, loading: false, error: null, loadedAt } }
          : {}),
        ...(isActiveSession(sessionId) && isLatestRequest('inspect', inspectToken)
          ? {
              ...contextRequestFromInspect(inspect, loadedAt),
              ...voidUnusedTokens(harvestToken, memoryReviewToken, providerHealthToken, constraintToken),
            }
          : {}),
      }))
    } catch (error) {
      const message = requestError(error)
      set((state) => ({
        ...(isActiveSession(sessionId) && isLatestRequest('refresh', refreshToken)
          ? { refresh: { ...state.refresh, data: null, loading: false, error: message } }
          : {}),
        ...(isActiveSession(sessionId) && isLatestRequest('inspect', inspectToken)
          ? {
              inspect: { ...state.inspect, loading: false, error: message },
              harvest: { ...state.harvest, loading: false, error: message },
              memoryReview: { ...state.memoryReview, loading: false, error: message },
              providerHealth: { ...state.providerHealth, loading: false, error: message },
              constraint: { ...state.constraint, loading: false, error: message },
              ...voidUnusedTokens(harvestToken, memoryReviewToken, providerHealthToken, constraintToken),
            }
          : {}),
      }))
    }
  },

  loadProviderHealth: async (input) => {
    const { sessionId, userMessage } = refreshInput(input)
    const changed = activateSession(sessionId)
    const token = nextRequestToken('providerHealth')
    if (changed) {
      nextRequestToken('inspect')
      nextRequestToken('harvest')
      nextRequestToken('memoryReview')
      nextRequestToken('constraint')
      nextRequestToken('refresh')
      nextRequestToken('verification')
    }
    set((state) => ({
      providerHealth: { ...state.providerHealth, loading: true, error: null },
      ...(changed ? resetContextRequests() : {}),
    }))
    try {
      const data = adaptInspectSnapshot(await ipc.context.inspect(sessionId, userMessage))
      const loadedAt = Date.now()
      set(() => (
        isActiveSession(sessionId) && isLatestRequest('providerHealth', token)
          ? { providerHealth: { data: data.providerHealth, loading: false, error: null, loadedAt } }
          : {}
      ))
    } catch (error) {
      const message = requestError(error)
      set((state) => (
        isActiveSession(sessionId) && isLatestRequest('providerHealth', token)
          ? { providerHealth: { ...state.providerHealth, data: null, loading: false, error: message } }
          : {}
      ))
    }
  },

  refreshProviders: async (input) => {
    await useContextStore.getState().refreshContext(input)
  },

  loadVerification: async (sessionId) => {
    const changed = activateSession(sessionId)
    const token = nextRequestToken('verification')
    if (changed) {
      nextRequestToken('inspect')
      nextRequestToken('harvest')
      nextRequestToken('memoryReview')
      nextRequestToken('providerHealth')
      nextRequestToken('refresh')
      nextRequestToken('constraint')
    }
    set((state) => ({
      verification: { ...state.verification, loading: true, error: null },
      ...(changed ? resetContextRequests() : {}),
    }))
    try {
      const data = await ipc.verification.inspect(sessionId)
      const loadedAt = Date.now()
      set(() => (
        isActiveSession(sessionId) && isLatestRequest('verification', token)
          ? { verification: { data, loading: false, error: null, loadedAt } }
          : {}
      ))
    } catch (error) {
      const message = requestError(error)
      set((state) => (
        isActiveSession(sessionId) && isLatestRequest('verification', token)
          ? { verification: { ...state.verification, data: null, loading: false, error: message } }
          : {}
      ))
    }
  },

  acceptMemoryCandidate: async (candidateId, sessionId) => {
    markMemoryCandidate(candidateId, sessionId, 'accepted', set)
  },

  rejectMemoryCandidate: async (candidateId, sessionId) => {
    markMemoryCandidate(candidateId, sessionId, 'rejected', set)
  },

  reset: () => {
    activeSessionId = null
    invalidateRequests()
    set({
      ...resetContextRequests(),
      verification: emptyRequest(),
    })
  },
}))

function voidUnusedTokens(..._tokens: number[]): Record<string, never> {
  return {}
}

function markMemoryCandidate(
  candidateId: string,
  sessionId: string,
  status: ContextInspectPayload['memoryReview']['rejected'][number]['status'],
  set: Parameters<typeof useContextStore.setState>[0],
): void {
  set((state) => ({
    memoryReview: {
      ...state.memoryReview,
      data: state.memoryReview.data
        ? {
            ...state.memoryReview.data,
            rejected: state.memoryReview.data.rejected.map((candidate) => (
              candidate.id === candidateId && candidate.sessionId === sessionId ? { ...candidate, status } : candidate
            )),
          }
        : null,
    },
  }))
}

function adaptRefreshSnapshot(snapshot: ContextRefreshSnapshot): { refresh: ContextRefreshPayload; inspect: ContextInspectStatePayload } {
  const inspect = adaptInspectSnapshot(snapshot.inspect)
  return {
    inspect,
    refresh: {
      status: snapshot.status === 'ready' ? 'refreshed' : 'unavailable',
      refreshedAt: snapshot.refreshedAt,
      requestedProviders: inspect.providerHealth.map((provider) => provider.id),
      bundle: inspect.bundle ?? emptyBundle(snapshot.sessionId, snapshot.refreshedAt),
      providerHealth: inspect.providerHealth,
      providerTimings: inspect.providerTimings,
      diagnostics: diagnosticsFromStrings(snapshot.diagnostics, snapshot.refreshedAt, 'PuddingContextRefresh'),
    },
  }
}

function adaptInspectSnapshot(snapshot: ContextInspectSnapshot): ContextInspectStatePayload {
  const inspectedAt = snapshot.inspectedAt
  const projectFacts = (snapshot.projectUnderstandingFacts ?? snapshot.memoryReview.storedProjectFacts).map(adaptFact)
  const currentSection = snapshot.current.section ? adaptSection(snapshot.current.section) : null
  const sections = currentSection ? [currentSection] : snapshot.current.facts.map((item) => sectionFromRetrievedFact(item, snapshot.sessionId))
  const diagnostics = diagnosticsFromStrings(snapshot.diagnostics, inspectedAt, 'PuddingContextInspect')
  const providerHealth = snapshot.providerHealth.map((provider) => adaptProviderHealth(provider, inspectedAt))

  return {
    sessionId: snapshot.sessionId,
    cwd: snapshot.cwd,
    query: snapshot.query,
    status: snapshot.status === 'ready' ? (sections.length || projectFacts.length ? 'available' : 'empty') : 'unavailable',
    inspectedAt,
    bundle: sections.length
      ? {
          id: `legacy_${snapshot.sessionId}_${inspectedAt}`,
          sessionId: snapshot.sessionId,
          requestHash: `legacy_${hashText(snapshot.query)}`,
          createdAt: inspectedAt,
          sections,
          citations: uniqueCitations(sections.flatMap((section) => section.citations)),
          diagnostics,
          budget: {
            usedTokens: snapshot.current.usedTokens,
            droppedTokens: snapshot.current.droppedTokens,
          },
        }
      : null,
    acceptedProjectFacts: projectFacts,
    droppedSections: [],
    providerHealth,
    providerTimings: [],
    harvestQueue: {
      jobs: [],
      summary: { ...emptyHarvestSummary },
    },
    memoryReview: {
      rejected: [],
    },
    diagnostics,
    schemaInfo: undefined,
    repoWiki: repoWikiSummary(snapshot.providerHealth),
  }
}

function memoryReviewFromInspect(inspect: ContextInspectPayload): ContextMemoryReview {
  return {
    accepted: {
      status: inspect.acceptedProjectFacts.length ? 'available' : 'empty',
      searchedAt: inspect.inspectedAt,
      query: { limit: 50 },
      results: inspect.acceptedProjectFacts.map((fact) => ({
        id: fact.id,
        kind: memoryKindFromFactKind(fact.kind),
        scope: memoryScopeFromFactScope(fact.scope),
        content: fact.content,
        citations: fact.citations,
        confidence: fact.confidence,
        freshness: fact.freshness,
        sourceProvider: fact.sourceProvider,
        createdAt: fact.createdAt,
        updatedAt: fact.updatedAt,
        expiresAt: fact.expiresAt,
      })),
      diagnostics: [],
    },
    rejected: inspect.memoryReview.rejected,
  }
}

function constraintFromInspect(inspect: ContextInspectPayload): ConstraintObservabilitySnapshot {
  const unhealthy = inspect.providerHealth.filter((provider) => provider.status === 'failed' || provider.status === 'timeout' || provider.status === 'rate_limited' || provider.status === 'stale' || provider.status === 'not_indexed')
  const status: ConstraintObservabilitySnapshot['status'] = inspect.status === 'unavailable' ? 'unavailable' : 'idle'
  return {
    status,
    inspectedAt: inspect.inspectedAt,
    cwd: '',
    summary: status === 'unavailable'
      ? { primary: '约束状态暂不可用', secondary: inspect.diagnostics[0]?.message ?? '无法读取上下文状态。' }
      : { primary: '约束状态正常', secondary: '没有未处理的阻塞、证据缺口或验证缺口。' },
    evidence: { status: 'not_required', missing: [] },
    blockedActions: [],
    verification: { status: 'not_required', changedFiles: [], requirements: [], commands: [] },
    contextHealth: {
      status: inspect.status,
      latestBundleId: inspect.bundle?.id,
      providerCount: inspect.providerHealth.length,
      unhealthyProviderCount: unhealthy.length,
      diagnostics: inspect.diagnostics,
    },
    policyEvents: [],
  }
}

function adaptProviderHealth(provider: LegacyProviderHealthItem, fallbackUpdatedAt: number): ContextProviderHealthItem {
  return {
    id: providerId(provider.id),
    status: providerStatus(provider.status),
    updatedAt: provider.updatedAt ?? fallbackUpdatedAt,
    diagnostic: provider.diagnostics[0]
      ? {
          id: `diag_provider_${provider.id}_${fallbackUpdatedAt}`,
          level: provider.status === 'error' ? 'error' : 'warning',
          source: provider.label || provider.id,
          message: provider.diagnostics[0],
          createdAt: fallbackUpdatedAt,
        }
      : undefined,
  }
}

function adaptSection(section: LegacyContextSection): NonNullable<ContextInspectPayload['bundle']>['sections'][number] {
  const facts = section.facts.map(adaptFact)
  const citations = uniqueCitations([...section.citations.map(adaptCitation), ...facts.flatMap((fact) => fact.citations)])
  return {
    id: section.id,
    kind: facts[0] ? sectionKindFromFactKind(facts[0].kind) : 'relevant_code',
    title: section.title,
    content: section.content,
    citations,
    priority: 10,
    confidence: firstConfidence(facts),
    freshness: freshest(facts),
    sourceProvider: facts[0]?.sourceProvider ?? 'context-v2',
    tokenEstimate: section.tokenEstimate,
    tokenCost: { tokenEstimate: section.tokenEstimate },
  }
}

function sectionFromRetrievedFact(
  item: ContextInspectSnapshot['current']['facts'][number],
  sessionId: string,
): NonNullable<ContextInspectPayload['bundle']>['sections'][number] {
  const fact = adaptFact(item.fact)
  return {
    id: `fact_section_${fact.id}`,
    kind: sectionKindFromFactKind(fact.kind),
    title: item.fact.title ?? fact.kind,
    content: fact.content,
    citations: fact.citations,
    priority: item.score,
    confidence: fact.confidence,
    freshness: fact.freshness,
    sourceProvider: fact.sourceProvider,
    tokenEstimate: item.tokenEstimate,
    tokenCost: { tokenEstimate: item.tokenEstimate, source: 'legacy-context-v2' },
    ownership: {
      authority: 'derived_state',
      topic: fact.kind === 'conversation_state' ? 'conversation' : fact.kind === 'git_state' ? 'git' : fact.kind === 'repo_wiki' ? 'project_profile' : 'memory',
      conflictPolicy: 'render',
      refs: [sessionId],
    },
  }
}

function adaptFact(fact: LegacyContextFact): ContextInspectPayload['acceptedProjectFacts'][number] {
  const createdAt = safeTimestamp(fact.createdAt)
  const updatedAt = safeTimestamp(fact.updatedAt)
  return {
    id: fact.id,
    kind: factKind(fact.kind),
    scope: factScope(fact.scope),
    content: fact.content,
    citations: fact.citations.map(adaptCitation).filter((citation) => citation.ref.length > 0),
    confidence: normalizeConfidence(fact.confidence),
    freshness: fact.expiresAt && fact.expiresAt < Date.now() ? 'stale' : 'cached',
    sourceProvider: fact.source || 'context-v2',
    createdAt,
    updatedAt,
    expiresAt: fact.expiresAt,
    tags: fact.tags,
  }
}

function adaptCitation(citation: LegacyContextFact['citations'][number]): ContextInspectPayload['acceptedProjectFacts'][number]['citations'][number] {
  return {
    id: citation.id ?? `cite_${hashText(`${citation.ref}:${citation.line ?? ''}:${citation.timestamp ?? ''}`)}`,
    type: citationType(citation.type),
    ref: citation.ref || 'unknown',
    line: citation.line,
    timestamp: citation.timestamp,
    hash: citation.hash,
  }
}

function diagnosticsFromStrings(messages: string[], createdAt: number, source: string): ContextInspectPayload['diagnostics'] {
  return messages.map((message, index) => ({
    id: `diag_${source}_${createdAt}_${index}`,
    level: 'warning',
    source,
    message,
    createdAt,
  }))
}

function emptyBundle(sessionId: string, createdAt: number): ContextRefreshPayload['bundle'] {
  return {
    id: `empty_refresh_${sessionId}_${createdAt}`,
    sessionId,
    requestHash: 'empty_refresh',
    createdAt,
    sections: [],
    citations: [],
    diagnostics: [],
    budget: { usedTokens: 0, droppedTokens: 0 },
  }
}

function uniqueCitations(citations: ContextInspectPayload['acceptedProjectFacts'][number]['citations']) {
  const seen = new Set<string>()
  return citations.filter((citation) => {
    const key = `${citation.type}:${citation.ref}:${citation.line ?? ''}:${citation.timestamp ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function repoWikiSummary(providers: LegacyProviderHealthItem[]): ContextInspectPayload['repoWiki'] {
  const provider = providers.find((item) => item.id === 'repo_wiki')
  if (!provider) return undefined
  return {
    activeEntries: numberDetail(provider.details?.activeEntries, provider.factCount),
    staleEntries: numberDetail(provider.details?.staleEntries, 0),
    lastDiagnostic: provider.diagnostics[0],
  }
}

function numberDetail(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function safeTimestamp(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : Date.now()
}

function normalizeConfidence(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.7
  return Math.min(1, Math.max(0.01, value))
}

function firstConfidence(facts: ContextInspectPayload['acceptedProjectFacts']): number {
  return facts[0]?.confidence ?? 0.7
}

function freshest(facts: ContextInspectPayload['acceptedProjectFacts']): ContextInspectPayload['acceptedProjectFacts'][number]['freshness'] {
  if (facts.some((fact) => fact.freshness === 'live')) return 'live'
  if (facts.some((fact) => fact.freshness === 'recent')) return 'recent'
  if (facts.some((fact) => fact.freshness === 'cached')) return 'cached'
  return 'stale'
}

function providerId(id: string): ContextProviderHealthItem['id'] {
  const known = ['code', 'repo_wiki', 'project', 'workflow', 'git', 'conversation', 'memory', 'runtime', 'ide'] as const
  if ((known as readonly string[]).includes(id)) return id as ContextProviderHealthItem['id']
  if (id === 'store') return 'memory'
  if (id === 'model') return 'runtime'
  return 'project'
}

function providerStatus(status: LegacyProviderHealthItem['status']): ContextProviderHealthItem['status'] {
  if (status === 'ok') return 'cached'
  if (status === 'warning') return 'stale'
  if (status === 'error') return 'failed'
  return 'disabled'
}

function factKind(kind: LegacyContextFact['kind']): ContextInspectPayload['acceptedProjectFacts'][number]['kind'] {
  if (kind === 'project') return 'project_profile'
  if (kind === 'code') return 'code_entrypoint'
  if (kind === 'git') return 'workflow_rule'
  if (kind === 'conversation') return 'current_goal'
  if (kind === 'repo_wiki') return 'architecture_decision'
  return 'project_profile'
}

function factScope(scope: LegacyContextFact['scope']): ContextInspectPayload['acceptedProjectFacts'][number]['scope'] {
  return scope === 'project' || scope === 'session' || scope === 'turn' ? scope : 'project'
}

function sectionKindFromFactKind(kind: ContextInspectPayload['acceptedProjectFacts'][number]['kind']): NonNullable<ContextInspectPayload['bundle']>['sections'][number]['kind'] {
  if (kind === 'code_entrypoint' || kind === 'module_boundary') return 'relevant_code'
  if (kind === 'workflow_rule') return 'git_state'
  if (kind === 'current_goal') return 'conversation_state'
  if (kind === 'architecture_decision') return 'repo_wiki'
  return 'memory'
}

function memoryKindFromFactKind(kind: ContextInspectPayload['acceptedProjectFacts'][number]['kind']): MemorySearchPayload['results'][number]['kind'] {
  if (kind === 'user_preference') return 'user_preference'
  if (kind === 'architecture_decision' || kind === 'module_boundary') return 'architecture_decision'
  if (kind === 'known_issue' || kind === 'runtime_error_chain') return 'known_issue'
  if (kind === 'project_convention' || kind === 'workflow_rule') return 'project_convention'
  return 'workflow_hint'
}

function memoryScopeFromFactScope(scope: ContextInspectPayload['acceptedProjectFacts'][number]['scope']): MemorySearchPayload['results'][number]['scope'] {
  if (scope === 'global' || scope === 'project' || scope === 'repo') return scope
  return 'project'
}

function citationType(type: string): ContextInspectPayload['acceptedProjectFacts'][number]['citations'][number]['type'] {
  if (type === 'file' || type === 'git' || type === 'message') return type
  if (type === 'code') return 'file'
  if (type === 'package') return 'config'
  return 'diagnostic'
}

function hashText(text: string): string {
  let hash = 0
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0
  }
  return Math.abs(hash).toString(36)
}
