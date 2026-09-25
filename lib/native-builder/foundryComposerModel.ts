/**
 * Foundry composer model: modes, model registry view, and context sources.
 *
 * Everything here is wired to something that exists:
 *  - ASK       -> foundryAsk: a read-only answer path with no tool access (see routeForMode).
 *  - AGENT     -> the existing bounded-coding session mission (unchanged default).
 *  - STANDALONE-> the mission controller's outcome-driven path (mission contract -> verification).
 *  - Models    -> the real registry: Foundry routing, the local model status, the Foundry "brain", and the
 *                 provider families' honest configured/not-configured status. Only Foundry Auto is
 *                 selectable because no runtime hook carries a per-mission model choice yet.
 *  - Context   -> only sources that already exist (workspace files, the mission's changed files).
 *
 * Pure: no filesystem, network, or React.
 */

export type FoundryComposerMode = 'ask' | 'agent' | 'standalone'

export const FOUNDRY_COMPOSER_MODES: { id: FoundryComposerMode; label: string; hint: string }[] = [
  { id: 'ask', label: 'Ask', hint: 'Explain, inspect and answer. Read-only: Foundry will not change the project.' },
  { id: 'agent', label: 'Agent', hint: 'A bounded engineering task. Foundry owns it until done or blocked.' },
  { id: 'standalone', label: 'Standalone', hint: 'An outcome-driven mission: contract, implementation, verification, completion.' },
]

export function parseComposerMode(value: unknown): FoundryComposerMode {
  return value === 'ask' || value === 'standalone' ? value : 'agent'
}

/**
 * How each mode is executed. All three are existing paths:
 *  - ask         -> POST .../sessions/[id]/ask (read-only, tool-less, workspace-bound answer)
 *  - agent       -> the unchanged session mission (bounded coding / engineering campaign)
 *  - standalone  -> the mission controller's outcome-driven path (the one application-builder requests already use)
 */
export function routeForMode(mode: FoundryComposerMode): 'ask-endpoint' | 'session-mission' | 'mission-controller' {
  return mode === 'ask' ? 'ask-endpoint' : mode === 'standalone' ? 'mission-controller' : 'session-mission'
}

// ---------------------------------------------------------------------------------------------
// Model registry view
// ---------------------------------------------------------------------------------------------

export type ModelRegistryInput = {
  local?: { state?: string; label?: string; model?: string | null; detail?: string } | null
  brain?: { ready?: boolean; provider?: string; modelId?: string; usageLimited?: boolean; detail?: string } | null
  providers?: { family: string; configured: boolean }[] | null
  routingMode?: string | null
  known?: boolean
}

export type ModelRegistryEntry = {
  id: string
  label: string
  locality: 'auto' | 'local' | 'cloud'
  state: 'ready' | 'starting' | 'limited' | 'configured' | 'unavailable' | 'not configured'
  detail: string
  selectable: boolean
  selected: boolean
}

export type ModelRegistryView = {
  current: { label: string; locality: 'local' | 'cloud' | 'unknown'; state: 'ready' | 'limited' | 'unavailable' | 'unknown' }
  entries: ModelRegistryEntry[]
}

function titleCase(value: string): string {
  return value.length ? value[0].toUpperCase() + value.slice(1) : value
}

export function buildModelRegistryView(input: ModelRegistryInput): ModelRegistryView {
  const local = input.local ?? null
  const brain = input.brain ?? null
  const localReady = local?.state === 'READY'
  const remoteReady = Boolean(brain?.ready && !brain.usageLimited)
  const anyReady = localReady || remoteReady
  const entries: ModelRegistryEntry[] = []

  const localName = local?.model ?? local?.label ?? 'the local model'
  const routeTarget = localReady
    ? `Routes work to ${localName}`
    : remoteReady ? `Routes work to ${titleCase(brain?.provider ?? 'the remote model')}` : 'No worker is available right now'
  entries.push({
    id: 'foundry-auto',
    label: 'Foundry Auto',
    locality: 'auto',
    state: input.known === false ? 'unavailable' : anyReady ? 'ready' : 'unavailable',
    detail: routeTarget,
    selectable: true,
    selected: true,
  })

  if (local && (local.label || local.model)) {
    entries.push({
      id: `local:${local.model ?? local.label}`,
      label: local.model ?? String(local.label),
      locality: 'local',
      state: localReady ? 'ready' : local.state === 'STARTING' ? 'starting' : 'unavailable',
      detail: localReady ? (local.label ? `Local worker · ${local.label.toLowerCase()}` : 'Local worker') : (local.detail ?? 'Local worker is not ready'),
      selectable: false,
      selected: false,
    })
  }

  if (brain?.provider) {
    entries.push({
      id: `brain:${brain.provider}:${brain.modelId ?? ''}`,
      label: `${titleCase(brain.provider)}${brain.modelId ? ` · ${brain.modelId}` : ''}`,
      locality: 'cloud',
      state: brain.usageLimited ? 'limited' : brain.ready ? 'ready' : 'unavailable',
      detail: brain.usageLimited ? 'Usage limited' : brain.ready ? 'Foundry remote model' : (brain.detail ?? 'Remote model is not ready'),
      selectable: false,
      selected: false,
    })
  }

  for (const provider of input.providers ?? []) {
    // Only models that are actually configured are shown; unconfigured families are not "models" to pick from.
    if (!provider.configured) continue
    if (brain?.provider && provider.family.toLowerCase() === brain.provider.toLowerCase()) continue
    entries.push({
      id: `provider:${provider.family}`,
      label: titleCase(provider.family),
      locality: 'cloud',
      state: 'configured',
      detail: 'Credential present. Not verified live.',
      selectable: false,
      selected: false,
    })
  }

  return {
    current: {
      label: 'Foundry Auto',
      locality: localReady ? 'local' : remoteReady ? 'cloud' : 'unknown',
      state: input.known === false ? 'unknown' : localReady || remoteReady ? 'ready' : brain?.usageLimited ? 'limited' : 'unavailable',
    },
    entries,
  }
}

