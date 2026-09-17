'use client'

import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import type { Viewer as CesiumViewer } from 'cesium'
import { TerraWorkspaceLayoutStore, type WorkspacePanelSize, type WorkspaceViewport } from './terraWorkspaceStore'
import { setTerraGlobeInputsEnabled } from './isolateTerraGlobeInputs'
import type { TerraWorkspacePanelId } from '@/lib/terra/workspace/panelIds'
import type { TerraWorkspacePanelRecord } from '@/lib/terra/workspace/layout'

type LayoutApi = {
  store: TerraWorkspaceLayoutStore
  getViewer: () => CesiumViewer | null
  getViewport: () => WorkspaceViewport
  isolateGlobe: (isolated: boolean) => void
  registerSize: (id: TerraWorkspacePanelId, size: WorkspacePanelSize) => void
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
}

function readViewport(node: HTMLElement | null): WorkspaceViewport {
  const rect = node?.getBoundingClientRect()
  return {
    width: Math.max(1, Math.round(rect?.width ?? window.innerWidth)),
    height: Math.max(1, Math.round(rect?.height ?? window.innerHeight)),
  }
}

export function TerraWorkspaceLayoutProvider({
  viewer,
  children,
}: {
  viewer: CesiumViewer | null
  children: ReactNode
}) {
  const storeRef = useRef<TerraWorkspaceLayoutStore | null>(null)
  if (!storeRef.current) storeRef.current = new TerraWorkspaceLayoutStore()
  const store = storeRef.current
  const hydratedRef = useRef(false)
  if (!hydratedRef.current && typeof window !== 'undefined') {
    store.hydrateFromStorage({ width: window.innerWidth, height: window.innerHeight })
    hydratedRef.current = true
  }
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewerRef = useRef(viewer)
  viewerRef.current = viewer
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
  }), [store])

  useEffect(() => {
    const host = hostRef.current
    store.hydrateFromStorage(readViewport(host))
    const onResize = () => store.reconcile(readViewport(hostRef.current), sizesRef.current)
    window.addEventListener('resize', onResize)
    const observer = host ? new ResizeObserver(onResize) : null
    if (host) observer?.observe(host)
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || !event.shiftKey) return
      if (event.key !== 'R' && event.key !== 'r') return
      event.preventDefault()
      store.reset(readViewport(hostRef.current), sizesRef.current)
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

export function useTerraWorkspacePanelState(id: TerraWorkspacePanelId): {
  record: TerraWorkspacePanelRecord
  rank: number
  dragging: boolean
  store: TerraWorkspaceLayoutStore
  api: LayoutApi
} {
  const api = useTerraWorkspaceLayoutApi()
  const snapshot = useSyncExternalStore(api.store.subscribe, api.store.getSnapshot, api.store.getSnapshot)
  return {
    record: snapshot.panels[id] ?? EMPTY_RECORD,
    rank: snapshot.zOrder.indexOf(id) < 0 ? snapshot.zOrder.length : snapshot.zOrder.indexOf(id),
    dragging: snapshot.draggingId === id,
    store: api.store,
    api,
  }
}

export function useTerraWorkspaceReset(): () => void {
  const api = useTerraWorkspaceLayoutApi()
  return () => api.store.reset(api.getViewport())
}
