/**
 * Foundry-native project instructions.
 * Prefers <project-root>/.foundry/instructions.md. Imports AGENTS.md when present; never overwrites it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  FOUNDRY_INSTRUCTION_PRECEDENCE,
  type FoundryInstructionLayer,
  type FoundryInstructionSource,
} from './foundryAgentTypes'

export const FOUNDRY_INSTRUCTIONS_REL = '.foundry/instructions.md'
export const AGENTS_MD_REL = 'AGENTS.md'

const FOUNDRY_GLOBAL_RULES = [
  'Commander current instruction wins.',
  'Approved spec binds requirement IDs; no uncontrolled scope drift.',
  'Workspace/repo truth beats generic skill text.',
  'NO commit, push, or live deploy without Commander authorization.',
  'Parallel autonomy does not grant production authority.',
].join('\n')

export function ensureFoundryInstructionsFile(projectRoot: string, body?: string): string {
  const abs = path.join(projectRoot, FOUNDRY_INSTRUCTIONS_REL)
  mkdirSync(path.dirname(abs), { recursive: true })
  if (!existsSync(abs)) {
    writeFileSync(abs, body?.trim() || defaultInstructions(), 'utf8')
  }
  return abs
}

export function loadProjectInstructionSources(input: {
  projectRoot: string
  commanderInstruction?: string
  approvedSpec?: string
  skillGuidance?: string
  workspaceTruth?: string
}): FoundryInstructionSource[] {
  const root = input.projectRoot
  const foundryPath = path.join(root, FOUNDRY_INSTRUCTIONS_REL)
  const agentsPath = path.join(root, AGENTS_MD_REL)
  const foundryText = existsSync(foundryPath) ? readFileSync(foundryPath, 'utf8') : ''
  const agentsText = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : ''
  return [
    source('COMMANDER_CURRENT', 'commander-live', input.commanderInstruction),
    source('APPROVED_SPEC', 'planning-mode-spec', input.approvedSpec),
    source('PROJECT_INSTRUCTIONS', FOUNDRY_INSTRUCTIONS_REL, foundryText),
    source('PROJECT_INSTRUCTIONS', AGENTS_MD_REL, agentsText),
    source('WORKSPACE_TRUTH', 'workspace', input.workspaceTruth),
    source('FOUNDRY_GLOBAL_RULES', 'foundry-global', FOUNDRY_GLOBAL_RULES),
    source('SKILL_GUIDANCE', 'capability-atlas-skill', input.skillGuidance),
  ]
}

export function composeInstructionContext(sources: FoundryInstructionSource[]): string {
  const byLayer = new Map<FoundryInstructionLayer, string[]>()
  for (const layer of FOUNDRY_INSTRUCTION_PRECEDENCE) byLayer.set(layer, [])
  for (const item of sources) {
    if (!item.loaded) continue
    byLayer.get(item.layer)?.push(`# ${item.layer} (${item.origin})\n${item.excerpt}`)
  }
  return FOUNDRY_INSTRUCTION_PRECEDENCE
    .map(layer => (byLayer.get(layer) || []).join('\n\n'))
    .filter(Boolean)
    .join('\n\n')
}

export function instructionLayerRank(layer: FoundryInstructionLayer): number {
  return FOUNDRY_INSTRUCTION_PRECEDENCE.indexOf(layer)
}

function source(layer: FoundryInstructionLayer, origin: string, text?: string): FoundryInstructionSource {
  const excerpt = (text || '').trim()
  return { layer, origin, loaded: excerpt.length > 0, excerpt: excerpt.slice(0, 4000) }
}

function defaultInstructions(): string {
  return [
    '# Foundry project instructions',
    '',
    'This file is the Foundry-native project instruction source.',
    'Commander current instruction and an approved spec outrank this file.',
    'Do not overwrite AGENTS.md.',
    'Do not commit, push, or live-deploy without Commander authorization.',
    'Keep persistent user data under data/; tests use an isolated runtime database.',
    '',
  ].join('\n')
}
