import { NextResponse } from 'next/server'
import {
  loadCapabilityAtlas,
  getSkill,
  buildCapabilityScoreboard,
  persistScoreboard,
  resolveMissionSkills,
  assessMissionCapabilities,
  readDiscoverySummary,
} from '@/lib/native-builder/capability-atlas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const query = (url.searchParams.get('q') ?? '').trim()
  const skillId = (url.searchParams.get('skill') ?? '').trim()
  const mission = (url.searchParams.get('mission') ?? '').trim()
  const atlas = loadCapabilityAtlas()
  const scoreboard = persistScoreboard(atlas)
  const needle = query.toLowerCase()
  const skills = [...atlas.skills.values()]
    .filter(skill => {
      if (!needle) return skill.capabilityStatus !== 'DISCOVERED' || skill.capabilityClass !== 'DISCOVERED_TAXONOMY'
      return `${skill.skillId} ${skill.name} ${skill.description} ${skill.frameworks.join(' ')}`.toLowerCase().includes(needle)
    })
    .sort((a, b) => a.skillId.localeCompare(b.skillId))
    .slice(0, 80)
    .map(skill => ({
      skillId: skill.skillId,
      name: skill.name,
      capabilityStatus: skill.capabilityStatus,
      confidence: skill.confidence,
      domain: skill.domain,
    }))
  const skill = skillId ? getSkill(atlas, skillId) : null
  const detail = skill
    ? {
        skill,
        sources: [...atlas.sources.values()].filter(source => source.skillIds.includes(skill.skillId) || skill.officialSources.includes(source.sourceId)),
        evaluations: [...atlas.evaluations.values()].filter(item => item.skillId === skill.skillId),
        relationships: atlas.relationships.filter(item => item.from === skill.skillId || item.to === skill.skillId),
      }
    : null
  return NextResponse.json({
    scoreboard: scoreboard ?? buildCapabilityScoreboard(atlas),
    skills,
    detail,
    query,
    resolution: mission || query ? resolveMissionSkills(atlas, mission || query) : null,
    capabilityAssessment: mission || query
      ? assessMissionCapabilities({ missionText: mission || query, atlas })
      : null,
    discoverySummary: readDiscoverySummary(),
  })
}
