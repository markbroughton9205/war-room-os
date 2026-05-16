import { PROVIDER_CONFIG_REGISTRY } from '@/lib/configuration/configurationRegistry'
import { REPAIR_LEDGER_ENTRIES, type RepairLedgerEntry } from '@/lib/repair/repairLedger'
import { REPAIR_MEMORY_SOURCES, type RepairMemorySource } from '@/lib/repair/repairMemory'

export type UnresolvedRepairSeverity = 'low' | 'medium' | 'high'

export type UnresolvedRepairItem = {
  id: string
  severity: UnresolvedRepairSeverity
  source: string
  issue: string
  recommendedNextAction: string
  blocksPhase9: boolean
  status: 'unresolved' | 'monitor' | 'deprecated'
}

export type UnresolvedRepairTracker = {
  generatedAt: string
  items: UnresolvedRepairItem[]
  phase9Blockers: UnresolvedRepairItem[]
  monitorCount: number
  deprecatedCount: number
  behavior: {
    autoAppliesRepairs: false
    deletesOldRepairInfo: false
    requiresHumanApprovalForRepair: true
  }
}

function severityForLedgerEntry(entry: RepairLedgerEntry): UnresolvedRepairSeverity {
  if (entry.status === 'unresolved') return 'high'
  if (entry.remainingWarnings.length > 0) return 'medium'
  return 'low'
}

function ledgerItems(entries: RepairLedgerEntry[]): UnresolvedRepairItem[] {
  return entries
    .filter(entry => entry.status !== 'resolved')
    .map(entry => ({
      id: entry.id,
      severity: severityForLedgerEntry(entry),
      source: entry.sourceRefs[0] ?? 'repair-ledger',
      issue: entry.issue,
      recommendedNextAction: entry.remainingWarnings[0] ?? entry.futureRisk,
      blocksPhase9: entry.status === 'unresolved',
      status: entry.status === 'resolved' ? 'monitor' : entry.status,
    }))
}

function memoryGapItems(sources: RepairMemorySource[]): UnresolvedRepairItem[] {
  return sources
    .filter(source => source.readiness !== 'strong')
    .flatMap(source => source.gaps.map((gap, index) => ({
      id: `repair-memory-${source.category}-${index + 1}`,
      severity: source.readiness === 'missing' ? 'high' as const : 'medium' as const,
      source: source.files[0] ?? source.category,
      issue: gap,
      recommendedNextAction: 'Capture future repairs in lib/repair/repairLedger.ts or docs/repair-ledger.md.',
      blocksPhase9: source.readiness === 'missing',
      status: source.readiness === 'missing' ? 'unresolved' as const : 'monitor' as const,
    })))
}

function providerReadinessItems(): UnresolvedRepairItem[] {
  return PROVIDER_CONFIG_REGISTRY
    .filter(provider => provider.staticStatus === 'missing_provider' || provider.staticStatus === 'missing_api_key')
    .map(provider => ({
      id: `provider-config-${provider.id}`,
      severity: provider.required === 'required' ? 'high' : 'medium',
      source: 'lib/configuration/configurationRegistry.ts',
      issue: `${provider.name} is statically marked ${provider.staticStatus}.`,
      recommendedNextAction: provider.recommendedNextAction,
      blocksPhase9: provider.required === 'required',
      status: 'monitor' as const,
    }))
}

export function buildUnresolvedRepairTracker(params: {
  generatedAt?: string
  ledger?: RepairLedgerEntry[]
  memorySources?: RepairMemorySource[]
  includeProviderReadiness?: boolean
} = {}): UnresolvedRepairTracker {
  const items = [
    ...ledgerItems(params.ledger ?? REPAIR_LEDGER_ENTRIES),
    ...memoryGapItems(params.memorySources ?? REPAIR_MEMORY_SOURCES),
    ...(params.includeProviderReadiness === false ? [] : providerReadinessItems()),
  ]

  return {
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    items,
    phase9Blockers: items.filter(item => item.blocksPhase9),
    monitorCount: items.filter(item => item.status === 'monitor').length,
    deprecatedCount: items.filter(item => item.status === 'deprecated').length,
    behavior: {
      autoAppliesRepairs: false,
      deletesOldRepairInfo: false,
      requiresHumanApprovalForRepair: true,
    },
  }
}
