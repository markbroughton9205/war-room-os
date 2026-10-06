'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  applyGovernorAntiThrash,
  buildLayerGovernorPlan,
  classifyProviderHealth,
  GOVERNED_LAYER_IDS,
  GOVERNOR_MASTER_STORAGE_KEY,
  GOVERNOR_MODES_STORAGE_KEY,
  GOVERNOR_PREFS_STORAGE_KEY,
  learnPresentationPref,
  parseLearnedPrefs,
  providerRetryAllowed,
  resetLearnedPrefs,
  type GovernedLayerId,
  type GovernorSnapshot,
  type LayerGovernorPlan,
  type LayerMode,
  type LearnedPrefs,
  type ResourceState,
} from '@/lib/terra/layerGovernor'

function readMasterAuto(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const raw = window.localStorage.getItem(GOVERNOR_MASTER_STORAGE_KEY)
    if (raw == null) return true
    return raw !== '0'
  } catch {
    return true
  }
}

function readModes(): Partial<Record<GovernedLayerId, LayerMode>> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(GOVERNOR_MODES_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, string>
    const next: Partial<Record<GovernedLayerId, LayerMode>> = {}
    for (const id of GOVERNED_LAYER_IDS) {
      const value = parsed[id]
      if (value === 'AUTO' || value === 'ON' || value === 'OFF') next[id] = value
    }
    return next
  } catch {
    return {}
  }
}

function readLearned(): LearnedPrefs {
  if (typeof window === 'undefined') return {}
  try {
    return parseLearnedPrefs(window.localStorage.getItem(GOVERNOR_PREFS_STORAGE_KEY))
  } catch {
    return {}
  }
}

const NEXT_MODE: Record<LayerMode, LayerMode> = { AUTO: 'ON', ON: 'OFF', OFF: 'AUTO' }

export function governorLayerPresent(effective: string): boolean {
  return effective === 'ACTIVE' || effective === 'DIMMED' || effective === 'PAUSED'
}

export function governorOpacityFactor(effective: string): number {
  if (effective === 'ACTIVE') return 1
  if (effective === 'DIMMED') return 0.55
  if (effective === 'PAUSED') return 0.4
  return 0
}

type HealthMemory = {
  consecutiveFailures: number
  lastAttemptMs: number | null
  lastState: string
}

function noteHealth(memory: HealthMemory, state: string, nowMs: number): HealthMemory {
  const health = classifyProviderHealth({ state })
  if (state === memory.lastState) return memory
  if (health === 'HEALTHY') {
    return { consecutiveFailures: 0, lastAttemptMs: nowMs, lastState: state }
  }
  return {
    consecutiveFailures: memory.consecutiveFailures + 1,
    lastAttemptMs: nowMs,
    lastState: state,
  }
}

