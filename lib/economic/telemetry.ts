import type {
  EconomicFamily,
  EconomicOperationalDomainId,
  EconomicTelemetryCategory,
  EconomicTelemetryEvent,
  ProviderEffectivenessSnapshot,
} from '@/lib/economic/types'

export type CreateEconomicTelemetryInput = {
  category: EconomicTelemetryCategory
  metric_name: string
  metric_value: number
  provider_family?: EconomicFamily | null
  domain_id?: EconomicOperationalDomainId | null
  metadata?: Record<string, unknown>
}

export function createTelemetryEvent(input: CreateEconomicTelemetryInput): EconomicTelemetryEvent {
  return {
    id: crypto.randomUUID(),
    category: input.category,
    provider_family: input.provider_family ?? null,
    domain_id: input.domain_id ?? null,
    metric_name: input.metric_name.trim().slice(0, 200),
    metric_value: Number.isFinite(input.metric_value) ? input.metric_value : 0,
    recorded_at: new Date().toISOString(),
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
  }
}

export function computeWorkflowCompletionRate(completed: number, failed: number, active: number): number {
  const total = completed + failed + active
  if (total <= 0) return 0
  return completed / total
}

export function computeProviderSuccessRate(snapshot: ProviderEffectivenessSnapshot): number {
  const total = snapshot.success_count + snapshot.failure_count
  if (total <= 0) return 0
  return snapshot.success_count / total
}
