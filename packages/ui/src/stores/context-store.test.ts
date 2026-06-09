import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useContextStore } from './context-store'
import type { ContextInspectSnapshot, VerificationInspectSnapshot } from '../lib/ipc-client'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function inspectPayload(sessionId: string, inspectedAt: number): ContextInspectSnapshot {
  return {
    status: 'ready',
    sessionId,
    cwd: `/repo/${sessionId}`,
    inspectedAt,
    query: 'context',
    current: {
      section: null,
      facts: [],
      usedTokens: 0,
      droppedTokens: 0,
      storedFactCount: 0,
      providerFactCount: 0,
    },
    providerHealth: [],
    memoryReview: {
      memoryDir: `/repo/${sessionId}/memory`,
      available: false,
      lineCount: 0,
      preview: '',
      storedProjectFacts: [],
    },
    diagnostics: [],
  }
}

function verificationPayload(sessionId: string): VerificationInspectSnapshot {
  return {
    status: 'ready',
    sessionId,
    cwd: `/repo/${sessionId}`,
    inspectedAt: 1,
    changedFiles: [],
    commands: [],
    requirements: [],
    policyEvents: [],
    diagnostics: [],
  }
}

describe('useContextStore', () => {
  beforeEach(() => {
    useContextStore.getState().reset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    useContextStore.getState().reset()
  })

  it('discards stale inspect and verification results after session switch', async () => {
    const inspectA = deferred<ContextInspectSnapshot>()
    const inspectB = deferred<ContextInspectSnapshot>()
    const verificationA = deferred<VerificationInspectSnapshot>()
    const verificationB = deferred<VerificationInspectSnapshot>()

    const invoke = vi.fn((channel: string, payload?: any) => {
      if (channel === 'context:inspect') {
        return payload.sessionId === 'session-a' ? inspectA.promise : inspectB.promise
      }
      if (channel === 'verification:inspect') {
        return payload.sessionId === 'session-a' ? verificationA.promise : verificationB.promise
      }
      throw new Error(`unexpected channel ${channel}`)
    })
    vi.stubGlobal('window', { electronAPI: { invoke } })

    const loadA = useContextStore.getState().loadProjectContext('session-a')
    const loadB = useContextStore.getState().loadProjectContext('session-b')

    inspectB.resolve(inspectPayload('session-b', 2))
    verificationB.resolve(verificationPayload('session-b'))
    await loadB

    expect(useContextStore.getState().inspect.data?.sessionId).toBe('session-b')
    expect(useContextStore.getState().verification.data?.sessionId).toBe('session-b')

    inspectA.resolve(inspectPayload('session-a', 1))
    verificationA.resolve(verificationPayload('session-a'))
    await loadA

    expect(useContextStore.getState().inspect.data?.sessionId).toBe('session-b')
    expect(useContextStore.getState().verification.data?.sessionId).toBe('session-b')
  })
})
