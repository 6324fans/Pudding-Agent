import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useTerminalStore } from '../stores/terminal-store'
import { IconX } from './icons'
import 'xterm/css/xterm.css'

interface Props {
  cwd: string
}

export function TerminalPanel({ cwd }: Props) {
  const visible = useTerminalStore((s) => s.visible)
  const height = useTerminalStore((s) => s.height)
  const terminalId = useTerminalStore((s) => s.terminalId)
  const hide = useTerminalStore((s) => s.hide)
  const setHeight = useTerminalStore((s) => s.setHeight)
  const setTerminalId = useTerminalStore((s) => s.setTerminalId)

  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const terminalIdRef = useRef<string | null>(null)
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)

  useEffect(() => {
    if (!visible || !containerRef.current) return

    let disposed = false
    let createdTerminalId: string | null = null
    let inputDisposable: { dispose: () => void } | null = null

    const term = new Terminal({
      fontSize: 13,
      fontFamily: 'var(--font-mono), Menlo, monospace',
      theme: {
        background: '#1a1a1a',
        foreground: '#e0e0e0',
        cursor: '#7c8aff',
      },
      cursorBlink: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    requestAnimationFrame(() => {
      if (!disposed) fit.fit()
    })

    termRef.current = term
    fitRef.current = fit

    // Create pty
    window.electronAPI?.terminalCreate(cwd).then((result: { id: string; error?: string }) => {
      if (disposed) {
        if (result.id) window.electronAPI?.terminalDestroy(result.id)
        return
      }

      if (result.error) {
        term.write(`\r\n[终端启动失败] ${result.error}\r\n`)
        return
      }

      createdTerminalId = result.id
      terminalIdRef.current = result.id
      setTerminalId(result.id)

      inputDisposable = term.onData((data) => {
        window.electronAPI?.terminalWrite(result.id, data)
      })

      fit.fit()
      window.electronAPI?.terminalResize(result.id, term.cols, term.rows)
    })

    // Listen for pty output
    const unsub = window.electronAPI?.onTerminalData((payload: { id: string; data: string }) => {
      if (payload.id !== createdTerminalId) return
      term.write(payload.data)
    })

    const unsubExit = window.electronAPI?.onTerminalExit((payload: { id: string; code: number }) => {
      if (payload.id !== createdTerminalId) return
      term.write('\r\n[进程已退出]\r\n')
      terminalIdRef.current = null
      setTerminalId(null)
    })

    return () => {
      disposed = true
      unsub?.()
      unsubExit?.()
      inputDisposable?.dispose()
      const id = createdTerminalId || terminalIdRef.current
      if (id) window.electronAPI?.terminalDestroy(id)
      terminalIdRef.current = null
      setTerminalId(null)
      term.dispose()
      if (termRef.current === term) termRef.current = null
      if (fitRef.current === fit) fitRef.current = null
    }
  }, [visible, cwd, setTerminalId])

  // Fit on resize or height change
  useEffect(() => {
    if (!visible || !fitRef.current || !termRef.current) return
    fitRef.current.fit()
    const id = terminalId
    if (id) {
      const { cols, rows } = termRef.current
      window.electronAPI?.terminalResize(id, cols, rows)
    }
  }, [visible, height, terminalId])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (terminalIdRef.current) window.electronAPI?.terminalDestroy(terminalIdRef.current)
      termRef.current?.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [])

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startY: e.clientY, startH: height }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const delta = dragRef.current.startY - ev.clientY
      setHeight(dragRef.current.startH + delta)
    }
    const onUp = () => {
      dragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [height, setHeight])

  if (!visible) return null

  return (
    <div className="flex flex-col border-t border-[var(--border)]" style={{ height }}>
      {/* Drag handle */}
      <div
        onMouseDown={onDragStart}
        className="h-1 cursor-row-resize hover:bg-[var(--accent)]/30 transition-colors"
      />
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-[var(--border)] bg-[var(--surface)]">
        <span className="text-[11px] text-[var(--muted)] font-mono">终端</span>
        <button
          onClick={hide}
          className="p-0.5 rounded text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]"
        >
          <IconX size={12} />
        </button>
      </div>
      {/* Terminal container */}
      <div ref={containerRef} className="flex-1 overflow-hidden bg-[#1a1a1a]" />
    </div>
  )
}
