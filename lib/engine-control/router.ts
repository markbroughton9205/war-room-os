/**
 * Pure command router (Phase 2). No I/O, no `process.env`, no side effects.
 * Callers pass `engines: EngineStatus[]` from `collectEngineStatuses` and optional `tools` snapshot
 * (built in API routes, e.g. after probing internet tools) so tests stay deterministic.
 */

import type { CouncilFamilyName } from '@/lib/ai/router'
import { routeDecreeByKeywords } from '@/lib/ai/router'

import { ENGINE_REGISTRY_BY_ID } from './registry'
import { engineProviderDisplayLabel } from './provider-display'
import {
  canExecuteRouting,
  classifyCommand,
  computeApprovalRequired,
  computeEnginePermissions,
} from './permissions'
import type { CommandApprovals, EngineId, EngineStatus, ToolRoutingSnapshot } from './types'

export type RouteCommandInput = {
  command: string
  engines: EngineStatus[]
  /** When omitted, internet/research routes are treated as unavailable. */
  tools?: ToolRoutingSnapshot
  approvals?: CommandApprovals
}

export type RouteCommandResult = {
  requestedCommand: string
  selectedFamily: CouncilFamilyName
  selectedEngine: EngineId
  selectedProvider: string
  /** Phase 2: reserved when execution layer pins a concrete model id. */
  selectedModel?: string
  capabilityMatch: boolean
  approvalRequired: boolean
  canExecute: boolean
  recommendedNextStep: string
  reason: string
}

const DEFAULT_TOOLS: ToolRoutingSnapshot = {
  internetReachable: false,
  researchConfigured: false,
}

function engineById(engines: EngineStatus[], id: EngineId): EngineStatus | undefined {
  return engines.find(e => e.id === id)
}

function pickLocalEngine(engines: EngineStatus[]): EngineStatus | null {
  const order: EngineId[] = ['ollama', 'lm_studio']
  for (const id of order) {
    const e = engineById(engines, id)
    if (e?.functional && e.reachable) return e
  }
  return null
}

function familyToPreferredEngine(family: CouncilFamilyName): EngineId {
  const map: Record<CouncilFamilyName, EngineId> = {
    Claude: 'claude',
    ChatGPT: 'chatgpt',
    Kimi: 'chatgpt',
    Grok: 'grok',
    Gemini: 'gemini',
    'Red Team': 'claude',
  }
  return map[family]
}

function capabilityMatches(engine: EngineStatus, commandClass: ReturnType<typeof classifyCommand>): boolean {
  const p = computeEnginePermissions(engine)
  if (commandClass === 'internet') return p.allowInternet
  if (commandClass === 'research') return p.allowResearch
  if (commandClass === 'repo_read') return p.allowRepoRead
  if (commandClass === 'repo_mutation') return p.allowRepoWrite
  if (commandClass === 'terminal') return engine.capabilities.includes('terminal')
  return p.allowPromptOnly
}

function fallbackEngine(): EngineStatus {
  const reg = ENGINE_REGISTRY_BY_ID.get('chatgpt')!
  const now = new Date().toISOString()
  return {
    id: 'chatgpt',
    displayName: reg.displayName,
    category: reg.category,
    providerType: reg.providerType,
    installed: false,
    configured: false,
    reachable: false,
    functional: false,
    capabilities: [...reg.defaultCapabilities],
    permissions: {
      allowPromptOnly: false,
      allowInternet: false,
      allowResearch: false,
      allowRepoRead: false,
      allowRepoWrite: false,
    },
    approvalRequired: true,
    lastChecked: now,
    providerLabel: engineProviderDisplayLabel('chatgpt', reg.providerType),
    lastSuccessfulProbeAt: null,
    notes: 'No engine status snapshot provided to router.',
  }
}

export function routeCommand(input: RouteCommandInput): RouteCommandResult {
  const tools = input.tools ?? DEFAULT_TOOLS
  const decree = routeDecreeByKeywords(input.command.trim() || 'general')
  const commandClass = classifyCommand(input.command)
  const preferredId = familyToPreferredEngine(decree.selectedFamily)
  let selected = engineById(input.engines, preferredId)

  if (!selected?.functional || !selected?.reachable) {
    const local = pickLocalEngine(input.engines)
    if (local && (commandClass === 'read_only_query' || commandClass === 'repo_read')) {
      selected = local
    }
  }

  if (!selected) {
    selected = engineById(input.engines, 'chatgpt') ?? input.engines[0] ?? fallbackEngine()
  }

  if (commandClass === 'internet' && !tools.internetReachable) {
    return {
      requestedCommand: input.command,
      selectedFamily: decree.selectedFamily,
      selectedEngine: selected.id,
      selectedProvider: engineProviderDisplayLabel(selected.id, selected.providerType),
      capabilityMatch: false,
      approvalRequired: true,
      canExecute: false,
      recommendedNextStep: 'Configure and verify an internet tool (e.g. Tavily/Firecrawl per /api/tools/internet/status), then re-run with approvals.internet if policy allows.',
      reason: 'Command appears to require internet tools, but no reachable internet tool was reported in the routing snapshot.',
    }
  }

  if (commandClass === 'research' && !tools.researchConfigured) {
    return {
      requestedCommand: input.command,
      selectedFamily: decree.selectedFamily,
      selectedEngine: selected.id,
      selectedProvider: engineProviderDisplayLabel(selected.id, selected.providerType),
      capabilityMatch: false,
      approvalRequired: true,
      canExecute: false,
      recommendedNextStep: 'Set TAVILY_API_KEY and/or FIRECRAWL_API_KEY, confirm /api/tools/research, then re-run with approvals.research if appropriate.',
      reason: 'Research-style command detected; research stack is not configured in the snapshot.',
    }
  }

  const capMatch = capabilityMatches(selected, commandClass)
  const approvalRequired = computeApprovalRequired(selected, commandClass)
  const exec = canExecuteRouting(selected, commandClass, input.approvals)
    && capMatch
    && (commandClass !== 'internet' || tools.internetReachable)
    && (commandClass !== 'research' || tools.researchConfigured)

  let recommendedNextStep = 'No execution in Phase 2 — use council or local agent flows after policy review.'
  if (!selected.functional || !selected.reachable) {
    recommendedNextStep = `Bring ${selected.displayName} online (see engine notes) or switch decree keywords to a council family with a configured provider.`
  } else if (approvalRequired && !exec) {
    recommendedNextStep = 'Obtain explicit approvals in the POST body for the detected command class, or rephrase as a read-only prompt.'
  } else if (!capMatch) {
    recommendedNextStep = 'Pick an engine whose capabilities include the detected command class, or narrow the command to chat-only scope.'
  } else if (exec) {
    recommendedNextStep = 'Router allows (policy permitting) hand-off to an execution layer outside Phase 2; confirm approvals in production before any write.'
  }

  return {
    requestedCommand: input.command,
    selectedFamily: decree.selectedFamily,
    selectedEngine: selected.id,
    selectedProvider: engineProviderDisplayLabel(selected.id, selected.providerType),
    capabilityMatch: capMatch,
    approvalRequired,
    canExecute: exec,
    recommendedNextStep,
    reason: `${decree.reason} Command class: ${commandClass}. Engine: ${selected.displayName} (functional=${selected.functional}, reachable=${selected.reachable}).`,
  }
}
