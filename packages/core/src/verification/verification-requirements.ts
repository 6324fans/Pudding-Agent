import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { VerificationKind } from './verification-ledger.js'

export type VerificationRequirementKind = VerificationKind | 'diff_check'
export type VerificationRequirementStatus = 'pending' | 'passed' | 'failed' | 'skipped' | 'unavailable'

export interface WorkspacePackageInfo {
  path: string
  name: string
}

export interface VerificationRequirement {
  id: string
  kind: VerificationRequirementKind
  command: string
  status: VerificationRequirementStatus
  files: string[]
  reason: string
  workspacePackages?: WorkspacePackageInfo[]
}

export interface VerificationRequirementPlan {
  cwd: string
  changedFiles: string[]
  workspacePackages: WorkspacePackageInfo[]
  requirements: VerificationRequirement[]
}

export async function deriveVerificationRequirements(input: {
  cwd: string
  changedFiles: string[]
  userMessage?: string
}): Promise<VerificationRequirementPlan> {
  const changedFiles = unique(input.changedFiles.map((file) => normalizePath(file, input.cwd)).filter(Boolean))
  const workspacePackages = await readWorkspacePackages(input.cwd)
  if (changedFiles.length === 0) return { cwd: input.cwd, changedFiles, workspacePackages, requirements: [] }

  const packageInfo = await readRootPackageInfo(input.cwd)
  const packageManager = detectPackageManager(input.cwd)
  const requirements: VerificationRequirement[] = []

  if (isDocsOnly(changedFiles)) {
    requirements.push(withWorkspacePackages({
      id: 'verify_diff_check',
      kind: 'diff_check',
      command: 'git diff --check',
      status: 'pending',
      files: changedFiles,
      reason: 'Documentation-only changes require whitespace/conflict-marker verification.',
    }, workspacePackages))
    return { cwd: input.cwd, changedFiles, workspacePackages, requirements }
  }

  if (hasCodeChange(changedFiles)) {
    requirements.push(scriptRequirement({
      id: 'verify_test',
      kind: 'test',
      scriptName: 'test',
      packageManager,
      scripts: packageInfo.scripts,
      files: changedFiles,
      workspacePackages,
      missingReason: 'No test script found in package.json.',
    }))
    requirements.push(scriptRequirement({
      id: 'verify_build',
      kind: 'build',
      scriptName: 'build',
      packageManager,
      scripts: packageInfo.scripts,
      files: changedFiles,
      workspacePackages,
      missingReason: 'No build script found in package.json.',
    }))
  }

  if (hasTypeScriptChange(changedFiles)) {
    requirements.push(scriptRequirement({
      id: 'verify_typecheck',
      kind: 'typecheck',
      scriptName: 'typecheck',
      packageManager,
      scripts: packageInfo.scripts,
      files: changedFiles,
      workspacePackages,
      missingReason: 'No typecheck script found in package.json.',
    }))
  }

  if (changesPackageOrConfig(changedFiles) && packageInfo.scripts.build && !requirements.some((requirement) => requirement.kind === 'build')) {
    requirements.push(scriptRequirement({
      id: 'verify_build',
      kind: 'build',
      scriptName: 'build',
      packageManager,
      scripts: packageInfo.scripts,
      files: changedFiles,
      workspacePackages,
      missingReason: 'No build script found in package.json.',
    }))
  }

  return { cwd: input.cwd, changedFiles, workspacePackages, requirements: dedupeRequirements(requirements) }
}

async function readRootPackageInfo(cwd: string): Promise<{ scripts: Record<string, string> }> {
  try {
    const raw = await readFile(path.join(cwd, 'package.json'), 'utf-8')
    const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> }
    const scripts: Record<string, string> = {}
    for (const [name, command] of Object.entries(parsed.scripts ?? {})) {
      if (typeof command === 'string') scripts[name] = command
    }
    return { scripts }
  } catch {
    return { scripts: {} }
  }
}

