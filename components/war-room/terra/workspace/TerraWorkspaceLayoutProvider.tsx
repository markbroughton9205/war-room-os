'use client'

import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Viewer as CesiumViewer } from 'cesium'
import { TerraWorkspaceLayoutStore, type TerraWorkspaceAttentionState, type WorkspacePanelSize, type WorkspaceViewport } from './terraWorkspaceStore'
import { setTerraGlobeInputsEnabled } from './isolateTerraGlobeInputs'
import { type TerraWorkspacePanelId } from '@/lib/terra/workspace/panelIds'
import type { TerraWorkspacePanelRecord } from '@/lib/terra/workspace/layout'
import { useTerraMissionControlOptional } from '../mission-control/TerraMissionControlProvider'

export type LayoutApi = {
  store: TerraWorkspaceLayoutStore
  getViewer: () => CesiumViewer | null
  getViewport: () => WorkspaceViewport
  isolateGlobe: (isolated: boolean) => void
  registerSize: (id: TerraWorkspacePanelId, size: WorkspacePanelSize) => void
  getSizes: () => Partial<Record<TerraWorkspacePanelId, WorkspacePanelSize>>
}

const TerraWorkspaceLayoutContext = createContext<LayoutApi | null>(null)

const EMPTY_RECORD: TerraWorkspacePanelRecord = {
  x: 12,
  y: 12,
  vw: 1280,
  vh: 720,
  locked: false,
  minimized: false,
  dock: 'float',
  closed: false,
}

function readViewport(node: HTMLElement | null): WorkspaceViewport {
  const rect = node?.getBoundingClientRect()
  return {
    width: Math.max(1, Math.round(rect?.width ?? window.innerWidth)),
    height: Math.max(1, Math.round(rect?.height ?? window.innerHeight)),
  }
}

function createHydratedStore(): TerraWorkspaceLayoutStore {
  const store = new TerraWorkspaceLayoutStore()
  if (typeof window !== 'undefined') {
    store.hydrateFromStorage({ width: window.innerWidth, height: window.innerHeight })
  }
  return store
}

export function TerraWorkspaceLayoutProvider({
  viewer,
  children,
  onApiReady,
}: {
  viewer: CesiumViewer | null
  children: ReactNode
  /** Lets the component that renders this provider (e.g. TerraShell, which owns the click
   * handlers that need to route into Smart Click) reach the same store instance imperatively —
   * the context hook only works for the provider's own descendants, not its ancestor. Fires
   * once the provider's memoized api is ready; never creates a second store/provider. */
  onApiReady?: (api: LayoutApi) => void
}) {
  const [store] = useState(createHydratedStore)
  const mission = useTerraMissionControlOptional()
  const missionRef = useRef(mission)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewerRef = useRef(viewer)
  const sizesRef = useRef<Partial<Record<TerraWorkspacePanelId, WorkspacePanelSize>>>({})

  const api = useMemo<LayoutApi>(() => ({
    store,
    getViewer: () => viewerRef.current,
    getViewport: () => readViewport(hostRef.current),
    isolateGlobe: (isolated: boolean) => {
      setTerraGlobeInputsEnabled(viewerRef.current, !isolated)
    },
    registerSize: (id, size) => {
      sizesRef.current[id] = size
    },
    getSizes: () => sizesRef.current,
  }), [store])

  useEffect(() => {
    missionRef.current = mission
  }, [mission])

  useEffect(() => {
    viewerRef.current = viewer
  }, [viewer])

  useEffect(() => {
    onApiReady?.(api)
  }, [api, onApiReady])

  useEffect(() => {
    const syncChrome = () => {
      const current = missionRef.current
      if (!current) return
      current.setChromeEnabled(store.getSnapshot().settings.missionControlChrome)
    }
    syncChrome()
    return store.subscribe(syncChrome)
  }, [store])

  useEffect(() => {
    const host = hostRef.current
    store.hydrateFromStorage(readViewport(host))
    const onResize = () => store.reconcile(readViewport(hostRef.current), sizesRef.current)
    window.addEventListener('resize', onResize)
    const observer = host ? new ResizeObserver(onResize) : null
    if (host) observer?.observe(host)
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || !event.shiftKey) return
      if (event.key === 'R' || event.key === 'r') {
        event.preventDefault()
        store.reset(readViewport(hostRef.current), sizesRef.current)
        return
      }
      if (event.key === 'O' || event.key === 'o') {
        const target = event.target as HTMLElement | null
        if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return
        event.preventDefault()
        store.smartOrganize(readViewport(hostRef.current), sizesRef.current)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKey)
      observer?.disconnect()
      setTerraGlobeInputsEnabled(viewerRef.current, true)
    }
  }, [store])

  return (
    <TerraWorkspaceLayoutContext.Provider value={api}>
      <div ref={hostRef} className="pointer-events-none absolute inset-0 z-[45]" data-testid="terra-workspace-overlay">
        {children}
      </div>
    </TerraWorkspaceLayoutContext.Provider>
  )
}

export function useTerraWorkspaceLayoutApi(): LayoutApi {
  const api = useContext(TerraWorkspaceLayoutContext)
  if (!api) throw new Error('Terra workspace panels require TerraWorkspaceLayoutProvider')
  return api
}

export function useTerraWorkspaceLayoutApiOptional(): LayoutApi | null {
  return useContext(TerraWorkspaceLayoutContext)
}

export function useTerraWorkspacePanelState(id: TerraWorkspacePanelId): {
  record: TerraWorkspacePanelRecord
  exists: boolean
  rank: number
  dragging: boolean
  attention: TerraWorkspaceAttentionState | undefined
  store: TerraWorkspaceLayoutStore
  api: LayoutApi
} {
  const api = useTerraWorkspaceLayoutApi()
  const snapshot = useSyncExternalStore(api.store.subscribe, api.store.getSnapshot, api.store.getSnapshot)
  return {
    record: snapshot.panels[id] ?? EMPTY_RECORD,
    exists: Boolean(snapshot.panels[id]),
    rank: snapshot.zOrder.indexOf(id) < 0 ? snapshot.zOrder.length : snapshot.zOrder.indexOf(id),
    dragging: snapshot.draggingId === id,
    attention: snapshot.attention[id],
    store: api.store,
    api,
  }
}

export function useTerraWorkspaceReset(): () => void {
  const api = useTerraWorkspaceLayoutApi()
  return () => api.store.reset(api.getViewport())
}
