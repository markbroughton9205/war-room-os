import { loadCapabilityAtlas, getSkill, registerSkill, type CapabilityAtlas } from './store'
import { resolveMissionSkills, buildSkillPack, detectSkillGaps } from './resolver'
import { buildCapabilityScoreboard, persistScoreboard } from './scoreboard'
import { selfKnowledgeBundle } from './selfKnowledge'
import { planSkillAcquisition } from './acquisition'
import { catalogExistingResearchArtifacts, NEXT_RESEARCH_MISSION } from './researchCatalog'
import { readDiscoverySummary } from './discoveryEngine'
import { findTaxonomyNodes, loadTaxonomy } from './taxonomy'
import type { SkillRecord } from './types'
import { discoveredSkillsFromTaxonomy } from './discoveredSkills'
import { importSkillMarkdown, importSkillMarkdownFile } from '../foundrySkillImporter'

export const CAPABILITY_ATLAS_TOOL_NAMES = [
  'capability.scoreboard',
  'capability.query',
  'capability.resolve',
  'capability.pack',
  'capability.inspect',
  'capability.gap',
  'capability.self_knowledge',
  'capability.import_skill',
] as const

export type CapabilityAtlasToolName = (typeof CAPABILITY_ATLAS_TOOL_NAMES)[number]

export function isCapabilityAtlasToolName(value: string): value is CapabilityAtlasToolName {
  return (CAPABILITY_ATLAS_TOOL_NAMES as readonly string[]).includes(value)
}

let cached: CapabilityAtlas | null = null

function atlas(): CapabilityAtlas {
  cached ??= loadCapabilityAtlas()
  persistScoreboard(cached)
  return cached
}

export function executeCapabilityAtlasTool(
  tool: CapabilityAtlasToolName,
  input: Record<string, unknown>,
): { ok: boolean; result?: unknown; error?: string } {
  try {
    const store = atlas()
    if (tool === 'capability.scoreboard') {
      return { ok: true, result: { scoreboard: buildCapabilityScoreboard(store), nextResearchMission: NEXT_RESEARCH_MISSION, discoverySummary: readDiscoverySummary() } }
    }
    if (tool === 'capability.query') {
      const q = String(input.query ?? '')
      const hits = q
        ? [...store.skills.values()].filter(skill => `${skill.skillId} ${skill.name} ${skill.description}`.toLowerCase().includes(q.toLowerCase()))
        : [...store.skills.values()].filter(skill => skill.capabilityStatus !== 'DISCOVERED')
      const taxonomy = findTaxonomyNodes(q)
      return { ok: true, result: { skills: hits.slice(0, 40), taxonomy: taxonomy.slice(0, 20) } }
    }
    if (tool === 'capability.resolve') {
      const mission = String(input.mission ?? input.query ?? '')
      if (!mission) return { ok: false, error: 'mission required' }
      return { ok: true, result: resolveMissionSkills(store, mission) }
    }
    if (tool === 'capability.pack') {
      const skillId = String(input.skillId ?? '')
      const pack = buildSkillPack(store, skillId)
      if (!pack) return { ok: false, error: `Unknown skill: ${skillId}` }
      return { ok: true, result: pack }
    }
    if (tool === 'capability.inspect') {
      const skillId = String(input.skillId ?? '')
      const skill = getSkill(store, skillId)
      if (!skill) return { ok: false, error: `Unknown skill: ${skillId}` }
      const sources = [...store.sources.values()].filter(source => source.skillIds.includes(skillId) || skill.officialSources.includes(source.sourceId))
      const evaluations = [...store.evaluations.values()].filter(item => item.skillId === skillId)
      const relationships = store.relationships.filter(item => item.from === skillId || item.to === skillId)
      return { ok: true, result: { skill, sources, evaluations, relationships, taxonomy: loadTaxonomy().find(node => node.id === skillId) ?? null } }
    }
    if (tool === 'capability.gap') {
      const mission = String(input.mission ?? '')
      if (!mission) return { ok: false, error: 'mission required' }
      const gaps = detectSkillGaps(store, mission)
      return { ok: true, result: { gaps, acquisition: gaps.map(planSkillAcquisition) } }
    }
    if (tool === 'capability.self_knowledge') {
      return {
        ok: true,
        result: {
          ...selfKnowledgeBundle(store, typeof input.mission === 'string' ? input.mission : undefined),
          researchArtifacts: catalogExistingResearchArtifacts(),
          taxonomyNodeCount: loadTaxonomy().length,
          discoveredLeafCount: discoveredSkillsFromTaxonomy().length,
        },
      }
    }
    if (tool === 'capability.import_skill') {
      const content = typeof input.content === 'string' ? input.content : null
      const filePath = typeof input.path === 'string' ? input.path : typeof input.file === 'string' ? input.file : null
      if (!content && !filePath) return { ok: false, error: 'capability.import_skill requires path or content' }
      const imported = content
        ? importSkillMarkdown({
            content,
            originPath: filePath ?? 'inline:SKILL.md',
            sourceLabel: typeof input.source === 'string' ? input.source : 'commander-import',
            license: typeof input.license === 'string' ? input.license : undefined,
            persist: input.persist !== false,
          })
        : importSkillMarkdownFile(filePath!, {
            sourceLabel: typeof input.source === 'string' ? input.source : 'commander-import',
            license: typeof input.license === 'string' ? input.license : undefined,
            persist: input.persist !== false,
          })
      cached = null
      if (imported.automaticallyProven !== false || imported.capabilityStatus === 'PROVEN' || imported.capabilityStatus === 'PRODUCTION_PROVEN') {
        return { ok: false, error: 'Imported SKILL.md must not become PROVEN automatically.' }
      }
      return { ok: true, result: imported }
    }
    return { ok: false, error: `Unknown capability tool: ${tool}` }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function resetCapabilityAtlasCache(): void {
  cached = null
}

export type { SkillRecord }
