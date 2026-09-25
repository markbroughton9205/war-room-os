/**
 * SKILL.md compatibility adapter → Capability Atlas Skill representation.
 * Frontmatter parsing, name/description validation, and lazy metadata/body split
 * adapted from kkkhs/ClawdCode SkillLoader
 * (MIT, commit 217a01369f9cb7d1ccc89c1fd9f50d6db2965b81, Copyright (c) 2026).
 * See docs/third-party/clawdcode.md.
 *
 * Imported skills do NOT automatically become PROVEN. Atlas remains the only registry.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { CLAWDCODE_UPSTREAM } from './foundryClawdcodeProvenance'
import {
  loadCapabilityAtlas,
  registerSkill,
  persistSource,
  SkillRegistryError,
  type CapabilityAtlas,
} from './capability-atlas/store'
import { createSourceRecord } from './capability-atlas/sources'
import type { SkillRecord } from './capability-atlas/types'

export type FoundrySkillFrontmatter = {
  name: string
  description: string
  allowedTools?: string[]
  argumentHint?: string
  userInvocable: boolean
  disableModelInvocation: boolean
  model?: string
  whenToUse?: string
  version?: string
  license?: string
}

export type ParsedFoundrySkillFile = {
  frontmatter: FoundrySkillFrontmatter
  body: string
}

export type FoundryImportedSkill = {
  skillId: string
  source: string
  hash: string
  license: string
  provenance: {
    format: 'SKILL.md'
    upstream: typeof CLAWDCODE_UPSTREAM.repoUrl
    commit: typeof CLAWDCODE_UPSTREAM.commit
    importedAt: string
    originPath: string
  }
  instructions: string
  toolsReferenced: string[]
  validationRequirements: string[]
  automaticallyProven: false
  capabilityStatus: SkillRecord['capabilityStatus']
  skill: SkillRecord
}

export function isValidSkillName(name: string): boolean {
  if (!name || typeof name !== 'string') return false
  if (name.length < 1 || name.length > 64) return false
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(name)
}

export function isValidDescription(description: string): boolean {
  return Boolean(description && typeof description === 'string' && description.length <= 1024)
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parseScalar(value: string): string | boolean {
  const trimmed = unquote(value)
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  return trimmed
}

/**
 * Minimal YAML-frontmatter parser for the SKILL.md subset.
 * Avoids adding a new YAML dependency; Foundry already has no yaml package.
 */
export function parseSkillMarkdown(content: string): ParsedFoundrySkillFile {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) throw new Error('Invalid SKILL.md format: missing YAML frontmatter (must start with ---)')
  const [, raw, body] = match
  const data: Record<string, unknown> = {}
  let currentList: string | null = null
  for (const line of raw.split(/\r?\n/)) {
    if (/^\s*-\s+/.test(line) && currentList) {
      const list = Array.isArray(data[currentList]) ? data[currentList] as string[] : []
      list.push(unquote(line.replace(/^\s*-\s+/, '')))
      data[currentList] = list
      continue
    }
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
    if (!kv) continue
    currentList = null
    const key = kv[1]
    const value = kv[2]
    if (!value) {
      currentList = key
      data[key] = []
      continue
    }
    data[key] = parseScalar(value)
  }
  const name = typeof data.name === 'string' ? data.name : ''
  const description = typeof data.description === 'string' ? data.description : ''
  if (!isValidSkillName(name)) {
    throw new Error(`Invalid skill name "${name}": must be 1-64 characters, lowercase letters, numbers, and hyphens only`)
  }
  if (!isValidDescription(description)) {
    throw new Error('SKILL.md must have a description of 1024 characters or less')
  }
  const allowed = data['allowed-tools']
  if (allowed !== undefined && !Array.isArray(allowed)) throw new Error('"allowed-tools" must be an array')
  return {
    frontmatter: {
      name,
      description,
      allowedTools: Array.isArray(allowed) ? allowed.map(String) : undefined,
      argumentHint: typeof data['argument-hint'] === 'string' ? data['argument-hint'] : undefined,
      userInvocable: data['user-invocable'] === true,
      disableModelInvocation: data['disable-model-invocation'] === true,
      model: typeof data.model === 'string' ? data.model : undefined,
      whenToUse: typeof data.when_to_use === 'string' ? data.when_to_use : undefined,
      version: typeof data.version === 'string' ? data.version : undefined,
      license: typeof data.license === 'string' ? data.license : undefined,
    },
    body: body.trim(),
  }
}

export function skillIdFromName(name: string): string {
  return `imported.skillmd.${name}`
}

