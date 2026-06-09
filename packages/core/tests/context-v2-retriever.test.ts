import { describe, expect, it } from 'vitest'
import { formatContextSection, retrieveContextFacts } from '../src/context-v2/retriever.js'
import type { ContextFact } from '../src/context-v2/types.js'

function fact(input: Partial<ContextFact> & Pick<ContextFact, 'id' | 'kind' | 'content'>): ContextFact {
  return {
    projectKey: '/repo',
    scope: 'project',
    citations: [],
    source: 'test',
    createdAt: 1,
    updatedAt: 1,
    ...input,
  }
}

describe('context-v2 retriever', () => {
  it('sorts by relevance and preserves citations', () => {
    const result = retrieveContextFacts({
      userMessage: 'How should invoice tax migration work?',
      now: () => 10,
      facts: [
        fact({ id: 'generic', kind: 'project', content: 'The repository uses TypeScript.' }),
        fact({
          id: 'invoice',
          kind: 'project',
          title: 'Invoice tax migration',
          content: 'Invoice tax migration must preserve JDC compatibility.',
          citations: [{ id: 'invoice-doc', type: 'file', ref: 'docs/invoice.md' }],
          tags: ['invoice', 'tax'],
          confidence: 0.95,
        }),
      ],
    })

    expect(result.facts.map((item) => item.fact.id)).toEqual(['invoice'])
    expect(result.section).not.toBeNull()
    expect(formatContextSection(result.section!)).toContain('[invoice-doc] file:docs/invoice.md')
  })

  it('respects token budget and reports dropped tokens', () => {
    const result = retrieveContextFacts({
      userMessage: 'billing',
      tokenBudget: 35,
      facts: [
        fact({ id: 'small', kind: 'project', content: 'Billing uses a compact release checklist.', tags: ['billing'] }),
        fact({ id: 'large', kind: 'project', content: `Billing ${'details '.repeat(200)}`, tags: ['billing'] }),
      ],
    })

    expect(result.facts.map((item) => item.fact.id)).toEqual(['small'])
    expect(result.usedTokens).toBeLessThanOrEqual(35)
    expect(result.droppedTokens).toBeGreaterThan(0)
  })
})
