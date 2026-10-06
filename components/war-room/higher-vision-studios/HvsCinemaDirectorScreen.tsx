'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { HVS_CANONICAL_PATH, hvsStudioHref } from '@/lib/media-command/navigation'
import type { HvsCameraPlanPatch, HvsCinemaIntent, HvsCinemaPlan } from '@/lib/media-command/cinema-director/types'
import type { Hvs3DScene } from '@/lib/media-command/director3d/types'
import { toSeconds } from '@/lib/media-command/time'
import type { HvsProject } from '@/lib/media-command/types'
import type { Hvs3DViewportMode } from './Hvs3DViewport'
import type { HvsDirectorPerformanceTrack } from '@/lib/media-command/digital-human/scene-performance'
import './hvs-3d-director.css'
import './hvs-cinema-director.css'

const Hvs3DViewport = dynamic(
  () => import('./Hvs3DViewport').then(mod => mod.Hvs3DViewport),
  { ssr: false },
)

const ACCEPTANCE_PROMPT = 'Create an 11-second cinematic sequence. Start with a 24mm wide establishing shot. Cut to a low-angle shot behind the black car. Orbit clockwise around the driver\'s side while keeping the person on the left third. Then use an 85mm close-up and slowly push toward the person\'s face.'

type CinemaResponse = {
  intent?: HvsCinemaIntent
  plan?: HvsCinemaPlan
  project?: HvsProject
  scene?: Hvs3DScene | null
  performanceTracks?: HvsDirectorPerformanceTrack[]
  patch?: HvsCameraPlanPatch | null
  error?: string
  mutated?: boolean
}

