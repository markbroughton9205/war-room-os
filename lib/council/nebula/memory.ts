import type { NebulaAgentId } from './identity'

/**
 * Nebula memory architecture — distinct scopes, not one giant vector store.
 * An agent conclusion is not global War Room truth. Promotion is explicit.
 */

export type NebulaMemoryScope =
  | 'working'
  | 'private'
  | 'council'
  | 'mission'
  | 'commander'
  | 'global'
  | 'constellation'

export const NEBULA_MEMORY_SCOPES: readonly NebulaMemoryScope[] = [
  'working',
  'private',
  'council',
  'mission',
  'commander',
  'global',
  'constellation',
]

export type NebulaMemoryKind =
  | 'episodic'
  | 'semantic'
  | 'procedural'
  | 'finding'
  | 'lesson'

export const NEBULA_MEMORY_KINDS: readonly NebulaMemoryKind[] = [
  'episodic',
  'semantic',
  'procedural',
  'finding',
  'lesson',
]

export type MemoryValidationState =
  | 'UNVERIFIED'
  | 'SUPPORTED'
  | 'VERIFIED'
  | 'DISPUTED'
  | 'REJECTED'
  | 'STALE'

export const MEMORY_VALIDATION_STATES: readonly MemoryValidationState[] = [
  'UNVERIFIED',
  'SUPPORTED',
  'VERIFIED',
  'DISPUTED',
  'REJECTED',
  'STALE',
]

export type MemorySourceRef = {
  kind: string
  locator: string
}

export type NebulaMemoryRecord = {
  memoryId: string
  ownerAgentId: NebulaAgentId | null
  scope: NebulaMemoryScope
  kind: NebulaMemoryKind
  sourceRefs: MemorySourceRef[]
  confidence: number | null
  validationState: MemoryValidationState
  supports: string[]
  contradicts: string[]
  supersedes: string[]
  createdAt: string
  validFrom: string
  validUntil: string | null
  expiresAt: string | null
  summary: string
}

export const DEFAULT_ALLOWED_SCOPES: Readonly<Record<NebulaAgentId, readonly NebulaMemoryScope[]>> = Object.freeze({
  aurora: ['working', 'private', 'council', 'mission'],
  nova: ['working', 'private', 'mission'],
  pulsar: ['working', 'private', 'mission'],
  phoenix: ['working', 'private', 'mission'],
  orion: ['working', 'private', 'mission'],
  lumen: ['working', 'private', 'mission', 'council'],
  solara: ['working', 'private', 'mission'],
  astra: ['working', 'private', 'mission', 'constellation'],
})

export function agentMayAccessMemoryScope(agentId: NebulaAgentId, scope: NebulaMemoryScope): boolean {
  if (scope === 'commander' || scope === 'global') return false
  return DEFAULT_ALLOWED_SCOPES[agentId].includes(scope)
}

export function agentMayWriteMemoryScope(agentId: NebulaAgentId, scope: NebulaMemoryScope): boolean {
  if (scope === 'global' || scope === 'commander') return false
  if (scope === 'council' && agentId !== 'aurora' && agentId !== 'lumen') return false
  if (scope === 'constellation' && agentId !== 'astra') return false
  return DEFAULT_ALLOWED_SCOPES[agentId].includes(scope)
}

export function createWorkingMemory(params: {
  memoryId: string
  ownerAgentId: NebulaAgentId
  summary: string
  createdAt: string
}): NebulaMemoryRecord {
  return {
    memoryId: params.memoryId,
    ownerAgentId: params.ownerAgentId,
    scope: 'working',
    kind: 'episodic',
    sourceRefs: [],
    confidence: null,
    validationState: 'UNVERIFIED',
    supports: [],
    contradicts: [],
    supersedes: [],
    createdAt: params.createdAt,
    validFrom: params.createdAt,
    validUntil: null,
    expiresAt: null,
    summary: params.summary,
  }
}

export function memoryScopesAreSeparated(): boolean {
  return NEBULA_MEMORY_SCOPES.length === 7 && new Set(NEBULA_MEMORY_SCOPES).size === 7
}
