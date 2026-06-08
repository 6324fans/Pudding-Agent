import path from 'node:path'
import type { VerificationRequirement, WorkspacePackageInfo } from './verification-requirements.js'

export type VerificationKind = 'build' | 'test' | 'typecheck' | 'lint' | 'diff_check'
export type VerificationCommandStatus = 'passed' | 'failed'
export type ChangedFileVerificationStatus = 'pending' | 'verified' | 'failed'
export type VerificationRequirementStatus = VerificationRequirement['status']

export interface ChangedFileRecord {
  filePath: string
  changedByToolUseId: string
  changedAt: number
  status: ChangedFileVerificationStatus
  verifiedByToolUseId?: string
  verificationFailure?: string
  updatedAt: number
}

export interface VerificationCommandRecord {
  toolUseId: string
  command: string
  kind: VerificationKind
  status: VerificationCommandStatus
  output: string
  createdAt: number
}

export interface VerificationRequirementRecord extends VerificationRequirement {
  kind: VerificationKind
  coveredChangedAt: number
  satisfiedByToolUseId?: string
  failure?: string
  updatedAt?: number
}

export class VerificationLedger {
  private changedFiles = new Map<string, ChangedFileRecord>()
  private commands: VerificationCommandRecord[] = []
  private requirements = new Map<string, VerificationRequirementRecord>()
  private now: () => number
  private cwd?: string
  private workspacePackages: WorkspacePackageInfo[]

  constructor(options: { now?: () => number; cwd?: string; workspacePackages?: WorkspacePackageInfo[] } = {}) {
    this.now = options.now ?? Date.now
    this.cwd = options.cwd
    this.workspacePackages = options.workspacePackages ?? []
  }

  setWorkspacePackages(workspacePackages: WorkspacePackageInfo[]): void {
    this.workspacePackages = workspacePackages
  }

  recordMutation(input: { filePath: string; toolUseId: string }): ChangedFileRecord {
    const timestamp = this.now()
    const record: ChangedFileRecord = {
      filePath: normalizePath(input.filePath, this.cwd),
      changedByToolUseId: input.toolUseId,
      changedAt: timestamp,
      status: 'pending',
      updatedAt: timestamp,
    }
    this.changedFiles.set(record.filePath, record)
    return record
  }

  recordCommand(input: {
    toolUseId: string
    command: string
    kind: VerificationKind
    status: VerificationCommandStatus
    output: string
  }): VerificationCommandRecord {
    const record: VerificationCommandRecord = {
      toolUseId: input.toolUseId,
      command: input.command,
      kind: input.kind,
      status: input.status,
      output: input.output,
      createdAt: this.now(),
    }
    this.commands.push(record)
    this.applyCommandToPendingChanges(record)
    this.applyCommandToRequirements(record)
    return record
  }

  setRequirements(requirements: VerificationRequirement[]): void {
    const nextIds = new Set(requirements.map((requirement) => requirement.id))
    for (const existingId of this.requirements.keys()) {
      if (!nextIds.has(existingId)) this.requirements.delete(existingId)
    }

    const workspacePackages = requirements.find((requirement) => requirement.workspacePackages?.length)?.workspacePackages
    if (workspacePackages) this.setWorkspacePackages(workspacePackages)

    for (const requirement of requirements) {
      const normalizedRequirement = {
        ...requirement,
        files: requirement.files.map((file) => normalizePath(file, this.cwd)),
      }
      const coveredChangedAt = this.requirementChangedAt(normalizedRequirement)
      const existing = this.requirements.get(requirement.id)
      if (existing && existing.status === 'passed' && sameRequirementWork(existing, normalizedRequirement, coveredChangedAt, this.workspacePackages)) continue
      this.requirements.set(requirement.id, {
        ...normalizedRequirement,
        kind: requirement.kind,
        coveredChangedAt,
        updatedAt: this.now(),
      })
      for (const command of this.commands) {
        if (command.createdAt >= coveredChangedAt) {
          this.applyCommandToRequirement(this.requirements.get(requirement.id)!, command)
        }
      }
    }
  }

  getRequirements(): VerificationRequirementRecord[] {
    return [...this.requirements.values()]
  }

  getPendingRequirements(): VerificationRequirementRecord[] {
    return this.getRequirements().filter((requirement) => requirement.status === 'pending')
  }

  getUnavailableRequirements(): VerificationRequirementRecord[] {
    return this.getRequirements().filter((requirement) => requirement.status === 'unavailable')
  }

  getChangedFiles(): ChangedFileRecord[] {
    return [...this.changedFiles.values()]
  }

  getCommands(): VerificationCommandRecord[] {
    return [...this.commands]
  }

  clear(): void {
    this.changedFiles.clear()
    this.commands = []
    this.requirements.clear()
  }

  private applyCommandToPendingChanges(command: VerificationCommandRecord): void {
    for (const record of this.changedFiles.values()) {
      if (record.changedAt > command.createdAt) continue

      record.updatedAt = this.now()
      if (command.status === 'passed') {
        record.status = 'verified'
        record.verifiedByToolUseId = command.toolUseId
        delete record.verificationFailure
      } else {
        record.status = 'failed'
        record.verificationFailure = command.output.slice(0, 500)
      }
    }
  }

  private applyCommandToRequirements(command: VerificationCommandRecord): void {
    for (const requirement of this.requirements.values()) {
      this.applyCommandToRequirement(requirement, command)
    }
  }

