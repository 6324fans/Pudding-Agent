import { describe, expect, it } from 'vitest'
import { createBrowserOpenTool } from '../tools/browser-open.js'
import { COMPUTER_USE_TOOL_NAMES, computerUseTestInternals, createComputerUseTools, isComputerUseToolName } from '../tools/computer-use.js'
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

  it('computer use exposes indexed UI targeting in tool schemas', () => {
    const tools = Object.fromEntries(createComputerUseTools().map(tool => [tool.definition.name, tool]))
    const getStateSchema = tools.computer_get_app_state.definition.inputSchema as any
    const clickSchema = tools.computer_click.definition.inputSchema as any
    const scrollSchema = tools.computer_scroll.definition.inputSchema as any

    expect(getStateSchema.properties.app).toBeTruthy()
    expect(getStateSchema.properties.max_elements).toBeTruthy()
    expect(clickSchema.properties.element_index).toBeTruthy()
    expect(clickSchema.required).toBeUndefined()
    expect(scrollSchema.properties.element_index).toBeTruthy()
  })

  it('computer use accessibility script scopes UI element traversal to System Events', () => {
    const script = computerUseTestInternals.buildAccessibilityTreeScript(3)

    expect(script).toContain('tell application "System Events" to set childElements to UI elements of theElement')
    expect(script).not.toContain('set childElements to UI elements of theElement')
    expect(script.some(line => line.includes('help of theElement'))).toBe(false)
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
