'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import type { TerraWorkspacePanelId } from '@/lib/terra/workspace/panelIds'
import {
  TERRA_MISSION_DEFAULT_SECTION,
  hostsForPanel,
  openTargetForPanel,
  slotKey,
  type TerraMissionDrawerId,
  type TerraMissionHost,
  type TerraMissionSectionId,
} from '@/lib/terra/missionControl/mapping'

export type TerraMissionControlApi = {
  chromeEnabled: boolean
  setChromeEnabled: (enabled: boolean) => void
  drawer: TerraMissionDrawerId | null
  section: TerraMissionSectionId | null
  openDrawer: (drawer: TerraMissionDrawerId, section?: TerraMissionSectionId) => void
  closeDrawer: () => void
  toggleDrawer: (drawer: TerraMissionDrawerId, section?: TerraMissionSectionId) => void
  openForPanel: (id: TerraWorkspacePanelId) => void
  registerSlot: (key: string, node: HTMLElement | null) => void
  slotNode: (key: string) => HTMLElement | null
  slotForHost: (host: TerraMissionHost) => HTMLElement | null
  activeSlotKeyForPanel: (id: TerraWorkspacePanelId) => string | null
}

const TerraMissionControlContext = createContext<TerraMissionControlApi | null>(null)

export function TerraMissionControlProvider({
  children,
}: {
  children: ReactNode
}) {
  const [chromeEnabled, setChromeEnabledState] = useState(true)
  const [view, setView] = useState<{ drawer: TerraMissionDrawerId | null; section: TerraMissionSectionId | null }>({
    drawer: null,
    section: null,
  })
  const slotsRef = useRef<Map<string, HTMLElement>>(new Map())
  const [slotGeneration, setSlotGeneration] = useState(0)

  const registerSlot = useCallback((key: string, node: HTMLElement | null) => {
    const slots = slotsRef.current
    if (!node) {
      if (slots.has(key)) {
        slots.delete(key)
        setSlotGeneration(value => value + 1)
      }
      return
    }
    if (slots.get(key) === node) return
    slots.set(key, node)
    setSlotGeneration(value => value + 1)
  }, [])

  const setChromeEnabled = useCallback((enabled: boolean) => {
    setChromeEnabledState(enabled)
  }, [])

  const openDrawer = useCallback((nextDrawer: TerraMissionDrawerId, nextSection?: TerraMissionSectionId) => {
    setView({ drawer: nextDrawer, section: nextSection ?? TERRA_MISSION_DEFAULT_SECTION[nextDrawer] })
  }, [])

  const closeDrawer = useCallback(() => {
    setView({ drawer: null, section: null })
  }, [])

  const toggleDrawer = useCallback((nextDrawer: TerraMissionDrawerId, nextSection?: TerraMissionSectionId) => {
    const resolved = nextSection ?? TERRA_MISSION_DEFAULT_SECTION[nextDrawer]
    setView(current => {
      if (current.drawer === nextDrawer && (!nextSection || current.section === resolved)) {
        return { drawer: null, section: null }
      }
      return { drawer: nextDrawer, section: resolved }
    })
  }, [])

  const openForPanel = useCallback((id: TerraWorkspacePanelId) => {
    const target = openTargetForPanel(id)
    if (!target) return
    setView(target)
  }, [])

  const slotNode = useCallback((key: string) => {
    return slotsRef.current.get(key) ?? null
  }, [])

  const slotForHost = useCallback((host: TerraMissionHost) => {
    return slotsRef.current.get(slotKey(host)) ?? null
  }, [])

  const activeSlotKeyForPanel = useCallback((id: TerraWorkspacePanelId) => {
    const hosts = hostsForPanel(id)
    for (const host of hosts) {
      if (host.kind === 'drawer') {
        if (view.drawer === host.drawer && view.section === host.section) return slotKey(host)
        continue
      }
      return slotKey(host)
    }
    return null
  }, [view.drawer, view.section])

  const api = useMemo<TerraMissionControlApi>(() => {
    void slotGeneration
    return {
    chromeEnabled,
    setChromeEnabled,
    drawer: view.drawer,
    section: view.section,
    openDrawer,
    closeDrawer,
    toggleDrawer,
    openForPanel,
    registerSlot,
    slotNode,
    slotForHost,
    activeSlotKeyForPanel,
    }
  }, [activeSlotKeyForPanel, chromeEnabled, closeDrawer, openDrawer, openForPanel, registerSlot, setChromeEnabled, slotForHost, slotGeneration, slotNode, toggleDrawer, view.drawer, view.section])

  return (
    <TerraMissionControlContext.Provider value={api}>
      {children}
    </TerraMissionControlContext.Provider>
  )
}

export function useTerraMissionControl(): TerraMissionControlApi {
  const api = useContext(TerraMissionControlContext)
  if (!api) throw new Error('Terra mission-control chrome requires TerraMissionControlProvider')
  return api
}

export function useTerraMissionControlOptional(): TerraMissionControlApi | null {
  return useContext(TerraMissionControlContext)
}
