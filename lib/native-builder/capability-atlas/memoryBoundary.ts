/**
 * General Atlas skill knowledge stays separate from War Room Engineering Memory.
 * Repo truth always wins.
 */
import type { CapabilityAtlas } from './store'
import type { SkillPack } from './types'
import { compactMemoryHits, ensureEngineeringMemoryBootstrap, recallEngineeringFacts } from '../foundryEngineeringMemory'

export const ENGINEERING_MEMORY_BOUNDARY = {
  atlasOwns: 'GENERAL_SKILL_KNOWLEDGE',
  memoryOwns: 'WAR_ROOM_REPO_TRUTH',
  conflictPolicy: 'REPO_TRUTH_WINS',
  wrimTraining: false,
} as const

export function skillPackOmitsRepoFacts(pack: SkillPack): boolean {
  const blob = JSON.stringify(pack)
  return !/desktop\/src\/main\.cjs owns/i.test(blob)
}

export async function recallRepoTruthForSkill(query: string): Promise<{
  source: 'ENGINEERING_MEMORY'
  compact: string
  atlasDidNotAuthor: true
}> {
  const store = await ensureEngineeringMemoryBootstrap()
  const facts = recallEngineeringFacts(store, query)
  return {
    source: 'ENGINEERING_MEMORY',
    compact: compactMemoryHits(facts).slice(0, 1200),
    atlasDidNotAuthor: true,
  }
}

export function assertMemoryNotCopiedIntoAtlas(atlas: CapabilityAtlas): string[] {
  const violations: string[] = []
  for (const skill of atlas.skills.values()) {
    if (/owns War Room Electron process startup/i.test(skill.description)) {
      violations.push(skill.skillId)
    }
  }
  return violations
}
