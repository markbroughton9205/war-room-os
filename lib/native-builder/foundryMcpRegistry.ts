/**
 * Foundry-governed MCP registry.
 * Server registry / tool-discovery shape adapted from kkkhs/ClawdCode McpRegistry
 * (MIT, commit 217a01369f9cb7d1ccc89c1fd9f50d6db2965b81, Copyright (c) 2026).
 * See docs/third-party/clawdcode.md.
 *
 * No MCP SDK import. No auto-spawn. Invocation must go through Tool Broker.
 * MCP never receives unrestricted host authority.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { foundryDataHierarchy } from './foundryPaths'
import type { FoundryMissionRecord } from './foundryMissionTypes'

export type FoundryMcpTransport = 'stdio' | 'sse' | 'http'

export type FoundryMcpServerConfig = {
  name: string
  transport: FoundryMcpTransport
  command?: string
  args?: string[]
  url?: string
  enabled: boolean
  projectId?: string
  trusted: false
}

export type FoundryMcpToolRecord = {
  server: string
  name: string
  description: string
}

export type FoundryMcpRegistryState = {
  servers: FoundryMcpServerConfig[]
  tools: FoundryMcpToolRecord[]
}

function registryPath(): string {
  const root = path.join(foundryDataHierarchy().foundryRoot, 'mcp-registry')
  mkdirSync(root, { recursive: true })
  return path.join(root, 'registry.json')
}

export function emptyFoundryMcpRegistry(): FoundryMcpRegistryState {
  return { servers: [], tools: [] }
}

export function loadFoundryMcpRegistry(): FoundryMcpRegistryState {
  const file = registryPath()
  if (!existsSync(file)) return emptyFoundryMcpRegistry()
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as FoundryMcpRegistryState
    return {
      servers: Array.isArray(parsed.servers) ? parsed.servers : [],
      tools: Array.isArray(parsed.tools) ? parsed.tools : [],
    }
  } catch {
    return emptyFoundryMcpRegistry()
  }
}

function save(state: FoundryMcpRegistryState): void {
  writeFileSync(registryPath(), JSON.stringify(state, null, 2), 'utf8')
}

export function registerFoundryMcpServer(config: Omit<FoundryMcpServerConfig, 'trusted'> & { trusted?: boolean }): FoundryMcpServerConfig {
  if (config.trusted === true) {
    throw new Error('MCP servers cannot be marked trusted. Foundry Tool Broker remains the authority.')
  }
  if (config.transport === 'stdio' && !config.command) {
    throw new Error('stdio MCP servers require a command, but Foundry will not auto-spawn them.')
  }
  const state = loadFoundryMcpRegistry()
  const next: FoundryMcpServerConfig = {
    ...config,
    enabled: config.enabled !== false,
    trusted: false,
  }
  const index = state.servers.findIndex(item => item.name === next.name && item.projectId === next.projectId)
  if (index >= 0) state.servers[index] = next
  else state.servers.push(next)
  save(state)
  return next
}

export function recordFoundryMcpTools(server: string, tools: Array<{ name: string; description: string }>): FoundryMcpToolRecord[] {
  const state = loadFoundryMcpRegistry()
  const recorded = tools.map(tool => ({ server, name: tool.name, description: tool.description }))
  state.tools = [...state.tools.filter(item => item.server !== server), ...recorded]
  save(state)
  return recorded
}

export function listFoundryMcpTools(projectId?: string): FoundryMcpToolRecord[] {
  const state = loadFoundryMcpRegistry()
  if (!projectId) return state.tools
  const allowed = new Set(state.servers.filter(item => !item.projectId || item.projectId === projectId).map(item => item.name))
  return state.tools.filter(item => allowed.has(item.server))
}

export function invokeFoundryMcpTool(input: {
  server: string
  tool: string
  args?: Record<string, unknown>
  mission?: FoundryMissionRecord | null
}): { ok: false; error: string; spawned: false; brokerRequired: true } {
  if (!input.mission) {
    return {
      ok: false,
      error: 'MCP invocation requires a Foundry mission and Tool Broker authorization.',
      spawned: false,
      brokerRequired: true,
    }
  }
  if (input.mission.cancelRequested) {
    return { ok: false, error: 'Mission cancelled. MCP invocation refused.', spawned: false, brokerRequired: true }
  }
  const state = loadFoundryMcpRegistry()
  const server = state.servers.find(item => item.name === input.server)
  if (!server || server.enabled === false) {
    return { ok: false, error: `MCP server "${input.server}" is not registered for this project.`, spawned: false, brokerRequired: true }
  }
  if (server.projectId && input.mission.applicationBuilder?.project?.projectId && server.projectId !== input.mission.applicationBuilder.project.projectId) {
    return { ok: false, error: 'MCP server is not in this project scope.', spawned: false, brokerRequired: true }
  }
  return {
    ok: false,
    error: 'MCP tools are catalogued only. Foundry will not auto-spawn MCP servers or grant host authority. Route a future bounded adapter through Tool Broker.',
    spawned: false,
    brokerRequired: true,
  }
}
