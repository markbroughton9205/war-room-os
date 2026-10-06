'use client'

import { useEffect, useRef, useState } from 'react'

type FaceType = 'FRONT_NEUTRAL' | 'LEFT_THREE_QUARTER' | 'RIGHT_THREE_QUARTER' | 'LEFT_PROFILE' | 'RIGHT_PROFILE' | 'FRONT_SMILE'

type FaceQuality = {
  width: number
  height: number
  meanLuma: number
  sharpness: number
  verdict: 'ACCEPT' | 'WARN' | 'REJECT'
  reasons: string[]
  tooDark?: boolean
  tooBright?: boolean
  possibleBlur?: boolean
  framing?: string
}

type FaceStill = { type: FaceType; accepted: boolean; quality: FaceQuality }

type FacePayload = {
  ok?: boolean
  code?: string
  error?: string
  message?: string
  projectId?: string
  cameraStarted?: boolean
  streamStarted?: boolean
  detect?: { creatorPlugin?: string; coreData?: string; linuxSupport?: string; creatorFriendlyName?: string | null }
  binding?: { metahumanCharacterPath?: string; assemblyPipeline?: string; faceCapture?: string; likeness?: string; assetState?: string }
  face?: {
    status?: string
    stills?: Partial<Record<FaceType, FaceStill>>
  }
  quality?: FaceQuality
  still?: FaceStill
}

const REQUIRED: FaceType[] = ['FRONT_NEUTRAL', 'LEFT_THREE_QUARTER', 'RIGHT_THREE_QUARTER', 'LEFT_PROFILE', 'RIGHT_PROFILE']
const OPTIONAL: FaceType[] = ['FRONT_SMILE']
const LABELS: Record<FaceType, string> = {
  FRONT_NEUTRAL: 'Front',
  LEFT_THREE_QUARTER: 'Left 3/4',
  RIGHT_THREE_QUARTER: 'Right 3/4',
  LEFT_PROFILE: 'Left profile',
  RIGHT_PROFILE: 'Right profile',
  FRONT_SMILE: 'Smile (optional)',
}
const GUIDES: Record<FaceType, string> = {
  FRONT_NEUTRAL: 'Look straight at the camera. Neutral expression. Head fills most of the frame.',
  LEFT_THREE_QUARTER: 'Turn left about 45°. Keep both eyes visible.',
  RIGHT_THREE_QUARTER: 'Turn right about 45°. Keep both eyes visible.',
  LEFT_PROFILE: 'Turn left so only the left profile is visible.',
  RIGHT_PROFILE: 'Turn right so only the right profile is visible.',
  FRONT_SMILE: 'Look straight at the camera and smile. Optional.',
}

async function post(body: Record<string, unknown>): Promise<FacePayload> {
  const res = await fetch('/api/media-command/face-reference', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json() as FacePayload
  if (!res.ok) throw new Error(data.message ?? data.error ?? 'Face reference request failed.')
  return data
}

function operatorError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (/Cannot read properties|undefined \(reading|CAPTURE_FAILED|no JPEG|Canvas is not/i.test(raw)) {
    return 'Could not capture the still. Please try again.'
  }
  return raw
}

function sampleCanvas(video: HTMLVideoElement): { jpeg: string; meanLuma: number; centerLuma: number; sharpness: number } {
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth || 640
  canvas.height = video.videoHeight || 480
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('CAPTURE_FAILED: canvas is not available.')
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = image?.data
  if (!data || typeof data.length !== 'number') throw new Error('CAPTURE_FAILED: canvas returned no pixels.')
  let sum = 0
  let center = 0
  let centerCount = 0
  const x0 = Math.floor(canvas.width * 0.3)
  const x1 = Math.floor(canvas.width * 0.7)
  const y0 = Math.floor(canvas.height * 0.2)
  const y1 = Math.floor(canvas.height * 0.8)
  const gray = new Float32Array(canvas.width * canvas.height)
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const y = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
    gray[p] = y
    sum += y
    const x = p % canvas.width
    const row = Math.floor(p / canvas.width)
    if (x >= x0 && x < x1 && row >= y0 && row < y1) {
      center += y
      centerCount += 1
    }
  }
  const pixels = canvas.width * canvas.height
  const mean = sum / pixels
  let variance = 0
  for (const y of gray) variance += (y - mean) ** 2
  const jpeg = canvas.toDataURL('image/jpeg', 0.92)
  if (!jpeg || jpeg.length < 32) throw new Error('CAPTURE_FAILED: empty JPEG.')
  return {
    jpeg,
    meanLuma: mean,
    centerLuma: centerCount ? center / centerCount : mean,
    sharpness: Math.sqrt(variance / pixels),
  }
}

