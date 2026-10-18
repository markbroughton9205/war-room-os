import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { foundryDataHierarchy } from '../foundryPaths'
import type {
  AtlasIndex,
  EvaluationRecord,
  SkillRecord,
  SkillRelationship,
  SourceHistoryEntry,
  SourceRecord,
  TaxonomyNode,
} from './types'
import { loadTaxonomy } from './taxonomy'
import { applyDerivedStatus } from './status'
import { appendSourceHistory } from './sources'
import { createRelationship } from './graph'
import { NEXT_RESEARCH_MISSION } from './researchCatalog'
import { buildSeedSkills, seedOfficialSources, seedRelationships } from './bootstrap'
import { discoveredSkillsFromTaxonomy } from './discoveredSkills'

export type CapabilityAtlasLayout = {
  root: string
  index: string
  domains: string
  skills: string
  sources: string
  evaluations: string
  relationships: string
  status: string
  manifests: string
  sourceHistory: string
}

export type CapabilityAtlas = {
  taxonomy: TaxonomyNode[]
  skills: Map<string, SkillRecord>
  sources: Map<string, SourceRecord>
  evaluations: Map<string, EvaluationRecord>
  relationships: SkillRelationship[]
  sourceHistory: SourceHistoryEntry[]
  updatedAt: string
}

export class SkillRegistryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkillRegistryError'
  }
}

export function capabilityAtlasLayout(root = process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT): CapabilityAtlasLayout {
  const atlasRoot = root && root.trim() ? root : path.join(foundryDataHierarchy().foundryRoot, 'capability-atlas')
  const layout: CapabilityAtlasLayout = {
    root: atlasRoot,
    index: path.join(atlasRoot, 'index.json'),
    domains: path.join(atlasRoot, 'domains'),
    skills: path.join(atlasRoot, 'skills'),
    sources: path.join(atlasRoot, 'sources'),
    evaluations: path.join(atlasRoot, 'evaluations'),
    relationships: path.join(atlasRoot, 'relationships'),
    status: path.join(atlasRoot, 'status'),
    manifests: path.join(atlasRoot, 'manifests'),
    sourceHistory: path.join(atlasRoot, 'source-history'),
  }
  for (const dir of [layout.root, layout.domains, layout.skills, layout.sources, layout.evaluations, layout.relationships, layout.status, layout.manifests, layout.sourceHistory]) {
    mkdirSync(dir, { recursive: true })
  }
  return layout
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
}

function overlayRecords<T extends { [k: string]: unknown }>(dir: string, idKey: string): Map<string, T> {
  const out = new Map<string, T>()
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue
      const rec = readJson<T | null>(path.join(dir, name), null)
      if (rec && typeof rec === 'object' && typeof rec[idKey] === 'string') out.set(String(rec[idKey]), rec)
    }
  } catch {
    /* empty overlay */
  }
  return out
}

export function emptyAtlas(): CapabilityAtlas {
  return {
    taxonomy: loadTaxonomy(),
    skills: new Map(),
    sources: new Map(),
    evaluations: new Map(),
    relationships: [],
    sourceHistory: [],
    updatedAt: new Date().toISOString(),
  }
}

export function seedAtlas(): CapabilityAtlas {
  const atlas = emptyAtlas()
  for (const source of seedOfficialSources()) atlas.sources.set(source.sourceId, source)
  for (const skill of discoveredSkillsFromTaxonomy()) atlas.skills.set(skill.skillId, skill)
  for (const skill of buildSeedSkills()) atlas.skills.set(skill.skillId, skill)
  atlas.relationships = seedRelationships()
  refreshDerived(atlas)
  return atlas
}

function refreshDerived(atlas: CapabilityAtlas): void {
  const sources = [...atlas.sources.values()]
  const evaluations = [...atlas.evaluations.values()]
  for (const [id, skill] of atlas.skills) {
    const skillSources = sources.filter(source => source.skillIds.includes(id) || skill.officialSources.includes(source.sourceId) || skill.openSourceSources.includes(source.sourceId))
    atlas.skills.set(id, applyDerivedStatus(skill, evaluations.filter(item => item.skillId === id), skillSources))
  }
  atlas.updatedAt = new Date().toISOString()
}

