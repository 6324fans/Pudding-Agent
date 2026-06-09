import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ContextCitation, RepoWikiEntry, RepoWikiEvidencePacket, RepoWikiGeneratedBy, RepoWikiModelOutput } from '../types.js'
import { RepoWikiModelOutputSchema } from './schemas.js'
import type { RepoWikiEvidenceBundle } from './evidence.js'
import type { RepoWikiModelClient, RepoWikiModelRequest } from './model-client.js'

export interface GenerateRepoWikiInput {
  cwd: string
  projectKey: string
  evidence: RepoWikiEvidenceBundle
  modelClient: RepoWikiModelClient
  model: RepoWikiGeneratedBy
  modelRequest?: Omit<RepoWikiModelRequest, 'cwd' | 'evidence' | 'modelId'>
  store?: {
    saveRepoWikiEntries(entries: RepoWikiEntry[]): Promise<{ savedEntries: number; diagnostics: string[] }>
  }
  now?: () => number
}

export interface GenerateRepoWikiResult {
  entries: RepoWikiEntry[]
  diagnostics: string[]
}

export async function generateRepoWikiEntries(input: GenerateRepoWikiInput): Promise<GenerateRepoWikiResult> {
  const now = input.now ?? Date.now
  const createdAt = now()
  const raw = await completeModel(input)
  if (!raw.ok) return { entries: [], diagnostics: [raw.message] }

  const output = parseRepoWikiModelOutput(raw.value)
  if (!output.ok) return { entries: [], diagnostics: [output.message] }
  if (output.value.action === 'skip') {
    return { entries: [], diagnostics: [`Repo Wiki generation skipped: ${output.value.reason ?? 'model skipped'}`] }
  }

  const validation = validateRepoWikiModelOutput(output.value, input.evidence, input.projectKey, input.model, createdAt, input.cwd)
  if (validation.entries.length === 0) {
    return {
      entries: [],
      diagnostics: validation.diagnostics.length ? validation.diagnostics : ['Repo Wiki model output produced no valid sections.'],
    }
  }

  if (!input.store) return validation

  try {
    const saved = await input.store.saveRepoWikiEntries(validation.entries)
    return {
      entries: validation.entries,
      diagnostics: [...validation.diagnostics, ...saved.diagnostics],
    }
  } catch (error) {
    return {
      entries: validation.entries,
      diagnostics: [...validation.diagnostics, `Repo Wiki persistence failed without blocking foreground chat: ${error instanceof Error ? error.message : String(error)}`],
    }
  }
}

export function parseRepoWikiModelOutput(raw: string): { ok: true; value: RepoWikiModelOutput } | { ok: false; message: string } {
  try {
    const parsedJson = JSON.parse(extractJsonObject(raw)) as unknown
    const parsed = RepoWikiModelOutputSchema.safeParse(parsedJson)
    if (!parsed.success) return { ok: false, message: `Repo Wiki model output schema-invalid: ${parsed.error.message}` }
    return { ok: true, value: parsed.data }
  } catch (error) {
    return { ok: false, message: `Repo Wiki model output schema-invalid: ${error instanceof Error ? error.message : String(error)}` }
  }
}