async function cinema(body: Record<string, unknown>): Promise<CinemaResponse> {
  const res = await fetch('/api/media-command/cinema', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json() as CinemaResponse
  if (!res.ok) throw new Error(data.error ?? 'I could not complete that.')
  return data
}

export function HvsCinemaDirectorScreen({
  initialPrompt = '',
  initialProjectId = null,
}: {
  initialPrompt?: string
  initialProjectId?: string | null
}) {
  const [prompt, setPrompt] = useState(initialPrompt)
  const [projectId, setProjectId] = useState<string | null>(initialProjectId)
  const [intent, setIntent] = useState<HvsCinemaIntent | null>(null)
  const [plan, setPlan] = useState<HvsCinemaPlan | null>(null)
  const [scene, setScene] = useState<Hvs3DScene | null>(null)
  const [patch, setPatch] = useState<HvsCameraPlanPatch | null>(null)
  const [busy, setBusy] = useState<'idle' | 'planning' | 'previewing' | 'revising'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Hvs3DViewportMode>('CAMERA')
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showPaths, setShowPaths] = useState(false)
  const [changeOpen, setChangeOpen] = useState(false)
  const [revision, setRevision] = useState('')
  const [reloadProof, setReloadProof] = useState<string | null>(null)
  const [performanceTracks, setPerformanceTracks] = useState<HvsDirectorPerformanceTrack[]>([])

  useEffect(() => {
    if (!projectId) return
    void fetch(`/api/media-command/cinema?projectId=${encodeURIComponent(projectId)}`)
      .then(r => r.json())
      .then((data: CinemaResponse & { session?: { intent?: HvsCinemaIntent; plan?: HvsCinemaPlan; patch?: HvsCameraPlanPatch } }) => {
        if (data.project) setProjectId(data.project.id)
        if (data.scene) {
          setScene(data.scene)
          setReloadProof(data.scene.id)
        }
        setPerformanceTracks(data.performanceTracks ?? [])
        if (data.session?.intent) setIntent(data.session.intent)
        if (data.plan ?? data.session?.plan) setPlan(data.plan ?? data.session?.plan ?? null)
        if (data.session?.patch) setPatch(data.session.patch)
      })
      .catch(() => undefined)
  }, [projectId])

  useEffect(() => {
    if (!playing || !scene) return
    const duration = toSeconds(scene.duration)
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      setPlayhead(prev => {
        const next = prev + dt
        if (next >= duration) {
          setPlaying(false)
          return duration
        }
        return next
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, scene])

  const durationSec = scene ? toSeconds(scene.duration) : plan ? toSeconds(plan.duration) : 11
  const activeShot = useMemo(() => {
    if (!plan) return null
    return plan.shots.find(item => playhead >= toSeconds(item.start) && playhead < toSeconds(item.end)) ?? plan.shots[plan.shots.length - 1] ?? null
  }, [plan, playhead])

  async function createPlan() {
    setBusy('planning')
    setError(null)
    try {
      const result = await cinema({ action: 'plan', projectId, prompt, projectName: prompt.slice(0, 48) })
      setIntent(result.intent ?? null)
      setPlan(result.plan ?? null)
      setProjectId(result.project?.id ?? projectId)
      setScene(result.scene ?? null)
      setPatch(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'I could not create that shot plan.')
    } finally {
      setBusy('idle')
    }
  }

  async function previewShots() {
    setBusy('previewing')
    setError(null)
    try {
      const result = await cinema({ action: 'preview', projectId })
      setPlan(result.plan ?? plan)
      setScene(result.scene ?? null)
      setProjectId(result.project?.id ?? projectId)
      if (result.scene?.id) setReloadProof(result.scene.id)
      setPlayhead(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'I could not preview those shots.')
    } finally {
      setBusy('idle')
    }
  }

  async function proposeRevision() {
    if (!revision.trim()) return
    setBusy('revising')
    try {
      const result = await cinema({ action: 'revise', projectId, prompt: revision })
      setPatch(result.patch ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'I could not understand that camera change.')
    } finally {
      setBusy('idle')
    }
  }

  async function applyRevision() {
    setBusy('revising')
    try {
      const result = await cinema({ action: 'apply-revision', projectId })
      setPlan(result.plan ?? plan)
      setScene(result.scene ?? null)
      setPatch(result.patch ?? null)
      setChangeOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'I could not apply that camera change.')
    } finally {
      setBusy('idle')
    }
  }

  return (
    <div className="hvs-3d hvs-cinema" data-testid="hvs-cinema-director">
      <section className="hvs-3d-hero">
        <div className="hvs-3d-kicker">Higher Vision Studios · Cinema Director</div>
        <h1 className="hvs-3d-title">Direct the shots</h1>
        <p className="hvs-3d-sub">Say the camera in movie language. HVS turns that into a structured shot plan. Nothing builds until you preview.</p>
        <textarea
          className="hvs-3d-prompt"
          data-testid="hvs-cinema-prompt"
          value={prompt}
          onChange={event => setPrompt(event.target.value)}
          placeholder={ACCEPTANCE_PROMPT}
        />
        <div className="hvs-3d-row">
          <button type="button" className="hvs-3d-btn hvs-3d-btn-go" data-testid="hvs-cinema-direct" disabled={busy !== 'idle' || !prompt.trim()} onClick={() => void createPlan()}>
            {busy === 'planning' ? 'Planning…' : 'Direct this scene'}
          </button>
          <button type="button" className="hvs-3d-btn" onClick={() => setPrompt(ACCEPTANCE_PROMPT)}>Use sample sequence</button>
          {projectId ? <Link className="hvs-3d-btn hvs-3d-btn-ghost" href={hvsStudioHref(projectId)}>Advanced Editor</Link> : null}
          <Link className="hvs-3d-btn hvs-3d-btn-ghost" href={HVS_CANONICAL_PATH}>Create</Link>
        </div>
        {error ? <p className="hvs-3d-error">{error}</p> : null}
      </section>

      {plan ? (
        <section className="hvs-3d-panel" data-testid="hvs-cinema-shot-list">
          <div className="hvs-3d-kicker">Your shots</div>
          <ol className="hvs-cinema-shots">
            {plan.commanderShotList.map(item => (
              <li key={item.shotId} data-active={activeShot?.id === item.shotId ? '1' : '0'}>
                {item.index}. {item.name} — {item.durationLabel}
              </li>
            ))}
          </ol>
          <div className="hvs-3d-row">
            <button type="button" className="hvs-3d-btn hvs-3d-btn-go" data-testid="hvs-cinema-preview" disabled={busy !== 'idle'} onClick={() => void previewShots()}>
              {busy === 'previewing' ? 'Building…' : 'Preview'}
            </button>
            <button type="button" className="hvs-3d-btn" data-testid="hvs-cinema-change" onClick={() => setChangeOpen(true)}>Change something</button>
            <button type="button" className="hvs-3d-btn" data-testid="hvs-cinema-use-shots" disabled={busy !== 'idle'} onClick={() => void cinema({ action: 'use-shots', projectId })}>
              Use shots
            </button>
          </div>
          {plan.status === 'proposed' ? <p className="hvs-3d-sub">Nothing has been built yet.</p> : null}
        </section>
      ) : null}

      {scene ? (
        <section className="hvs-3d-stage" data-testid="hvs-cinema-previs">
          <div className="hvs-3d-row">
            <button type="button" className="hvs-3d-chip" data-testid="hvs-cinema-play" onClick={() => setPlaying(value => !value)}>{playing ? 'Pause' : 'Play'}</button>
            {(['CAMERA', 'DIRECT', 'TOP'] as Hvs3DViewportMode[]).map(item => (
              <button key={item} type="button" className="hvs-3d-chip" data-active={mode === item ? '1' : '0'} onClick={() => setMode(item)}>{item === 'CAMERA' ? 'Movie preview' : item === 'DIRECT' ? 'Path view' : 'Top'}</button>
            ))}
            <button type="button" className="hvs-3d-chip" data-testid="hvs-cinema-paths" onClick={() => setShowPaths(value => !value)}>{showPaths ? 'Hide path' : 'Show path'}</button>
            <span className="hvs-3d-sub">{playhead.toFixed(1)}s / {durationSec.toFixed(1)}s{activeShot ? ` · ${activeShot.name}` : ''}</span>
          </div>
          <Hvs3DViewport scene={scene} playheadSec={playhead} playing={false} mode={mode} showPaths={showPaths || mode !== 'CAMERA'} performanceTracks={performanceTracks} />
          {reloadProof ? <p className="hvs-3d-sub" data-testid="hvs-cinema-reload-proof">Reload persistence · {reloadProof}</p> : null}
        </section>
      ) : null}

      <button type="button" className="hvs-3d-btn hvs-3d-btn-ghost" data-testid="hvs-cinema-advanced" onClick={() => setShowAdvanced(value => !value)}>
        {showAdvanced ? 'Hide advanced details' : 'Advanced details'}
      </button>
      {showAdvanced && plan ? (
        <section className="hvs-3d-panel" data-testid="hvs-cinema-advanced-panel">
          {plan.shots.map(shot => (
            <div key={shot.id} className="hvs-cinema-adv">
              <strong>{shot.name}</strong>
              <span>{shot.cameraSpec.lensIntent} · {shot.cameraAngle} · {shot.cameraMovement} · {shot.framing}</span>
              <span>{shot.cameraSpec.focalLengthMm}mm · path {shot.pathId}</span>
            </div>
          ))}
          {intent ? <p className="hvs-3d-sub">Intent {intent.id} · skill {intent.skill ?? 'none'}</p> : null}
        </section>
      ) : null}

      {changeOpen ? (
        <section className="hvs-3d-panel" data-testid="hvs-cinema-revision">
          <div className="hvs-3d-kicker">Change the camera</div>
          <textarea className="hvs-3d-prompt" value={revision} onChange={event => setRevision(event.target.value)} placeholder="Make the orbit slower and lower the camera." />
          <div className="hvs-3d-row">
            <button type="button" className="hvs-3d-btn" disabled={busy !== 'idle'} onClick={() => void proposeRevision()}>Propose</button>
            {patch ? <button type="button" className="hvs-3d-btn hvs-3d-btn-go" data-testid="hvs-cinema-apply-revision" onClick={() => void applyRevision()}>Use this change</button> : null}
            <button type="button" className="hvs-3d-btn hvs-3d-btn-ghost" onClick={() => setChangeOpen(false)}>Cancel</button>
          </div>
          {patch ? (
            <ul className="hvs-3d-sub">
              {patch.summaryLines.map(line => <li key={line}>{line}</li>)}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
