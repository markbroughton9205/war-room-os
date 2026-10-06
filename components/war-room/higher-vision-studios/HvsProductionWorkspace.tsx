'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { HVS_CANONICAL_PATH, persistHvsResume, readHvsResume } from '@/lib/media-command/navigation'
import { matrixRowsForPage } from '@/lib/media-command/production-matrix'
import { HVS_PRODUCTION_PAGES, hvsProductionHref, type HvsProductionPageId } from '@/lib/media-command/production-pages'
import { formatTimecode } from '@/lib/media-command/time'
import { timelineDuration, type HvsProject, type OutputAspect } from '@/lib/media-command/types'
import { activeUnifiedLanes } from '@/lib/media-command/unified-render-plan'
import { HvsBackButton } from './HvsBackButton'
import { HvsGlobalDirector } from './HvsGlobalDirector'
import { HvsProductionBar } from './HvsProductionBar'
import { HvsVersionBrowser } from './HvsVersionBrowser'
import { HvsAudioPanel, HvsColorPanel, HvsGeneratePanel, HvsMediaViPanel, HvsVfxPanel } from './HvsLaneWorkspaces'
import './hvs-studio-v3.css'

export function HvsProductionWorkspace({
  projectId,
  page,
}: {
  projectId: string
  page: HvsProductionPageId
}) {
  const spec = HVS_PRODUCTION_PAGES.find(item => item.id === page)!
  const [project, setProject] = useState<HvsProject | null>(null)
  const [status, setStatus] = useState('Loading project…')
  const [category, setCategory] = useState<'all' | 'video' | 'image' | 'audio' | 'generated'>('all')

  useEffect(() => {
    void fetch(`/api/media-command/projects/${projectId}`)
      .then(r => r.json())
      .then((d: { project?: HvsProject; error?: string }) => {
        if (d.project) {
          setProject(d.project)
          setStatus(`Same .hvsproj · ${d.project.name}`)
        } else setStatus(d.error ?? 'Project missing.')
      })
  }, [projectId])

  const rows = useMemo(() => matrixRowsForPage(page), [page])
  const assets = (project?.assets ?? []).filter(asset => {
    if (page === 'photo') return asset.kind === 'image' || asset.kind === 'logo' || asset.kind === 'graphic'
    if (page === 'audio') return asset.kind === 'audio'
    if (category === 'all') return true
    if (category === 'generated') return asset.generated
    if (category === 'image') return asset.kind === 'image' || asset.kind === 'logo' || asset.kind === 'graphic'
    return asset.kind === category
  })
  const lastRender = project?.renderJobs.at(-1)
  const currentVersion = project?.versions.find(v => v.id === project.currentVersionId) ?? project?.versions.at(-1)
  const lanes = project ? activeUnifiedLanes(project) : null

  async function commit(kind: string, extra: Record<string, unknown> = {}) {
    if (!project) return
    const res = await fetch(`/api/media-command/projects/${project.id}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        commands: [{
          id: `hvs-${Date.now().toString(36)}`,
          createdAt: new Date().toISOString(),
          actor: 'human',
          kind,
          ...extra,
        }],
      }),
    })
    const data = await res.json() as { project?: HvsProject; errors?: string[] }
    if (data.project) setProject(data.project)
    setStatus(data.errors?.join('; ') || `Committed ${kind} via EditOp.`)
  }

  async function ingest(file: File) {
    if (!project) return
    const form = new FormData()
    form.set('projectId', project.id)
    form.set('file', file)
    const res = await fetch('/api/media-command/ingest', { method: 'POST', body: form })
    const data = await res.json() as { project?: HvsProject; error?: string }
    if (data.project) {
      setProject(data.project)
      setStatus(`Ingested ${file.name} into the same AssetRecord pool.`)
    } else setStatus(data.error ?? 'Ingest failed.')
  }

  async function renderAspect(aspect: OutputAspect) {
    if (!project) return
    setStatus(`Rendering ${aspect}…`)
    const res = await fetch('/api/media-command/render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, aspect }),
    })
    const data = await res.json() as { project?: HvsProject }
    if (data.project) setProject(data.project)
    setStatus(`${aspect} render requested on the shared RenderQueue.`)
  }

  return (
    <div className="space-y-2" data-testid="hvs-production-workspace" data-hvs-page={page}>
      <HvsProductionBar projectId={projectId} page={page} projectName={project?.name} />
      <header className="foundry-glass flex flex-wrap items-center gap-2 rounded-lg border border-amber-900/40 px-3 py-2" data-testid="hvs-production-header">
        <div className="hvs-v3-header-leading">
          <HvsBackButton onNavigate={() => {
            const resume = readHvsResume()
            persistHvsResume({
              basePath: hvsProductionHref(projectId, page),
              projectId,
              section: page === 'media' ? 'library' : page === 'deliver' ? 'render-queue' : 'editor',
              playheadSec: resume?.playheadSec ?? null,
              selectedClipId: resume?.selectedClipId ?? null,
            })
          }} />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-emerald-300">{spec.label}</p>
            <p className="text-[13px] font-semibold tracking-wide text-amber-50">{project?.name ?? 'Loading…'}</p>
          </div>
        </div>
        <span className="rounded border px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest" style={{
          borderColor: spec.status === 'WORKING' ? 'rgba(61,255,138,0.5)' : spec.status === 'PARTIAL' ? 'rgba(92,225,255,0.45)' : spec.status === 'SHELL' ? 'rgba(245,193,93,0.45)' : 'rgba(148,163,184,0.4)',
          color: spec.status === 'WORKING' ? '#6ee7b7' : spec.status === 'PARTIAL' ? '#67e8f9' : spec.status === 'SHELL' ? '#f5c15d' : '#94a3b8',
        }}>{spec.status}</span>
        <span className="text-[10px] uppercase tracking-widest text-slate-500">{project?.timeline.aspect} · {currentVersion?.label ?? 'Version 1'} · {lastRender ? `Render ${lastRender.status}` : 'No render'}</span>
        <span className="ml-auto font-mono text-[11px] text-cyan-200">{project ? formatTimecode(timelineDuration(project.timeline)) : '—'}</span>
      </header>
      <p className="px-1 text-[11px] text-slate-400">{spec.purpose}</p>
      <p className="truncate px-1 text-[10px] text-cyan-300">{status}</p>

      {page === 'media' && project ? (
        <HvsMediaViPanel project={project} assets={assets} category={category} setCategory={setCategory} ingest={file => void ingest(file)} onStatus={setStatus} />
      ) : null}

      {page === 'vfx' && project ? (
        <HvsVfxPanel project={project} commit={commit} onStatus={setStatus} />
      ) : null}

      {page === 'color' && project ? (
        <HvsColorPanel project={project} commit={commit} />
      ) : null}

      {page === 'audio' && project ? (
        <HvsAudioPanel project={project} commit={commit} onStatus={setStatus} />
      ) : null}

      {page === 'photo' ? (
        <section className="foundry-glass rounded-lg border border-amber-900/40 p-3" data-testid="hvs-photo-page">
          <p className="text-[10px] uppercase tracking-widest text-amber-300">SHELL · still AssetRecords · retouch later</p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-3">
            {assets.map(asset => (
              <li key={asset.id} className="rounded border border-white/10 p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt="" src={`/api/media-command/assets/${asset.id}/file?kind=thumb`} className="h-28 w-full rounded object-cover" />
                <p className="mt-1 truncate text-[11px] text-amber-50">{asset.name}</p>
              </li>
            ))}
            {assets.length === 0 ? <li className="text-slate-500">No stills in this project.</li> : null}
          </ul>
        </section>
      ) : null}

      {page === 'ai' && project ? (
        <HvsGeneratePanel project={project} commit={commit} />
      ) : null}

      {page === 'review' ? (
        <section className="foundry-glass rounded-lg border border-amber-900/40 p-3" data-testid="hvs-review-page">
          <p className="text-[10px] uppercase tracking-widest text-cyan-300">PARTIAL · Version Browser WORKING · renders · A/B playback later</p>
          {project ? (
            <div className="mt-2" data-testid="hvs-review-versions">
              <HvsVersionBrowser project={project} onProject={setProject} />
            </div>
          ) : null}
          <div className="mt-3">
            <p className="text-[10px] uppercase tracking-widest text-amber-300">Renders</p>
            <ul className="mt-1 space-y-1 text-[12px] text-slate-400">
              {(project?.renderJobs ?? []).map(job => (
                <li key={job.id}>{job.target.aspect} · {job.status}{job.encoder ? ` · ${job.encoder}` : ''} · version {job.versionId}</li>
              ))}
              {(project?.renderJobs.length ?? 0) === 0 ? <li>No renders yet.</li> : null}
            </ul>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">QC, continuity warnings, and approval state are not faked.</p>
          <button
            type="button"
            data-testid="hvs-qc-run"
            className="mt-2 rounded border border-cyan-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-cyan-100"
            onClick={() => {
              if (!project) return
              void fetch('/api/media-command/qc', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ projectId: project.id, action: 'qc' }),
              }).then(r => r.json()).then((d: { findings?: Array<{ type: string; evidence: string }>; error?: string }) => {
                setStatus(d.error ?? `QC ${(d.findings ?? []).map(f => f.type).join(', ') || 'no findings'}`)
              })
            }}
          >Run technical QC</button>
        </section>
      ) : null}

      {page === 'deliver' ? (
        <section className="foundry-glass rounded-lg border border-amber-900/40 p-3" data-testid="hvs-deliver-page">
          <p className="text-[10px] uppercase tracking-widest text-cyan-300">PARTIAL · shared RenderQueue · unified RenderEngine · no publish without Commander</p>
          {lanes ? (
            <dl className="mt-2 grid gap-1 text-[11px] text-slate-300 sm:grid-cols-2" data-testid="hvs-deliver-unified-truth">
              <div>Aspect <span className="text-amber-100">{lanes.aspect}</span></div>
              <div>Codec <span className="text-amber-100">{lastRender?.encoder ?? lastRender?.target?.videoCodec ?? 'h264'} / aac</span></div>
              <div>Version <span className="text-amber-100">{lanes.versionLabel}</span></div>
              <div>VFX <span className="text-amber-100">{lanes.vfxActive ? `active (${lanes.effectGraphIds.join(', ')})` : 'off'}</span></div>
              <div>Color <span className="text-amber-100">{lanes.colorActive ? `active (${lanes.colorPipelineNodeIds.length} nodes)` : 'off'}</span></div>
              <div>Audio <span className="text-amber-100">{lanes.audioActive ? `active (${lanes.audioGraphChannelIds.length} ch)` : 'off'}</span></div>
              <div>Render <span className="text-amber-100">{lastRender ? lastRender.status : 'none'}</span></div>
            </dl>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {(['16:9', '9:16', '1:1'] as OutputAspect[]).map(aspect => (
              <button key={aspect} type="button" className="rounded border border-emerald-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-emerald-100" onClick={() => void renderAspect(aspect)}>Render {aspect}</button>
            ))}
            {(['MASTER', 'WEB_1080P', 'VERTICAL_1080x1920', 'SOCIAL_SQUARE'] as const).map(id => (
              <button
                key={id}
                type="button"
                data-testid={`hvs-preset-${id}`}
                className="rounded border border-amber-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-amber-100"
                onClick={() => {
                  const aspect = id === 'VERTICAL_1080x1920' ? '9:16' : id === 'SOCIAL_SQUARE' ? '1:1' : '16:9'
                  void renderAspect(aspect)
                  setStatus(`HVS preset ${id} requested. Project truth unchanged. Loudness not auto-normalized.`)
                }}
              >{id.replaceAll('_', ' ')}</button>
            ))}
            <button
              type="button"
              data-testid="hvs-preflight"
              className="rounded border border-cyan-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-cyan-100"
              onClick={() => {
                if (!project) return
                void fetch('/api/media-command/qc', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ projectId: project.id, action: 'preflight' }),
                }).then(r => r.json()).then((d: { ok?: boolean; issues?: Array<{ code: string }> }) => {
                  setStatus(d.ok ? 'Preflight OK' : `Preflight ${(d.issues ?? []).map(i => i.code).join(', ')}`)
                })
              }}
            >Preflight</button>
            {lastRender && (lastRender.status === 'queued' || lastRender.status === 'running') ? (
              <button
                type="button"
                className="rounded border border-rose-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-rose-100"
                onClick={() => {
                  if (!project || !lastRender) return
                  void fetch('/api/media-command/render', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ projectId: project.id, action: 'cancel', jobId: lastRender.id }),
                  }).then(r => r.json()).then((d: { project?: HvsProject }) => {
                    if (d.project) setProject(d.project)
                    setStatus('Cancel requested. Project and originals kept.')
                  })
                }}
              >Cancel render</button>
            ) : null}
            <Link href={`${HVS_CANONICAL_PATH}/render-queue`} className="rounded border border-cyan-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-cyan-200">Open queue</Link>
          </div>
        </section>
      ) : null}

      <HvsGlobalDirector projectId={projectId} page={page} />

      <details className="rounded border border-white/5 p-2 text-[10px] text-slate-500">
        <summary className="cursor-pointer uppercase tracking-widest">Matrix rows on this page ({rows.length})</summary>
        <ul className="mt-1 columns-2 gap-3">
          {rows.slice(0, 24).map(row => (
            <li key={row.id}>{row.id} · {row.state}</li>
          ))}
          {rows.length > 24 ? <li>… {rows.length - 24} more</li> : null}
        </ul>
      </details>
    </div>
  )
}
