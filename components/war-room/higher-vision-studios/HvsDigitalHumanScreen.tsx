'use client'

import { useEffect, useRef, useState } from 'react'
import type { HvsBackgroundPopulation, HvsCaptureDevice, HvsDigitalHuman, HvsPerformanceTake } from '@/lib/media-command/digital-human/types'
import { HvsRaelBodyPreview, type CompactHumanoidPose } from './HvsRaelBodyPreview'
import { HvsFaceReferencePanel } from './HvsFaceReferencePanel'
import { HvsCharacterProductionPanel } from './HvsCharacterProductionPanel'
import { readHvsResume } from '@/lib/media-command/navigation'
import './hvs-digital-human.css'

type ActorResponse = {
  projectId?: string
  error?: string
  rael?: HvsDigitalHuman | null
  characters?: HvsDigitalHuman[]
  populations?: HvsBackgroundPopulation[]
  devices?: HvsCaptureDevice[]
  take?: HvsPerformanceTake
  cameraActive?: boolean
  deviceReleased?: boolean
  motion?: {
    status?: string
    failure?: string | null
    message?: string | null
    landmarkFrames?: number
    overlay?: Array<{ i: number; points: Array<{ name: string; x: number; y: number; confidence?: number }> }>
  }
  tracking?: string
  model?: string
  coverage?: number
  frameTrackingCoverage?: number | null
  fullBodyCoverage?: number | null
  session?: { id: string; status: string; deviceReleased: boolean }
  preview?: {
    label: string
    atRest: boolean
    honesty: string
    photoreal: boolean
    samples?: Array<{ head: { yaw: number }; leftArm: number; rightArm: number; lean: number; root: { x: number } }>
  }
  reference?: { characterId?: string | null }
  acceptance?: string
  bodyBinding?: { characterId: string; rigId: string | null; rigType: string; takeId: string | null; motionId: string | null }
  bodyPreview?: {
    honesty?: string
    rigId?: string
    photoreal?: boolean
    metricLocomotion?: boolean
    atRest?: boolean
    takeId?: string
    quality?: string
    duration?: { ticks: number; timescale: number }
    poses?: CompactHumanoidPose[]
    leftArmRaise?: boolean
    rootTravel?: number
    fallbackLabel?: string
    rigAssignment?: HvsDigitalHuman['rigBinding']
  }
  readiness?: {
    level: string
    warning: string | null
    present: string[]
    missing: string[]
    windowFrames?: number
  }
}

const FULL_BODY_SETUP = [
  'Stand upright. One person only. Face the camera.',
  'Entire head visible. Both arms inside the frame.',
  'Both hips, both knees, and both ankles / feet visible.',
  'Move far enough back. Do not sit or recline. No furniture blocking the legs.',
  'Use front lighting. Avoid strong backlight.',
  'Keep the body centered. Stay inside the frame during movement.',
]

const TRACKING_BONES: Array<[string, string]> = [
  ['HEAD', 'NECK'],
  ['NECK', 'CHEST'],
  ['CHEST', 'PELVIS'],
  ['LEFT_SHOULDER', 'RIGHT_SHOULDER'],
  ['LEFT_SHOULDER', 'LEFT_ELBOW'],
  ['LEFT_ELBOW', 'LEFT_WRIST'],
  ['RIGHT_SHOULDER', 'RIGHT_ELBOW'],
  ['RIGHT_ELBOW', 'RIGHT_WRIST'],
  ['LEFT_SHOULDER', 'LEFT_HIP'],
  ['RIGHT_SHOULDER', 'RIGHT_HIP'],
  ['LEFT_HIP', 'RIGHT_HIP'],
  ['LEFT_HIP', 'LEFT_KNEE'],
  ['LEFT_KNEE', 'LEFT_ANKLE'],
  ['RIGHT_HIP', 'RIGHT_KNEE'],
  ['RIGHT_KNEE', 'RIGHT_ANKLE'],
]

const ACTOR_A = 'Have Actor A stand beside the black car, look at the doorway, hesitate, then walk toward it.'
const ALLEY = 'Add 12 background people in the alley. Most are walking. Three are standing near the storefront. When the collapse begins, the closest people turn and move away.'
const SCENE = "Start wide. Ra'el walks toward the doorway. He looks back when the building starts collapsing. The nearby extras react and move away. Finish on a close-up of Ra'el."

