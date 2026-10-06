'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { HVS_CANONICAL_PATH, hvsStudioHref } from '@/lib/media-command/navigation'
import type { Hvs3DIntent, Hvs3DPlanPatch, Hvs3DScene, HvsProductionBlueprint3D, HvsScenePlan } from '@/lib/media-command/director3d/types'
import type { HvsDirectorPlan, HvsDirectorPlanPatch, HvsDirectorPrevis, HvsProductionBlueprint } from '@/lib/media-command/director/types'
import { toSeconds } from '@/lib/media-command/time'
import type { HvsProject } from '@/lib/media-command/types'
import type { AlleyKernelPlayback, Hvs3DViewportMode } from './Hvs3DViewport'
import type { HvsAlleyBinding } from '@/lib/media-command/destruction/types'
import type { HvsDirectorPerformanceTrack } from '@/lib/media-command/digital-human/scene-performance'
import { HvsUnrealExecutionStatus } from './HvsUnrealExecutionStatus'
import './hvs-3d-director.css'

const Hvs3DViewport = dynamic(
  () => import('./Hvs3DViewport').then(mod => mod.Hvs3DViewport),
  { ssr: false },
)

const ACCEPTANCE_PROMPT = 'Create an 8-second nighttime city shot. Place a person beside a black car. Have the person walk toward a doorway. Start the camera low behind the car. Orbit around the person. Finish with a close-up.'
const DIRECTOR_ACCEPT_PROMPT = "Create an 11-second nighttime action scene. Ra'el is standing beside a black car in an alley. Start with a 24mm wide establishing shot. Cut low behind the car. Have Ra'el walk toward a doorway. Orbit clockwise around him. At about six seconds the building behind him begins collapsing. Pull the camera backward during the collapse. Nearby background actors react and move away. Finish on an 85mm close-up of Ra'el while dust crosses the foreground."

type DirectorResponse = {
  intent?: Hvs3DIntent
  plan?: HvsScenePlan
  directorPlan?: HvsDirectorPlan | null
  directorPatch?: HvsDirectorPlanPatch | null
  directorPrevis?: HvsDirectorPrevis | null
  project?: HvsProject
  scene?: Hvs3DScene | null
  performanceTracks?: HvsDirectorPerformanceTrack[]
  patch?: Hvs3DPlanPatch | null
  blueprint?: HvsProductionBlueprint3D | HvsProductionBlueprint
  previs?: { sceneHash?: string }
  error?: string
  mutated?: boolean
  generatorAuthorized?: boolean
}