export function useTerraLayerGovernor(snapshot: Omit<GovernorSnapshot, 'masterAuto' | 'layerModes' | 'learned' | 'previousResource' | 'previousPrefetchKey'>): {
  plan: LayerGovernorPlan
  masterAuto: boolean
  setMasterAuto: (value: boolean) => void
  cycleLayer: (id: GovernedLayerId) => void
  setLayerMode: (id: GovernedLayerId, mode: LayerMode) => void
  resetLearned: () => void
  noteInteraction: () => void
  lastInteractionMs: number
  learnStreetCloudOpacity: (value: number) => void
  learnCityRadarOpacity: (value: number) => void
} {
  const [masterAuto, setMasterAutoState] = useState(readMasterAuto)
  const [layerModes, setLayerModes] = useState(readModes)
  const [learned, setLearned] = useState(readLearned)
  const [lastInteractionMs, setLastInteractionMs] = useState(0)
  const previousPlanRef = useRef<LayerGovernorPlan | null>(null)
  const lastChangeMsRef = useRef<Partial<Record<GovernedLayerId, number>>>({})
  const previousResourceRef = useRef<ResourceState | undefined>(undefined)
  const previousPrefetchKeyRef = useRef<string | null>(null)
  const radarHealthRef = useRef<HealthMemory>({ consecutiveFailures: 0, lastAttemptMs: null, lastState: '' })
  const cloudHealthRef = useRef<HealthMemory>({ consecutiveFailures: 0, lastAttemptMs: null, lastState: '' })

  const setMasterAuto = useCallback((value: boolean) => {
    setMasterAutoState(value)
    try { window.localStorage.setItem(GOVERNOR_MASTER_STORAGE_KEY, value ? '1' : '0') } catch { /* ignore */ }
  }, [])

  const persistModes = useCallback((next: Partial<Record<GovernedLayerId, LayerMode>>) => {
    setLayerModes(next)
    try { window.localStorage.setItem(GOVERNOR_MODES_STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }, [])

  const persistLearned = useCallback((next: LearnedPrefs) => {
    setLearned(next)
    try { window.localStorage.setItem(GOVERNOR_PREFS_STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }, [])

  const setLayerMode = useCallback((id: GovernedLayerId, mode: LayerMode) => {
    persistModes({ ...layerModes, [id]: mode })
  }, [layerModes, persistModes])

  const cycleLayer = useCallback((id: GovernedLayerId) => {
    persistModes({ ...layerModes, [id]: NEXT_MODE[layerModes[id] ?? 'AUTO'] })
  }, [layerModes, persistModes])

  const resetLearned = useCallback(() => {
    persistLearned(resetLearnedPrefs())
  }, [persistLearned])

  const noteInteraction = useCallback(() => {
    setLastInteractionMs(Date.now())
  }, [])

  const learnStreetCloudOpacity = useCallback((value: number) => {
    persistLearned(learnPresentationPref(learned, { streetCloudOpacity: value }))
  }, [learned, persistLearned])

  const learnCityRadarOpacity = useCallback((value: number) => {
    persistLearned(learnPresentationPref(learned, { cityRadarOpacity: value }))
  }, [learned, persistLearned])

  const plan = useMemo(() => {
    const nowMs = Date.now()
    radarHealthRef.current = noteHealth(radarHealthRef.current, snapshot.radarState, nowMs)
    cloudHealthRef.current = noteHealth(cloudHealthRef.current, snapshot.cloudsTruth, nowMs)
    const radarRetryAllowed = snapshot.radarRetryAllowed ?? providerRetryAllowed({
      health: classifyProviderHealth({ state: snapshot.radarState }),
      consecutiveFailures: radarHealthRef.current.consecutiveFailures,
      lastAttemptMs: radarHealthRef.current.lastAttemptMs,
      nowMs,
    })
    const cloudRetryAllowed = snapshot.cloudRetryAllowed ?? providerRetryAllowed({
      health: classifyProviderHealth({ state: snapshot.cloudsTruth }),
      consecutiveFailures: cloudHealthRef.current.consecutiveFailures,
      lastAttemptMs: cloudHealthRef.current.lastAttemptMs,
      nowMs,
    })
    const next = buildLayerGovernorPlan({
      ...snapshot,
      nowMs,
      masterAuto,
      layerModes,
      learned,
      previousResource: previousResourceRef.current,
      previousPrefetchKey: previousPrefetchKeyRef.current,
      radarRetryAllowed,
      cloudRetryAllowed,
    })
    const held = applyGovernorAntiThrash({
      previous: previousPlanRef.current,
      next,
      nowMs,
      lastChangeMs: lastChangeMsRef.current,
    })
    lastChangeMsRef.current = held.lastChangeMs
    previousPlanRef.current = held.plan
    previousResourceRef.current = held.plan.resource
    previousPrefetchKeyRef.current = held.plan.prefetch.key || null
    return held.plan
  }, [snapshot, masterAuto, layerModes, learned])

  return {
    plan,
    masterAuto,
    setMasterAuto,
    cycleLayer,
    setLayerMode,
    resetLearned,
    noteInteraction,
    lastInteractionMs,
    learnStreetCloudOpacity,
    learnCityRadarOpacity,
  }
}