async function post(body: Record<string, unknown>): Promise<ActorResponse> {
  const res = await fetch('/api/media-command/digital-human', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json() as ActorResponse
  if (!res.ok) throw new Error(data.error ?? 'HVS could not do that.')
  return data
}

export function HvsDigitalHumanScreen({ initialProjectId = null }: { initialProjectId?: string | null }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [projectId, setProjectId] = useState<string | null>(initialProjectId)
  const [rael, setRael] = useState<HvsDigitalHuman | null>(null)
  const [characters, setCharacters] = useState<HvsDigitalHuman[]>([])
  const [populations, setPopulations] = useState<HvsBackgroundPopulation[]>([])
  const [devices, setDevices] = useState<HvsCaptureDevice[]>([])
  const [prompt, setPrompt] = useState(SCENE)
  const [cameraActive, setCameraActive] = useState(false)
  const [previewMode, setPreviewMode] = useState('BODY_REFERENCE')
  const [still, setStill] = useState<string | null>(null)
  const [takeLabel, setTakeLabel] = useState<string | null>(null)
  const [takeId, setTakeId] = useState<string | null>(null)
  const [quality, setQuality] = useState<string | null>(null)
  const [motionStatus, setMotionStatus] = useState<string | null>(null)
  const [tracking, setTracking] = useState('IDLE')
  const [modelReady, setModelReady] = useState('MODEL REQUIRED')
  const [showTracking, setShowTracking] = useState(false)
  const [landmarkCount, setLandmarkCount] = useState(0)
  const [coverage, setCoverage] = useState<number | null>(null)
  const [fullBodyCoverage, setFullBodyCoverage] = useState<number | null>(null)
  const [overlay, setOverlay] = useState<Array<{ i: number; points: Array<{ name: string; x: number; y: number; confidence?: number }> }>>([])
  const [poseFrame, setPoseFrame] = useState(0)
  const [samples, setSamples] = useState<Array<{ head: { yaw: number }; leftArm: number; rightArm: number; lean: number; root: { x: number } }>>([])
  const [previewLabel, setPreviewLabel] = useState<string | null>(null)
  const [previewRest, setPreviewRest] = useState(true)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [readiness, setReadiness] = useState<string | null>(null)
  const [framingWarning, setFramingWarning] = useState<string | null>(null)
  const [missingJoints, setMissingJoints] = useState<string[]>([])
  const [bodyPoses, setBodyPoses] = useState<CompactHumanoidPose[]>([])
  const [bodyDuration, setBodyDuration] = useState<{ ticks: number; timescale: number } | null>(null)
  const [showPlaceholder, setShowPlaceholder] = useState(false)
  const [rigReady, setRigReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/media-command/digital-human?audit=1')
      .then(res => res.json())
      .then((data: ActorResponse & { streamStarted?: boolean }) => {
        if (cancelled || data.error) return
        setDevices(data.devices ?? [])
        if (data.tracking) setTracking(data.tracking)
        if (data.model) setModelReady(data.model)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    if (initialProjectId) return
    const saved = readHvsResume()?.projectId
    if (saved) setProjectId(saved)
  }, [initialProjectId])

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    fetch(`/api/media-command/digital-human?projectId=${encodeURIComponent(projectId)}`)
      .then(res => res.json())
      .then((data: ActorResponse & { selectedTake?: HvsPerformanceTake | null; performanceLabel?: string | null }) => {
        if (cancelled || data.error) return
        apply(data)
        if (data.selectedTake) {
          setTakeId(data.selectedTake.id)
          setTakeLabel(data.selectedTake.label)
          setQuality(data.selectedTake.quality ?? null)
          if (typeof data.selectedTake.trackingCoverage === 'number') setCoverage(data.selectedTake.trackingCoverage)
          if (typeof data.selectedTake.frameTrackingCoverage === 'number') setCoverage(data.selectedTake.frameTrackingCoverage)
          if (typeof data.selectedTake.fullBodyCoverage === 'number') setFullBodyCoverage(data.selectedTake.fullBodyCoverage)
          if (data.projectId && data.selectedTake.rawAssetId) {
            setStill(`/api/media-command/digital-human?projectId=${encodeURIComponent(data.projectId)}&frameAssetId=${encodeURIComponent(data.selectedTake.rawAssetId)}`)
          }
        }
        if (data.performanceLabel) setMessage(data.performanceLabel)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [projectId])

  useEffect(() => {
    if (!projectId || !takeId) return
    let cancelled = false
    post({ action: 'bind-body-rig', projectId, characterId: 'rael-commander' })
      .then(bound => {
        if (cancelled) return
        apply(bound)
        return post({ action: 'preview-body-rig', projectId, takeId })
      })
      .then(preview => {
        if (cancelled || !preview) return
        apply(preview)
        if (preview.bodyPreview?.poses) setBodyPoses(preview.bodyPreview.poses)
        if (preview.bodyPreview?.duration) setBodyDuration(preview.bodyPreview.duration)
        setRigReady(true)
        if (preview.bodyPreview?.atRest === false) setPreviewRest(false)
        setPreviewLabel(preview.bodyPreview?.honesty ?? 'PRODUCTION BODY PREVIEW')
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [projectId, takeId])

  useEffect(() => {
    if (!projectId) return
    const next = new URL(window.location.href)
    if (next.searchParams.get('project') === projectId) return
    next.searchParams.set('project', projectId)
    window.history.replaceState(null, '', next.toString())
  }, [projectId])

  useEffect(() => {
    if (!showTracking || overlay.length < 2) return
    const timer = window.setInterval(() => setPoseFrame(frame => (frame + 1) % overlay.length), 80)
    return () => window.clearInterval(timer)
  }, [showTracking, overlay.length])

  useEffect(() => {
    if (samples.length < 2) return
    const timer = window.setInterval(() => setPoseFrame(frame => (frame + 1) % samples.length), 80)
    return () => window.clearInterval(timer)
  }, [samples.length])

  function apply(data: ActorResponse) {
    if (data.projectId) setProjectId(data.projectId)
    if (data.rael) setRael(data.rael)
    if (data.characters) setCharacters(data.characters)
    if (data.populations) setPopulations(data.populations)
    if (data.devices) setDevices(data.devices)
    if (data.motion?.status) setMotionStatus(data.motion.status)
    if (data.tracking) setTracking(data.tracking)
    if (data.model) setModelReady(data.model)
    if (typeof data.coverage === 'number') setCoverage(data.coverage)
    if (typeof data.frameTrackingCoverage === 'number') setCoverage(data.frameTrackingCoverage)
    if (typeof data.fullBodyCoverage === 'number') setFullBodyCoverage(data.fullBodyCoverage)
    if (typeof data.motion?.landmarkFrames === 'number') setLandmarkCount(data.motion.landmarkFrames)
    if (data.motion?.overlay) setOverlay(data.motion.overlay)
    if (data.session?.id) setSessionId(data.session.id)
    if (data.bodyBinding) setRigReady(Boolean(data.bodyBinding.rigId))
    if (data.rael?.rigBinding?.state === 'BOUND') setRigReady(true)
    if (data.bodyPreview?.poses) setBodyPoses(data.bodyPreview.poses)
    if (data.bodyPreview?.duration) setBodyDuration(data.bodyPreview.duration)
  }

  async function authorize() {
    setError('')
    const data = await post({ action: 'authorize-rael', projectId })
    apply(data)
    setMessage("Ra'el is authorized on this production. No reference media was enrolled.")
  }

  async function direct(text: string) {
    setError('')
    const data = await post({ action: 'direct', projectId, prompt: text })
    apply(data)
    setMessage(text)
  }

  async function checkCamera() {
    setError('')
    const res = await fetch('/api/media-command/digital-human?audit=1')
    const data = await res.json() as ActorResponse & { audioAvailable?: boolean; streamStarted?: boolean }
    setDevices(data.devices ?? [])
    setMotionStatus(data.motion?.status ?? null)
    if (data.tracking) setTracking(data.tracking)
    if (data.model) setModelReady(data.model)
    setMessage(data.streamStarted ? 'Unexpected stream.' : 'Camera audit finished. The camera is not streaming.')
  }

  function stopPreview() {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraActive(false)
  }

  async function startPreview() {
    setError('')
    stopPreview()
    if (projectId) {
      const started = await post({ action: 'capture-start', projectId, characterId: rael?.id, mode: previewMode })
      apply(started)
      setTracking('READY')
    }
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false })
    streamRef.current = stream
    if (videoRef.current) videoRef.current.srcObject = stream
    setCameraActive(true)
    const track = stream.getVideoTracks()[0]
    const settings = track?.getSettings()
    setMessage(`Preview ${settings?.width ?? '—'}×${settings?.height ?? '—'} · ${previewMode}`)
    setShowTracking(true)
    await checkFraming()
  }

  async function checkFraming() {
    setError('')
    stopPreview()
    const data = await post({ action: 'frame-check', projectId })
    apply(data)
    setCameraActive(false)
    setReadiness(data.readiness?.level ?? 'IMPROVE LIGHTING — TRACKING WEAK')
    setFramingWarning(data.readiness?.warning ?? null)
    setMissingJoints(data.readiness?.missing ?? [])
    setShowTracking(true)
    setMessage(data.readiness?.level === 'FULL BODY READY'
      ? 'FULL BODY READY. The acceptance take can start.'
      : `${data.readiness?.level ?? 'IMPROVE LIGHTING — TRACKING WEAK'}${data.readiness?.missing?.length ? ` Missing: ${data.readiness.missing.join(', ')}.` : ''}`)
  }

  async function recordReference() {
    setError('')
    if (readiness !== 'FULL BODY READY') {
      setMessage(readiness ?? 'Check framing first. The acceptance take stays blocked until the window says FULL BODY READY.')
      return
    }
    stopPreview()
    const data = await post({ action: 'acceptance-take', projectId, characterId: rael?.id })
    if (data.acceptance === 'FULL_BODY_FRAMING_NOT_ACHIEVED' || (data.readiness && data.readiness.level !== 'FULL BODY READY')) {
      setReadiness(data.readiness?.level ?? 'ADJUST CAMERA — LOWER BODY OUT OF FRAME')
      setFramingWarning(data.readiness?.level ?? 'FULL_BODY_FRAMING_NOT_ACHIEVED')
      setMissingJoints(data.readiness?.missing ?? [])
      setCameraActive(false)
      setMessage(data.readiness?.level ?? 'FULL_BODY_FRAMING_NOT_ACHIEVED')
      return
    }
    apply(data)
    setCameraActive(false)
    setTracking(data.motion?.status === 'EXTRACTED' || data.motion?.landmarkFrames ? 'READY' : 'IDLE')
    setTakeLabel(data.take?.label ?? null)
    setTakeId(data.take?.id ?? null)
    setQuality(data.take?.quality ?? null)
    if (typeof data.coverage === 'number') setCoverage(data.coverage)
    if (typeof data.frameTrackingCoverage === 'number') setCoverage(data.frameTrackingCoverage)
    if (typeof data.fullBodyCoverage === 'number') setFullBodyCoverage(data.fullBodyCoverage)
    if (data.projectId && data.take?.rawAssetId) {
      setStill(`/api/media-command/digital-human?projectId=${encodeURIComponent(data.projectId)}&frameAssetId=${encodeURIComponent(data.take.rawAssetId)}`)
    }
    setMessage(data.motion?.message ?? (data.deviceReleased ? 'Capture stopped and the device was released.' : 'Capture finished.'))
  }

  async function stopTake() {
    setError('')
    stopPreview()
    if (!sessionId) return
    const data = await post({ action: 'capture-stop', projectId, sessionId })
    apply(data)
    setMessage('Capture stopped and the device was released.')
  }

  async function previewTake() {
    setError('')
    if (!takeId) throw new Error('Record a take before preview.')
    const data = await post({ action: 'preview-performance', projectId, takeId })
    setPreviewLabel(data.preview?.label ?? 'PLACEHOLDER RETARGET')
    setPreviewRest(data.preview?.atRest !== false)
    setSamples(data.preview?.samples ?? [])
    setMessage(data.preview?.photoreal ? 'Preview error.' : 'Placeholder retarget. No photoreal human.')
  }

  async function applyToRael() {
    setError('')
    if (!takeId || !rael) throw new Error("Authorize Ra'el and record a take first.")
    const data = await post({ action: 'assign-performance', projectId, takeId, characterId: rael.id })
    apply(data)
    const crowd = await post({ action: 'reuse-crowd-motion', projectId, takeId })
    apply(crowd)
    setMessage("Performance reference assigned to Ra'el. Identity was not trained. Background motion reuse applied.")
  }

  const capture = devices.find(device => device.type === 'VIDEO_CAPTURE')
  const population = populations[0]
  const fictional = characters.filter(item => item.identityClass === 'FICTIONAL')

  return (
    <div className="hvs-actors" data-testid="hvs-digital-human">
      <section className="hvs-actors-panel">
        <h2>Actors</h2>
        <p className="hvs-actor-meta">Hero characters, Ra&apos;el, and background people stay on this production.</p>
        {error ? <p>{error}</p> : null}
        {message ? <p data-testid="hvs-actor-message">{message}</p> : null}
      </section>
      <div className="hvs-actors-grid">
        <article className="hvs-actor-card" data-testid="hvs-rael-card">
          <h2>Ra&apos;el · Commander digital human</h2>
          <div className="hvs-actor-meta">
            <span>Identity: {rael ? 'Authorized' : 'Not authorized'}</span>
            <span>References: {rael?.referenceAssetIds?.length ?? 0}</span>
            <span>Voice: {rael?.voiceBinding?.enrolled ? 'Enrolled' : 'Not enrolled'}</span>
            <span>3D rig: {rael?.rigBinding.state === 'BOUND' || rigReady ? 'READY' : 'Not available'}</span>
            <span>Wardrobe: {rael?.wardrobeSets?.length ?? 0}</span>
            <span>Class: {rael?.characterClass ?? '—'}</span>
          </div>
          <div className="hvs-actor-actions">
            <button type="button" data-testid="hvs-authorize-rael" onClick={() => authorize().catch(err => setError(err.message))}>Authorize Ra&apos;el</button>
            <button type="button" onClick={() => direct(SCENE).catch(err => setError(err.message))}>Direct scene</button>
          </div>
        </article>
        <article className="hvs-actor-card" data-testid="hvs-actor-cards">
          <h2>Fictional actors</h2>
          {fictional.length === 0 ? <p className="hvs-actor-meta">No fictional actor yet.</p> : fictional.map(actor => (
            <div key={actor.id} className="hvs-actor-meta" data-testid="hvs-fictional-actor">
              <strong>{actor.displayName}</strong>
              <span>{actor.characterClass}</span>
              <span>Continuity: {actor.continuityState.sceneState}</span>
              <span>Wardrobe: {actor.wardrobeSets.length}</span>
              <span>Voice: {actor.voiceBinding ? 'Bound' : 'Unset'}</span>
              <span>3D: {actor.rigBinding.state}</span>
            </div>
          ))}
          <div className="hvs-actor-actions">
            <button type="button" data-testid="hvs-direct-actor-a" onClick={() => direct(ACTOR_A).catch(err => setError(err.message))}>Direct Actor A</button>
          </div>
        </article>
        <article className="hvs-actor-card" data-testid="hvs-background-cast">
          <h2>Background cast</h2>
          {population ? (
            <div className="hvs-actor-meta">
              <span>{population.count} people</span>
              <span>Behavior: {population.groups.map(group => `${group.count} ${group.behavior.toLowerCase()}`).join(' · ')}</span>
              <span>Reaction: {population.reaction ? 'collapse → move away' : 'none'}</span>
              <span>Variation: {population.wardrobeVariation.toLowerCase()}</span>
            </div>
          ) : <p className="hvs-actor-meta">No background population yet.</p>}
          <div className="hvs-actor-actions">
            <button type="button" data-testid="hvs-add-background" onClick={() => direct(ALLEY).catch(err => setError(err.message))}>Add alley background</button>
          </div>
        </article>
      </div>
      <section className="hvs-actors-panel" data-testid="hvs-webcam-preview">
        <h2>Performance capture</h2>
        <div data-testid="hvs-full-body-setup">
          <p>FULL-BODY CAPTURE SETUP</p>
          <ol>
            {FULL_BODY_SETUP.map(step => <li key={step}>{step}</li>)}
          </ol>
        </div>
        <p className={cameraActive ? 'hvs-camera-live' : 'hvs-camera-off'} data-testid="hvs-camera-state">{cameraActive ? 'CAMERA ACTIVE' : 'CAMERA OFF'}</p>
        <p className={readiness === 'FULL BODY READY' ? 'hvs-body-ready' : 'hvs-body-wait'} data-testid="hvs-body-readiness">{readiness ?? 'Framing not checked'}</p>
        {framingWarning ? <p data-testid="hvs-framing-warning">{framingWarning}{missingJoints.length ? ` Missing: ${missingJoints.join(', ')}.` : ''}</p> : null}
        <div className="hvs-actor-meta">
          <span>Camera: {capture ? capture.label : 'Not checked'}</span>
          <span data-testid="hvs-model-state">Model: {modelReady}</span>
          <span data-testid="hvs-tracking-state">Tracking: {tracking}</span>
          <span data-testid="hvs-face-status">Face tracking: NOT READY</span>
          <span data-testid="hvs-hand-status">Hand tracking: NOT READY</span>
          <span data-testid="hvs-gaze-status">Eye gaze: NOT READY</span>
          <span>Mode: {previewMode}</span>
          <span>Motion: {motionStatus ?? 'Not checked'}</span>
          <span data-testid="hvs-take-label">Take: {takeLabel ?? 'None'}</span>
          <span data-testid="hvs-take-quality">Quality: {quality ?? '—'}</span>
          <span data-testid="hvs-frame-coverage">Frame tracking: {coverage == null ? '—' : `${Math.round(coverage * 100)}%`}</span>
          <span data-testid="hvs-full-body-coverage">Full-body coverage: {fullBodyCoverage == null ? '—' : `${Math.round(fullBodyCoverage * 100)}%`}</span>
        </div>
        <div className="hvs-review">
          <div>
            <video ref={videoRef} className="hvs-preview-video" data-testid="hvs-preview-video" autoPlay muted playsInline />
            {still ? (
              <div className="hvs-still-wrap">
                <img className="hvs-preview-still" data-testid="hvs-capture-still" alt="Local capture still" src={still} />
                {showTracking && overlay[poseFrame % Math.max(1, overlay.length)]?.points.length ? (
                  <svg className="hvs-tracking-overlay" viewBox="0 0 1 1" preserveAspectRatio="none" data-testid="hvs-tracking-overlay">
                    {TRACKING_BONES.map(([start, end]) => {
                      const frame = overlay[poseFrame % overlay.length]
                      const visible = frame.points.filter(point => (point.confidence ?? 1) >= 0.35)
                      const a = visible.find(point => point.name === start)
                      const b = visible.find(point => point.name === end)
                      if (!a || !b) return null
                      return <line key={`${start}-${end}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
                    })}
                    {overlay[poseFrame % overlay.length].points.filter(point => (point.confidence ?? 1) >= 0.35).map(point => (
                      <circle key={point.name} cx={point.x} cy={point.y} r="0.012" opacity={Math.max(0.35, point.confidence ?? 1)} />
                    ))}
                  </svg>
                ) : null}
              </div>
            ) : null}
            {showTracking && landmarkCount === 0 ? <p data-testid="hvs-tracking-overlay">No person was detected.</p> : null}
          </div>
          <div className="hvs-motion-preview" data-testid="hvs-motion-preview">
            {bodyPoses.length ? (
              <HvsRaelBodyPreview
                poses={bodyPoses}
                duration={bodyDuration}
                takeLabel={takeId === 'take-mud7ggfd-zgdqbm' ? 'TAKE 3' : takeLabel}
                quality={quality}
                rigReady={rigReady || rael?.rigBinding.state === 'BOUND'}
              />
            ) : (
              <>
                <p>{previewLabel ?? 'PRODUCTION BODY PREVIEW'}</p>
                <span>Loading body preview…</span>
              </>
            )}
            {showPlaceholder ? (
              <>
                <p data-testid="hvs-placeholder-fallback">PLACEHOLDER RETARGET fallback</p>
                <svg viewBox="0 0 80 120" aria-label="Placeholder retarget">
                  <g transform={`translate(${(samples[poseFrame % Math.max(1, samples.length)]?.root.x ?? 0) * 18 + (samples[poseFrame % Math.max(1, samples.length)]?.lean ?? 0) * 8} 0)`}>
                    <g transform={`rotate(${(samples[poseFrame % Math.max(1, samples.length)]?.head.yaw ?? 0) * 25} 40 16)`}>
                      <circle cx="40" cy="16" r="8" />
                    </g>
                    <line x1="40" y1="24" x2="40" y2="70" />
                    <line x1="22" y1="40" x2={22 - (samples[poseFrame % Math.max(1, samples.length)]?.leftArm ?? 0) * 6} y2={40 - (samples[poseFrame % Math.max(1, samples.length)]?.leftArm ?? 0) * 26} />
                    <line x1="58" y1="40" x2={58 + (samples[poseFrame % Math.max(1, samples.length)]?.rightArm ?? 0) * 6} y2={40 - (samples[poseFrame % Math.max(1, samples.length)]?.rightArm ?? 0) * 26} />
                    <line x1="40" y1="70" x2="24" y2="108" />
                    <line x1="40" y1="70" x2="56" y2="108" />
                  </g>
                </svg>
                <span>{previewRest ? 'At rest. No landmark motion.' : 'Placeholder motion.'}</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="hvs-actor-actions">
          <button type="button" data-testid="hvs-check-camera" onClick={() => checkCamera().catch(err => setError(err.message))}>Check camera</button>
          <button type="button" data-testid="hvs-check-framing" onClick={() => checkFraming().catch(err => setError(err.message))}>Check framing</button>
          <button type="button" data-testid="hvs-start-camera" onClick={() => startPreview().catch(err => setError(err.message))}>Start camera</button>
          <button type="button" data-testid="hvs-record-reference" onClick={() => recordReference().catch(err => setError(err.message))} disabled={readiness !== 'FULL BODY READY'}>Start acceptance take</button>
          <button type="button" data-testid="hvs-stop-take" onClick={() => stopTake().catch(err => setError(err.message))}>Stop take</button>
          <button type="button" data-testid="hvs-stop-camera" onClick={stopPreview}>Stop camera</button>
          <button type="button" data-testid="hvs-preview-take" onClick={() => previewTake().catch(err => setError(err.message))}>Preview take</button>
          <button type="button" data-testid="hvs-show-placeholder" onClick={() => {
            setShowPlaceholder(value => !value)
            if (!samples.length && takeId) previewTake().catch(() => undefined)
          }}>{showPlaceholder ? 'Hide placeholder fallback' : 'Show placeholder fallback'}</button>
          <button type="button" data-testid="hvs-apply-rael" onClick={() => applyToRael().catch(err => setError(err.message))}>Apply to Ra&apos;el</button>
          <button type="button" data-testid="hvs-show-tracking" onClick={() => setShowTracking(value => !value)}>{showTracking ? 'Hide tracking' : 'Show tracking'}</button>
          <button type="button" onClick={() => setPreviewMode(mode => mode === 'BODY_REFERENCE' ? 'HEAD_REFERENCE' : 'BODY_REFERENCE')}>Capture mode</button>
        </div>
      </section>
      <HvsCharacterProductionPanel projectId={projectId} />
      <HvsFaceReferencePanel projectId={projectId} />
      <section className="hvs-actors-panel" data-testid="hvs-director-binding">
        <h2>Director</h2>
        <textarea value={prompt} onChange={event => setPrompt(event.target.value)} />
        <div className="hvs-actor-actions">
          <button type="button" data-testid="hvs-direct-prompt" onClick={() => direct(prompt).catch(err => setError(err.message))}>Direct</button>
        </div>
      </section>
    </div>
  )
}
