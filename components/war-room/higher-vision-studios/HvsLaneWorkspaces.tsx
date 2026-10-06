'use client'

import { useEffect, useRef, useState } from 'react'
import { formatTimecode, toSeconds } from '@/lib/media-command/time'
import type { HvsProject } from '@/lib/media-command/types'
import { firstChromaKeyGraph, firstMaskedMergeGraph, maskPreviewCss, planEffectGraphLowering, readMaskParams, readTransformParams, type HvsEffectNode } from '@/lib/media-command/effect-graph'
import { colorPipelineToPreviewCss, identityColorPipelineOr, addRgbCurvePoint, deleteRgbCurvePoint, readHslQualifier, readLumaQualifier, type ColorPipeline } from '@/lib/media-command/color-pipeline'
import { colorPipelineSvgFilter, LUT_PREVIEW_HONESTY, lumaQualifierCoverage01, readBlurParams } from '@/lib/media-command/program-deliver-fidelity'
import { interpolateSubject } from '@/lib/media-command/tracking'
import type { GenerationAuthorityCard, GenerationSurfaceState } from '@/lib/media-command/generation-authority'
import { eqResponseCurve } from '@/lib/media-command/eq-response'
import type { TranscriptDocument } from '@/lib/media-command/transcript'

type CommitFn = (kind: string, extra?: Record<string, unknown>) => Promise<void>

function numParam(pipeline: ColorPipeline, type: string, key: string, fallback: number): number {
  const node = pipeline.nodes.find(n => n.type === type)
  const v = node?.params[key]
  return typeof v === 'number' ? v : fallback
}

