import { TOOL_REGISTRY, getToolById, type ToolId } from '@/lib/tools/toolRegistry'
import type { ToolArgType, ToolArgumentSchema, UnifiedToolDefinition } from './types'

/**
 * Authoritative War Room tools remain `lib/tools/toolRegistry.ts`.
 * This catalog is a schema/execution view over that registry plus the bounded
 * gym/curriculum tools WRIM compact intent already names (sha256, lookup_note).
 * It does not replace TOOL_REGISTRY.
 */

const WAR_ROOM_ARG_OVERLAY: Partial<Record<ToolId, ToolArgumentSchema[]>> = {
  web: [{ name: 'query', type: 'string', required: true }],
  memory: [{ name: 'query', type: 'string', required: true }],
  files: [{ name: 'path', type: 'string', required: true }],
  research: [{ name: 'query', type: 'string', required: true }],
  repo: [{ name: 'action', type: 'string', required: true }],
  deployments: [{ name: 'action', type: 'string', required: true }],
  build: [{ name: 'title', type: 'string', required: true }],
}

const GYM_AND_CURRICULUM: UnifiedToolDefinition[] = [
  {
    toolId: 'sha256',
    displayName: 'Bounded SHA-256',
    enabled: true,
    available: true,
    authority: 'agi_gym_bounded',
    requiresAuth: false,
    executionProvider: 'agi_gym_sha256',
    arguments: [{ name: 'text', type: 'string', required: true }],
    schemaSpecified: true,
    capabilityMetadata: { family: 'tool_use', reversible: 'true', live_network: 'false' },
  },
  {
    toolId: 'lookup_note',
    displayName: 'Curriculum note lookup (synthetic)',
    enabled: true,
    available: true,
    authority: 'curriculum_synthetic',
    requiresAuth: false,
    executionProvider: 'mock',
    arguments: [{ name: 'note_id', type: 'string', required: true }],
    schemaSpecified: true,
    capabilityMetadata: { family: 'tool_use', synthetic: 'true', live_network: 'false' },
  },
  {
    toolId: 'echo_int',
    displayName: 'Phase 1 schema fixture (integer arg)',
    enabled: true,
    available: true,
    authority: 'curriculum_synthetic',
    requiresAuth: false,
    executionProvider: 'mock',
    arguments: [{ name: 'n', type: 'integer', required: true }],
    schemaSpecified: true,
    capabilityMetadata: { family: 'schema_fixture', phase1: 'true', live_network: 'false' },
  },
  {
    toolId: 'disabled_probe',
    displayName: 'Phase 1 unavailable fixture',
    enabled: false,
    available: false,
    authority: 'curriculum_synthetic',
    requiresAuth: false,
    executionProvider: 'none',
    arguments: [{ name: 'text', type: 'string', required: true }],
    schemaSpecified: true,
    capabilityMetadata: { family: 'schema_fixture', phase1: 'true' },
  },
]

export function warRoomToolsAsDefinitions(): UnifiedToolDefinition[] {
  return TOOL_REGISTRY.map((tool) => {
    const args = WAR_ROOM_ARG_OVERLAY[tool.id] ?? []
    return {
      toolId: tool.id,
      displayName: tool.name,
      enabled: true,
      available: true,
      authority: 'war_room_tool_registry' as const,
      requiresAuth: tool.requiresAuth,
      endpoint: tool.endpoint,
      warRoomToolId: tool.id,
      executionProvider: 'war_room_api' as const,
      arguments: args,
      schemaSpecified: args.length > 0,
      capabilityMetadata: { family: 'war_room_ui_tool', endpoint: tool.endpoint },
    }
  })
}

export function listUnifiedTools(): UnifiedToolDefinition[] {
  return [...warRoomToolsAsDefinitions(), ...GYM_AND_CURRICULUM]
}

export function getUnifiedTool(toolId: string): UnifiedToolDefinition | null {
  return listUnifiedTools().find((t) => t.toolId === toolId) ?? null
}

export function warRoomRegistryStillAuthoritative(id: ToolId) {
  return getToolById(id) !== undefined && getUnifiedTool(id)?.authority === 'war_room_tool_registry'
}

export function coerceArgument(raw: string, type: ToolArgType): { ok: true; value: string | number | boolean } | { ok: false; reason: string } {
  if (type === 'string') return { ok: true, value: raw }
  if (type === 'boolean') {
    if (raw === 'true' || raw === 'false') return { ok: true, value: raw === 'true' }
    return { ok: false, reason: `expected boolean got ${raw}` }
  }
  if (type === 'integer') {
    if (!/^-?\d+$/.test(raw)) return { ok: false, reason: `expected integer got ${raw}` }
    return { ok: true, value: Number.parseInt(raw, 10) }
  }
  if (type === 'number') {
    const n = Number(raw)
    if (!Number.isFinite(n)) return { ok: false, reason: `expected number got ${raw}` }
    return { ok: true, value: n }
  }
  return { ok: false, reason: 'unknown type' }
}
