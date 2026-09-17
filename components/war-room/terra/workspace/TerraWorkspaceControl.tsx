'use client'

import { useState, useSyncExternalStore } from 'react'
import { useTerraWorkspaceLayoutApi } from './TerraWorkspaceLayoutProvider'
import type { TerraWorkspacePreset } from '@/lib/terra/workspace/layout'
import type { TerraWorkspaceDock } from '@/lib/terra/workspace/layout'

export function TerraWorkspaceControl() {
  const api = useTerraWorkspaceLayoutApi()
  const settings = useSyncExternalStore(api.store.subscribe, api.store.getSnapshot, api.store.getSnapshot).settings
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const viewport = () => api.getViewport()
  const sizes = () => ({}) as Parameters<typeof api.store.applyPreset>[2]

  const runPreset = (preset: TerraWorkspacePreset) => {
    api.store.applyPreset(preset, viewport(), sizes())
  }

  const dockRail = (dock: TerraWorkspaceDock) => {
    api.store.setDock('left_rail', dock, viewport(), { width: 224, height: 480 })
    if (dock !== 'float') api.store.setMinimized('left_rail', false)
  }

  return (
    <div className="w-[13.5rem] rounded-b-lg border border-t-0 border-cyan-300/25 bg-black/80 p-1.5 text-[10px] text-slate-300" data-testid="terra-workspace-control">
      <p className="sr-only">Alt+Shift+R resets layout, Alt+Shift+O runs Smart Organize, even if panels cover this control.</p>
      <div className="grid grid-cols-2 gap-1">
        <button type="button" className="rounded border border-cyan-300/40 px-1 py-0.5 text-[8px] font-bold uppercase tracking-widest text-cyan-200" data-testid="terra-workspace-reset-layout" onClick={() => api.store.reset(viewport())}>Reset</button>
        <button type="button" className="rounded border border-white/15 px-1 py-0.5 text-[8px] uppercase tracking-widest" data-testid="terra-workspace-save" onClick={() => { api.store.persistNow(); setSavedAt(new Date().toISOString()) }}>Save</button>
        <button type="button" className="col-span-2 rounded border border-cyan-300/25 px-1 py-0.5 text-[8px] font-bold uppercase tracking-widest text-cyan-200/90" data-testid="terra-workspace-smart-organize" title="Arrange the currently open panels; press Save to keep it" onClick={() => api.store.smartOrganize(viewport(), api.getSizes())}>Smart Organize</button>
        <button type="button" className="rounded border border-white/15 px-1 py-0.5 text-[8px] uppercase tracking-widest" data-testid="terra-workspace-lock-all" onClick={() => api.store.lockAll(true)}>Lock all</button>
        <button type="button" className="rounded border border-white/15 px-1 py-0.5 text-[8px] uppercase tracking-widest" data-testid="terra-workspace-unlock-all" onClick={() => api.store.lockAll(false)}>Unlock all</button>
        <button type="button" className="rounded border border-white/15 px-1 py-0.5 text-[8px] uppercase tracking-widest" data-testid="terra-workspace-minimize-all" onClick={() => api.store.minimizeFloating(true)}>Min float</button>
        <button type="button" className="rounded border border-white/15 px-1 py-0.5 text-[8px] uppercase tracking-widest" data-testid="terra-workspace-restore-all" onClick={() => api.store.restoreAll()}>Restore</button>
      </div>
      <p className="mt-1 text-[8px] uppercase tracking-widest text-slate-500">Smart</p>
      <div className="mt-0.5 grid grid-cols-2 gap-1">
        <button
          type="button"
          className={`rounded border px-1 py-0.5 text-[8px] uppercase tracking-widest ${settings.smartClick ? 'border-cyan-300/40 text-cyan-200' : 'border-white/15 text-slate-400'}`}
          aria-pressed={settings.smartClick}
          data-testid="terra-workspace-smart-click-toggle"
          title="Bring clicked panels to front and recover them into view; off leaves plain click-to-front only"
          onClick={() => api.store.setSmartClickEnabled(!settings.smartClick)}
        >
          Click {settings.smartClick ? 'ON' : 'OFF'}
        </button>
        <button
          type="button"
          className={`rounded border px-1 py-0.5 text-[8px] uppercase tracking-widest ${settings.smartOpen ? 'border-cyan-300/40 text-cyan-200' : 'border-white/15 text-slate-400'}`}
          aria-pressed={settings.smartOpen}
          data-testid="terra-workspace-smart-open-toggle"
          title="When on, a relevant minimized panel may auto-restore instead of only pulsing"
          onClick={() => api.store.setSmartOpenEnabled(!settings.smartOpen)}
        >
          Open {settings.smartOpen ? 'ON' : 'OFF'}
        </button>
      </div>
      <p className="mt-1 text-[8px] uppercase tracking-widest text-slate-500">Presets</p>
      <div className="mt-0.5 flex flex-wrap gap-1">
        <button type="button" className="rounded border border-white/15 px-1 py-0.5 text-[8px] uppercase tracking-widest" data-testid="terra-workspace-preset-default" onClick={() => runPreset('default')}>Default</button>
        <button type="button" className="rounded border border-white/15 px-1 py-0.5 text-[8px] uppercase tracking-widest" data-testid="terra-workspace-preset-globe" onClick={() => runPreset('globe_focus')}>Globe</button>
        <button type="button" className="rounded border border-white/15 px-1 py-0.5 text-[8px] uppercase tracking-widest" data-testid="terra-workspace-preset-intel" onClick={() => runPreset('intel_focus')}>Intel</button>
      </div>
      <p className="mt-1 text-[8px] uppercase tracking-widest text-slate-500">Rail</p>
      <div className="mt-0.5 flex flex-wrap gap-1">
        <button type="button" className="rounded border border-white/15 px-1 py-0.5 text-[8px] uppercase tracking-widest" data-testid="terra-workspace-rail-left" onClick={() => dockRail('left')}>Left</button>
        <button type="button" className="rounded border border-white/15 px-1 py-0.5 text-[8px] uppercase tracking-widest" data-testid="terra-workspace-rail-right" onClick={() => dockRail('right')}>Right</button>
        <button type="button" className="rounded border border-white/15 px-1 py-0.5 text-[8px] uppercase tracking-widest" data-testid="terra-workspace-rail-float" onClick={() => dockRail('float')}>Float</button>
        <button type="button" className="rounded border border-white/15 px-1 py-0.5 text-[8px] uppercase tracking-widest" data-testid="terra-workspace-rail-collapse" onClick={() => api.store.setMinimized('left_rail', true)}>Collapse</button>
      </div>
      {savedAt ? <p className="mt-1 text-[8px] uppercase tracking-widest text-emerald-300/80" data-testid="terra-workspace-saved">Layout saved</p> : null}
    </div>
  )
}
