// System-prompt segment describing the experimental Pudding Context Engine tools.

export interface ContextEnginePromptSegment {
  segment: string
  cacheable: true
}

export function getContextEnginePromptSegment(): ContextEnginePromptSegment {
  return {
    cacheable: true,
    segment: [
      '## Pudding Context Engine (experimental code intelligence)',
      '',
      'Pudding Context Engine is an experimental in-process Tree-sitter index for read-only code intelligence.',
      'It exposes these model tools when the feature flag is enabled:',
      '',
      '- `ContextSearch` - search symbols by name.',
      '- `ContextNode` - inspect one symbol, its callers, and its callees.',
      '- `ContextImpact` - inspect static caller impact for a symbol.',
      '- `ContextFiles` - inspect indexed files and symbol counts.',
      '',
      'The index is project-local, stored under `.puddingagent/context-engine/`, and coexists with CodeGraph.',
      'Coverage includes TS/TSX/JS/Python/Go/Rust/Java/C/C++/Ruby/PHP. The call graph is static and name-based, so verify ambiguous symbols by file and line.',
    ].join('\n'),
  }
}