export function validateRepoWikiModelOutput(
  output: RepoWikiModelOutput,
  evidence: RepoWikiEvidenceBundle,
  projectKey: string,
  model: RepoWikiGeneratedBy,
  createdAt: number,
  cwd = projectKey,
): GenerateRepoWikiResult {
  const packetsById = new Map(evidence.packets.map((packet) => [packet.id, packet]))
  const diagnostics: string[] = []
  const entries: RepoWikiEntry[] = []

  for (const section of output.sections) {
    if (containsHiddenReasoning(section.content) || containsHiddenReasoning(section.summary ?? '')) {
      diagnostics.push(`Rejected Repo Wiki section "${section.title}" because content contains hidden reasoning markers.`)
      continue
    }

    const missing = section.citationPacketIds.filter((id) => !packetsById.has(id))
    if (missing.length) {
      diagnostics.push(`Rejected Repo Wiki section "${section.title}" because it cited unknown citation packet ${missing.join(', ')}.`)
      continue
    }

    const citedPackets = section.citationPacketIds.map((id) => packetsById.get(id)).filter((packet): packet is RepoWikiEvidencePacket => Boolean(packet))
    if (citedPackets.some((packet) => packet.ref === 'code-index')) {
      diagnostics.push(`Rejected Repo Wiki section "${section.title}" because code-index is orientation context and cannot be used as a final citation.`)
      continue
    }

    if (citedPackets.length === 0 || citedPackets.some((packet) => !packet.hash)) {
      diagnostics.push(`Rejected Repo Wiki section "${section.title}" because every saved section must cite hashed file evidence.`)
      continue
    }

    let invalidCitation: { packet: RepoWikiEvidencePacket; reason: string } | undefined
    for (const packet of citedPackets) {
      const reason = validateCitationPacket(packet, cwd)
      if (reason) {
        invalidCitation = { packet, reason }
        break
      }
    }
    if (invalidCitation) {
      diagnostics.push(`Rejected Repo Wiki section "${section.title}" because citation ${invalidCitation.packet.ref} ${invalidCitation.reason}.`)
      continue
    }

    const citations = citedPackets.map((packet, index) => citationFromPacket(packet, section.title, index, createdAt))
    entries.push({
      id: stableWikiId(section.kind, section.title, section.citationPacketIds),
      projectKey,
      kind: section.kind,
      title: section.title,
      content: section.content,
      ...(section.summary ? { summary: section.summary } : {}),
      citations,
      relatedFiles: unique([...section.relatedFiles, ...citations.map((citation) => citation.ref)]),
      relatedSymbols: unique(section.relatedSymbols),
      confidence: section.confidence,
      freshness: 'cached',
      generatedBy: model,
      evidenceHash: evidence.evidenceHash,
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    })
  }

  return { entries, diagnostics }
}

async function completeModel(input: GenerateRepoWikiInput): Promise<{ ok: true; value: string } | { ok: false; message: string }> {
  try {
    const raw = await input.modelClient.completeRepoWiki({
      cwd: input.cwd,
      evidence: input.evidence,
      modelId: input.model.modelId,
      modelConfig: input.modelRequest?.modelConfig ?? { model: input.model.modelId, maxTokens: 8_000 },
      cacheUser: input.modelRequest?.cacheUser ?? cacheUserForProject(input.projectKey),
      signal: input.modelRequest?.signal,
    })
    return { ok: true, value: raw }
  } catch (error) {
    return { ok: false, message: `Repo Wiki generation failed without blocking foreground chat: ${error instanceof Error ? error.message : String(error)}` }
  }
}

function citationFromPacket(packet: RepoWikiEvidencePacket, title: string, index: number, timestamp: number): ContextCitation {
  return {
    id: `repo_wiki_cit_${createHash('sha1').update(`${title}:${packet.id}:${index}`).digest('hex').slice(0, 16)}`,
    type: packet.ref.endsWith('package.json') ? 'package' : 'file',
    ref: packet.ref,
    line: packet.line,
    timestamp,
    hash: packet.hash,
  }
}

function extractJsonObject(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1] ?? raw
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('Repo Wiki model output did not contain a JSON object')
  return candidate.slice(start, end + 1)
}

function containsHiddenReasoning(content: string): boolean {
  return /chain[- ]of[- ]thought|hidden reasoning|scratchpad|<thinking>|<\/thinking>|raw thinking/i.test(content)
}

function validateCitationPacket(packet: RepoWikiEvidencePacket, cwd: string): string | undefined {
  if (packet.ref === 'code-index') return undefined
  const absolute = path.join(cwd, packet.ref)
  if (!existsSync(absolute)) return 'references a missing citation file'
  let content: string
  try {
    content = readFileSync(absolute, 'utf-8')
  } catch (error) {
    return `could not be read: ${error instanceof Error ? error.message : String(error)}`
  }
  const sha256 = createHash('sha256').update(content).digest('hex')
  return packet.hash !== sha256 ? 'has a stale hash mismatch' : undefined
}

function cacheUserForProject(projectKey: string): string {
  return `repo_wiki_${createHash('sha256').update(projectKey).digest('hex')}`
}

function stableWikiId(kind: string, title: string, packetIds: string[]): string {
  return `repo_wiki_${createHash('sha1').update([kind, title, ...packetIds].join('\u0000')).digest('hex').slice(0, 16)}`
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}
