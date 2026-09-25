import type { CapabilityAtlas } from './store'
import type { CapabilityScoreboard, CapabilityStatus } from './types'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { capabilityAtlasLayout } from './store'

export function buildCapabilityScoreboard(atlas: CapabilityAtlas): CapabilityScoreboard {
  const counts: Record<CapabilityStatus, number> = {
    DISCOVERED: 0,
    SOURCE_BACKED: 0,
    LEARNABLE: 0,
    AVAILABLE: 0,
    EVALUATION_PENDING: 0,
    EVALUATED: 0,
    PROVEN: 0,
    PRODUCTION_PROVEN: 0,
    STALE: 0,
    FAILED: 0,
    UNSUPPORTED: 0,
  }
  const languages = new Set<string>()
  const domains = new Set<string>()
  for (const skill of atlas.skills.values()) {
    counts[skill.capabilityStatus] += 1
    for (const language of skill.languages) languages.add(language.toLowerCase())
    domains.add(skill.domain)
    if (skill.skillId.startsWith('software.languages.')) languages.add(skill.name.toLowerCase())
  }
  for (const node of atlas.taxonomy) {
    if (node.id.startsWith('software.languages.') && node.parentId === 'software.languages') languages.add(node.name.toLowerCase())
    if (!node.parentId) domains.add(node.id)
  }
  const board: CapabilityScoreboard = {
    skillsRegistered: atlas.skills.size,
    sourceBacked: counts.SOURCE_BACKED + counts.LEARNABLE + counts.AVAILABLE + counts.EVALUATION_PENDING + counts.EVALUATED + counts.PROVEN + counts.PRODUCTION_PROVEN,
    evaluated: counts.EVALUATED + counts.PROVEN + counts.PRODUCTION_PROVEN,
    proven: counts.PROVEN + counts.PRODUCTION_PROVEN,
    productionProven: counts.PRODUCTION_PROVEN,
    stale: counts.STALE,
    failed: counts.FAILED,
    unknown: counts.DISCOVERED,
    unsupported: counts.UNSUPPORTED,
    available: counts.AVAILABLE,
    discovered: counts.DISCOVERED,
    learnable: counts.LEARNABLE,
    evaluationPending: counts.EVALUATION_PENDING,
    languagesCovered: languages.size,
    domainsCovered: domains.size,
    lastUpdated: atlas.updatedAt,
  }
  return board
}

export function persistScoreboard(atlas: CapabilityAtlas): CapabilityScoreboard {
  const board = buildCapabilityScoreboard(atlas)
  const layout = capabilityAtlasLayout()
  mkdirSync(layout.status, { recursive: true })
  writeFileSync(path.join(layout.status, 'scoreboard.json'), JSON.stringify(board, null, 2), 'utf8')
  return board
}