export function HvsFaceReferencePanel({ projectId }: { projectId: string | null }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [payload, setPayload] = useState<FacePayload | null>(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [consent, setConsent] = useState(false)
  const [slot, setSlot] = useState<FaceType>('FRONT_NEUTRAL')
  const [review, setReview] = useState<{ jpeg: string; meanLuma: number; centerLuma: number; sharpness: number } | null>(null)
  const [quality, setQuality] = useState<FaceQuality | null>(null)
  const [message, setMessage] = useState('Camera is off. Press Start camera when you are ready.')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const id = projectId ?? 'hvs-mud545ez-8w3a'
    fetch(`/api/media-command/face-reference?projectId=${encodeURIComponent(id)}`)
      .then(res => res.json())
      .then((data: FacePayload) => {
        if (cancelled) return
        setPayload(data)
      })
      .catch(err => {
        if (!cancelled) setError(operatorError(err))
      })
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
  }, [projectId])

  function stopCamera() {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraActive(false)
    setMessage('Camera stopped.')
  }

  async function checkCamera() {
    setError('')
    const data = await post({ action: 'check-camera', projectId })
    setPayload(data)
    setMessage(data.streamStarted ? 'Unexpected stream.' : 'Camera audit finished. The camera is not streaming.')
  }

  async function startCamera() {
    setError('')
    if (!consent) {
      setError('Authorize this capture first. It is Commander self-authorized, this capture only.')
      return
    }
    stopCamera()
    await post({ action: 'start-session', projectId, consent: 'COMMANDER_SELF_AUTHORIZED' })
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false })
    streamRef.current = stream
    if (videoRef.current) videoRef.current.srcObject = stream
    setCameraActive(true)
    setMessage(`Preview live. Capture ${LABELS[slot]}.`)
  }

  async function captureStill() {
    setError('')
    if (!videoRef.current || !cameraActive) throw new Error('Start the camera first.')
    const sampled = sampleCanvas(videoRef.current)
    const data = await post({
      action: 'capture',
      projectId,
      type: slot,
      jpeg: sampled.jpeg,
      meanLuma: sampled.meanLuma,
      centerLuma: sampled.centerLuma,
      sharpness: sampled.sharpness,
      consent: 'COMMANDER_SELF_AUTHORIZED',
    })
    setReview(sampled)
    setQuality(data.quality ?? null)
    setPayload(data)
    setMessage(data.quality?.verdict === 'REJECT'
      ? `Rejected: ${(data.quality.reasons ?? []).join(' ')}`
      : 'Review the still. Use it or retake.')
  }

  async function useStill() {
    if (!review) throw new Error('Capture a still first.')
    const data = await post({
      action: 'use',
      projectId,
      type: slot,
      jpeg: review.jpeg,
      meanLuma: review.meanLuma,
      centerLuma: review.centerLuma,
      sharpness: review.sharpness,
      consent: 'COMMANDER_SELF_AUTHORIZED',
    })
    setPayload(data)
    setQuality(data.quality ?? null)
    setReview(null)
    setMessage(data.face?.status === 'REFERENCE CAPTURED' ? 'Five required stills are accepted.' : `${LABELS[slot]} accepted.`)
  }

  async function retake() {
    const data = await post({ action: 'retake', projectId, type: slot })
    setPayload(data)
    setReview(null)
    setQuality(null)
    setMessage(`Retake ${LABELS[slot]}.`)
  }

  const status = payload?.face?.status ?? 'REFERENCE CAPTURE REQUIRED'
  const stills = payload?.face?.stills ?? {}
  const accepted = REQUIRED.filter(type => stills[type]?.accepted).length

  return (
    <section className="hvs-actors-panel hvs-face-ref" data-testid="hvs-high-fidelity-rael">
      <h2>High-fidelity Ra&apos;el</h2>
      <p className="hvs-actor-meta">Official MetaHuman Creator execution representation. One identity: rael-commander. Likeness is not final.</p>
      <p className={status === 'REFERENCE CAPTURED' ? 'hvs-body-ready' : 'hvs-body-wait'} data-testid="hvs-face-ref-status">{status}</p>
      <div className="hvs-actor-meta">
        <span data-testid="hvs-mh-creator">MetaHuman Creator: {payload?.detect?.creatorPlugin ?? '—'} {payload?.detect?.creatorFriendlyName ?? ''}</span>
        <span data-testid="hvs-mh-core">Core Data: {payload?.detect?.coreData ?? '—'}</span>
        <span data-testid="hvs-mh-linux">Linux: {payload?.detect?.linuxSupport ?? '—'}</span>
        <span data-testid="hvs-mh-path">Reserved MHC: {payload?.binding?.metahumanCharacterPath ?? '—'}</span>
        <span data-testid="hvs-mh-state">MHC state: {payload?.binding?.assetState ?? '—'}</span>
        <span data-testid="hvs-mh-likeness">Likeness: {payload?.binding?.likeness ?? 'NOT_FINAL'}</span>
        <span>Assembly: {payload?.binding?.assemblyPipeline ?? 'CINE'}</span>
        <span>Accepted stills: {accepted}/5</span>
      </div>
      <label className="hvs-face-consent">
        <input type="checkbox" data-testid="hvs-face-consent" checked={consent} onChange={event => setConsent(event.target.checked)} />
        Commander self-authorized face-reference stills for this capture only. No training, cloning, cloud enrollment, or identity recognition.
      </label>
      <p className={cameraActive ? 'hvs-camera-live' : 'hvs-camera-off'} data-testid="hvs-face-camera-state">{cameraActive ? 'CAMERA ACTIVE' : 'CAMERA OFF'}</p>
      <p className="hvs-actor-meta">{GUIDES[slot]}</p>
      <div className="hvs-face-slots">
        {[...REQUIRED, ...OPTIONAL].map(type => (
          <button
            key={type}
            type="button"
            data-testid={`hvs-face-slot-${type}`}
            className={slot === type ? 'hvs-face-slot-on' : undefined}
            onClick={() => { setSlot(type); setReview(null); setQuality(null) }}
          >
            {LABELS[type]}{stills[type]?.accepted ? ' ✓' : ''}
          </button>
        ))}
      </div>
      <div className="hvs-review">
        <video ref={videoRef} className="hvs-preview-video" data-testid="hvs-face-preview-video" autoPlay muted playsInline />
        {review ? <img className="hvs-preview-still" data-testid="hvs-face-review" alt={`${LABELS[slot]} review`} src={review.jpeg} /> : null}
        {stills[slot] && !review ? (
          <img
            className="hvs-preview-still"
            alt={`${LABELS[slot]} accepted still`}
            src={`/api/media-command/face-reference?projectId=${encodeURIComponent(projectId ?? 'hvs-mud545ez-8w3a')}&image=${slot}`}
          />
        ) : null}
      </div>
      {quality ? <p data-testid="hvs-face-quality">{quality.verdict}: {(quality.reasons ?? []).join(' ') || `${quality.width}×${quality.height}`}</p> : null}
      {error ? <p>{error}</p> : null}
      {message ? <p data-testid="hvs-face-message">{message}</p> : null}
      <div className="hvs-actor-actions">
        <button type="button" data-testid="hvs-face-check-camera" onClick={() => checkCamera().catch(err => setError(operatorError(err)))}>Check camera</button>
        <button type="button" data-testid="hvs-face-start-camera" onClick={() => startCamera().catch(err => setError(operatorError(err)))}>Start camera</button>
        <button type="button" data-testid="hvs-face-capture" onClick={() => captureStill().catch(err => {
          console.error('[hvs-face-capture]', err)
          setError(operatorError(err))
        })}>Capture still</button>
        <button type="button" data-testid="hvs-face-use" onClick={() => useStill().catch(err => setError(operatorError(err)))}>Use still</button>
        <button type="button" data-testid="hvs-face-retake" onClick={() => retake().catch(err => setError(operatorError(err)))}>Retake</button>
        <button type="button" data-testid="hvs-face-stop-camera" onClick={stopCamera}>Stop camera</button>
      </div>
    </section>
  )
}
