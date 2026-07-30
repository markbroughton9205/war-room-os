/**
 * Reduces one /api/runtime/canonical-status response into the flat provider/label maps
 * app/page.tsx's widely-shared providerHealth state needs. Kept separate from app/page.tsx so
 * both the reduction logic and "one response feeds both providerConnection and canonicalStatus"
 * can be exercised outside a browser/React tree.
 */

export type ReducedProviderConnectionStatus = 'online' | 'standby' | 'error' | 'not_connected'

export type CanonicalStatusProviderRow = {
  family: string
  label?: string
  connectionStatus?: string
}

export type CanonicalStatusResponseShape = {
  providers?: CanonicalStatusProviderRow[]
}

export function deriveProviderHealthFromCanonicalStatus<TFamily extends string>(
  data: CanonicalStatusResponseShape,
  defaults: {
    providers: Record<TFamily, ReducedProviderConnectionStatus>
    labels: Record<TFamily, string>
  },
): { providers: Record<TFamily, ReducedProviderConnectionStatus>; labels: Record<TFamily, string> } {
  const providers = { ...defaults.providers }
  const labels = { ...defaults.labels }
  for (const row of data.providers ?? []) {
    if (row.family in providers) {
      const family = row.family as TFamily
      providers[family] = (row.connectionStatus as ReducedProviderConnectionStatus) ?? 'not_connected'
      labels[family] = row.label ?? row.family
    }
  }
  return { providers, labels }
}
