import type { AdminIdentityPrefs, AdminSublayerId, AdminSublayerModes } from './types'
import { ADMIN_IDENTITY_STORAGE_KEY, ADMIN_SUBLAYER_IDS } from './types'
import { DEFAULT_ADMIN_SUBMODES } from './presentation'
import type { LayerMode } from '@/lib/terra/layerGovernor/types'

export { ADMIN_IDENTITY_STORAGE_KEY, ADMIN_SUBLAYER_IDS }

export function defaultAdminIdentityPrefs(): AdminIdentityPrefs {
  return { subModes: { ...DEFAULT_ADMIN_SUBMODES }, flagOpacityOverride: null }
}

export function parseAdminIdentityPrefs(raw: string | null): AdminIdentityPrefs {
  const fallback = defaultAdminIdentityPrefs()
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw) as Partial<AdminIdentityPrefs>
    const subModes: AdminSublayerModes = { ...DEFAULT_ADMIN_SUBMODES }
    const incoming = parsed.subModes ?? {}
    for (const id of ADMIN_SUBLAYER_IDS) {
      const value = (incoming as Record<string, string>)[id]
      if (value === 'AUTO' || value === 'ON' || value === 'OFF') subModes[id] = value
    }
    const override = parsed.flagOpacityOverride
    return {
      subModes,
      flagOpacityOverride: typeof override === 'number' && Number.isFinite(override) ? Math.min(1, Math.max(0, override)) : null,
    }
  } catch {
    return fallback
  }
}

export function cycleAdminSubMode(current: LayerMode): LayerMode {
  if (current === 'AUTO') return 'ON'
  if (current === 'ON') return 'OFF'
  return 'AUTO'
}

export function isAdminSublayerId(value: string): value is AdminSublayerId {
  return (ADMIN_SUBLAYER_IDS as readonly string[]).includes(value)
}