export function importedSkillRecord(input: {
  parsed: ParsedFoundrySkillFile
  originPath: string
  sourceLabel: string
  hash: string
  license: string
}): SkillRecord {
  const tools = input.parsed.frontmatter.allowedTools ?? []
  const brokerTools = tools
    .map(tool => {
      const lower = tool.toLowerCase()
      if (lower === 'read') return 'file.read'
      if (lower === 'write') return 'file.write'
      if (lower === 'edit') return 'file.replace_unique'
      if (lower === 'glob' || lower === 'grep') return 'workspace.search'
      if (lower === 'bash') return 'terminal.execute'
      return tool
    })
    .filter(tool => !/^bash\(/i.test(tool))
  return {
    skillId: skillIdFromName(input.parsed.frontmatter.name),
    name: input.parsed.frontmatter.name,
    domain: 'imported',
    subdomain: 'skillmd',
    description: input.parsed.frontmatter.description,
    capabilityClass: 'imported-skillmd',
    languages: [],
    frameworks: [],
    platforms: [],
    operatingSystems: [],
    tools: brokerTools,
    officialSources: [`skillmd:${input.hash.slice(0, 12)}`],
    openSourceSources: [CLAWDCODE_UPSTREAM.repoUrl],
    referenceImplementations: [],
    prerequisiteSkills: [],
    relatedSkills: [],
    requiredContext: input.parsed.frontmatter.whenToUse ? [input.parsed.frontmatter.whenToUse] : [],
    supportedToolBrokerTools: brokerTools.filter(tool => /^(file|workspace|engineering|capability|code)\./.test(tool)),
    validationMethods: ['Commander review', 'Foundry Tool Broker execution', 'Not automatically PROVEN'],
    knownFailureModes: ['Imported SKILL.md is instruction text, not mastery.', 'Must not bypass Tool Broker.'],
    securityConsiderations: ['Do not treat imported skills as host authority.', 'No unrestricted Bash from allowed-tools.'],
    governanceRequirements: ['Commander approval', 'Tool Broker', 'Atlas provenance'],
    localModelCompatibility: 'unknown',
    frontierModelCompatibility: 'unknown',
    selfHostable: true,
    lastSourceVerified: new Date().toISOString(),
    lastCapabilityEvaluated: null,
    capabilityStatus: 'SOURCE_BACKED',
    confidence: 'low',
    productionProofMissions: [],
    engineeringMemoryLinks: [],
    version: 1,
    lifecycle: 'CURRENT',
    modelRouting: ['LOCAL_MODEL_OK'],
    evidence: {
      implementationFiles: [],
      brokerTools: brokerTools.filter(tool => /^(file|workspace|engineering|capability|code)\./.test(tool)),
      validators: [],
      proofFiles: [],
      notes: `Imported from SKILL.md at ${input.originPath}. Status is SOURCE_BACKED, never auto-PROVEN.`,
    },
    unsupportedReason: null,
  }
}

export function importSkillMarkdown(input: {
  content: string
  originPath: string
  sourceLabel?: string
  license?: string
  atlas?: CapabilityAtlas
  persist?: boolean
}): FoundryImportedSkill {
  const parsed = parseSkillMarkdown(input.content)
  const hash = createHash('sha256').update(input.content, 'utf8').digest('hex')
  const license = input.license ?? parsed.frontmatter.license ?? 'UNDECLARED'
  const atlas = input.atlas ?? loadCapabilityAtlas()
  const skill = importedSkillRecord({
    parsed,
    originPath: input.originPath,
    sourceLabel: input.sourceLabel ?? 'file',
    hash,
    license,
  })
  try {
    registerSkill(atlas, skill, input.persist !== false)
  } catch (error) {
    if (!(error instanceof SkillRegistryError)) throw error
    const existing = atlas.skills.get(skill.skillId)
    if (!existing) throw error
    if (existing.capabilityStatus === 'PROVEN' || existing.capabilityStatus === 'PRODUCTION_PROVEN') {
      throw new Error(`Imported skill ${skill.skillId} already exists and must not be auto-elevated.`)
    }
  }
  const source = createSourceRecord({
    sourceId: `skillmd:${hash.slice(0, 12)}`,
    title: `SKILL.md ${parsed.frontmatter.name}`,
    sourceUrl: input.originPath.startsWith('http') ? input.originPath : CLAWDCODE_UPSTREAM.repoUrl,
    sourceType: 'major_community',
    organization: input.sourceLabel ?? 'imported-skillmd',
    license,
    version: parsed.frontmatter.version ?? null,
    lastVerified: new Date().toISOString(),
    retrievedAt: new Date().toISOString(),
    authorityClass: 'MAJOR_COMMUNITY',
    contentHash: hash,
    skillIds: [skill.skillId],
    notes: `SKILL.md compatibility import. Format adapted from ClawdCode ${CLAWDCODE_UPSTREAM.commit}. Not PROVEN.`,
  })
  persistSource(atlas, source, 'REGISTERED')
  const stored = atlas.skills.get(skill.skillId) ?? skill
  return {
    skillId: stored.skillId,
    source: input.sourceLabel ?? input.originPath,
    hash,
    license,
    provenance: {
      format: 'SKILL.md',
      upstream: CLAWDCODE_UPSTREAM.repoUrl,
      commit: CLAWDCODE_UPSTREAM.commit,
      importedAt: new Date().toISOString(),
      originPath: input.originPath,
    },
    instructions: parsed.body.slice(0, 8_000),
    toolsReferenced: stored.tools,
    validationRequirements: stored.validationMethods,
    automaticallyProven: false,
    capabilityStatus: stored.capabilityStatus,
    skill: stored,
  }
}

export function importSkillMarkdownFile(filePath: string, options?: { sourceLabel?: string; license?: string; persist?: boolean }): FoundryImportedSkill {
  const content = readFileSync(filePath, 'utf8')
  return importSkillMarkdown({
    content,
    originPath: filePath,
    sourceLabel: options?.sourceLabel,
    license: options?.license,
    persist: options?.persist,
  })
}
