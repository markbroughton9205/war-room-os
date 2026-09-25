import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { foundryDataHierarchy } from './foundryPaths'
import type { FoundryProviderHealth } from './foundryOperationsTypes'

function healthPath(): string {
  return path.join(foundryDataHierarchy().operations, 'provider-health.json')
}

export async function loadProviderHealth(): Promise<FoundryProviderHealth[]> {
  if (!existsSync(healthPath())) return []
  try {
    return JSON.parse(await readFile(healthPath(), 'utf8')) as FoundryProviderHealth[]
  } catch {
    return []
  }
}

async function saveProviderHealth(rows: FoundryProviderHealth[]): Promise<void> {
  await writeFile(healthPath(), JSON.stringify(rows, null, 2), 'utf8')
}

function upsert(
  rows: FoundryProviderHealth[],
  provider: string,
  modelId: string | null,
): FoundryProviderHealth {
  const found = rows.find(row => row.provider === provider && row.modelId === modelId)
  if (found) return found
  const created: FoundryProviderHealth = {
    provider,
    modelId,
    healthy: true,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    transientOutage: false,
    consecutiveFailures: 0,
    nextRetryAt: null,
    fallbackEligible: false,
  }
  rows.push(created)
  return created
}

export async function recordProviderSuccess(provider: string, modelId: string | null): Promise<FoundryProviderHealth> {
  const rows = await loadProviderHealth()
  const row = upsert(rows, provider, modelId)
  row.healthy = true
  row.transientOutage = false
  row.consecutiveFailures = 0
  row.lastSuccessAt = new Date().toISOString()
  row.lastError = null
  row.nextRetryAt = null
  await saveProviderHealth(rows)
  return row
}

export async function recordProviderFailure(
  provider: string,
  modelId: string | null,
  error: string,
  failureClass: string,
): Promise<FoundryProviderHealth> {
  const rows = await loadProviderHealth()
  const row = upsert(rows, provider, modelId)
  row.consecutiveFailures += 1
  row.lastFailureAt = new Date().toISOString()
  row.lastError = error.slice(0, 400)
  const transient = failureClass === 'PROVIDER' || failureClass === 'TIMEOUT' || failureClass === 'UNAVAILABLE'
  row.transientOutage = transient
  row.healthy = row.consecutiveFailures < 3
  row.nextRetryAt = new Date(Date.now() + Math.min(30_000, 2_000 * (2 ** (row.consecutiveFailures - 1)))).toISOString()
  row.fallbackEligible = false
  await saveProviderHealth(rows)
  return row
}

export function providerRetryDelayMs(health: FoundryProviderHealth): number {
  if (!health.nextRetryAt) return 0
  return Math.max(0, Date.parse(health.nextRetryAt) - Date.now())
}
