import { describe, expect, it } from 'vitest'
import { createBrowserOpenTool } from '../tools/browser-open.js'
import { COMPUTER_USE_TOOL_NAMES, createComputerUseTools, isComputerUseToolName } from '../tools/computer-use.js'
import { createSkillListTool } from '../tools/skill-list.js'

describe('host capability tools', () => {
  it('browser_open validates URL protocols', async () => {
    const opened: string[] = []
    const tool = createBrowserOpenTool((url) => { opened.push(url) })

    const invalid = await tool.execute({ url: 'file:///etc/passwd' }, { cwd: '/' })
    expect(invalid.isError).toBe(true)
    expect(opened).toHaveLength(0)

    const valid = await tool.execute({ url: 'https://example.com/path' }, { cwd: '/' })
    expect(valid.isError).toBeUndefined()
    expect(opened).toEqual(['https://example.com/path'])
  })

  it('computer use exposes the expected host control tools', () => {
    const tools = createComputerUseTools()
    const names = tools.map(tool => tool.definition.name)

    expect(names).toEqual([...COMPUTER_USE_TOOL_NAMES])
    expect(names.every(isComputerUseToolName)).toBe(true)
    expect(tools.every(tool => tool.definition.inputSchema.type === 'object')).toBe(true)
  })

  it('skill_list reports empty skill state clearly', async () => {
    const loader = { getInvocable: () => [] } as any
    const tool = createSkillListTool(loader)

    const result = await tool.execute({}, { cwd: '/' })

    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('No invocable skills are currently loaded')
  })

  it('skill_list renders available skills', async () => {
    const loader = {
      getInvocable: () => [{
        name: 'weather-helper',
        description: 'Answer weather questions',
        userInvocable: true,
        source: 'global',
        filePath: '/tmp/weather-helper/SKILL.md',
      }],
    } as any
    const tool = createSkillListTool(loader)

    const result = await tool.execute({}, { cwd: '/' })

    expect(result.content).toContain('weather-helper')
    expect(result.content).toContain('/tmp/weather-helper/SKILL.md')
  })
})
