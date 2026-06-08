import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODEL_CAPABILITY_PROFILE_ID,
  resolveModelCapabilityProfile,
  strictToolGroundingProfile,
} from '../src/model-profile.js'

describe('resolveModelCapabilityProfile', () => {
  it('uses the default profile when no profiles are configured', () => {
    const profile = resolveModelCapabilityProfile({ modelId: 'anything' })
    expect(profile.id).toBe(DEFAULT_MODEL_CAPABILITY_PROFILE_ID)
    expect(profile.maxParallelToolCalls).toBe(5)
    expect(profile.requireStepwiseVerification).toBe(false)
  })

  it('matches provider and model patterns and clamps parallel calls', () => {
    const profile = resolveModelCapabilityProfile({
      providerId: 'work',
      modelId: 'strict-model-v1',
      profiles: [
        {
          ...strictToolGroundingProfile({
            id: 'strict',
            providerPattern: 'work',
            modelPattern: 'strict-*',
          }),
          maxParallelToolCalls: 99,
        },
      ],
    })
    expect(profile.id).toBe('strict')
    expect(profile.evidenceStrictness).toBe('strict')
    expect(profile.maxParallelToolCalls).toBe(5)
  })

  it('lets explicit override win', () => {
    const profiles = [
      strictToolGroundingProfile({ id: 'strict', providerPattern: '*', modelPattern: 'strict-*' }),
      {
        ...strictToolGroundingProfile({ id: 'override', providerPattern: '*', modelPattern: '*' }),
        evidenceStrictness: 'relaxed' as const,
      },
    ]
    const profile = resolveModelCapabilityProfile({
      providerId: 'any',
      modelId: 'strict-model',
      overrideProfileId: 'override',
      profiles,
    })
    expect(profile.id).toBe('override')
    expect(profile.evidenceStrictness).toBe('relaxed')
  })
})