export function HvsMediaViPanel({
  project,
  assets,
  category,
  setCategory,
  ingest,
  onStatus,
}: {
  project: HvsProject
  assets: HvsProject['assets']
  category: string
  setCategory: (id: 'all' | 'video' | 'image' | 'audio' | 'generated') => void
  ingest: (file: File) => void
  onStatus: (s: string) => void
}) {
  const videoAsset = project.assets.find(a => a.kind === 'video')
  const videoRef = useRef<HTMLVideoElement>(null)
  const [tab, setTab] = useState<'ANALYSIS' | 'SCENES' | 'MOTION' | 'AUDIO' | 'SEARCH' | 'TRANSCRIPT'>('ANALYSIS')
  const [payload, setPayload] = useState<{
    status?: string
    observations?: Array<{
      id?: string
      timestamp: { ticks: number; timescale: number }
      scene?: string | null
      actions?: Array<{ label: string; confidence: number }>
      audio_event?: string | null
      confidence: number
      evidence?: Array<{ kind: string; note: string; metric?: string | null }>
      transcript?: string | null
    }>
    hits?: Array<{ start: { ticks: number; timescale: number }; reason: string; confidence: number }>
    backend?: string | null
    observationCount?: number
    lastAnalyzed?: string | null
    assetFingerprint?: string | null
    cacheHit?: boolean
  }>({})
  const [busy, setBusy] = useState(false)
  const [transcript, setTranscript] = useState<TranscriptDocument | null>(null)
  const [speechQuery, setSpeechQuery] = useState('')
  const [speechHits, setSpeechHits] = useState<Array<{ text: string; timestamp: { ticks: number; timescale: number } }>>([])

  async function loadVi(extra?: Record<string, string>) {
    if (!videoAsset) return
    const q = new URLSearchParams({ projectId: project.id, assetId: videoAsset.id, ...extra })
    const res = await fetch(`/api/media-command/video-intelligence?${q}`)
    const data = await res.json() as typeof payload
    setPayload(data)
  }

  useEffect(() => { void loadVi() }, [project.id, videoAsset?.id])

  async function loadTranscript() {
    if (!videoAsset) return
    const res = await fetch(`/api/media-command/asr?projectId=${encodeURIComponent(project.id)}&assetId=${encodeURIComponent(videoAsset.id)}`)
    const data = await res.json() as { transcript?: TranscriptDocument | null }
    setTranscript(data.transcript ?? null)
  }

  useEffect(() => {
    if (tab === 'TRANSCRIPT') void loadTranscript()
  }, [tab, project.id, videoAsset?.id])

  function seekTo(time: { ticks: number; timescale: number }) {
    const sec = toSeconds(time)
    if (videoRef.current) {
      videoRef.current.currentTime = sec
      void videoRef.current.play().catch(() => undefined)
    }
    onStatus(`Source seek ${sec.toFixed(3)}s`)
  }

  async function search(kind: 'HIGH MOTION' | 'LOW MOTION' | 'AUDIO ACTIVE' | 'SILENCE' | 'SHOT') {
    const extra: Record<string, string> = {}
    if (kind === 'HIGH MOTION') extra.motion = 'HIGH MOTION'
    if (kind === 'LOW MOTION') extra.motion = 'LOW MOTION'
    if (kind === 'AUDIO ACTIVE') extra.audioState = 'AUDIO ACTIVE'
    if (kind === 'SILENCE') extra.audioState = 'SILENCE'
    if (kind === 'SHOT') extra.sceneBoundary = '1'
    await loadVi(extra)
    setTab('SEARCH')
  }

  async function reanalyze(force: boolean) {
    if (!videoAsset) return
    setBusy(true)
    onStatus(force ? 'REANALYZE queued…' : 'Analysis queued…')
    const res = await fetch('/api/media-command/video-intelligence', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, assetId: videoAsset.id, force }),
    })
    const data = await res.json() as { cacheHit?: boolean; observationCount?: number; error?: string; job?: { status: string } }
    onStatus(data.error ?? `${data.job?.status ?? ''} cacheHit=${String(data.cacheHit)} count=${data.observationCount ?? 0}`)
    await loadVi()
    setBusy(false)
  }

  const observations = payload.observations ?? []
  const scenes = observations.filter(o => o.scene === 'SHOT' || o.scene === 'SCENE_BOUNDARY')
  const motion = observations.filter(o => o.actions?.some(a => /MOTION/i.test(a.label)))
  const audio = observations.filter(o => o.audio_event)
  const rows = tab === 'SCENES' ? scenes : tab === 'MOTION' ? motion : tab === 'AUDIO' ? audio : observations

  return (
    <section className="foundry-glass rounded-lg border border-amber-900/40 p-3" data-testid="hvs-media-page">
      <div className="mb-2 flex flex-wrap gap-1">
        {(['all', 'video', 'image', 'audio', 'generated'] as const).map(id => (
          <button key={id} type="button" className="rounded border px-2 py-1 text-[9px] uppercase tracking-widest" style={{ color: category === id ? '#67e8f9' : '#94a3b8', borderColor: category === id ? 'rgba(34,211,238,0.45)' : 'rgba(255,255,255,0.1)' }} onClick={() => setCategory(id)}>{id}</button>
        ))}
        <label className="ml-auto rounded border border-emerald-400/40 px-2 py-1 text-[9px] uppercase tracking-widest text-emerald-200">
          Import
          <input type="file" accept="video/*,audio/*,image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) ingest(f); e.target.value = '' }} />
        </label>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {assets.map(asset => (
          <li key={asset.id} className="flex items-center gap-2 rounded border border-white/10 p-2">
            {(asset.kind === 'video' || asset.kind === 'image' || asset.kind === 'logo') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="" src={`/api/media-command/assets/${asset.id}/file?kind=thumb`} className="h-12 w-20 rounded object-cover" />
            ) : null}
            <span className="min-w-0">
              <span className="block truncate text-[12px] text-amber-50">{asset.name}</span>
              <span className="text-[9px] uppercase tracking-widest text-slate-500">{asset.kind} · {asset.generated ? 'generated' : 'source'} · {formatTimecode(asset.duration)}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-testid="hvs-media-vi">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-cyan-300">Source · Video Intelligence</p>
          {videoAsset ? (
            <video
              ref={videoRef}
              src={`/api/media-command/assets/${videoAsset.id}/file`}
              controls
              className="mt-1 w-full rounded border border-white/10"
              data-testid="hvs-vi-source"
            />
          ) : <p className="text-slate-500">No video asset.</p>}
          <p className="mt-1 font-mono text-[10px] text-amber-200" data-testid="hvs-vi-status">
            {payload.status ?? 'NOT ANALYZED'} · {payload.backend ?? '—'} · {payload.observationCount ?? 0} obs · fp {payload.assetFingerprint?.slice(0, 10) ?? '—'}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            <button type="button" disabled={busy} className="rounded border border-cyan-400/40 px-2 py-1 text-[9px] uppercase tracking-widest text-cyan-100" onClick={() => void reanalyze(false)}>Analyze</button>
            <button type="button" disabled={busy} className="rounded border border-amber-400/40 px-2 py-1 text-[9px] uppercase tracking-widest text-amber-100" onClick={() => void reanalyze(true)}>Reanalyze</button>
          </div>
        </div>
        <div>
          <div className="flex flex-wrap gap-1">
            {(['ANALYSIS', 'SCENES', 'MOTION', 'AUDIO', 'SEARCH', 'TRANSCRIPT'] as const).map(id => (
              <button key={id} type="button" className="rounded border px-2 py-1 text-[9px] uppercase tracking-widest" style={{ color: tab === id ? '#67e8f9' : '#94a3b8' }} onClick={() => setTab(id)}>{id}</button>
            ))}
          </div>
          {tab === 'SEARCH' ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {(['HIGH MOTION', 'LOW MOTION', 'AUDIO ACTIVE', 'SILENCE', 'SHOT'] as const).map(q => (
                <button key={q} type="button" className="rounded border border-white/15 px-2 py-1 text-[9px] uppercase tracking-widest text-slate-200" onClick={() => void search(q)}>{q}</button>
              ))}
            </div>
          ) : null}
          <ul className="mt-2 max-h-64 space-y-1 overflow-auto text-[11px]" data-testid="hvs-vi-observations">
            {(tab === 'SEARCH' ? (payload.hits ?? []).map(h => ({
              id: `${toSeconds(h.start)}`,
              timestamp: h.start,
              scene: null,
              actions: [{ label: h.reason, confidence: h.confidence }],
              audio_event: null,
              confidence: h.confidence,
              evidence: [{ kind: 'search', note: h.reason }],
            }) ) : rows).map((row, i) => (
              <li key={row.id ?? i}>
                <button type="button" className="w-full rounded border border-white/10 px-2 py-1 text-left text-amber-50" onClick={() => seekTo(row.timestamp)}>
                  {toSeconds(row.timestamp).toFixed(3)}s · {row.scene ?? row.actions?.[0]?.label ?? row.audio_event ?? 'obs'} · {row.confidence.toFixed(2)}
                  <span className="block text-[10px] text-slate-500">{row.evidence?.[0]?.note}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] text-slate-500">People/objects/transcript are not invented. Sample.mp4 remains a single-take unless FFmpeg reports cuts. Object ≠ identity. Biometric mode OFF.</p>
          {tab === 'TRANSCRIPT' ? (
            <div className="mt-2" data-testid="hvs-transcript">
              <p className="text-[11px] text-amber-200" data-testid="hvs-transcript-status">
                {transcript?.segments?.length
                  ? `${transcript.backend} · ${transcript.model ?? 'local'} · ${transcript.segments.length} lines`
                  : 'No transcript yet. Speech stays on this computer.'}
              </p>
              <div className="mt-2 flex gap-1">
                <input
                  className="min-w-0 flex-1 rounded border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-amber-50"
                  data-testid="hvs-speech-search"
                  value={speechQuery}
                  onChange={event => setSpeechQuery(event.target.value)}
                  placeholder="Find where I say…"
                />
                <button
                  type="button"
                  className="rounded border border-white/15 px-2 py-1 text-[9px] uppercase tracking-widest text-slate-200"
                  onClick={() => {
                    void (async () => {
                      if (!videoAsset || !speechQuery.trim()) return
                      const res = await fetch(`/api/media-command/asr?projectId=${encodeURIComponent(project.id)}&assetId=${encodeURIComponent(videoAsset.id)}&q=${encodeURIComponent(speechQuery)}`)
                      const data = await res.json() as { hits?: Array<{ text: string; timestamp: { ticks: number; timescale: number } }> }
                      setSpeechHits(data.hits ?? [])
                      if (data.hits?.[0]) seekTo(data.hits[0].timestamp)
                    })()
                  }}
                >Find</button>
                <button
                  type="button"
                  className="rounded border border-cyan-400/40 px-2 py-1 text-[9px] uppercase tracking-widest text-cyan-100"
                  onClick={() => {
                    void (async () => {
                      if (!videoAsset) return
                      await fetch('/api/media-command/asr', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ projectId: project.id, assetId: videoAsset.id }),
                      })
                      await loadTranscript()
                    })()
                  }}
                >Transcribe</button>
              </div>
              <ul className="mt-2 max-h-48 space-y-1 overflow-auto">
                {(speechHits.length ? speechHits.map(hit => ({ start: hit.timestamp, text: hit.text })) : (transcript?.segments ?? [])).map((row, i) => (
                  <li key={i}>
                    <button type="button" className="hvs-transcript-line" data-testid="hvs-transcript-line" onClick={() => seekTo(row.start)}>
                      <span>{formatTimecode(row.start)}</span>
                      <span>{row.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}

export function HvsVfxPanel({ project, commit, onStatus }: { project: HvsProject; commit: CommitFn; onStatus: (s: string) => void }) {
  const videos = project.assets.filter(a => a.kind === 'video' || a.kind === 'image')
  const graph = project.effectGraphs[0] ?? firstMaskedMergeGraph(project.id, videos[0]?.id ?? '', videos[1]?.id ?? videos[0]?.id ?? '')
  const [selected, setSelected] = useState<string>(graph.nodes[0]?.id ?? '')
  const node = graph.nodes.find(n => n.id === selected)
  const xf = graph.nodes.find(n => n.kind === 'Transform')
  const mask = graph.nodes.find(n => n.kind === 'Mask')
  const params = xf ? readTransformParams(xf) : null
  const subject = project.timeline.subjects[0]
  const box = subject ? interpolateSubject(subject, 0, project.timeline.timescale) : null
  const maskP = readMaskParams(mask, box)
  const blur = readBlurParams(graph.nodes.find(n => n.kind === 'Blur'))
  const executable = new Set(['MediaIn', 'MediaOut', 'Transform', 'Merge', 'Mask', 'Blur', 'TrackerRef', 'Text', 'Keyer'])

  async function persistGraph(next = graph) {
    await commit('updateEffectGraph', { graph: next })
  }

  return (
    <section className="foundry-glass rounded-lg border border-amber-900/40 p-3" data-testid="hvs-vfx-page">
      <p className="text-[10px] uppercase tracking-widest text-amber-300">PARTIAL · executable: MediaIn / Transform / Mask / Merge / Blur / Text / TrackerRef / Keyer / MediaOut</p>
      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_220px]">
        <div data-testid="hvs-vfx-viewer" className="relative overflow-hidden rounded border border-white/10 bg-black" style={{ minHeight: 280 }}>
          {videos[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="" src={`/api/media-command/assets/${videos[0].id}/file?kind=thumb`} className="h-full w-full object-cover" style={blur.enabled && maskP.invert ? { filter: `blur(${blur.radius}px)` } : undefined} />
          ) : null}
          {videos[1] || videos[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt=""
              src={`/api/media-command/assets/${(videos[1] ?? videos[0]).id}/file?kind=thumb`}
              className="absolute left-0 top-0 h-full w-full object-cover"
              data-testid="hvs-vfx-fg"
              style={{
                transform: params ? `translate(${params.nx * 100}%, ${params.ny * 100}%) scale(${params.scaleX}, ${params.scaleY})` : undefined,
                opacity: params?.opacity ?? 0.9,
                clipPath: maskPreviewCss({ ...maskP, invert: false }),
                filter: blur.enabled && !maskP.invert ? `blur(${blur.radius}px)` : undefined,
              }}
            />
          ) : null}
        </div>
        <div data-testid="hvs-vfx-graph">
          <p className="text-[10px] uppercase tracking-widest text-cyan-300">Node graph</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {graph.nodes.map(n => (
              <button key={n.id} type="button" onClick={() => setSelected(n.id)} className="rounded border px-2 py-1 text-[10px] uppercase tracking-widest" style={{ borderColor: selected === n.id ? 'rgba(34,211,238,0.6)' : 'rgba(255,255,255,0.12)', color: executable.has(n.kind) ? '#e2e8f0' : '#64748b' }}>
                {n.kind}{executable.has(n.kind) ? '' : ' · not executable'}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-slate-500">{graph.connections.map(c => `${c.fromNode}→${c.toNode}.${c.toPort}`).join(' · ')}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            <button type="button" className="rounded border border-white/15 px-2 py-1 text-[9px] uppercase tracking-widest text-slate-200" onClick={() => void persistGraph(firstMaskedMergeGraph(project.id, videos[0]?.id ?? '', videos[1]?.id ?? videos[0]?.id ?? ''))}>Load mask graph</button>
            <button type="button" className="rounded border border-emerald-400/40 px-2 py-1 text-[9px] uppercase tracking-widest text-emerald-100" onClick={() => void persistGraph(firstChromaKeyGraph(project.id, videos[0]?.id ?? ''))}>Load chroma key</button>
            <button type="button" className="rounded border border-white/15 px-2 py-1 text-[9px] uppercase tracking-widest text-slate-200" onClick={() => void persistGraph({ ...graph, nodes: [...graph.nodes, { id: `blur-${Date.now().toString(36)}`, kind: 'Blur', inputs: [{ id: 'in', name: 'rgba', kind: 'input' }], outputs: [{ id: 'out', name: 'rgba', kind: 'output' }], enabled: true, parameters: { radius: 8 } }] })}>Add Blur</button>
            <button type="button" className="rounded border border-white/15 px-2 py-1 text-[9px] uppercase tracking-widest text-slate-200" onClick={() => selected && void commit('removeEffectNode', { graphId: graph.id, nodeId: selected })}>Remove</button>
            <button type="button" className="rounded border border-white/15 px-2 py-1 text-[9px] uppercase tracking-widest text-slate-200" onClick={() => void commit('undo')}>Undo</button>
            <button type="button" className="rounded border border-white/15 px-2 py-1 text-[9px] uppercase tracking-widest text-slate-200" onClick={() => void commit('redo')}>Redo</button>
            <button type="button" className="rounded border border-white/15 px-2 py-1 text-[9px] uppercase tracking-widest text-slate-200" onClick={() => void fetch('/api/media-command/vfx/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: project.id, graph, still: true }) }).then(r => r.json()).then(d => onStatus(d.error ?? 'VFX still rendered'))}>Render still</button>
            <button type="button" className="rounded border border-white/15 px-2 py-1 text-[9px] uppercase tracking-widest text-slate-200" onClick={() => void fetch('/api/media-command/vfx/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: project.id, graph, still: false, durationSec: 2 }) }).then(r => r.json()).then(d => onStatus(d.error ?? `VFX video ${d.probe?.durationSec ?? ''}s`))}>Render 2s</button>
          </div>
        </div>
        <div data-testid="hvs-vfx-inspector">
          <p className="text-[10px] uppercase tracking-widest text-cyan-300">Inspector</p>
          {node ? <VfxInspector node={node} graphId={graph.id} commit={commit} /> : <p className="text-slate-500">Select a node.</p>}
          <p className="mt-2 text-[10px] text-slate-500">{planEffectGraphLowering(graph).notes[2]}</p>
        </div>
      </div>
    </section>
  )
}

function VfxInspector({ node, graphId, commit }: { node: HvsEffectNode; graphId: string; commit: CommitFn }) {
  const p = node.parameters
  function set(key: string, value: number | boolean | string) {
    void commit('updateEffectNode', { graphId, nodeId: node.id, parameters: { [key]: value } })
  }
  if (node.kind === 'Transform' || node.kind === 'Mask') {
    const keys = node.kind === 'Transform' ? ['nx', 'ny', 'scaleX', 'scaleY', 'opacity'] : ['x', 'y', 'width', 'height', 'feather']
    return (
      <div className="space-y-1">
        {keys.map(key => (
          <label key={key} className="block text-[10px] uppercase tracking-widest text-slate-400">
            {key} {String(p[key] ?? '')}
            <input type="range" min={key === 'scaleX' || key === 'scaleY' ? 0.1 : 0} max={key === 'scaleX' || key === 'scaleY' ? 2 : 1} step={0.01} defaultValue={Number(p[key] ?? 0)} className="w-full" onMouseUp={e => set(key, Number((e.target as HTMLInputElement).value))} />
          </label>
        ))}
        {node.kind === 'Mask' ? (
          <>
            <label className="block text-[10px] text-slate-400">
              shape
              <select defaultValue={String(p.type ?? p.shape ?? 'rectangle')} onChange={e => set('type', e.target.value)}>
                <option value="rectangle">rectangle</option>
                <option value="ellipse">ellipse</option>
              </select>
            </label>
            {['centerX', 'centerY', 'radiusX', 'radiusY'].map(key => (
              <label key={key} className="block text-[10px] uppercase tracking-widest text-slate-400">
                {key} {String(p[key] ?? '')}
                <input type="range" min={0} max={1} step={0.01} defaultValue={Number(p[key] ?? 0.5)} className="w-full" onMouseUp={e => set(key, Number((e.target as HTMLInputElement).value))} />
              </label>
            ))}
            <label className="block text-[10px] text-slate-400">
              invert
              <input type="checkbox" defaultChecked={p.invert === true} onChange={e => set('invert', e.target.checked)} />
            </label>
          </>
        ) : null}
        <label className="mt-2 block text-[10px] uppercase tracking-widest text-slate-400">
          bypass
          <input type="checkbox" checked={node.enabled === false} onChange={e => void commit('updateEffectNode', { graphId, nodeId: node.id, parameters: {}, enabled: !e.target.checked })} />
        </label>
      </div>
    )
  }
  if (node.kind === 'Blur') {
    const radius = typeof p.radius === 'number' ? p.radius : 8
    return (
      <div className="space-y-1" data-testid="hvs-blur-inspector">
        <label className="block text-[10px] uppercase tracking-widest text-slate-400">
          radius {radius}
          <input type="range" min={0} max={40} step={0.5} defaultValue={radius} className="w-full" onMouseUp={e => set('radius', Number((e.target as HTMLInputElement).value))} />
        </label>
        <label className="mt-2 block text-[10px] uppercase tracking-widest text-slate-400">
          bypass
          <input type="checkbox" checked={node.enabled === false} onChange={e => void commit('updateEffectNode', { graphId, nodeId: node.id, parameters: {}, enabled: !e.target.checked })} />
        </label>
      </div>
    )
  }
  return (
    <div>
      <pre className="max-h-40 overflow-auto text-[10px] text-slate-400">{JSON.stringify(p, null, 2)}</pre>
      <label className="mt-2 block text-[10px] uppercase tracking-widest text-slate-400">
        bypass
        <input type="checkbox" checked={node.enabled === false} onChange={e => void commit('updateEffectNode', { graphId, nodeId: node.id, parameters: {}, enabled: !e.target.checked })} />
      </label>
    </div>
  )
}

export function HvsColorPanel({ project, commit }: { project: HvsProject; commit: CommitFn }) {
  const pipeline = identityColorPipelineOr(project.colorPipeline)
  const [compare, setCompare] = useState<'AFTER' | 'BEFORE'>('AFTER')
  const [scopes, setScopes] = useState<{ after?: { luma: number }; before?: { luma: number }; afterScopes?: { histogram: { luma: number[] }; waveform: { lumaMean: number[] }; parade: { rMean: number[]; gMean: number[]; bMean: number[] }; vectorscope: { size: number; counts: number[] } } } | null>(null)
  const [clipboard, setClipboard] = useState<ColorPipeline | null>(null)
  const video = project.assets.find(a => a.kind === 'video')
  const css = colorPipelineToPreviewCss(pipeline)
  const svg = colorPipelineSvgFilter(pipeline, 'hvs-color-page-pipe')
  const lutOn = pipeline.nodes.some(n => n.type === 'lut' && n.enabled)

  useEffect(() => {
    if (!video) return
    void fetch(`/api/media-command/color/scopes?projectId=${project.id}&at=1`)
      .then(r => r.json())
      .then(setScopes)
  }, [project.id, project.colorPipeline, video?.id])

  function patch(type: string, params: Record<string, unknown>) {
    const nodes = pipeline.nodes.some(n => n.type === type)
      ? pipeline.nodes.map(n => n.type === type ? { ...n, enabled: true, params: { ...n.params, ...params } } : n)
      : [...pipeline.nodes, { id: type, type: type as ColorPipeline['nodes'][number]['type'], enabled: true, params }]
    void commit('updateColorPipeline', { pipeline: { ...pipeline, nodes } })
  }

  const lift = numParam(pipeline, 'lift-gamma-gain', 'x', 0)

  return (
    <section className="foundry-glass rounded-lg border border-amber-900/40 p-3" data-testid="hvs-color-page">
      <p className="text-[10px] uppercase tracking-widest text-cyan-300">ColorPipeline · wheels map to numeric nodes · scopes from pixels</p>
      <div className="mt-3 grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          {([
            ['offset', 'Offset', numParam(pipeline, 'offset', 'offset', 0), -0.5, 0.5],
            ['temp', 'Temperature', numParam(pipeline, 'temp-tint', 'temperature', 0), -1, 1],
            ['tint', 'Tint', numParam(pipeline, 'temp-tint', 'tint', 0), -1, 1],
            ['contrast', 'Contrast', numParam(pipeline, 'contrast-pivot', 'contrast', 0), -0.5, 1],
            ['pivot', 'Pivot', numParam(pipeline, 'contrast-pivot', 'pivot', 0.5), 0, 1],
            ['sat', 'Saturation', numParam(pipeline, 'saturation', 'saturation', 0), -1, 1],
          ] as const).map(([id, label, value, min, max]) => (
            <label key={id} className="mt-1 block text-[10px] uppercase tracking-widest text-slate-400">
              {label} {value.toFixed(2)}
              <input type="range" min={min} max={max} step={0.01} value={value} className="w-full" onChange={e => {
                const v = Number(e.target.value)
                if (id === 'offset') patch('offset', { offset: v })
                if (id === 'temp') patch('temp-tint', { temperature: v })
                if (id === 'tint') patch('temp-tint', { tint: v })
                if (id === 'contrast') patch('contrast-pivot', { contrast: v })
                if (id === 'pivot') patch('contrast-pivot', { pivot: v })
                if (id === 'sat') patch('saturation', { saturation: v })
              }} />
            </label>
          ))}
          <p className="mt-2 text-[10px] uppercase tracking-widest text-slate-400">Lift wheel</p>
          <div
            data-testid="hvs-color-wheel"
            className="relative mx-auto h-28 w-28 rounded-full border border-cyan-500/40"
            style={{ background: 'radial-gradient(circle, #888, #111)' }}
            onPointerDown={e => {
              const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
              const x = (e.clientX - r.left) / r.width - 0.5
              const y = (e.clientY - r.top) / r.height - 0.5
              patch('lift-gamma-gain', { lift: [x * 0.4, -y * 0.4, -x * 0.3], gamma: [1, 1, 1], gain: [1, 1, 1] })
            }}
          >
            <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-200" style={{ transform: `translate(${lift * 80}px, 0)` }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            <button type="button" className="rounded border px-2 py-1 text-[9px] uppercase tracking-widest text-slate-200" onClick={() => setCompare('BEFORE')}>Before</button>
            <button type="button" className="rounded border px-2 py-1 text-[9px] uppercase tracking-widest text-slate-200" onClick={() => setCompare('AFTER')}>After</button>
            <button type="button" className="rounded border px-2 py-1 text-[9px] uppercase tracking-widest text-slate-200" onClick={() => { setClipboard(pipeline); void commit('copyColorPipeline') }}>Copy grade</button>
            <button type="button" className="rounded border px-2 py-1 text-[9px] uppercase tracking-widest text-slate-200" disabled={!clipboard} onClick={() => clipboard && void commit('pasteColorPipeline', { pipeline: clipboard })}>Paste grade</button>
          </div>
        </div>
        <div>
          {svg.markup ? (
            <svg width="0" height="0" className="absolute" aria-hidden>
              <defs dangerouslySetInnerHTML={{ __html: svg.markup }} />
            </svg>
          ) : null}
          {video ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="" src={`/api/media-command/assets/${video.id}/file?kind=thumb`} className="w-full rounded object-cover" style={{ filter: compare === 'AFTER' ? `${css}${svg.css ? ` ${svg.css}` : ''}` : 'none' }} data-testid="hvs-color-viewer" data-compare={compare} data-node-order={pipeline.nodes.filter(n => n.enabled).map(n => n.type).join(',')} />
          ) : null}
          {lutOn ? <p className="mt-1 text-[9px] uppercase tracking-widest text-amber-200" data-testid="hvs-lut-honesty">{LUT_PREVIEW_HONESTY}</p> : null}
          <p className="mt-1 text-[10px] text-slate-400">{compare} luma {compare === 'AFTER' ? scopes?.after?.luma?.toFixed(2) : scopes?.before?.luma?.toFixed(2)}</p>
          <LumaCurve pipeline={pipeline} onChange={curve => patch('luma-curve', { curve })} />
          <p className="mt-2 text-[10px] uppercase tracking-widest text-slate-400">RGB curves</p>
          {(['r', 'g', 'b'] as const).map(ch => (
            <LumaCurve key={ch} pipeline={{ ...pipeline, nodes: [{ id: ch, type: 'rgb-curve', enabled: true, params: { curve: (pipeline.nodes.find(n => n.type === 'rgb-curve')?.params[ch] as Array<{ input: number; output: number }> | undefined) ?? [{ input: 0, output: 0 }, { input: 1, output: 1 }] } }] }} onChange={curve => {
              const existing = pipeline.nodes.find(n => n.type === 'rgb-curve')?.params ?? {}
              patch('rgb-curve', { ...existing, [ch]: curve })
            }} onAdd={(x, y) => {
              const next = addRgbCurvePoint(pipeline, ch, x, y)
              void commit('updateColorPipeline', { pipeline: next })
            }} onDelete={index => {
              const next = deleteRgbCurvePoint(pipeline, ch, index)
              void commit('updateColorPipeline', { pipeline: next })
            }} />
          ))}
          <button type="button" className="mt-2 rounded border px-2 py-1 text-[9px] uppercase tracking-widest text-slate-200" onClick={() => void fetch('/api/media-command/color/shot-match', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: project.id }) }).then(r => r.json()).then(d => {
            if (d.proposal?.pipeline) void commit('updateColorPipeline', { pipeline: d.proposal.pipeline })
          })}>Match to reference (proposal)</button>
          <p className="mt-1 text-[10px] text-slate-500">SHOT MATCH is statistical. Preview/commit. Not cinematic perfection.</p>
          <p className="mt-3 text-[10px] uppercase tracking-widest text-cyan-300">LUMA qualifier</p>
          {(() => {
            const q = readLumaQualifier(pipeline.nodes.find(n => n.type === 'luma-qualifier'))
            return (
              <div data-testid="hvs-luma-qualifier" className="space-y-1">
                {([['low', q.low], ['high', q.high], ['softness', q.softness]] as const).map(([key, value]) => (
                  <label key={key} className="block text-[10px] uppercase tracking-widest text-slate-400">
                    {key} {value.toFixed(2)}
                    <input type="range" min={0} max={1} step={0.01} value={value} className="w-full" onChange={e => patch('luma-qualifier', { low: q.low, high: q.high, softness: q.softness, invert: q.invert, [key]: Number(e.target.value) })} />
                  </label>
                ))}
                <label className="block text-[10px] text-slate-400">
                  invert
                  <input type="checkbox" checked={q.invert} onChange={e => patch('luma-qualifier', { low: q.low, high: q.high, softness: q.softness, invert: e.target.checked })} />
                </label>
                <button type="button" className="rounded border px-2 py-1 text-[9px] uppercase tracking-widest text-slate-200" onClick={() => {
                  patch('luma-qualifier', { low: q.low, high: q.high, softness: q.softness, invert: q.invert, showMask: q.enabled ? true : true })
                  void fetch('/api/media-command/color/scopes?projectId=' + project.id + '&at=1').then(r => r.json()).then(setScopes)
                }}>Show Mask</button>
                <p className="text-[9px] text-slate-500">Show Mask derives from qualifier low/high/softness/invert. FFmpeg still remains canonical. CSS does not fake luma qualification.</p>
                {video && pipeline.nodes.find(n => n.type === 'luma-qualifier')?.params.showMask === true ? (
                  <canvas
                    data-testid="hvs-show-mask-canvas"
                    className="mt-1 w-full rounded border border-white/10"
                    ref={node => {
                      if (!node || !video) return
                      const img = new Image()
                      img.crossOrigin = 'anonymous'
                      img.onload = () => {
                        node.width = 160
                        node.height = 90
                        const ctx = node.getContext('2d')
                        if (!ctx) return
                        ctx.drawImage(img, 0, 0, 160, 90)
                        const data = ctx.getImageData(0, 0, 160, 90)
                        for (let i = 0; i < data.data.length; i += 4) {
                          const y = (0.2126 * data.data[i] + 0.7152 * data.data[i + 1] + 0.0722 * data.data[i + 2]) / 255
                          const c = lumaQualifierCoverage01(y, q)
                          const v = Math.round(c * 255)
                          data.data[i] = v
                          data.data[i + 1] = v
                          data.data[i + 2] = v
                        }
                        ctx.putImageData(data, 0, 0)
                      }
                      img.src = `/api/media-command/assets/${video.id}/file?kind=thumb`
                    }}
                  />
                ) : null}
              </div>
            )
          })()}
          <p className="mt-3 text-[10px] uppercase tracking-widest text-cyan-300">HSL qualifier</p>
          {(() => {
            const q = readHslQualifier(pipeline.nodes.find(n => n.type === 'hsl-qualifier'))
            return (
              <div data-testid="hvs-hsl-qualifier" className="space-y-1">
                {([['hueLow', q.hueLow, 0, 360], ['hueHigh', q.hueHigh, 0, 360], ['satLow', q.satLow, 0, 1], ['satHigh', q.satHigh, 0, 1], ['lumaLow', q.lumaLow, 0, 1], ['lumaHigh', q.lumaHigh, 0, 1]] as const).map(([key, value, min, max]) => (
                  <label key={key} className="block text-[10px] uppercase tracking-widest text-slate-400">
                    {key} {value.toFixed(2)}
                    <input type="range" min={min} max={max} step={max > 1 ? 1 : 0.01} value={value} className="w-full" onChange={e => patch('hsl-qualifier', { ...q, [key]: Number(e.target.value) })} />
                  </label>
                ))}
                <p className="text-[9px] text-slate-500">Hue vs Hue / Hue vs Sat curves remain researched. Look snapshots use Version Browser. No second version system.</p>
              </div>
            )
          })()}
        </div>
        <HvsScopes scopes={scopes?.afterScopes ?? null} />
      </div>
    </section>
  )
}

function LumaCurve({ pipeline, onChange, onAdd, onDelete }: {
  pipeline: ColorPipeline
  onChange: (curve: Array<{ input: number; output: number }>) => void
  onAdd?: (x: number, y: number) => void
  onDelete?: (index: number) => void
}) {
  const node = pipeline.nodes.find(n => n.type === 'luma-curve' || n.type === 'rgb-curve')
  const curve = (Array.isArray(node?.params.curve) ? node.params.curve : [{ input: 0, output: 0 }, { input: 0.5, output: 0.5 }, { input: 1, output: 1 }]) as Array<{ input: number; output: number }>
  return (
    <svg viewBox="0 0 100 100" className="mt-2 h-28 w-full rounded border border-white/10 bg-black/40" data-testid="hvs-luma-curve" onClick={e => {
      const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
      const x = (e.clientX - r.left) / r.width
      const y = 1 - (e.clientY - r.top) / r.height
      const hit = curve.findIndex(p => Math.hypot(p.input - x, p.output - y) < 0.06)
      if (hit >= 0 && e.altKey && onDelete) {
        onDelete(hit)
        return
      }
      if (onAdd) onAdd(x, y)
      else onChange([...curve.filter(p => Math.abs(p.input - x) > 0.08), { input: x, output: y }].sort((a, b) => a.input - b.input))
    }}>
      <polyline fill="none" stroke="#67e8f9" strokeWidth="2" points={curve.map(p => `${p.input * 100},${100 - p.output * 100}`).join(' ')} />
      {curve.map((p, i) => <circle key={i} cx={p.input * 100} cy={100 - p.output * 100} r="3" fill="#f5c15d" />)}
    </svg>
  )
}

function HvsScopes({ scopes }: { scopes: { histogram: { luma: number[] }; waveform: { lumaMean: number[] }; parade: { rMean: number[]; gMean: number[]; bMean: number[] }; vectorscope: { size: number; counts: number[] } } | null }) {
  if (!scopes) return <p className="text-[11px] text-slate-500">Scopes wait for a real graded frame.</p>
  const maxH = Math.max(...scopes.histogram.luma, 1)
  return (
    <div data-testid="hvs-scopes" className="space-y-2 text-[10px] uppercase tracking-widest text-slate-400">
      <p>Histogram</p>
      <div className="flex h-16 items-end gap-px bg-black/50">
        {scopes.histogram.luma.filter((_, i) => i % 4 === 0).map((v, i) => <span key={i} className="flex-1 bg-cyan-400" style={{ height: `${(v / maxH) * 100}%` }} />)}
      </div>
      <p>Waveform</p>
      <div className="flex h-12 items-end gap-px bg-black/50">
        {scopes.waveform.lumaMean.filter((_, i) => i % 4 === 0).map((v, i) => <span key={i} className="flex-1 bg-amber-300" style={{ height: `${(v / 255) * 100}%` }} />)}
      </div>
      <p>RGB parade</p>
      <div className="grid grid-cols-3 gap-1">
        {(['rMean', 'gMean', 'bMean'] as const).map(ch => (
          <div key={ch} className="flex h-10 items-end gap-px bg-black/50">
            {scopes.parade[ch].filter((_, i) => i % 8 === 0).map((v, i) => <span key={i} className="flex-1" style={{ height: `${(v / 255) * 100}%`, background: ch === 'rMean' ? '#f87171' : ch === 'gMean' ? '#4ade80' : '#60a5fa' }} />)}
          </div>
        ))}
      </div>
      <p>Vectorscope samples {scopes.vectorscope.counts.reduce((a, b) => a + b, 0)}</p>
    </div>
  )
}

export function HvsAudioPanel({ project, commit, onStatus }: { project: HvsProject; commit: CommitFn; onStatus: (s: string) => void }) {
  const graph = project.audioGraph
  const [meters, setMeters] = useState<{ peak: number; rms: number; leftRms: number; rightRms: number; lufs?: number | null } | null>(null)

  function patchChannel(id: string, patch: Record<string, unknown>) {
    void commit('updateAudioGraph', { graph: { ...graph, channels: graph.channels.map(ch => ch.id === id ? { ...ch, ...patch } : ch) } })
  }

  async function preview() {
    const res = await fetch('/api/media-command/audio/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: project.id, mix: graph.channels.length > 1 }) })
    const data = await res.json() as { peak?: number; rms?: number; leftRms?: number; rightRms?: number; error?: string }
    setMeters({ peak: data.peak ?? 0, rms: data.rms ?? 0, leftRms: data.leftRms ?? 0, rightRms: data.rightRms ?? 0 })
    onStatus(data.error ?? `peak ${data.peak?.toFixed(3)} rms ${data.rms?.toFixed(3)}`)
  }

  const auto = graph.automation[0]

  return (
    <section className="foundry-glass rounded-lg border border-amber-900/40 p-3" data-testid="hvs-audio-page">
      <p className="text-[10px] uppercase tracking-widest text-cyan-300">Mixer · AudioGraph strips · real meters after preview</p>
      <div className="mt-2 grid gap-2 md:grid-cols-2" data-testid="hvs-mixer">
        {graph.channels.map(ch => {
          const eq = ch.inserts.find(i => i.kind === 'eq')
          const comp = ch.inserts.find(i => i.kind === 'compressor')
          return (
            <div key={ch.id} className="rounded border border-white/10 p-2">
              <p className="text-[11px] text-amber-50">{ch.trackId}</p>
              <label className="block text-[10px] text-slate-400">Volume {ch.volume.toFixed(2)}
                <input type="range" min={0} max={2} step={0.01} value={ch.volume} className="w-full" onChange={e => patchChannel(ch.id, { volume: Number(e.target.value) })} />
              </label>
              <label className="block text-[10px] text-slate-400">Pan {ch.pan.toFixed(2)}
                <input type="range" min={-1} max={1} step={0.01} value={ch.pan} className="w-full" onChange={e => patchChannel(ch.id, { pan: Number(e.target.value) })} />
              </label>
              <div className="flex gap-2 text-[10px] uppercase tracking-widest">
                <button type="button" className="rounded border px-2 py-0.5" style={{ color: ch.mute ? '#f87171' : '#94a3b8' }} onClick={() => patchChannel(ch.id, { mute: !ch.mute })}>Mute</button>
                <button type="button" className="rounded border px-2 py-0.5" style={{ color: ch.solo ? '#86efac' : '#94a3b8' }} onClick={() => patchChannel(ch.id, { solo: !ch.solo })}>Solo</button>
              </div>
              {eq && eq.kind === 'eq' ? (
                <div className="mt-1 space-y-1">
                  <label className="block text-[10px] text-slate-400">HPF {eq.highpassHz ?? 0}
                    <input type="range" min={0} max={400} value={eq.highpassHz ?? 0} className="w-full" onChange={e => patchChannel(ch.id, { inserts: ch.inserts.map(i => i.kind === 'eq' ? { ...i, highpassHz: Number(e.target.value) || null } : i) })} />
                  </label>
                  <label className="block text-[10px] text-slate-400">LPF {eq.lowpassHz ?? 0}
                    <input type="range" min={0} max={16000} value={eq.lowpassHz ?? 0} className="w-full" onChange={e => patchChannel(ch.id, { inserts: ch.inserts.map(i => i.kind === 'eq' ? { ...i, lowpassHz: Number(e.target.value) || null } : i) })} />
                  </label>
                  <label className="block text-[10px] text-slate-400">1 kHz {eq.bands[0]?.gainDb ?? 0} dB
                    <input type="range" min={-12} max={12} value={eq.bands[0]?.gainDb ?? 0} className="w-full" onChange={e => patchChannel(ch.id, { inserts: ch.inserts.map(i => i.kind === 'eq' ? { ...i, bands: [{ frequencyHz: 1000, gainDb: Number(e.target.value), q: 1 }] } : i) })} />
                  </label>
                  <p className="text-[9px] uppercase tracking-widest text-slate-500">EQ RESPONSE (calculated, not live FFT)</p>
                  <svg viewBox="0 0 200 40" className="h-10 w-full" data-testid="hvs-eq-response">
                    <polyline fill="none" stroke="#67e8f9" strokeWidth="1.5" points={eqResponseCurve(eq).map((p, i) => `${(i / 63) * 200},${20 - p.db * 1.5}`).join(' ')} />
                  </svg>
                </div>
              ) : null}
              {comp && comp.kind === 'compressor' ? (
                <div className="mt-1 space-y-1" data-testid="hvs-compressor">
                  {([
                    ['thresholdDb', 'Threshold', -40, 0],
                    ['ratio', 'Ratio', 1, 20],
                    ['attackMs', 'Attack', 1, 100],
                    ['releaseMs', 'Release', 10, 400],
                    ['makeupDb', 'Makeup', 0, 12],
                  ] as const).map(([key, label, min, max]) => (
                    <label key={key} className="block text-[10px] text-slate-400">{label} {Number((comp as unknown as Record<string, number>)[key] ?? 0)}
                      <input type="range" min={min} max={max} value={Number((comp as unknown as Record<string, number>)[key] ?? 0)} className="w-full" onChange={e => patchChannel(ch.id, { inserts: ch.inserts.map(i => i.kind === 'compressor' ? { ...i, [key]: Number(e.target.value) } : i) })} />
                    </label>
                  ))}
                </div>
              ) : (
                <button type="button" className="mt-1 text-[9px] uppercase tracking-widest text-cyan-200" onClick={() => patchChannel(ch.id, { inserts: [...ch.inserts, { kind: 'compressor', enabled: true, thresholdDb: -20, ratio: 4, attackMs: 12, releaseMs: 80, makeupDb: 2 }] })}>Add compressor</button>
              )}
              <div className="mt-2 h-16 w-3 overflow-hidden rounded bg-black/60" data-testid={`hvs-meter-${ch.id}`}>
                <div className="w-full bg-emerald-400" style={{ height: `${Math.min(100, (meters?.peak ?? 0) * 100)}%`, marginTop: 'auto' }} />
              </div>
              <p className="font-mono text-[10px] text-slate-400">peak {meters?.peak.toFixed(3) ?? '—'} rms {meters?.rms.toFixed(3) ?? '—'}</p>
            </div>
          )
        })}
      </div>
      {auto ? (
        <svg viewBox="0 0 400 80" className="mt-2 h-20 w-full rounded border border-white/10" data-testid="hvs-automation">
          <polyline fill="none" stroke="#f5c15d" strokeWidth="2" points={auto.keyframes.map(k => `${(toSeconds(k.time) / 4) * 400},${80 - k.value * 60}`).join(' ')} />
        </svg>
      ) : null}
      <p className="mt-2 text-[10px] uppercase tracking-widest text-slate-400">Buses {graph.buses.map(b => `${b.kind}:${b.id} vol=${b.volume}`).join(' · ')}</p>
      <p className="text-[10px] text-slate-400" data-testid="hvs-lufs">LUFS target {graph.loudnessTargetLufs ?? 'not set'} · never auto-normalize · ebur128 when measured</p>
      <div className="mt-1 flex flex-wrap gap-1">
        <button type="button" className="rounded border px-2 py-1 text-[9px] uppercase tracking-widest text-slate-200" onClick={() => {
          const ch = graph.channels[0]
          if (!ch) return
          patchChannel(ch.id, { inserts: [...ch.inserts, { kind: 'gate', enabled: true, thresholdDb: -40, attackMs: 5, releaseMs: 80 }] })
        }}>Add gate</button>
        <button type="button" className="rounded border px-2 py-1 text-[9px] uppercase tracking-widest text-slate-200" onClick={() => {
          const ch = graph.channels[0]
          if (!ch) return
          patchChannel(ch.id, { inserts: [...ch.inserts, { kind: 'delay', enabled: true, delaysMs: 180, decays: 0.35 }] })
        }}>Add delay</button>
      </div>
      <button type="button" className="mt-2 rounded border border-cyan-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-cyan-100" onClick={() => void preview()}>Preview mix</button>
    </section>
  )
}

export function HvsGeneratePanel({ project, commit }: { project: HvsProject; commit: CommitFn }) {
  const [card, setCard] = useState<GenerationAuthorityCard | null>(null)
  const [state, setState] = useState<GenerationSurfaceState>('LOCAL ENGINE NOT INSTALLED')
  useEffect(() => {
    void fetch(`/api/media-command/generation?projectId=${project.id}&capability=IMAGE_GENERATION`)
      .then(r => r.json())
      .then((d: { inspect?: { surfaceState: GenerationSurfaceState; card: GenerationAuthorityCard } }) => {
        setState(d.inspect?.surfaceState ?? 'LOCAL ENGINE NOT INSTALLED')
        setCard(d.inspect?.card ?? null)
      })
  }, [project.id])

  return (
    <section className="foundry-glass rounded-lg border border-amber-900/40 p-3" data-testid="hvs-ai-page">
      <p className="text-[10px] uppercase tracking-widest text-cyan-300">Generate · SHELL — providers not connected</p>
      <p className="mt-1 text-[12px] font-bold text-amber-200" data-testid="hvs-gen-state">{state}</p>
      {card ? (
        <div className="mt-2 rounded border border-amber-900/40 p-3 text-[12px] text-slate-300" data-testid="hvs-gen-authority">
          <p>Provider: {card.provider}</p>
          <p>Capability: {card.capability}</p>
          <p>Estimated cost: {card.estimatedCost ?? 'unknown'}</p>
          <p>External upload required: {card.externalUploadRequired ? 'yes' : 'no'}</p>
          <p>Assets transferred: {card.assetsTransferred.join(', ') || 'none (blocked before upload)'}</p>
          <p>Why approval: {card.whyApproval}</p>
          {card.localEngine ? (
            <div className="mt-2 text-[11px] text-amber-100" data-testid="hvs-local-engine-card">
              <p>Engine: {card.localEngine.engine}</p>
              <p>Capability: {card.localEngine.capability}</p>
              <p>Estimated storage: {card.localEngine.estimatedStorage}</p>
              <p>VRAM: {card.localEngine.vram}</p>
              <p>RAM: {card.localEngine.ram}</p>
              <p>License: {card.localEngine.license}</p>
              <p>Install approval required</p>
            </div>
          ) : null}
          <div className="mt-2 flex gap-2">
            <button type="button" className="rounded border px-2 py-1 text-[9px] uppercase tracking-widest" onClick={() => void fetch('/api/media-command/generation', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }) })}>Cancel</button>
            <button type="button" className="rounded border px-2 py-1 text-[9px] uppercase tracking-widest" onClick={() => void fetch('/api/media-command/generation', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'approve-later' }) })}>Approve later</button>
          </div>
          <p className="mt-1 text-[10px] text-slate-500">No Execute. No fake Generate. LOCAL ENGINE NOT INSTALLED. Spend is not authorized.</p>
        </div>
      ) : null}
      <button type="button" className="mt-2 rounded border border-white/15 px-2 py-1 text-[10px] uppercase tracking-widest text-slate-200" onClick={() => void commit('generateImage', { prompt: 'key art' })}>Queue blocked generateImage</button>
    </section>
  )
}
