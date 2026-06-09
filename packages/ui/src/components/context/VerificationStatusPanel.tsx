import type { VerificationInspectSnapshot } from '../../lib/ipc-client'
import type { ContextRequestState } from '../../stores/context-store'
import { LongText, Metric, PanelHeader, PanelState, StatusPill } from './ContextCurrentPanel'

export function VerificationStatusPanel({ verification, onReload }: {
  verification: ContextRequestState<VerificationInspectSnapshot>
  onReload: () => void
}) {
  if (verification.loading) return <PanelState title="正在读取验证状态" message="验证台账" />
  if (verification.error) return <PanelState title="验证状态暂不可用" message={verification.error} />
  if (!verification.data) return <PanelState title="暂无验证状态" message="验证台账" />

  const snapshot = verification.data
  const pendingFiles = snapshot.changedFiles.filter((file) => file.status !== 'verified')
  const pendingRequirements = snapshot.requirements.filter((requirement) => requirement.status !== 'passed')

  return (
    <section className="space-y-3">
      <PanelHeader title="验证" actionLabel="刷新" onAction={onReload} />
      {snapshot.status === 'unavailable' && (
        <PanelState title="验证台账暂不可用" message={snapshot.diagnostics[0] ?? '验证台账暂不可用'} />
      )}

      <div className="grid grid-cols-3 gap-2">
        <Metric label="待验证" value={pendingFiles.length} />
        <Metric label="命令" value={snapshot.commands.length} />
        <Metric label="策略" value={snapshot.policyEvents.length} />
      </div>

      <ChangedFiles files={pendingFiles} />
      <Requirements requirements={pendingRequirements} />
      <Commands commands={snapshot.commands} />
      <PolicyEvents events={snapshot.policyEvents} />
    </section>
  )
}

function ChangedFiles({ files }: { files: VerificationInspectSnapshot['changedFiles'] }) {
  return (
    <section className="space-y-2">
      <PanelHeader title="待验证文件" />
      {files.length === 0 ? (
        <p className="text-[12px] text-[var(--muted)]">暂无待验证文件</p>
      ) : (
        <div className="space-y-1.5">
          {files.map((file) => (
            <article key={file.filePath} className="min-w-0 rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-mono text-[11px] text-[var(--text)]" title={file.filePath}>{file.filePath}</div>
                  <div className="mt-0.5 text-[10px] text-[var(--muted)]">工具 {file.changedByToolUseId || '未知'}</div>
                </div>
                <StatusPill tone={file.status === 'failed' ? 'bad' : 'warn'}>{verificationStatusLabel(file.status)}</StatusPill>
              </div>
              {file.verificationFailure && <LongText text={file.verificationFailure} />}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function Requirements({ requirements }: { requirements: VerificationInspectSnapshot['requirements'] }) {
  if (requirements.length === 0) return null

  return (
    <section className="space-y-2">
      <PanelHeader title="验证要求" />
      <div className="space-y-1.5">
        {requirements.map((requirement) => (
          <article key={requirement.id} className="min-w-0 rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="break-words font-mono text-[11px] text-[var(--text)] [overflow-wrap:anywhere]">{requirement.command}</div>
                <div className="mt-0.5 text-[10px] tracking-[0.08em] text-[var(--muted)]">{verificationKindLabel(requirement.kind)}</div>
              </div>
              <StatusPill tone={requirement.status === 'failed' ? 'bad' : 'warn'}>{verificationStatusLabel(requirement.status)}</StatusPill>
            </div>
            {requirement.files.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {requirement.files.map((file) => (
                  <span key={file} className="max-w-full truncate rounded-[4px] border border-[var(--border)] bg-[var(--bg)] px-1.5 py-1 font-mono text-[10px] text-[var(--muted)]" title={file}>
                    {file.split('/').pop()}
                  </span>
                ))}
              </div>
            )}
            {requirement.failure && <LongText text={requirement.failure} />}
          </article>
        ))}
      </div>
    </section>
  )
}

function Commands({ commands }: { commands: VerificationInspectSnapshot['commands'] }) {
  return (
    <section className="space-y-2">
      <PanelHeader title="验证命令" />
      {commands.length === 0 ? (
        <p className="text-[12px] text-[var(--muted)]">暂无验证命令</p>
      ) : (
        <div className="space-y-1.5">
          {commands.slice().reverse().slice(0, 8).map((command) => (
            <article key={command.toolUseId || `${command.command}-${command.createdAt}`} className="min-w-0 rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="break-words font-mono text-[11px] text-[var(--text)] [overflow-wrap:anywhere]">{command.command}</div>
                  <div className="mt-0.5 text-[10px] tracking-[0.08em] text-[var(--muted)]">{verificationKindLabel(command.kind)}</div>
                </div>
                <StatusPill tone={command.status === 'passed' ? 'good' : 'bad'}>{verificationStatusLabel(command.status)}</StatusPill>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function PolicyEvents({ events }: { events: VerificationInspectSnapshot['policyEvents'] }) {
  if (events.length === 0) return null

  return (
    <section className="space-y-2">
      <PanelHeader title="策略事件" />
      <div className="space-y-1.5">
        {events.slice().reverse().slice(0, 8).map((event) => (
          <article key={event.id} className="min-w-0 rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="break-words text-[11px] text-[var(--text)] [overflow-wrap:anywhere]">{event.toolName}</div>
                <div className="mt-0.5 text-[10px] tracking-[0.08em] text-[var(--muted)]">{policySourceLabel(event.source)} · {policyPhaseLabel(event.phase)}</div>
              </div>
              <StatusPill tone={event.decision === 'block' ? 'bad' : 'warn'}>{policyDecisionLabel(event.decision)}</StatusPill>
            </div>
            {event.reason && <LongText text={event.reason} />}
          </article>
        ))}
      </div>
    </section>
  )
}

function verificationStatusLabel(status: string): string {
  switch (status) {
    case 'verified':
    case 'passed': return '已通过'
    case 'failed': return '失败'
    case 'pending': return '待验证'
    case 'running': return '运行中'
    case 'skipped': return '已跳过'
    default: return status
  }
}

function verificationKindLabel(kind: string): string {
  switch (kind) {
    case 'build': return '构建'
    case 'test': return '测试'
    case 'typecheck': return '类型检查'
    case 'lint': return 'Lint'
    case 'manual': return '手动'
    case 'unknown': return '未知'
    default: return kind
  }
}

function policySourceLabel(source: string): string {
  switch (source) {
    case 'safety-policy': return '安全策略'
    case 'permissions': return '权限'
    default: return source
  }
}

function policyPhaseLabel(phase: string): string {
  switch (phase) {
    case 'pre_tool_use': return '工具调用前'
    case 'post_tool_use': return '工具调用后'
    default: return phase
  }
}

function policyDecisionLabel(decision: string): string {
  switch (decision) {
    case 'warn': return '警告'
    case 'block': return '阻止'
    case 'allow': return '允许'
    default: return decision
  }
}
