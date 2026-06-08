import { describe, expect, it } from 'vitest'
import { resolveConfiguredModel, type ConfiguredModelGroup } from '../src/model-resolution.js'

const groups: ConfiguredModelGroup[] = [
  {
    id: 'work',
    name: 'Work',
    protocol: 'openai',
    models: [
      { id: 'entry-a', modelId: 'same-api', name: 'Shared Name' },
      { id: 'entry-b', modelId: 'unique-api', name: 'Unique Display' },
    ],
  },
  {
    id: 'lab',
    name: 'Lab',
    protocol: 'anthropic',
    models: [
      { id: 'entry-c', modelId: 'same-api', name: 'Shared Name' },
    ],
  },
]

describe('resolveConfiguredModel', () => {
  it('resolves composite groupId:modelId', () => {
    const result = resolveConfiguredModel(groups, 'lab:same-api')
    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') {
      expect(result.model.groupId).toBe('lab')
      expect(result.model.modelEntryId).toBe('entry-c')
      expect(result.model.modelId).toBe('same-api')
    }
  })

  it('resolves by entry id, API model id, and display name', () => {
    const byEntry = resolveConfiguredModel(groups, 'entry-b')
    expect(byEntry.status).toBe('resolved')
    if (byEntry.status === 'resolved') expect(byEntry.model.modelId).toBe('unique-api')

    const byApi = resolveConfiguredModel(groups, 'unique-api')
    expect(byApi.status).toBe('resolved')
    if (byApi.status === 'resolved') expect(byApi.model.modelEntryId).toBe('entry-b')

    const byName = resolveConfiguredModel(groups, 'Unique Display')
    expect(byName.status).toBe('resolved')
    if (byName.status === 'resolved') expect(byName.model.modelEntryId).toBe('entry-b')
  })

  it('returns ambiguous for duplicate API ids or display names', () => {
    const byApi = resolveConfiguredModel(groups, 'same-api')
    expect(byApi.status).toBe('ambiguous')
    if (byApi.status === 'ambiguous') {
      expect(byApi.matches.map(m => `${m.groupId}:${m.modelId}`)).toEqual(['work:same-api', 'lab:same-api'])
    }

    const byName = resolveConfiguredModel(groups, 'Shared Name')
    expect(byName.status).toBe('ambiguous')
    if (byName.status === 'ambiguous') expect(byName.matches).toHaveLength(2)
  })

  it('returns not_found when the group or model does not exist', () => {
    expect(resolveConfiguredModel(groups, 'missing').status).toBe('not_found')
    expect(resolveConfiguredModel(groups, 'missing:same-api').status).toBe('not_found')
    expect(resolveConfiguredModel(groups, 'work:missing').status).toBe('not_found')
  })
})