async function readWorkspacePackages(cwd: string): Promise<WorkspacePackageInfo[]> {
  const packagesDir = path.join(cwd, 'packages')
  if (!existsSync(packagesDir)) return []

  try {
    const { readdir } = await import('node:fs/promises')
    const entries = await readdir(packagesDir, { withFileTypes: true })
    const packageInfos = await Promise.all(entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry): Promise<WorkspacePackageInfo | undefined> => {
        const packagePath = path.join('packages', entry.name)
        try {
          const raw = await readFile(path.join(cwd, packagePath, 'package.json'), 'utf-8')
          const parsed = JSON.parse(raw) as { name?: unknown }
          return typeof parsed.name === 'string' && parsed.name.length > 0
            ? { path: packagePath, name: parsed.name }
            : undefined
        } catch {
          return undefined
        }
      }))
    return packageInfos.filter((info): info is WorkspacePackageInfo => Boolean(info))
  } catch {
    return []
  }
}

function scriptRequirement(input: {
  id: string
  kind: VerificationRequirementKind
  scriptName: string
  packageManager: string
  scripts: Record<string, string>
  files: string[]
  workspacePackages: WorkspacePackageInfo[]
  missingReason: string
}): VerificationRequirement {
  const hasScript = typeof input.scripts[input.scriptName] === 'string' && input.scripts[input.scriptName].trim().length > 0
  return withWorkspacePackages({
    id: input.id,
    kind: input.kind,
    command: scriptCommand(input.packageManager, input.scriptName),
    status: hasScript ? 'pending' : 'unavailable',
    files: input.files,
    reason: hasScript ? `${input.scriptName} script covers changed files.` : input.missingReason,
  }, input.workspacePackages)
}

function withWorkspacePackages(requirement: Omit<VerificationRequirement, 'workspacePackages'>, workspacePackages: WorkspacePackageInfo[]): VerificationRequirement {
  return workspacePackages.length > 0 ? { ...requirement, workspacePackages } : requirement
}

function scriptCommand(packageManager: string, scriptName: string): string {
  if (packageManager === 'npm' && !['test', 'start', 'stop', 'restart'].includes(scriptName)) {
    return `npm run ${scriptName}`
  }
  if (packageManager === 'bun') return `bun run ${scriptName}`
  return `${packageManager} ${scriptName}`
}

function detectPackageManager(cwd: string): 'pnpm' | 'yarn' | 'bun' | 'npm' {
  if (existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn'
  if (existsSync(path.join(cwd, 'bun.lockb')) || existsSync(path.join(cwd, 'bun.lock'))) return 'bun'
  return 'npm'
}

function hasCodeChange(files: string[]): boolean {
  return files.some((file) => /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|py|rs|go|java|kt|swift|css|scss|vue|svelte)$/i.test(file))
}

function hasTypeScriptChange(files: string[]): boolean {
  return files.some((file) => /\.(ts|tsx|mts|cts)$/i.test(file))
}

function changesPackageOrConfig(files: string[]): boolean {
  return files.some((file) => /(^|\/)(package\.json|tsconfig[^/]*\.json|vite\.config\.[^/]+|vitest\.config\.[^/]+|eslint\.config\.[^/]+)$/i.test(file))
}

function isDocsOnly(files: string[]): boolean {
  return files.length > 0 && files.every((file) => /\.(md|mdx|txt|rst|adoc)$/i.test(file) || file.startsWith('docs/'))
}

function normalizePath(file: string, cwd: string): string {
  const normalized = file.replace(/\\/g, '/')
  const cwdNormalized = cwd.replace(/\\/g, '/').replace(/\/$/, '')
  return normalized.startsWith(`${cwdNormalized}/`)
    ? normalized.slice(cwdNormalized.length + 1)
    : normalized.replace(/^\.\//, '')
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function dedupeRequirements(requirements: VerificationRequirement[]): VerificationRequirement[] {
  const seen = new Set<string>()
  const out: VerificationRequirement[] = []
  for (const requirement of requirements) {
    const key = `${requirement.kind}:${requirement.command}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(requirement)
  }
  return out
}
