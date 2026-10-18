/**
 * Canonical Foundry-owned directories under the existing War Room application-data hierarchy
 * (~/.local/share/war-room-os on Linux). Never invent a second data root.
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { ensureLocalAppDataDirs, resolveLocalAppDataPaths } from '@/lib/sovereign-runtime/local-ownership/paths'

export type FoundryDataHierarchy = {
  appRoot: string
  foundryRoot: string
  browserProfile: string
  browserDownloads: string
  browserUploads: string
  computerUse: string
  deploy: string
  screenshots: string
  missions: string
  cursorAgentProvider: string
  cursorAgentState: string
  cursorAgentLogs: string
  cursorAgentCache: string
  cursorAgentWorkspace: string
  operations: string
  registry: string
  resourceLocks: string
  checkpoints: string
  observationArchives: string
  toolCalls: string
  artifacts: string
  runtimeConfig: string
  engineeringMemory: string
  capabilityAtlas: string
  capabilityEvaluation: string
  toolchains: string
  commandCenter: string
  agentWorkspaces: string
  sessions: string
  contracts: string
}

export function foundryDataHierarchy(): FoundryDataHierarchy {
  const app = resolveLocalAppDataPaths()
  ensureLocalAppDataDirs(app)
  const foundryRoot = path.join(app.data, 'foundry')
  const dirs: FoundryDataHierarchy = {
    appRoot: app.root,
    foundryRoot,
    browserProfile: path.join(foundryRoot, 'browser-profile'),
    browserDownloads: path.join(foundryRoot, 'browser-downloads'),
    browserUploads: path.join(foundryRoot, 'browser-uploads'),
    computerUse: path.join(foundryRoot, 'computer-use'),
    deploy: path.join(foundryRoot, 'deploy'),
    screenshots: path.join(foundryRoot, 'screenshots'),
    missions: path.join(foundryRoot, 'missions'),
    cursorAgentProvider: path.join(foundryRoot, 'providers', 'cursor-agent'),
    cursorAgentState: path.join(foundryRoot, 'providers', 'cursor-agent', 'state'),
    cursorAgentLogs: path.join(foundryRoot, 'providers', 'cursor-agent', 'logs'),
    cursorAgentCache: path.join(foundryRoot, 'providers', 'cursor-agent', 'cache'),
    cursorAgentWorkspace: path.join(foundryRoot, 'providers', 'cursor-agent', 'workspace'),
    operations: path.join(foundryRoot, 'operations'),
    registry: path.join(foundryRoot, 'operations', 'registry'),
    resourceLocks: path.join(foundryRoot, 'operations', 'locks'),
    checkpoints: path.join(foundryRoot, 'operations', 'checkpoints'),
    observationArchives: path.join(foundryRoot, 'operations', 'archives'),
    toolCalls: path.join(foundryRoot, 'operations', 'tool-calls'),
    artifacts: path.join(foundryRoot, 'operations', 'artifacts'),
    runtimeConfig: path.join(foundryRoot, 'runtime-config.json'),
    engineeringMemory: path.join(foundryRoot, 'engineering-memory'),
    capabilityAtlas: path.join(foundryRoot, 'capability-atlas'),
    capabilityEvaluation: path.join(foundryRoot, 'capability-evaluation'),
    toolchains: path.join(foundryRoot, 'toolchains'),
    commandCenter: path.join(foundryRoot, 'command-center'),
    agentWorkspaces: path.join(foundryRoot, 'agent-workspaces'),
    sessions: path.join(foundryRoot, 'sessions'),
    contracts: path.join(foundryRoot, 'contracts'),
  }
  for (const [key, dir] of Object.entries(dirs)) {
    if (key === 'runtimeConfig') continue
    mkdirSync(dir, { recursive: true })
  }
  return dirs
}
