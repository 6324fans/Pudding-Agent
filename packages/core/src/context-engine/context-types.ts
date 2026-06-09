export type ContextEvidenceRequirementKind = 'relevant_code' | 'runtime_or_code' | 'diff_or_relevant_code' | 'project_doc' | 'repo_map'
export type ContextEvidenceRequirementPriority = 'must' | 'should'
export type ContextEvidenceRequirementStatus = 'missing' | 'satisfied'

export interface ContextEvidenceRequirement {
  id: string
  kind: ContextEvidenceRequirementKind
  reason: string
  query: string
  priority: ContextEvidenceRequirementPriority
  relatedFiles: string[]
  relatedSymbols: string[]
  docRefs: string[]
  languageHints: string[]
  status?: ContextEvidenceRequirementStatus
}