  private applyCommandToRequirement(requirement: VerificationRequirementRecord, command: VerificationCommandRecord): void {
    if (requirement.kind !== command.kind || !commandsCoverSameScript(requirement.command, command.command, requirement.files, this.workspacePackages)) return

    requirement.updatedAt = this.now()
    requirement.satisfiedByToolUseId = command.toolUseId
    if (command.status === 'passed') {
      requirement.status = 'passed'
      delete requirement.failure
    } else {
      requirement.status = 'failed'
      requirement.failure = command.output.slice(0, 500)
    }
  }

  private requirementChangedAt(requirement: VerificationRequirement): number {
    const changedAtValues = requirement.files
      .map((filePath) => this.changedFiles.get(filePath)?.changedAt)
      .filter((changedAt): changedAt is number => typeof changedAt === 'number')
    if (changedAtValues.length === 0) return Number.NEGATIVE_INFINITY
    return Math.max(...changedAtValues)
  }
}

function sameRequirementWork(
  existing: VerificationRequirementRecord,
  next: VerificationRequirement,
  coveredChangedAt: number,
  workspacePackages: WorkspacePackageInfo[]
): boolean {
  return existing.kind === next.kind
    && commandsCoverSameScript(existing.command, next.command, next.files, workspacePackages)
    && existing.coveredChangedAt === coveredChangedAt
    && sameStringArray(existing.files, next.files)
}

function commandsCoverSameScript(
  requirementCommand: string,
  actualCommand: string,
  files: string[],
  workspacePackages: WorkspacePackageInfo[]
): boolean {
  if (requirementCommand === actualCommand) return true
  const requirement = parsePackageScriptCommand(requirementCommand)
  const actual = parsePackageScriptCommand(actualCommand)
  if (!requirement || !actual || requirement.script !== actual.script) return false
  return packageFiltersCoverFiles(actual.filters, files, workspacePackages)
}

function parsePackageScriptCommand(command: string): { manager: string; script: string; filters: string[] } | undefined {
  const segments = command.trim().replace(/\s+/g, ' ').split('&&').map((part) => part.trim()).filter(Boolean)
  let cwdFilter: string | undefined

  for (const segment of segments) {
    const cdMatch = segment.match(/^cd (?<path>(?:\.\/)?packages\/[^\s/&|;]+)(?:\s|$)/)
    if (cdMatch?.groups?.path) {
      cwdFilter = packageScopeForPackagePath(cdMatch.groups.path)
      continue
    }

    const normalizedSegment = segment.replace(/^corepack\s+/, '')
    if (!/^(pnpm|npm|yarn|bun)\b/.test(normalizedSegment)) continue
    const tokens = normalizedSegment.split(' ')
    const manager = tokens[0]
    const filters: string[] = cwdFilter ? [cwdFilter] : []
    let script: string | undefined
    for (let index = 1; index < tokens.length; index += 1) {
      const token = tokens[index]
      if (token === '--filter' && tokens[index + 1]) {
        filters.push(tokens[index + 1])
        index += 1
        continue
      }
      if (token.startsWith('--filter=')) {
        filters.push(token.slice('--filter='.length))
        continue
      }
      if (token === 'run') continue
      if (!token.startsWith('-')) {
        script = token
        break
      }
    }
    if (script && ['build', 'test', 'typecheck', 'lint'].includes(script)) return { manager, script, filters }
  }

  return undefined
}

function packageFiltersCoverFiles(filters: string[], files: string[], workspacePackages: WorkspacePackageInfo[]): boolean {
  if (filters.length === 0) return true
  const requiredPackages = new Set(files.map((file) => packageScopeForFile(file, workspacePackages)).filter((scope): scope is string => Boolean(scope)))
  if (requiredPackages.size === 0) return true
  for (const requiredPackage of requiredPackages) {
    if (!filters.some((filter) => packageFilterMatchesScope(filter, requiredPackage))) return false
  }
  return true
}

function packageScopeForFile(filePath: string, workspacePackages: WorkspacePackageInfo[]): string | undefined {
  const normalized = filePath.replace(/\\/g, '/')
  const match = normalized.match(/^packages\/([^/]+)\//)
  if (!match) return undefined
  const packagePath = `packages/${match[1]}`
  return workspacePackages.find((workspacePackage) => workspacePackage.path === packagePath)?.name ?? match[1]
}

function packageScopeForPackagePath(packagePath: string): string | undefined {
  const normalized = packagePath.replace(/^\.\//, '').replace(/\\/g, '/')
  const match = normalized.match(/^packages\/([^/]+)$/)
  return match ? match[1] : undefined
}

function packageFilterMatchesScope(filter: string, scope: string): boolean {
  const normalized = filter.replace(/^['"]|['"]$/g, '')
  if (normalized === scope) return true
  const unscoped = scope.split('/').at(-1)
  return Boolean(unscoped && (normalized === unscoped || normalized === `./packages/${unscoped}` || normalized === `packages/${unscoped}`))
}

function normalizePath(filePath: string, cwd?: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  if (!cwd || !path.isAbsolute(filePath)) return normalized.replace(/^\.\//, '')
  const relative = path.relative(cwd, filePath).replace(/\\/g, '/')
  return relative.startsWith('..') ? normalized : relative
}

function sameStringArray(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}
