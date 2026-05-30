import type { SkillLoader } from '../skills/loader.js'
import type { ToolContext, ToolHandler, ToolResult } from '../tool-registry.js'

export function createSkillListTool(loader: SkillLoader): ToolHandler {
  return {
    definition: {
      name: 'skill_list',
      description: 'List skills currently loaded for this session, including global and project skills. Use this before invoking Skill when you need to discover available skills.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    async execute(_input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const skills = loader.getAll()
      if (skills.length === 0) {
        return {
          content:
            'No skills are currently loaded. Skills can be installed globally in ~/.puddingagent/skills or per-project in <project>/.puddingagent/skills. Create a markdown file or a directory containing SKILL.md.',
        }
      }

      const lines = skills
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(s => `- ${s.name} (${s.source}): ${s.description || 'No description'}${s.argumentHint ? ` Args: ${s.argumentHint}` : ''}\n  File: ${s.filePath}`)
      return { content: lines.join('\n') }
    },
  }
}
