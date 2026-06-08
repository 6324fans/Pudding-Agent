import { describe, expect, it } from 'vitest'
import { getToolCardKind, getToolFamily, formatToolLabel } from './tool-card-meta'

describe('tool-card-meta', () => {
  it('classifies Pudding snake_case tool names', () => {
    expect(getToolFamily('grep')).toBe('search')
    expect(getToolCardKind('grep')).toBe('search')
    expect(getToolCardKind('file_read')).toBe('read')
    expect(getToolCardKind('file_edit')).toBe('edit')
    expect(getToolCardKind('file_write')).toBe('write')
    expect(getToolCardKind('multi_edit')).toBe('multi-edit')
    expect(getToolCardKind('notebook_edit')).toBe('notebook-edit')
    expect(getToolCardKind('web_search')).toBe('external')
    expect(getToolCardKind('task_create')).toBe('task')
    expect(getToolCardKind('todo_write')).toBe('task')
  })

  it('recognizes MCP tool names', () => {
    expect(getToolFamily('mcp__filesystem__read_file')).toBe('mcp')
    expect(getToolCardKind('mcp__filesystem__read_file')).toBe('mcp')
  })

  it('formats labels without introducing a JDC family', () => {
    expect(getToolFamily('gitnexus_query')).toBe('context')
    expect(formatToolLabel('team_add_task')).toBe('TEAM ADD TASK')
  })
})