async function director(body: Record<string, unknown>): Promise<DirectorResponse> {
  const res = await fetch('/api/media-command/director3d', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json() as DirectorResponse
  if (!res.ok) throw new Error(data.error ?? 'I could not complete that.')
  return data
}

export function Hvs3DDirectorScreen({
  initialPrompt = '',
  initialProjectId = null,
}: {
  initialPrompt?: string
  initialProjectId?: string | null
}) {
  const [prompt, setPrompt] = useState(initialPrompt)
  const [projectId, setProjectId] = useState<string | null>(initialProjectId)
  const [intent, setIntent] = useState<Hvs3DIntent | null>(null)
  const [plan, setPlan] = useState<HvsScenePlan | null>(null)
  const [scene, setScene] = useState<Hvs3DScene | null>(null)
  const [patch, setPatch] = useState<Hvs3DPlanPatch | null>(null)
  const [blueprint, setBlueprint] = useState<HvsProductionBlueprint3D | HvsProductionBlueprint | null>(null)
  const [directorPlan, setDirectorPlan] = useState<HvsDirectorPlan | null>(null)
  const [directorPatch, setDirectorPatch] = useState<HvsDirectorPlanPatch | null>(null)
  const [directorPrevis, setDirectorPrevis] = useState<HvsDirectorPrevis | null>(null)
  const [advancedTab, setAdvancedTab] = useState<'STORYBOARD' | 'CAMERA' | '3D' | 'CAST' | 'CROWD' | 'DESTRUCTION' | 'LIGHTING'>('STORYBOARD')
  const [busy, setBusy] = useState<'idle' | 'planning' | 'building' | 'revising'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Hvs3DViewportMode>('CAMERA')
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [changeOpen, setChangeOpen] = useState(false)
  const [revision, setRevision] = useState('')
  const [reloadProof, setReloadProof] = useState<string | null>(null)
  const [kernel, setKernel] = useState<AlleyKernelPlayback | null>(null)
  const [alley, setAlley] = useState<HvsAlleyBinding | null>(null)
  const [performanceTracks, setPerformanceTracks] = useState<HvsDirectorPerformanceTrack[]>([])

  async function loadKernel(project: HvsProject | null | undefined) {
    const binding = project?.destruction?.alleyBinding ?? null
    setAlley(binding)
    if (!project || !binding) {
      setKernel(null)
      return
    }
    const res = await fetch(`/api/media-command/destruction?projectId=${encodeURIComponent(project.id)}`)
    if (!res.ok) return
    const body = await res.json() as { playback?: { fps: number; frameCount: number; nodes: AlleyKernelPlayback['nodes'] } }
    if (!body.playback) return
    setKernel({
      cacheManifestId: binding.cacheManifestId,
      simulationRuns: binding.simulationRuns,
      collapseStartSec: binding.collapseStartSec,
      fps: body.playback.fps,
      frameCount: body.playback.frameCount,
      shakeSceneSec: binding.shakeSceneSec,
      nodes: body.playback.nodes,
    })
  }

  useEffect(() => {
    if (!projectId) return
    void fetch(`/api/media-command/director3d?projectId=${encodeURIComponent(projectId)}`)
      .then(r => r.json())
      .then((data: DirectorResponse & { session?: { intent?: Hvs3DIntent; plan?: HvsScenePlan; patch?: Hvs3DPlanPatch; blueprint?: HvsProductionBlueprint3D; directorPlan?: HvsDirectorPlan; directorPatch?: HvsDirectorPlanPatch; directorPrevis?: HvsDirectorPrevis; directorBlueprint?: HvsProductionBlueprint } }) => {
        if (data.project) setProjectId(data.project.id)
        if (data.scene) {
          setScene(data.scene)
          setReloadProof(data.scene.id)
        }
        setPerformanceTracks(data.performanceTracks ?? [])
        if (data.session?.intent) setIntent(data.session.intent)
        if (data.session?.plan) setPlan(data.session.plan)
        if (data.session?.patch) setPatch(data.session.patch)
        if (data.session?.blueprint) setBlueprint(data.session.blueprint)
        if (data.session?.directorPlan) setDirectorPlan(data.session.directorPlan)
        if (data.session?.directorPatch) setDirectorPatch(data.session.directorPatch)
        if (data.session?.directorPrevis) setDirectorPrevis(data.session.directorPrevis)
        if (data.session?.directorBlueprint) setBlueprint(data.session.directorBlueprint)
        if (data.project) void loadKernel(data.project)
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

  const durationSec = scene ? toSeconds(scene.duration) : plan ? Number(plan.durationLabel.replace(/[^\d.]/g, '')) || 8 : 8
  const activeDirectorShot = directorPlan?.shots.find(shot => playhead >= toSeconds(shot.start) && playhead < toSeconds(shot.end)) ?? directorPlan?.shots[directorPlan.shots.length - 1] ?? null
  const activeSceneShot = scene?.shots.find(shot => playhead >= toSeconds(shot.start) && playhead < toSeconds(shot.end)) ?? scene?.shots[scene.shots.length - 1] ?? null
  const activeSceneCamera = scene?.cameras.find(item => item.id === activeSceneShot?.cameraId) ?? scene?.cameras[0] ?? null
  const directing = useMemo(() => {
    if (!scene) return []
    const lines = []
    if (scene.characters.some(item => item.motionPathId)) lines.push('Character movement')
    if (scene.cameras.some(item => item.pathId)) lines.push('Camera movement')
    if (scene.lights.length) lines.push('Lighting')
    return lines
  }, [scene])

  async function createPlan() {
    setBusy('planning')
    setError(null)
    try {
      const result = await director({ action: 'plan', projectId, prompt, projectName: prompt.slice(0, 48) })
      setIntent(result.intent ?? null)
      setPlan(result.plan ?? null)
      setDirectorPlan(result.directorPlan ?? null)
      setProjectId(result.project?.id ?? projectId)
      setScene(result.scene ?? null)
      setPatch(null)
      setDirectorPatch(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'I could not create that plan.')
    } finally {
      setBusy('idle')
    }
  }

  async function buildScene() {
    setBusy('building')
    setError(null)
    try {
      const result = await director({ action: 'build', projectId })
      setPlan(result.plan ?? plan)
      setDirectorPlan(result.directorPlan ?? directorPlan)
      setDirectorPrevis(result.directorPrevis ?? directorPrevis)
      setScene(result.scene ?? null)
      setProjectId(result.project?.id ?? projectId)
      if (result.scene?.id) setReloadProof(result.scene.id)
      setPlayhead(0)
      if (result.project) await loadKernel(result.project)
      const pid = result.project?.id ?? projectId
      if (pid) {
        const fresh = await fetch(`/api/media-command/director3d?projectId=${encodeURIComponent(pid)}`).then(r => r.json()) as DirectorResponse
        if (fresh.scene) setScene(fresh.scene)
        setPerformanceTracks(fresh.performanceTracks ?? [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'I could not build that scene.')
    } finally {
      setBusy('idle')
    }
  }

  async function proposeRevision() {
    if (!revision.trim()) return
    setBusy('revising')
    try {
      const result = await director({ action: 'revise', projectId, prompt: revision })
      setPatch(result.patch ?? null)
      setDirectorPatch(result.directorPatch ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'I could not understand that change.')
    } finally {
      setBusy('idle')
    }
  }

  async function applyRevision(ok: boolean) {
    setBusy('revising')
    try {
      const result = await director({ action: ok ? 'apply-revision' : 'reject-revision', projectId })
      setScene(result.scene ?? scene)
      setPatch(ok ? null : result.patch ?? null)
      setDirectorPlan(result.directorPlan ?? directorPlan)
      setDirectorPatch(ok ? null : result.directorPatch ?? directorPatch)
      setDirectorPrevis(result.directorPrevis ?? directorPrevis)
      if (ok) setChangeOpen(false)
      if (ok && result.project) await loadKernel(result.project)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'I could not apply that change.')
    } finally {
      setBusy('idle')
    }
  }

  async function useScene() {
    setBusy('building')
    try {
      const result = await director({ action: 'use-scene', projectId })
      setBlueprint(result.blueprint ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'I could not approve that scene.')
    } finally {
      setBusy('idle')
    }
  }

  const working = busy !== 'idle'
  const placeholderCount = scene?.objects.filter(item => item.placeholder).length ?? 0

  return (
    <section className="hvs-3d" data-testid="hvs-3d-director">
      <header className="hvs-3d-hero">
        <p className="hvs-3d-kicker">Higher Vision Studios</p>
        <h1 className="hvs-3d-title">3D Director</h1>
        <p className="hvs-3d-sub">
          Describe the shot in ordinary language. HVS plans the scene, waits for BUILD SCENE, then plays a previs.
          Placeholders are blocking stand-ins, not generated people. No video is generated from this screen.
        </p>
        <textarea
          className="hvs-3d-prompt"
          data-testid="hvs-3d-prompt"
          value={prompt}
          onChange={event => setPrompt(event.target.value)}
          placeholder="Put a woman next to a black sports car on a wet city street at night…"
        />
        <div className="hvs-3d-row">
          <button type="button" className="hvs-3d-chip" onClick={() => setPrompt(ACCEPTANCE_PROMPT)}>Night city example</button>
          <button type="button" className="hvs-3d-chip" onClick={() => setPrompt('Build a shot with a black car in an alley. Put the person beside it. Circle around them and finish with a close-up.')}>Alley example</button>
          <button type="button" className="hvs-3d-chip" data-testid="hvs-director-example" onClick={() => setPrompt(DIRECTOR_ACCEPT_PROMPT)}>11-second action</button>
        </div>
        <div className="hvs-3d-row">
          <button
            type="button"
            className="hvs-3d-btn hvs-3d-btn-go"
            data-testid="hvs-3d-plan"
            disabled={working || !prompt.trim()}
            onClick={() => void createPlan()}
          >
            {busy === 'planning' ? 'Planning…' : 'Direct this shot'}
          </button>
          <Link href={hvsStudioHref(projectId)} className="hvs-3d-btn hvs-3d-btn-ghost">Advanced Editor</Link>
        </div>
      </header>

      {plan && !scene ? (
        <article className="hvs-3d-panel" data-testid="hvs-3d-scene-plan">
          <h2>{directorPlan ? 'YOUR SCENE' : plan.title}</h2>
          <p className="hvs-3d-sub">{directorPlan ? `${directorPlan.timing.durationSec} seconds · ${directorPlan.shots.length} shots` : `${plan.durationLabel} · ${plan.environmentLabel} · ${plan.shotCount} shots`}</p>
          {directorPlan ? (
            <div data-testid="hvs-director-plan">
              <p className="hvs-3d-sub">{directorPlan.creativeGoal}</p>
              <p className="hvs-3d-sub">{directorPlan.lightingPlan.summary}</p>
              <ol className="hvs-3d-list" data-testid="hvs-director-beats">
                {directorPlan.storyBeats.map(beat => (
                  <li key={beat.id}>{beat.order}. {beat.description}</li>
                ))}
              </ol>
              <div className="hvs-3d-shots" data-testid="hvs-director-shot-list">
                {directorPlan.shots.map(shot => (
                  <div key={shot.id} data-testid={`hvs-director-shot-${shot.order}`}>
                    <p>Shot {shot.order} · {shot.commanderLabel}</p>
                    <p className="hvs-3d-sub">Purpose: {shot.purpose.replace(/_/g, ' ')}</p>
                    <p className="hvs-3d-sub">Camera: {shot.cameraSpec.lensIntent} {shot.motionPreset.replace(/_/g, ' ').toLowerCase()}</p>
                    <p className="hvs-3d-sub">Reason: {shot.directorReason}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <p className="hvs-3d-sub">HVS will:</p>
          <ul className="hvs-3d-list">
            {plan.steps.map(step => <li key={step.id}>✓ {step.label}</li>)}
          </ul>
          <div className="hvs-3d-shots" data-testid="hvs-3d-shot-list">
            <h3>YOUR SHOTS</h3>
            {plan.shots.map(shot => (
              <p key={shot.id}>{shot.order}. {shot.label} — {shot.durationLabel}</p>
            ))}
          </div>
          <button
            type="button"
            className="hvs-3d-btn hvs-3d-btn-go"
            data-testid="hvs-3d-build-scene"
            disabled={working}
            onClick={() => void buildScene()}
          >
            {busy === 'building' ? 'Building…' : directorPlan ? 'Build previs' : 'Build scene'}
          </button>
          <p className="hvs-3d-sub" data-testid="hvs-3d-no-mutation">Nothing has been built yet. Approval is required.</p>
        </article>
      ) : null}

      {scene ? (
        <article className="hvs-3d-stage">
          <Hvs3DViewport scene={scene} playheadSec={playhead} playing={false} mode={mode} showPaths={showAdvanced} destruction={kernel} performanceTracks={performanceTracks} />
          <div className="hvs-3d-stage-copy">
            <h2>YOUR SCENE</h2>
            <p>{durationSec} seconds · {scene.shots.length} shots</p>
            {directorPlan ? (
              <p data-testid="hvs-director-clock">Playhead {playhead.toFixed(2)}s · shot {activeDirectorShot?.order ?? '—'} {activeDirectorShot?.commanderLabel ?? ''}</p>
            ) : null}
            {directorPlan ? <p data-testid="hvs-director-active-shot">{activeDirectorShot?.commanderLabel ?? ''}</p> : null}
            <p>HVS is directing:</p>
            <ul className="hvs-3d-list">
              {directing.map(line => <li key={line}>✓ {line}</li>)}
            </ul>
            <p className="hvs-3d-placeholder" data-testid="hvs-3d-placeholder-badge">
              {placeholderCount} PLACEHOLDER block{placeholderCount === 1 ? '' : 's'} — not a generated person.
            </p>
            <p data-testid="hvs-3d-motion-honesty">
              Character motion: {scene.characters[0]?.motionHonesty === 'CHARACTER_ANIMATION' ? 'CHARACTER ANIMATION' : scene.characters[0]?.motionHonesty === 'POSITIONAL_MOTION' ? 'POSITIONAL MOTION' : 'none'}
            </p>
            {performanceTracks[0] ? (
              <div data-testid="hvs-director-performance">
                <p>RA&apos;EL</p>
                <p data-testid="hvs-director-rig-state">RIG: READY</p>
                <p data-testid="hvs-director-take">PERFORMANCE: TAKE 3</p>
                <p data-testid="hvs-director-playback">PLAYBACK: SCENE CLOCK</p>
                <p className="hvs-3d-sub" data-testid="hvs-director-performance-detail">
                  offset {performanceTracks[0].startTime.ticks}/{performanceTracks[0].startTime.timescale} · {performanceTracks[0].policy} · take {performanceTracks[0].takeId}
                </p>
              </div>
            ) : null}
            {scene.cameras.length ? (
              <div data-testid="hvs-director-camera">
                <p data-testid="hvs-director-camera-mode">CAMERA: {mode === 'CAMERA' ? 'SCENE' : mode === 'DIRECT' ? 'DEBUG ORBIT' : mode}</p>
                <p data-testid="hvs-director-camera-shot">SHOT: {activeSceneShot?.commanderLabel ?? activeSceneShot?.name ?? '—'}</p>
                <p data-testid="hvs-director-camera-lens">LENS: {activeSceneCamera ? `${activeSceneCamera.focalLength}mm` : '—'}</p>
                <p data-testid="hvs-director-camera-clock">PLAYBACK: SCENE CLOCK</p>
              </div>
            ) : null}
            <div className="hvs-3d-row">
              <button type="button" className="hvs-3d-btn hvs-3d-btn-go" data-testid="hvs-3d-play" onClick={() => {
                if (playhead >= durationSec - 0.05) setPlayhead(0)
                setPlaying(true)
              }}>
                {directorPlan ? 'Play scene' : 'Play'}
              </button>
              <button type="button" className="hvs-3d-btn" data-testid="hvs-3d-pause" onClick={() => setPlaying(false)}>Pause</button>
              <button type="button" className="hvs-3d-btn" data-testid="hvs-3d-restart" onClick={() => { setPlayhead(0); setPlaying(true) }}>Restart</button>
              {directorPlan ? <span data-testid="hvs-director-play" hidden /> : null}
              <button type="button" className="hvs-3d-btn" data-testid="hvs-3d-change" onClick={() => setChangeOpen(true)}>Change something</button>
              <button type="button" className="hvs-3d-btn" data-testid="hvs-3d-use-scene" onClick={() => void useScene()}>Use this scene</button>
            </div>
            <label className="hvs-3d-sub" data-testid="hvs-3d-seek-label">
              Seek
              <input
                type="range"
                min={0}
                max={1000}
                value={Math.round((playhead / Math.max(0.001, durationSec)) * 1000)}
                data-testid="hvs-3d-seek"
                onChange={event => {
                  setPlaying(false)
                  setPlayhead((Number(event.target.value) / 1000) * durationSec)
                }}
              />
            </label>
            <div className="hvs-3d-row" data-testid="hvs-3d-modes">
              {(['DIRECT', 'CAMERA', 'TOP', 'FRONT', 'SIDE'] as const).map(item => (
                <button
                  key={item}
                  type="button"
                  className={mode === item ? 'hvs-3d-chip hvs-3d-chip-on' : 'hvs-3d-chip'}
                  data-testid={`hvs-3d-mode-${item.toLowerCase()}`}
                  onClick={() => setMode(item)}
                >
                  {item === 'CAMERA' ? 'SCENE' : item === 'DIRECT' ? 'ORBIT' : item}
                </button>
              ))}
            </div>
            <div className="hvs-3d-shots" data-testid="hvs-3d-built-shots">
              <h3>YOUR SHOTS</h3>
              {scene.shots.map((shot, index) => (
                <p key={shot.id}>{index + 1}. {shot.commanderLabel}</p>
              ))}
            </div>
            {directorPlan ? (
              <div data-testid="hvs-director-built">
                <p className="hvs-3d-placeholder" data-testid="hvs-director-destruction">
                  {kernel
                    ? `DESTRUCTION PREVIS — REAL KERNEL CACHE · collapse ${directorPlan.timing.collapseSec.toFixed(1)}s · ${kernel.simulationRuns} sim run${kernel.simulationRuns === 1 ? '' : 's'}`
                    : `DESTRUCTION PREVIS PLACEHOLDER · collapse ${directorPlan.timing.collapseSec.toFixed(1)}s · geometric proxy, not a simulation.`}
                </p>
                <p className="hvs-3d-sub" data-testid="hvs-director-framing">
                  Destruction: {kernel ? 'REAL PREVIS' : 'PLACEHOLDER'} · Framing: {alley?.framingStatus ?? '—'} · Shot 5: Ra&apos;el close-up · Building {alley && alley.backgroundVisibleFraction > 0 ? 'visible' : 'pending'}
                </p>
                <p className="hvs-3d-sub" data-testid="hvs-director-character">
                  Ra&apos;el · {performanceTracks[0] ? 'HVS HUMANOID RIG · TAKE 3 · SCENE CLOCK' : 'PLACEHOLDER CHARACTER'} · identity {directorPlan.castRefs[0]} · same entity across shots.
                </p>
                <p className="hvs-3d-sub" data-testid="hvs-director-crowd">{directorPlan.backgroundPopulation.count} placeholder extras · react {(alley?.crowdReactSceneSec ?? directorPlan.timing.crowdReactSec).toFixed(1)}s</p>
                {alley ? (
                  <p className="hvs-3d-sub" data-testid="hvs-director-kernel-meta">
                    cache {alley.cacheManifestId} · runs {alley.simulationRuns} · shake {alley.shakeSceneSec.toFixed(2)}s · hero coverage {alley.heroFrameCoverage.toFixed(2)} · conditioning {alley.conditioningRefs.length}
                  </p>
                ) : null}
                {directorPlan.acting.lookBack ? <p className="hvs-3d-sub" data-testid="hvs-director-lookback">Ra&apos;el looks back at the collapse, then turns to camera.</p> : null}
                {directorPlan.shots.map(shot => (
                  <p key={shot.id} data-testid={`hvs-director-reason-${shot.order}`}>
                    SHOT {shot.order} · Purpose: {shot.purpose.replace(/_/g, ' ')} · Camera: {shot.cameraSpec.lensIntent} · Reason: {shot.directorReason}
                  </p>
                ))}
              </div>
            ) : null}
            {directorPrevis ? (
              <div className="hvs-3d-row" data-testid="hvs-director-storyboard">
                {directorPrevis.storyboard.map(frame => (
                  <div key={frame.id} dangerouslySetInnerHTML={{ __html: frame.svg }} />
                ))}
              </div>
            ) : null}
            {blueprint ? (
              <p className="hvs-3d-sub" data-testid="hvs-3d-blueprint-ready">
                Production blueprint approved for downstream HVS use. Video generation is not authorized. Provider-neutral.
              </p>
            ) : null}
            {reloadProof ? <p data-testid="hvs-3d-reload-id" className="hvs-3d-sub">Scene {reloadProof}</p> : null}
          </div>
        </article>
      ) : null}

      {changeOpen ? (
        <article className="hvs-3d-panel" data-testid="hvs-3d-revision">
          <h2>Change something</h2>
          <textarea
            className="hvs-3d-prompt"
            data-testid="hvs-3d-revision-input"
            value={revision}
            onChange={event => setRevision(event.target.value)}
            placeholder="Make the camera lower and slow down the orbit."
          />
          <div className="hvs-3d-row">
            <button type="button" className="hvs-3d-chip" onClick={() => setRevision('Make the camera lower and slow down the orbit.')}>Lower + slower orbit</button>
            <button type="button" className="hvs-3d-chip" onClick={() => setRevision('Put the close-up first.')}>Close-up first</button>
            <button type="button" className="hvs-3d-chip" onClick={() => setRevision('Move her farther away.')}>Farther away</button>
            <button type="button" className="hvs-3d-chip" data-testid="hvs-director-rev1" onClick={() => setRevision('Make the orbit slower and have Ra\'el reach the doorway before the collapse starts.')}>Slower orbit + arrive first</button>
            <button type="button" className="hvs-3d-chip" data-testid="hvs-director-rev2" onClick={() => setRevision('Make the final close-up lower and tighter.')}>Lower tighter CU</button>
            <button type="button" className="hvs-3d-chip" data-testid="hvs-director-rev3" onClick={() => setRevision('Keep more of the falling building visible behind Ra\'el.')}>More building in CU</button>
            <button type="button" className="hvs-3d-chip" data-testid="hvs-director-rev-acting" onClick={() => setRevision('Have Ra\'el look back at the collapse before turning to camera.')}>Look back</button>
          </div>
          <button type="button" className="hvs-3d-btn" disabled={working || !revision.trim()} onClick={() => void proposeRevision()}>
            Show the change
          </button>
          {directorPatch ? <p className="hvs-3d-sub" data-testid="hvs-director-patch">{directorPatch.summary}{directorPatch.directorChoice ? ` ${directorPatch.directorChoice}` : ''}</p> : null}
          {patch ? (
            <div data-testid="hvs-3d-revision-proposal">
              {patch.summaryLines.map(line => <p key={line}>{line}</p>)}
              <div className="hvs-3d-row">
                <button type="button" className="hvs-3d-btn hvs-3d-btn-go" data-testid="hvs-3d-apply-revision" onClick={() => void applyRevision(true)}>Apply</button>
                <button type="button" className="hvs-3d-btn hvs-3d-btn-ghost" onClick={() => void applyRevision(false)}>Keep current</button>
              </div>
            </div>
          ) : null}
        </article>
      ) : null}

      <button
        type="button"
        className="hvs-3d-btn hvs-3d-btn-ghost"
        data-testid="hvs-3d-advanced"
        onClick={() => setShowAdvanced(v => !v)}
      >
        Advanced 3D Controls
      </button>
      {showAdvanced && scene ? (
        <article className="hvs-3d-panel" data-testid="hvs-3d-advanced-body">
          <HvsUnrealExecutionStatus projectId={projectId} />
          <div className="hvs-3d-row" data-testid="hvs-director-advanced-tabs">
            {(['STORYBOARD', 'CAMERA', '3D', 'CAST', 'CROWD', 'DESTRUCTION', 'LIGHTING'] as const).map(tab => (
              <button key={tab} type="button" className={advancedTab === tab ? 'hvs-3d-chip hvs-3d-chip-on' : 'hvs-3d-chip'} onClick={() => setAdvancedTab(tab)}>{tab}</button>
            ))}
          </div>
          {advancedTab === 'STORYBOARD' && directorPlan ? (
            <ul className="hvs-3d-list">
              {directorPlan.shots.map(shot => <li key={shot.id}>{shot.commanderLabel} · {shot.purpose} · {shot.transitionIn}</li>)}
            </ul>
          ) : null}
          {advancedTab === 'CAST' && directorPlan ? (
            <p className="hvs-3d-sub">Ra&apos;el identity {directorPlan.castRefs[0]} · {directorPlan.characters[0]?.state} · blocking {directorPlan.blockingPlan.actions.map(item => item.kind).join(' → ')}</p>
          ) : null}
          {advancedTab === 'CROWD' && directorPlan ? (
            <p className="hvs-3d-sub">{directorPlan.backgroundPopulation.count} extras · {directorPlan.backgroundPopulation.honesty} · nearest react at {directorPlan.timing.crowdReactSec.toFixed(1)}s after collapse {directorPlan.timing.collapseSec.toFixed(1)}s</p>
          ) : null}
          {advancedTab === 'CAMERA' ? (
            <ul className="hvs-3d-list">
              {scene.cameras.map(cam => (
                <li key={cam.id}>{cam.name} · {cam.movement} · {cam.focalLength}mm · target {cam.target?.kind ?? 'none'}</li>
              ))}
            </ul>
          ) : null}
          {advancedTab === '3D' ? (
            <ul className="hvs-3d-list">
              {scene.objects.map(node => (
                <li key={node.id}>{node.type} · {node.label} · x {node.transform.position.x.toFixed(2)}</li>
              ))}
            </ul>
          ) : null}
          {advancedTab === 'DESTRUCTION' && directorPlan ? (
            <p className="hvs-3d-sub">Collapse {directorPlan.timing.collapseSec.toFixed(1)}s · impact {directorPlan.timing.impactSec.toFixed(1)}s · {directorPlan.destructionHonesty} · {directorPlan.destructionPlan?.summary}</p>
          ) : null}
          {advancedTab === 'LIGHTING' && directorPlan ? (
            <p className="hvs-3d-sub">{directorPlan.lightingPlan.summary}</p>
          ) : null}
          {advancedTab === '3D' ? (
            <>
              <h2>Keyframes</h2>
              <p>{scene.keyframes.length} rational keyframes · timescale {scene.timeline.timescale}</p>
              <h2>Motion paths</h2>
              <ul className="hvs-3d-list">
                {scene.paths.map(path => (
                  <li key={path.id}>{path.kind} · {path.name} · {path.interpolation} · {path.points.length} points</li>
                ))}
              </ul>
            </>
          ) : null}
        </article>
      ) : null}

      {error ? <p className="hvs-3d-error" data-testid="hvs-3d-error">{error}</p> : null}
      {intent ? <p className="hvs-3d-sub" data-testid="hvs-3d-intent-id">Intent {intent.id}</p> : null}
      <p className="hvs-3d-sub">
        <Link href={HVS_CANONICAL_PATH}>Create</Link>
      </p>
    </section>
  )
}
