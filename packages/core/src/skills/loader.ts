import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import matter from 'gray-matter'
import type { SkillDefinition } from './types.js'

const GLOBAL_DIR = path.join(os.homedir(), '.puddingagent', 'skills')

function projectDir(cwd: string): string {
  return path.join(cwd, '.puddingagent', 'skills')
}

export class SkillLoader {
  private skills = new Map<string, SkillDefinition>()

  async loadAll(cwd: string): Promise<void> {
    this.skills.clear()
    await this.loadDir(GLOBAL_DIR, 'global')
    await this.loadDir(projectDir(cwd), 'project')
  }

  private async loadDir(dir: string, source: 'global' | 'project'): Promise<void> {
    let entries: string[]
    try { entries = await readdir(dir) } catch { return }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry)
      const st = await stat(fullPath).catch(() => null)
      if (!st) continue

      let filePath: string
      if (st.isDirectory()) {
        filePath = path.join(fullPath, 'SKILL.md')
        try { await stat(filePath) } catch { continue }
      } else if (entry.endsWith('.md')) {
        filePath = fullPath
      } else {
        continue
      }

      const skill = await this.parseSkill(filePath, source, fullPath, st.isDirectory() ? 'directory' : 'file')
      if (skill) this.skills.set(skill.name, skill)
    }
  }

  private async parseSkill(filePath: string, source: 'global' | 'project', entryPath: string, entryType: 'file' | 'directory'): Promise<SkillDefinition | null> {
    try {
      const raw = await readFile(filePath, 'utf-8')
      const { data, content } = matter(raw)
      const name = data.name || path.basename(filePath, '.md')
      return {
        name,
        description: data.description || '',
        content: content.trim(),
        userInvocable: data['user-invocable'] !== false,
        trigger: data.trigger,
        arguments: data.arguments || [],
        argumentHint: data['argument-hint'],
        allowedTools: data['allowed-tools'],
        source,
        filePath,
        entryPath,
        entryType,
      }
    } catch { return null }
  }

  async setInvocable(filePath: string, userInvocable: boolean): Promise<void> {
    const skill = this.findByFilePath(filePath)
    if (!skill) throw new Error('Skill not found')

    const raw = await readFile(skill.filePath, 'utf-8')
    const parsed = matter(raw)
    parsed.data['user-invocable'] = userInvocable
    await writeFile(skill.filePath, matter.stringify(parsed.content, parsed.data), 'utf-8')
    skill.userInvocable = userInvocable
  }

  async delete(filePath: string): Promise<void> {
    const skill = this.findByFilePath(filePath)
    if (!skill) throw new Error('Skill not found')

    await rm(skill.entryPath, { recursive: skill.entryType === 'directory', force: false })
    this.skills.delete(skill.name)
  }

  private findByFilePath(filePath: string): SkillDefinition | undefined {
    const target = path.resolve(filePath)
    return this.getAll().find(s => path.resolve(s.filePath) === target)
  }

  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name)
  }

  getAll(): SkillDefinition[] {
    return Array.from(this.skills.values())
  }

  getInvocable(): SkillDefinition[] {
    return this.getAll().filter(s => s.userInvocable)
  }
}

export function renderSkill(skill: SkillDefinition, args?: string): string {
  let content = skill.content
  if (args) {
    const parts = args.split(/\s+/)
    parts.forEach((part, i) => {
      content = content.replace(new RegExp(`\\$\\{${i + 1}\\}`, 'g'), part)
    })
  }
  return content
}
