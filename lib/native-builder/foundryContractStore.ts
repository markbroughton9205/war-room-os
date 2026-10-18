/**
 * Persist sealed contracts, evidence, and verdicts under the Foundry data root.
 * Override with FOUNDRY_CONTRACTS_ROOT for disposable validators.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { foundryDataHierarchy } from './foundryPaths'
import type {
  FoundryAcceptanceContract,
  FoundryAcceptanceEvidence,
  FoundryContractEvent,
  FoundryContractEventType,
  FoundryExecutionApproval,
  FoundryMissionContract,
  FoundryVerdictRecord,
} from './foundryContractTypes'
import type { FoundryReplanRecord } from './foundryReplanTypes'
import type { FoundryResourceBudget, FoundryResourceExtension, FoundryResourceUsage } from './foundryResourceGovernorTypes'
import { appendFoundryAgentEvent } from './foundryAgentEvents'
import { hashAcceptanceContractIdentity, hashMissionContractIdentity } from './foundryContractHash'
import type { FoundryMissionRecord } from './foundryMissionTypes'

export function foundryContractsRoot(): string {
  const override = process.env.FOUNDRY_CONTRACTS_ROOT?.trim()
  const root = override || path.join(foundryDataHierarchy().foundryRoot, 'contracts')
  mkdirSync(path.join(root, 'missions'), { recursive: true })
  mkdirSync(path.join(root, 'acceptance'), { recursive: true })
  mkdirSync(path.join(root, 'evidence'), { recursive: true })
  mkdirSync(path.join(root, 'verdicts'), { recursive: true })
  mkdirSync(path.join(root, 'verdicts', 'history'), { recursive: true })
  mkdirSync(path.join(root, 'events'), { recursive: true })
  mkdirSync(path.join(root, 'approvals'), { recursive: true })
  mkdirSync(path.join(root, 'replans'), { recursive: true })
  mkdirSync(path.join(root, 'resources'), { recursive: true })
  mkdirSync(path.join(root, 'resources', 'budgets'), { recursive: true })
  mkdirSync(path.join(root, 'resources', 'usage'), { recursive: true })
  mkdirSync(path.join(root, 'resources', 'extensions'), { recursive: true })
  mkdirSync(path.join(root, 'runtimes'), { recursive: true })
  mkdirSync(path.join(root, 'runtimes', 'leases'), { recursive: true })
  mkdirSync(path.join(root, 'runtimes', 'checkpoints'), { recursive: true })
  mkdirSync(path.join(root, 'runtimes', 'actions'), { recursive: true })
  mkdirSync(path.join(root, 'envelopes'), { recursive: true })
  return root
}

function atomicWrite(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${randomUUID()}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(tmp, filePath)
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

export function saveMissionContract(contract: FoundryMissionContract): FoundryMissionContract {
  const existing = loadMissionContract(contract.missionContractId)
  if (existing?.status === 'SEALED' && contract.status === 'SEALED') {
    if (hashMissionContractIdentity(contract) !== existing.contentHash) {
      throw new Error('SEALED_CONTRACT_MUTATION_REFUSED: sealed MissionContract is immutable. Supersede with a new version.')
    }
  }
  atomicWrite(path.join(foundryContractsRoot(), 'missions', `${contract.missionContractId}.json`), contract)
  return contract
}

export function loadMissionContract(missionContractId: string): FoundryMissionContract | null {
  return readJson(path.join(foundryContractsRoot(), 'missions', `${missionContractId}.json`))
}

export function saveAcceptanceContract(contract: FoundryAcceptanceContract): FoundryAcceptanceContract {
  const existing = loadAcceptanceContract(contract.acceptanceContractId)
  if (existing?.status === 'SEALED' && contract.status === 'SEALED') {
    if (hashAcceptanceContractIdentity(contract) !== existing.contentHash) {
      throw new Error('SEALED_CONTRACT_MUTATION_REFUSED: sealed AcceptanceContract is immutable. Supersede with a new version.')
    }
  }
  atomicWrite(path.join(foundryContractsRoot(), 'acceptance', `${contract.acceptanceContractId}.json`), contract)
  return contract
}

export function loadAcceptanceContract(acceptanceContractId: string): FoundryAcceptanceContract | null {
  return readJson(path.join(foundryContractsRoot(), 'acceptance', `${acceptanceContractId}.json`))
}

export function saveAcceptanceEvidence(evidence: FoundryAcceptanceEvidence): FoundryAcceptanceEvidence {
  const dir = path.join(foundryContractsRoot(), 'evidence', evidence.missionId)
  mkdirSync(dir, { recursive: true })
  atomicWrite(path.join(dir, `${evidence.evidenceId}.json`), evidence)
  return evidence
}

export function listAcceptanceEvidence(missionId: string): FoundryAcceptanceEvidence[] {
  const dir = path.join(foundryContractsRoot(), 'evidence', missionId)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => readJson<FoundryAcceptanceEvidence>(path.join(dir, name)))
    .filter((item): item is FoundryAcceptanceEvidence => Boolean(item))
}

export function saveVerdictRecord(verdict: FoundryVerdictRecord): FoundryVerdictRecord {
  atomicWrite(path.join(foundryContractsRoot(), 'verdicts', `${verdict.missionId}.json`), verdict)
  return verdict
}

export function loadVerdictRecord(missionId: string): FoundryVerdictRecord | null {
  return readJson(path.join(foundryContractsRoot(), 'verdicts', `${missionId}.json`))
}

export function archiveVerdictRecord(verdict: FoundryVerdictRecord): FoundryVerdictRecord {
  const dir = path.join(foundryContractsRoot(), 'verdicts', 'history', verdict.missionId)
  mkdirSync(dir, { recursive: true })
  atomicWrite(path.join(dir, `${verdict.verdictId}.json`), verdict)
  return verdict
}

export function listArchivedVerdicts(missionId: string): FoundryVerdictRecord[] {
  const dir = path.join(foundryContractsRoot(), 'verdicts', 'history', missionId)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => readJson<FoundryVerdictRecord>(path.join(dir, name)))
    .filter((item): item is FoundryVerdictRecord => Boolean(item))
}

function approvalIdentity(approval: FoundryExecutionApproval): string {
  return [
    approval.specId,
    approval.specVersion,
    approval.specContentHash,
    approval.missionContractId,
    approval.missionContractHash,
    approval.acceptanceContractId,
    approval.acceptanceContractHash,
    approval.authoritySnapshotId,
  ].join('|')
}

export function saveExecutionApproval(approval: FoundryExecutionApproval): FoundryExecutionApproval {
  const existing = loadExecutionApproval(approval.approvalId)
  if (existing && approvalIdentity(existing) !== approvalIdentity(approval)) {
    throw new Error('SEALED_APPROVAL_IMMUTABLE: execution approval hashes cannot be rewritten. Create a new approval.')
  }
  if (existing?.status === 'ACTIVE' && approval.status === 'ACTIVE' && existing.approvedAt !== approval.approvedAt) {
    throw new Error('SEALED_APPROVAL_IMMUTABLE: ACTIVE execution approval cannot be mutated in place.')
  }
  atomicWrite(path.join(foundryContractsRoot(), 'approvals', `${approval.approvalId}.json`), approval)
  return approval
}

export function loadExecutionApproval(approvalId: string): FoundryExecutionApproval | null {
  return readJson(path.join(foundryContractsRoot(), 'approvals', `${approvalId}.json`))
}

export function listExecutionApprovals(missionId: string, graphId?: string | null): FoundryExecutionApproval[] {
  const dir = path.join(foundryContractsRoot(), 'approvals')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => readJson<FoundryExecutionApproval>(path.join(dir, name)))
    .filter((item): item is FoundryExecutionApproval => Boolean(item))
    .filter(item => item.missionId === missionId && (!graphId || item.graphId === graphId || item.graphId == null))
    .sort((a, b) => a.approvedAt.localeCompare(b.approvedAt))
}

export function loadActiveExecutionApproval(missionId: string, graphId?: string | null): FoundryExecutionApproval | null {
  const rows = listExecutionApprovals(missionId, graphId).filter(item => item.status === 'ACTIVE')
  if (graphId) {
    return rows.find(item => item.graphId === graphId) ?? rows.find(item => item.graphId == null) ?? null
  }
  return rows.at(-1) ?? null
}

export function appendContractEvent(
  missionId: string,
  type: FoundryContractEventType,
  text: string,
  mission?: FoundryMissionRecord | null,
  metadata?: FoundryContractEvent['metadata'],
): FoundryContractEvent {
  const event: FoundryContractEvent = {
    eventId: randomUUID(),
    at: new Date().toISOString(),
    type,
    missionId,
    text: String(text ?? '').slice(0, 2_000),
    metadata,
  }
  const file = path.join(foundryContractsRoot(), 'events', `${missionId}.jsonl`)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(event)}\n`, { encoding: 'utf8', flag: 'a' })
  if (mission) {
    appendFoundryAgentEvent(mission, type, text, { metadata })
  }
  return event
}

export function loadContractEvents(missionId: string): FoundryContractEvent[] {
  const file = path.join(foundryContractsRoot(), 'events', `${missionId}.jsonl`)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line) as FoundryContractEvent
      } catch {
        return null
      }
    })
    .filter((item): item is FoundryContractEvent => Boolean(item))
}

export function saveReplanRecord(record: FoundryReplanRecord): FoundryReplanRecord {
  const dir = path.join(foundryContractsRoot(), 'replans', record.graphId)
  mkdirSync(dir, { recursive: true })
  atomicWrite(path.join(dir, `${record.replanId}.json`), record)
  return record
}

export function loadReplanRecord(graphId: string, replanId: string): FoundryReplanRecord | null {
  return readJson(path.join(foundryContractsRoot(), 'replans', graphId, `${replanId}.json`))
}

export function listReplanRecords(graphId: string): FoundryReplanRecord[] {
  const dir = path.join(foundryContractsRoot(), 'replans', graphId)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => readJson<FoundryReplanRecord>(path.join(dir, name)))
    .filter((item): item is FoundryReplanRecord => Boolean(item))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function listReplanRecordsForMission(missionId: string): FoundryReplanRecord[] {
  const root = path.join(foundryContractsRoot(), 'replans')
  if (!existsSync(root)) return []
  return readdirSync(root)
    .flatMap(graphId => listReplanRecords(graphId))
    .filter(item => item.missionId === missionId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

function resourceBudgetPointerName(budget: FoundryResourceBudget): string | null {
  if (budget.status === 'SUPERSEDED') return null
  if (budget.scope === 'TASK' && budget.taskId) return `active-${budget.missionId}-task-${budget.taskId}.json`
  if (budget.scope === 'PROVIDER' || budget.scope === 'TOOL_FAMILY') return `active-${budget.missionId}-scope-${budget.scope}-${budget.budgetId}.json`
  return `active-${budget.missionId}.json`
}

export function saveResourceBudget(budget: FoundryResourceBudget): FoundryResourceBudget {
  atomicWrite(path.join(foundryContractsRoot(), 'resources', 'budgets', `${budget.budgetId}.json`), budget)
  const pointer = resourceBudgetPointerName(budget)
  if (pointer) {
    atomicWrite(path.join(foundryContractsRoot(), 'resources', 'budgets', pointer), { budgetId: budget.budgetId, missionId: budget.missionId, scope: budget.scope, taskId: budget.taskId })
  }
  return budget
}

export function loadResourceBudget(budgetId: string): FoundryResourceBudget | null {
  return readJson(path.join(foundryContractsRoot(), 'resources', 'budgets', `${budgetId}.json`))
}

export function loadActiveResourceBudget(missionId: string): FoundryResourceBudget | null {
  const pointer = readJson<{ budgetId: string }>(path.join(foundryContractsRoot(), 'resources', 'budgets', `active-${missionId}.json`))
  if (pointer?.budgetId) {
    const loaded = loadResourceBudget(pointer.budgetId)
    if (loaded && loaded.status !== 'SUPERSEDED') return loaded
  }
  const dir = path.join(foundryContractsRoot(), 'resources', 'budgets')
  if (!existsSync(dir)) return null
  const matches = readdirSync(dir)
    .filter(name => name.endsWith('.json') && !name.startsWith('active-'))
    .map(name => readJson<FoundryResourceBudget>(path.join(dir, name)))
    .filter((item): item is FoundryResourceBudget => Boolean(item && item.missionId === missionId && item.status !== 'SUPERSEDED' && (item.scope === 'MISSION' || item.scope === 'WALL_CLOCK')))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return matches[0] ?? null
}

export function loadActiveTaskResourceBudget(missionId: string, taskId: string): FoundryResourceBudget | null {
  const pointer = readJson<{ budgetId: string }>(path.join(foundryContractsRoot(), 'resources', 'budgets', `active-${missionId}-task-${taskId}.json`))
  if (pointer?.budgetId) {
    const loaded = loadResourceBudget(pointer.budgetId)
    if (loaded && loaded.status !== 'SUPERSEDED') return loaded
  }
  return listResourceBudgets(missionId).find(item => item.scope === 'TASK' && item.taskId === taskId && item.status !== 'SUPERSEDED') ?? null
}

export function listResourceBudgets(missionId: string): FoundryResourceBudget[] {
  const dir = path.join(foundryContractsRoot(), 'resources', 'budgets')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => name.endsWith('.json') && !name.startsWith('active-'))
    .map(name => readJson<FoundryResourceBudget>(path.join(dir, name)))
    .filter((item): item is FoundryResourceBudget => Boolean(item && item.missionId === missionId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function saveResourceUsage(usage: FoundryResourceUsage): FoundryResourceUsage {
  const file = path.join(foundryContractsRoot(), 'resources', 'usage', `${usage.missionId}.jsonl`)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(usage)}\n`, { encoding: 'utf8', flag: 'a' })
  atomicWrite(path.join(foundryContractsRoot(), 'resources', 'usage', `${usage.actionId}.json`), usage)
  return usage
}

export function loadResourceUsageByAction(actionId: string): FoundryResourceUsage | null {
  return readJson(path.join(foundryContractsRoot(), 'resources', 'usage', `${usageActionFile(actionId)}`))
}

function usageActionFile(actionId: string): string {
  return `${actionId}.json`
}

export function listResourceUsage(missionId: string): FoundryResourceUsage[] {
  const file = path.join(foundryContractsRoot(), 'resources', 'usage', `${missionId}.jsonl`)
  const byAction = new Map<string, FoundryResourceUsage>()
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
      try {
        const item = JSON.parse(line) as FoundryResourceUsage
        byAction.set(item.actionId, item)
      } catch {
        /* skip */
      }
    }
  }
  const dir = path.join(foundryContractsRoot(), 'resources', 'usage')
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).filter(item => item.endsWith('.json'))) {
      const item = readJson<FoundryResourceUsage>(path.join(dir, name))
      if (item && item.missionId === missionId) byAction.set(item.actionId, item)
    }
  }
  return [...byAction.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

export function saveResourceExtension(extension: FoundryResourceExtension): FoundryResourceExtension {
  const file = path.join(foundryContractsRoot(), 'resources', 'extensions', `${extension.budgetId}.jsonl`)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(extension)}\n`, { encoding: 'utf8', flag: 'a' })
  atomicWrite(path.join(foundryContractsRoot(), 'resources', 'extensions', `${extension.extensionId}.json`), extension)
  return extension
}

export function listResourceExtensions(budgetId: string): FoundryResourceExtension[] {
  const file = path.join(foundryContractsRoot(), 'resources', 'extensions', `${budgetId}.jsonl`)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line) as FoundryResourceExtension
      } catch {
        return null
      }
    })
    .filter((item): item is FoundryResourceExtension => Boolean(item))
}
