import { useCallback, useEffect, useState } from 'react'

export type CodegraphStatus = 'hidden' | 'idle' | 'indexing' | 'ready' | 'error'

interface CodegraphState {
  status: CodegraphStatus
  progress: string
  error: string
  initialized: boolean
  run: () => Promise<void>
  refresh: () => Promise<void>
}

function getApi() {
  return (window as any).electronAPI?.codegraphApi
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-9;]*[a-zA-Z]|\x1B\[[0-9]*[GHKJ]|\r/g, '').trim()
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return typeof err === 'string' ? err : '代码图谱索引失败'
}

export function useCodegraph(cwd: string): CodegraphState {
  const [status, setStatus] = useState<CodegraphStatus>('hidden')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const api = getApi()
    if (!api || !cwd) {
      setStatus('hidden')
      setProgress('')
      setError('')
      return
    }

    const unsubState = api.onState?.((state: { cwd: string; initialized: boolean }) => {
      if (state.cwd !== cwd) return
      setStatus(state.initialized ? 'ready' : 'idle')
      setProgress('')
      setError('')
    })
    const unsubProgress = api.onInitProgress?.((event: { cwd: string; line: string }) => {
      if (event.cwd !== cwd) return
      setStatus('indexing')
      setError('')
      const clean = stripAnsi(event.line || '')
      if (clean) setProgress(clean.length > 52 ? `${clean.slice(0, 49)}...` : clean)
    })

    api.refreshState?.(cwd)?.catch((err: unknown) => {
      setStatus('error')
      setError(errorMessage(err))
    })

    return () => {
      unsubState?.()
      unsubProgress?.()
    }
  }, [cwd])

  const refresh = useCallback(async () => {
    const api = getApi()
    if (!api || !cwd) return
    await api.refreshState(cwd)
  }, [cwd])

  const run = useCallback(async () => {
    const api = getApi()
    if (!api || !cwd || status === 'indexing') return
    setStatus('indexing')
    setProgress('')
    setError('')
    try {
      if (status === 'ready') {
        await api.reindex(cwd)
      } else {
        await api.init(cwd)
      }
      await api.refreshState(cwd)
    } catch (err) {
      setStatus('error')
      setError(errorMessage(err))
    }
  }, [cwd, status])

  return {
    status,
    progress,
    error,
    initialized: status === 'ready',
    run,
    refresh,
  }
}
