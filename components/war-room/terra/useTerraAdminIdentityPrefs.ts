'use client'

import { useCallback, useEffect, useState } from 'react'
import type { LayerMode } from '@/lib/terra/layerGovernor'
import {
  ADMIN_IDENTITY_STORAGE_KEY,
  cycleAdminSubMode,
  defaultAdminIdentityPrefs,
  parseAdminIdentityPrefs,
  type AdminIdentityPrefs,
  type AdminSublayerId,
} from '@/lib/terra/adminIdentity'

const EVENT = 'terra-admin-identity-prefs'

function readPrefs(): AdminIdentityPrefs {
  if (typeof window === 'undefined') return defaultAdminIdentityPrefs()
  try {
    return parseAdminIdentityPrefs(window.localStorage.getItem(ADMIN_IDENTITY_STORAGE_KEY))
  } catch {
    return defaultAdminIdentityPrefs()
  }
}

function writePrefs(prefs: AdminIdentityPrefs): void {
  try {
    window.localStorage.setItem(ADMIN_IDENTITY_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT))
}

export function useTerraAdminIdentityPrefs(): {
  prefs: AdminIdentityPrefs
  cycleSub: (id: AdminSublayerId) => void
  setFlagOpacity: (value: number | null) => void
} {
  const [prefs, setPrefs] = useState<AdminIdentityPrefs>(defaultAdminIdentityPrefs)

  useEffect(() => {
    const sync = () => setPrefs(readPrefs())
    sync()
    window.addEventListener(EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const cycleSub = useCallback((id: AdminSublayerId) => {
    setPrefs(current => {
      const next: AdminIdentityPrefs = {
        ...current,
        subModes: { ...current.subModes, [id]: cycleAdminSubMode(current.subModes[id] as LayerMode) },
      }
      writePrefs(next)
      return next
    })
  }, [])

  const setFlagOpacity = useCallback((value: number | null) => {
    setPrefs(current => {
      const next: AdminIdentityPrefs = { ...current, flagOpacityOverride: value }
      writePrefs(next)
      return next
    })
  }, [])

  return { prefs, cycleSub, setFlagOpacity }
}