export function loadCapabilityAtlas(): CapabilityAtlas {
  const layout = capabilityAtlasLayout()
  const atlas = seedAtlas()
  for (const [id, rec] of overlayRecords<SkillRecord>(layout.skills, 'skillId')) atlas.skills.set(id, rec)
  for (const [id, rec] of overlayRecords<SourceRecord>(layout.sources, 'sourceId')) {
    const existing = atlas.sources.get(id)
    atlas.sources.set(id, existing ? { ...existing, ...rec, sourceId: existing.sourceId } : rec)
  }
  for (const [id, rec] of overlayRecords<EvaluationRecord>(layout.evaluations, 'evaluationId')) atlas.evaluations.set(id, rec)
  const relOverlay = readJson<SkillRelationship[]>(path.join(layout.relationships, 'index.json'), [])
  if (relOverlay.length) {
    const byId = new Map(atlas.relationships.map(item => [item.id, item]))
    for (const rel of relOverlay) byId.set(rel.id, rel)
    atlas.relationships = [...byId.values()]
  }
  const historyFile = path.join(layout.sourceHistory, 'history.jsonl')
  if (existsSync(historyFile)) {
    const lines = readFileSync(historyFile, 'utf8').split('\n').filter(Boolean)
    atlas.sourceHistory = lines.map(line => JSON.parse(line) as SourceHistoryEntry)
  }
  refreshDerived(atlas)
  persistIndex(atlas, layout)
  return atlas
}

function persistIndex(atlas: CapabilityAtlas, layout = capabilityAtlasLayout()): void {
  const index: AtlasIndex = {
    version: 1,
    updatedAt: atlas.updatedAt,
    skillIds: [...atlas.skills.keys()].sort(),
    sourceIds: [...atlas.sources.keys()].sort(),
    evaluationIds: [...atlas.evaluations.keys()].sort(),
    relationshipIds: atlas.relationships.map(item => item.id).sort(),
    domainIds: atlas.taxonomy.map(item => item.id),
  }
  writeJson(layout.index, index)
  writeJson(path.join(layout.domains, 'taxonomy.json'), atlas.taxonomy)
  writeJson(path.join(layout.manifests, 'next-research-mission.json'), NEXT_RESEARCH_MISSION)
}

export function persistSkill(atlas: CapabilityAtlas, skill: SkillRecord): void {
  const layout = capabilityAtlasLayout()
  writeJson(path.join(layout.skills, `${skill.skillId.replace(/[^\w.-]+/g, '_')}.json`), skill)
  atlas.skills.set(skill.skillId, skill)
  refreshDerived(atlas)
  persistIndex(atlas, layout)
}

export function persistSource(atlas: CapabilityAtlas, source: SourceRecord, action: SourceHistoryEntry['action']): void {
  const layout = capabilityAtlasLayout()
  const existing = atlas.sources.get(source.sourceId)
  atlas.sources.set(source.sourceId, existing ? { ...existing, ...source, sourceId: existing.sourceId } : source)
  writeJson(path.join(layout.sources, `${source.sourceId.replace(/[^\w.-]+/g, '_')}.json`), atlas.sources.get(source.sourceId))
  const entry = appendSourceHistory([], source, action)[0]
  atlas.sourceHistory.push(entry)
  appendFileSync(path.join(layout.sourceHistory, 'history.jsonl'), `${JSON.stringify(entry)}\n`, 'utf8')
  refreshDerived(atlas)
  persistIndex(atlas, layout)
}

export function persistEvaluation(atlas: CapabilityAtlas, evaluation: EvaluationRecord): void {
  const layout = capabilityAtlasLayout()
  atlas.evaluations.set(evaluation.evaluationId, evaluation)
  writeJson(path.join(layout.evaluations, `${evaluation.evaluationId.replace(/[^\w.-]+/g, '_')}.json`), evaluation)
  refreshDerived(atlas)
  const derived = atlas.skills.get(evaluation.skillId)
  if (derived) writeJson(path.join(layout.skills, `${derived.skillId.replace(/[^\w.-]+/g, '_')}.json`), derived)
  persistIndex(atlas, layout)
}

export function persistRelationships(atlas: CapabilityAtlas, extra: SkillRelationship[]): void {
  const layout = capabilityAtlasLayout()
  const byId = new Map(atlas.relationships.map(item => [item.id, item]))
  for (const rel of extra) byId.set(rel.id, rel)
  atlas.relationships = [...byId.values()]
  writeJson(path.join(layout.relationships, 'index.json'), atlas.relationships)
  persistIndex(atlas, layout)
}

export function registerSkill(atlas: CapabilityAtlas, skill: SkillRecord, persist = true): SkillRecord {
  if (atlas.skills.has(skill.skillId)) {
    throw new SkillRegistryError(`Duplicate skill id refused: ${skill.skillId}`)
  }
  if (persist) persistSkill(atlas, skill)
  else atlas.skills.set(skill.skillId, skill)
  refreshDerived(atlas)
  return atlas.skills.get(skill.skillId)!
}

export function registerRelationship(atlas: CapabilityAtlas, from: string, kind: Parameters<typeof createRelationship>[1], to: string, note = ''): SkillRelationship {
  const rel = createRelationship(from, kind, to, note)
  persistRelationships(atlas, [rel])
  return rel
}

export function getSkill(atlas: CapabilityAtlas, skillId: string): SkillRecord | null {
  return atlas.skills.get(skillId) ?? null
}
