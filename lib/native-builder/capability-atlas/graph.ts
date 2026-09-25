import type { SkillRelationship, RelationshipKind } from './types'
import { RELATIONSHIP_KINDS } from './types'

export class SkillGraphError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkillGraphError'
  }
}

export function isRelationshipKind(value: string): value is RelationshipKind {
  return (RELATIONSHIP_KINDS as readonly string[]).includes(value)
}

export function relationshipId(from: string, kind: RelationshipKind, to: string): string {
  return `${from}--${kind}--${to}`
}

export function createRelationship(from: string, kind: RelationshipKind, to: string, note = ''): SkillRelationship {
  if (!isRelationshipKind(kind)) throw new SkillGraphError(`Unknown relationship kind: ${kind}`)
  if (from === to && kind === 'REQUIRES') throw new SkillGraphError(`Self-requirement refused: ${from}`)
  return { id: relationshipId(from, kind, to), from, kind, to, note }
}

export type GraphWalk = {
  order: string[]
  missing: string[]
  cycle: string[] | null
}

export function walkPrerequisites(
  skillId: string,
  relationships: SkillRelationship[],
  knownSkillIds: Set<string>,
): GraphWalk {
  const requires = relationships.filter(item => item.kind === 'REQUIRES')
  const edges = new Map<string, string[]>()
  for (const rel of requires) {
    const list = edges.get(rel.from) ?? []
    list.push(rel.to)
    edges.set(rel.from, list)
  }
  const order: string[] = []
  const missing: string[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  let cycle: string[] | null = null

  const visit = (id: string, stack: string[]): void => {
    if (cycle) return
    if (visiting.has(id)) {
      cycle = [...stack.slice(stack.indexOf(id)), id]
      return
    }
    if (visited.has(id)) return
    if (!knownSkillIds.has(id)) {
      missing.push(id)
      return
    }
    visiting.add(id)
    for (const next of edges.get(id) ?? []) visit(next, [...stack, id])
    visiting.delete(id)
    visited.add(id)
    order.push(id)
  }

  visit(skillId, [])
  return { order, missing, cycle }
}

export function relatedSkills(skillId: string, relationships: SkillRelationship[], kind?: RelationshipKind): string[] {
  return relationships
    .filter(item => item.from === skillId && (!kind || item.kind === kind))
    .map(item => item.to)
}