// ---------------------------------------------------------------------------------------------
// Context sources
// ---------------------------------------------------------------------------------------------

export type ContextFilesState = 'loading' | 'ready' | 'unavailable'

export type ContextSourceView = {
  connected: { id: 'files' | 'changes'; label: string; count: number; paths: string[] }[]
  notConnected: string[]
  /** Whether the project-file listing has arrived for the selected workspace. Never inferred from panel visibility. */
  filesState: ContextFilesState
}

/**
 * Foundry-owned bookkeeping is not a Commander context choice: `.war-room/**` (already denylisted by the
 * repository walker) and the two identity seed files every Foundry project starts with (the same names
 * foundryProjectIsolation treats as identity seeds).
 */
const FOUNDRY_IDENTITY_SEED_FILES = new Set(['commander-facts.json', 'foundry-memory.json'])
export function isFoundryMetadataPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.?\//, '')
  return normalized.startsWith('.war-room/') || normalized.includes('/.war-room/') || FOUNDRY_IDENTITY_SEED_FILES.has(normalized)
}

/** Which workspace the last project-file listing belongs to, and whether it succeeded. */
export type FilesListedFor = { workspaceId: string; ok: boolean } | null

/**
 * The composer's project-file listing is keyed ONLY by the selected workspace. Nothing about Advanced,
 * Details or the right inspector is an input here, so the Context menu cannot depend on panel visibility.
 */
export function contextFilesUrl(workspaceId: string | null | undefined): string | null {
  return workspaceId ? `/api/mission-runtime/engineering/repo/files?workspaceId=${encodeURIComponent(workspaceId)}` : null
}

/** A listing only counts for the workspace it was fetched for; a switch shows "loading", never the old project's files. */
export function resolveContextFiles(input: { workspaceId: string | null | undefined; listedFor: FilesListedFor; files: readonly string[] }): { files: string[]; state: ContextFilesState } {
  if (!input.workspaceId) return { files: [], state: 'ready' }
  if (!input.listedFor || input.listedFor.workspaceId !== input.workspaceId) return { files: [], state: 'loading' }
  if (!input.listedFor.ok) return { files: [], state: 'unavailable' }
  return { files: [...input.files], state: 'ready' }
}

export function buildContextView(input: { files: readonly string[]; changedFiles?: readonly string[] | null; filesState?: ContextFilesState }): ContextSourceView {
  const files = input.files.filter(path => !isFoundryMetadataPath(path))
  const changed = (input.changedFiles ?? []).filter(path => !isFoundryMetadataPath(path))
  const connected: ContextSourceView['connected'] = []
  if (files.length) connected.push({ id: 'files', label: 'Files', count: files.length, paths: files })
  if (changed.length) connected.push({ id: 'changes', label: 'Changed files', count: changed.length, paths: changed })
  return { connected, notConnected: ['Codebase', 'Web', 'Git', 'Terminal', 'Selection'], filesState: input.filesState ?? 'ready' }
}

/** Appends an @reference to the request. The mission request text is what Foundry actually sees. */
export function insertContextReference(text: string, reference: string): string {
  const token = `@${reference.replace(/^@/, '')}`
  if (text.split(/\s+/).includes(token)) return text
  const trimmed = text.replace(/\s+$/, '')
  return trimmed ? `${trimmed} ${token} ` : `${token} `
}
