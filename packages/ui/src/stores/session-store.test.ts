import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from './session-store'

function setElectronTasks(tasks: Array<{ id: string; subject: string; description: string; status: string }>) {
  const invoke = vi.fn().mockResolvedValue(tasks)
  vi.stubGlobal('window', {
    electronAPI: {
      invoke,
    },
  })
  return invoke
}

async function waitForMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('useSessionStore task refresh', () => {
  beforeEach(() => {
    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessionStates: {},
      tasks: [],
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('refreshes active session tasks when task_create completes', async () => {
    const tasks = [{ id: '1', subject: 'Created', description: '', status: 'pending' }]
    const invoke = setElectronTasks(tasks)

    useSessionStore.getState().addToolEvent('session-1', {
      type: 'complete',
      toolName: 'task_create',
      toolUseId: 'tool-1',
      result: { content: 'created' },
    })
    await waitForMicrotasks()

    expect(invoke).toHaveBeenCalledWith('session:get-tasks', { sessionId: 'session-1' })
    expect(useSessionStore.getState().tasks).toEqual(tasks)
  })

  it('refreshes active session tasks when TaskUpdate completes', async () => {
    const tasks = [{ id: '1', subject: 'Updated', description: '', status: 'completed' }]
    const invoke = setElectronTasks(tasks)

    useSessionStore.getState().addToolEvent('session-1', {
      type: 'complete',
      toolName: 'TaskUpdate',
      toolUseId: 'tool-2',
      result: { content: 'updated' },
    })
    await waitForMicrotasks()

    expect(invoke).toHaveBeenCalledWith('session:get-tasks', { sessionId: 'session-1' })
    expect(useSessionStore.getState().tasks).toEqual(tasks)
  })

  it('does not refresh tasks for inactive sessions', async () => {
    const invoke = setElectronTasks([{ id: '1', subject: 'Other', description: '', status: 'pending' }])

    useSessionStore.getState().addToolEvent('session-2', {
      type: 'complete',
      toolName: 'task_update',
      toolUseId: 'tool-3',
      result: { content: 'updated' },
    })
    await waitForMicrotasks()

    expect(invoke).not.toHaveBeenCalled()
    expect(useSessionStore.getState().tasks).toEqual([])
  })
})
