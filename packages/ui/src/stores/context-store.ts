import { create } from 'zustand'
import {
  ipc,
  type ContextInspectSnapshot,
  type ContextRefreshSnapshot,
  type VerificationInspectSnapshot,
} from '../lib/ipc-client'

export interface ContextRequestState<T> {
  data: T | null
  loading: boolean
  error: string | null
  loadedAt: number | null
}

type ContextRequestKey = 'inspect' | 'refresh' | 'verification'

interface ContextStoreState {
  inspect: ContextRequestState<ContextInspectSnapshot>
  refresh: ContextRequestState<ContextRefreshSnapshot>
  verification: ContextRequestState<VerificationInspectSnapshot>
  loadProjectContext: (sessionId: string) => Promise<void>
  loadInspect: (sessionId: string, userMessage?: string) => Promise<void>
  refreshContext: (sessionId: string, userMessage?: string) => Promise<void>
  loadVerification: (sessionId: string) => Promise<void>
  reset: () => void
}

const emptyRequest = <T>(): ContextRequestState<T> => ({
  data: null,
  loading: false,
  error: null,
  loadedAt: null,
})

const requestTokens: Record<ContextRequestKey, number> = {
  inspect: 0,
  refresh: 0,
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

export const useContextStore = create<ContextStoreState>((set) => ({
  inspect: emptyRequest(),
  refresh: emptyRequest(),
  verification: emptyRequest(),

  loadProjectContext: async (sessionId) => {
    const changed = activateSession(sessionId)
    const inspectToken = nextRequestToken('inspect')
    const verificationToken = nextRequestToken('verification')
    if (changed) nextRequestToken('refresh')

    set((state) => ({
      inspect: { ...state.inspect, loading: true, error: null },
      verification: { ...state.verification, loading: true, error: null },
      ...(changed ? { refresh: emptyRequest<ContextRefreshSnapshot>() } : {}),
    }))

    const [inspectResult, verificationResult] = await Promise.allSettled([
      ipc.context.inspect(sessionId),
      ipc.verification.inspect(sessionId),
    ])
    const loadedAt = Date.now()
    const inspectError = settledError(inspectResult)
    const verificationError = settledError(verificationResult)

    set((state) => ({
      ...(isActiveSession(sessionId) && isLatestRequest('inspect', inspectToken)
        ? inspectResult.status === 'fulfilled'
          ? { inspect: { data: inspectResult.value, loading: false, error: null, loadedAt } }
          : { inspect: { ...state.inspect, data: null, loading: false, error: inspectError } }
        : {}),
      ...(isActiveSession(sessionId) && isLatestRequest('verification', verificationToken)
        ? verificationResult.status === 'fulfilled'
          ? { verification: { data: verificationResult.value, loading: false, error: null, loadedAt } }
          : { verification: { ...state.verification, data: null, loading: false, error: verificationError } }
        : {}),
    }))
  },

  loadInspect: async (sessionId, userMessage) => {
    const changed = activateSession(sessionId)
    const token = nextRequestToken('inspect')
    if (changed) {
      nextRequestToken('refresh')
      nextRequestToken('verification')
    }
    set((state) => ({
      inspect: { ...state.inspect, loading: true, error: null },
      ...(changed ? { refresh: emptyRequest<ContextRefreshSnapshot>(), verification: emptyRequest<VerificationInspectSnapshot>() } : {}),
    }))
    try {
      const data = await ipc.context.inspect(sessionId, userMessage)
      const loadedAt = Date.now()
      set(() => (
        isActiveSession(sessionId) && isLatestRequest('inspect', token)
          ? { inspect: { data, loading: false, error: null, loadedAt } }
          : {}
      ))
    } catch (error) {
      const message = requestError(error)
      set((state) => (
        isActiveSession(sessionId) && isLatestRequest('inspect', token)
          ? { inspect: { ...state.inspect, data: null, loading: false, error: message } }
          : {}
      ))
    }
  },

  refreshContext: async (sessionId, userMessage) => {
    const changed = activateSession(sessionId)
    const refreshToken = nextRequestToken('refresh')
    const inspectToken = nextRequestToken('inspect')
    if (changed) nextRequestToken('verification')

    set((state) => ({
      refresh: { ...state.refresh, loading: true, error: null },
      inspect: { ...state.inspect, loading: true, error: null },
      ...(changed ? { verification: emptyRequest<VerificationInspectSnapshot>() } : {}),
    }))

    try {
      const data = await ipc.context.refresh(sessionId, userMessage)
      const loadedAt = Date.now()
      set(() => ({
        ...(isActiveSession(sessionId) && isLatestRequest('refresh', refreshToken)
          ? { refresh: { data, loading: false, error: null, loadedAt } }
          : {}),
        ...(isActiveSession(sessionId) && isLatestRequest('inspect', inspectToken)
          ? { inspect: { data: data.inspect, loading: false, error: null, loadedAt } }
          : {}),
      }))
    } catch (error) {
      const message = requestError(error)
      set((state) => ({
        ...(isActiveSession(sessionId) && isLatestRequest('refresh', refreshToken)
          ? { refresh: { ...state.refresh, data: null, loading: false, error: message } }
          : {}),
        ...(isActiveSession(sessionId) && isLatestRequest('inspect', inspectToken)
          ? { inspect: { ...state.inspect, loading: false, error: message } }
          : {}),
      }))
    }
  },

  loadVerification: async (sessionId) => {
    const changed = activateSession(sessionId)
    const token = nextRequestToken('verification')
    if (changed) {
      nextRequestToken('inspect')
      nextRequestToken('refresh')
    }
    set((state) => ({
      verification: { ...state.verification, loading: true, error: null },
      ...(changed ? { inspect: emptyRequest<ContextInspectSnapshot>(), refresh: emptyRequest<ContextRefreshSnapshot>() } : {}),
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

  reset: () => {
    activeSessionId = null
    invalidateRequests()
    set({
      inspect: emptyRequest(),
      refresh: emptyRequest(),
      verification: emptyRequest(),
    })
  },
}))
