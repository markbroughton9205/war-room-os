'use client'

/**
 * Terra Foundation (Phase G) — the instrumentation shell around TerraGlobe.
 *
 * Every panel here is an honestly-labeled PLACEHOLDER for Phase H/I/J/K work (Earth Knowledge,
 * Live Council, time engine, hardening) — none of them are wired to real data yet, and none of
 * them fabricate data to look otherwise. This matches this repo's "no fake dashboards, empty-but-
 * real systems only" standard: an empty state that says so, not a populated-looking mock.
 *
 * Per the Terra runtime rule, this shell introduces NO parallel runtime, Council, provider system,
 * Earth Knowledge registry, Research Engine, audit system, or approval system — it is a client
 * shell only. Real Mission Runtime wiring (a TerraMissionExecutionStrategy alongside the existing
 * engineering one) is explicitly deferred to a later Terra phase, not invented here to make the
 * shell look more finished than it is.
 */
import { useState } from 'react'
import dynamic from 'next/dynamic'
import type { TerraGlobeStatus } from './TerraGlobe'

const TerraGlobe = dynamic(() => import('./TerraGlobe').then(m => m.TerraGlobe), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex h-full w-full items-center justify-center bg-black">
      <p className="font-mono text-xs uppercase tracking-widest text-emerald-500/60">Loading globe engine…</p>
    </div>
  ),
})

function StatusLine({ status }: { status: TerraGlobeStatus }) {
  if (status.phase === 'loading') {
    return <span className="text-slate-500">Initializing…</span>
  }
  if (status.phase === 'error') {
    return <span className="text-amber-400">Globe failed to initialize: {status.message}</span>
  }
  const imageryLabel = status.imageryTier === 'photorealistic_3d_tiles' ? 'Google Photorealistic 3D Tiles' : 'OpenStreetMap (no credential required)'
  return (
    <span className="text-emerald-400">
      Base imagery: {imageryLabel}
      {!status.hasIonToken && <span className="text-slate-500"> · Cesium ion token not configured — terrain/Bing tiers unavailable</span>}
    </span>
  )
}

function PlaceholderPanel({ title, note }: { title: string; note: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/60 p-3 backdrop-blur-sm">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-emerald-400/80">{title}</p>
      <p className="text-[11px] leading-snug text-slate-500">{note}</p>
    </div>
  )
}

export function TerraShell() {
  const [globeStatus, setGlobeStatus] = useState<TerraGlobeStatus>({ phase: 'loading' })

  return (
    <div className="relative h-screen w-full overflow-hidden bg-black text-white">
      <TerraGlobe onStatusChange={setGlobeStatus} />

      {/* Top instrumentation bar — mission status + identity. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4">
        <div className="pointer-events-auto rounded border border-white/10 bg-black/70 px-3 py-2 backdrop-blur-sm">
          <h1 className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-400">War Room · Terra</h1>
          <p className="mt-0.5 text-[10px] text-slate-500">Planetary Intelligence Environment — Foundation (Phase G)</p>
        </div>
        <div className="pointer-events-auto rounded border border-white/10 bg-black/70 px-3 py-2 text-[11px] backdrop-blur-sm">
          <StatusLine status={globeStatus} />
        </div>
      </div>

      {/* Left rail — layer controls + Earth Knowledge placeholder. */}
      <div className="pointer-events-none absolute left-0 top-20 flex w-64 flex-col gap-2 p-4">
        <div className="pointer-events-auto rounded border border-white/10 bg-black/60 p-3 backdrop-blur-sm">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-cyan-400/80">Layer Controls</p>
          <ul className="space-y-1 text-[11px] text-slate-400">
            <li className="flex items-center justify-between">
              <span>Base imagery</span>
              <span className="text-emerald-400">OSM</span>
            </li>
            <li className="flex items-center justify-between opacity-40">
              <span>Photorealistic 3D Tiles</span>
              <span>no key</span>
            </li>
            <li className="flex items-center justify-between opacity-40">
              <span>Terrain (Cesium World Terrain)</span>
              <span>no token</span>
            </li>
          </ul>
        </div>
        <div className="pointer-events-auto">
          <PlaceholderPanel
            title="Earth Knowledge Panel"
            note="Not wired yet. Will consume War Room's existing Earth Knowledge Registry and Research Engine directly — no separate registry planned or built here (Phase H)."
          />
        </div>
      </div>

      {/* Right rail — Live Council dock + provenance/source panel. */}
      <div className="pointer-events-none absolute right-0 top-20 flex w-64 flex-col gap-2 p-4">
        <div className="pointer-events-auto">
          <PlaceholderPanel
            title="Live Council Dock"
            note="Not wired yet. Will reuse the existing Council/provider adapters — no second Council or provider system planned or built here (Phase I)."
          />
        </div>
        <div className="pointer-events-auto">
          <PlaceholderPanel
            title="Provenance / Source Panel"
            note="Will show, per feature on screen: source, license, fetch time, and layer class (Observed Data / Curated Knowledge / AI Analysis / Commander Annotation) — kept visually distinct, never blended (Phase H)."
          />
        </div>
      </div>

      {/* Bottom bar — time controls + Commander annotation placeholder. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-4">
        <div className="pointer-events-auto">
          <PlaceholderPanel title="Time Controls" note="4D time engine not wired yet (Phase J). Globe currently shows the present moment only." />
        </div>
        <div className="pointer-events-auto">
          <PlaceholderPanel
            title="Commander Annotation"
            note="Not wired yet. Will be a distinct, clearly-labeled layer class — never merged with Observed Data or AI Analysis layers."
          />
        </div>
      </div>
    </div>
  )
}
