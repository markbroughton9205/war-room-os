'use client'

import { useEffect, useState } from 'react'
import { useApplicationActivity } from '@/lib/ui/applicationActivity'
import type { PlanetStatus } from '@/lib/council/immersive/planets'

/** Polls the read-only planet status route. Slows down when the app is unfocused and stops when hidden, so it never competes with inference. */
export function usePlanets(fast = false): { planets: PlanetStatus[] | null; error: string | null; refreshedAt: string | null } {
  const activity = useApplicationActivity()
  const [planets, setPlanets] = useState<PlanetStatus[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null)
  const visible = activity.visible
  const mult = activity.pollingMultiplier

  useEffect(() => {
    if (!visible) return
    let stop = false
    const load = async () => {
      try {
        const res = await fetch('/api/council/immersive/planets', { cache: 'no-store' })
        if (!res.ok) { if (!stop) { setPlanets(null); setError(`Planet status unavailable (HTTP ${res.status})`) } return }
        const j = await res.json() as { planets?: PlanetStatus[]; generatedAt?: string }
        if (!stop && Array.isArray(j.planets)) { setPlanets(j.planets); setError(null); setRefreshedAt(j.generatedAt ?? null) }
      } catch (e) {
        if (!stop) { setPlanets(null); setError('Planet status unavailable') }
      }
    }
    void load()
    const t = window.setInterval(() => { void load() }, (fast ? 3000 : 8000) * mult)
    return () => { stop = true; window.clearInterval(t) }
  }, [visible, mult, fast])

  return { planets, error, refreshedAt }
}
