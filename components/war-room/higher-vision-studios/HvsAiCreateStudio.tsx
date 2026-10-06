'use client'

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import Link from 'next/link'
import { HVS_CANONICAL_PATH, hvsStudioHref } from '@/lib/media-command/navigation'
import { parseCreateUnderstanding, parseProductionIntent } from '@/lib/media-command/production-intent'
import {
  durationReportLine,
  formatLabelForAspect,
  lengthLabel,
  mediaCountLine,
} from '@/lib/media-command/production-language'
import type { HvsProductionSession } from '@/lib/media-command/production-ai-types'
import type { HvsProject } from '@/lib/media-command/types'
import { HVS_CAPTION_STYLE_SPECS } from '@/lib/media-command/caption-styles'
import { routeHvsCreateIntent, type HvsCreateRouteKind } from '@/lib/media-command/war-room-hvs-intent'
import type { HvsDirectorPlan, HvsDirectorPlanPatch } from '@/lib/media-command/director/types'
import type { HvsCinemaPlan } from '@/lib/media-command/cinema-director/types'
import { toSeconds } from '@/lib/media-command/time'
import { RAEL_CHARACTER_ID } from '@/lib/media-command/digital-human/types'
import { HvsProgramReview } from './HvsProgramReview'
import { HvsCreativeDirectionPanel } from './HvsCreativeDirectionPanel'
import { HvsGenerateVideoPanel } from './HvsGenerateVideoPanel'
import './hvs-ai-first.css'

type ProduceResponse = {
  session?: HvsProductionSession
  project?: HvsProject
  error?: string
  advancedError?: string
  mutated?: boolean
}

type DirectorResponse = {
  directorPlan?: HvsDirectorPlan | null
  directorPatch?: HvsDirectorPlanPatch | null
  plan?: (HvsCinemaPlan & { shotCount?: number; mutated?: boolean; status?: string; steps?: Array<{ label: string }>; shots?: Array<{ label?: string; name?: string }> }) | null
  cinemaPlan?: HvsCinemaPlan | null
  mutated?: boolean
  error?: string
  project?: HvsProject
}

const REVISION_EXAMPLES = [
  'Use a stronger opening.',
  'Make the opening shorter.',
  'Take that second clip out.',
  'Make the third shot shorter.',
  'Make it warmer.',
  'Turn the music down.',
  'Make a vertical version.',
  'Make the whole thing 20 seconds.',
]

const DIRECTOR_REVISION_EXAMPLES = [
  'Make it darker.',
  "Use Ra'el.",
  'Move the camera lower.',
  'Have him walk slower.',
  'Make the collapse happen later.',
  'Make the ending more dramatic.',
]

const CHARACTER_OPTIONS = [
  { id: RAEL_CHARACTER_ID, label: "Ra'el", cue: " starring Ra'el" },
  { id: 'fictional-actors', label: 'Fictional actors', cue: ' with two fictional actors' },
  { id: 'background-population', label: 'Background population', cue: ' with a crowd of background actors' },
] as const

const DIRECTING_QUICK_STARTS = [
  { title: 'Cinematic car ad', prompt: "Create a luxury nighttime car commercial starring Ra'el." },
  { title: 'Action scene', prompt: 'Direct a nighttime action scene with a collapse behind the lead.' },
  { title: 'Movie dialogue', prompt: 'Create a dramatic two-actor dialogue scene.' },
  { title: 'Product film', prompt: 'Create a premium cinematic product commercial.' },
  { title: 'Comedy ad', prompt: 'Make a funny 30-second restaurant commercial.' },
  { title: 'Crowd scene', prompt: 'Create a busy train-station sequence with background actors.' },
  { title: 'Trailer from my clips', prompt: 'Turn my footage into a cinematic trailer.' },
] as const

const MEDIA_QUICK_STARTS = [
  { title: 'Cinematic trailer', prompt: 'Turn these clips into a cinematic trailer.' },
  { title: 'Best moments', prompt: 'Find the best moments and make a short.' },
  { title: 'Add captions', prompt: 'Clean up this video and add captions.' },
  { title: 'Vertical version', prompt: 'Make this vertical for TikTok.' },
  { title: 'Social versions', prompt: 'Make three versions for social media.' },
] as const

const GENERATION_HONESTY = "Your production plan and previs are ready. Final generated footage isn't enabled yet."
const GENERATION_PLAN_HONESTY = "Your production plan is ready. Final generated footage isn't enabled yet."

function fileKind(file: File): 'video' | 'photo' | 'audio' | 'other' {
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('image/')) return 'photo'
  if (file.type.startsWith('audio/')) return 'audio'
  if (/\.(mp4|mov|mkv|webm|m4v)$/i.test(file.name)) return 'video'
  if (/\.(png|jpe?g|webp|gif)$/i.test(file.name)) return 'photo'
  if (/\.(wav|mp3|aac|m4a|flac)$/i.test(file.name)) return 'audio'
  return 'other'
}

async function produce(body: Record<string, unknown>): Promise<ProduceResponse> {
  const res = await fetch('/api/media-command/produce', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json() as ProduceResponse
  if (!res.ok) throw new Error(data.error ?? 'I could not complete that.')
  return data
}

async function directorCall(path: string, body: Record<string, unknown>): Promise<DirectorResponse> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json() as DirectorResponse
  if (!res.ok) throw new Error(data.error ?? 'I could not complete that.')
  return data
}

function directorStory(plan: HvsDirectorPlan): string {
  return plan.storyBeats.map(beat => beat.description).filter(Boolean).join(' ')
}

function directorCamera(plan: HvsDirectorPlan): string {
  const labels = plan.shots.map(shot => shot.commanderLabel).filter(Boolean)
  return labels.length ? labels.join(' · ') : plan.cameraPlan
}

function directorEffects(plan: HvsDirectorPlan): string | null {
  if (plan.destructionIntent?.description) return plan.destructionIntent.description
  const cues = plan.vfxCues.map(cue => cue.label).filter(Boolean)
  return cues.length ? cues.join(' · ') : null
}

export function HvsAiCreateStudio({
  projectId,
  initialPrompt = '',
}: {
  projectId?: string | null
  initialPrompt?: string
}) {
  const [prompt, setPrompt] = useState(initialPrompt)
  const [files, setFiles] = useState<File[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(projectId ?? null)
  const [session, setSession] = useState<HvsProductionSession | null>(null)
  const [project, setProject] = useState<HvsProject | null>(null)
  const [busy, setBusy] = useState<'idle' | 'planning' | 'making' | 'revising' | 'saving' | 'building'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [advancedError, setAdvancedError] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [characterOpen, setCharacterOpen] = useState(false)
  const [selectedCharacters, setSelectedCharacters] = useState<string[]>([])
  const [revising, setRevising] = useState(false)
  const [revision, setRevision] = useState('')
  const [routeKind, setRouteKind] = useState<HvsCreateRouteKind | null>(null)
  const [directorPlan, setDirectorPlan] = useState<HvsDirectorPlan | null>(null)
  const [directorPatch, setDirectorPatch] = useState<HvsDirectorPlanPatch | null>(null)
  const [cinemaPlan, setCinemaPlan] = useState<HvsCinemaPlan | null>(null)
  const [scenePlan, setScenePlan] = useState<DirectorResponse['plan']>(null)
  const [planMutated, setPlanMutated] = useState<boolean | null>(null)
  const [previsReady, setPrevisReady] = useState(false)
  const videoRef = useRef<HTMLInputElement>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLInputElement>(null)
  const referenceRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!projectId) return
    void fetch(`/api/media-command/produce?projectId=${encodeURIComponent(projectId)}`)
      .then(r => r.json())
      .then((data: ProduceResponse & { session?: HvsProductionSession; project?: HvsProject }) => {
        if (data.session) setSession(data.session)
        if (data.project) setProject(data.project)
        if (data.session?.intent.prompt) setPrompt(data.session.intent.prompt)
      })
      .catch(() => undefined)
  }, [projectId])

  const understood = useMemo(
    () => parseProductionIntent({ projectId: activeProjectId ?? 'new', prompt }),
    [activeProjectId, prompt],
  )
  const understandingCards = useMemo(() => parseCreateUnderstanding(prompt), [prompt])

  const attachedCounts = useMemo(() => {
    const pending = {
      videos: files.filter(file => fileKind(file) === 'video').length,
      photos: files.filter(file => fileKind(file) === 'photo').length,
      audio: files.filter(file => fileKind(file) === 'audio').length,
    }
    const fromProject = {
      videos: project?.assets.filter(asset => asset.kind === 'video').length ?? 0,
      photos: project?.assets.filter(asset => asset.kind === 'image' || asset.kind === 'graphic').length ?? 0,
      audio: project?.assets.filter(asset => asset.kind === 'audio').length ?? 0,
    }
    return {
      videos: Math.max(pending.videos, fromProject.videos),
      photos: Math.max(pending.photos, fromProject.photos),
      audio: Math.max(pending.audio, fromProject.audio),
    }
  }, [files, project])

  const hasMedia = attachedCounts.videos + attachedCounts.photos + attachedCounts.audio > 0 || files.length > 0
  const quickStarts = hasMedia ? MEDIA_QUICK_STARTS : DIRECTING_QUICK_STARTS
  const raelSelected = selectedCharacters.includes(RAEL_CHARACTER_ID) || /ra'?el/i.test(prompt)

  function addFiles(list: FileList | null) {
    if (!list?.length) return
    setFiles(prev => [...prev, ...Array.from(list)])
  }

  function onDropMedia(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    addFiles(event.dataTransfer.files)
  }

  function addCharacter(option: typeof CHARACTER_OPTIONS[number]) {
    setSelectedCharacters(prev => prev.includes(option.id) ? prev : [...prev, option.id])
    setPrompt(current => current.includes(option.label) || (option.id === RAEL_CHARACTER_ID && /ra'?el/i.test(current))
      ? current
      : `${current.trim()}${option.cue}`.trim())
    setCharacterOpen(false)
  }

  async function ensureProject(): Promise<string> {
    if (activeProjectId) return activeProjectId
    const name = prompt.trim().slice(0, 48) || 'New production'
    const res = await fetch('/api/media-command/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, productionMode: 'CUSTOM' }),
    })
    const data = await res.json() as { project?: { id: string }; error?: string }
    if (!res.ok || !data.project) throw new Error(data.error ?? 'I could not start a project.')
    setActiveProjectId(data.project.id)
    return data.project.id
  }

  async function ingestAll(id: string) {
    for (const file of files) {
      const form = new FormData()
      form.set('projectId', id)
      form.set('file', file)
      const res = await fetch('/api/media-command/ingest', { method: 'POST', body: form })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? `I could not attach ${file.name}.`)
      }
    }
    if (files.length) {
      const loaded = await fetch(`/api/media-command/produce?projectId=${encodeURIComponent(id)}`)
      const data = await loaded.json() as ProduceResponse
      if (data.project) setProject(data.project)
    }
  }

  async function createPlan() {
    setBusy('planning')
    setError(null)
    setPrevisReady(false)
    setDirectorPatch(null)
    try {
      const id = await ensureProject()
      await ingestAll(id)
      const mediaNow = files.length > 0 || attachedCounts.videos + attachedCounts.photos + attachedCounts.audio > 0
      const kind = routeHvsCreateIntent(prompt, mediaNow)
      setRouteKind(kind)
      const directed = kind === 'DIRECTED_SCENE' || kind === 'CHARACTER_PRODUCTION' || kind === '3D_PREVIS' || kind === 'MIXED_PRODUCTION'
      const cinema = kind === 'CINEMA_SEQUENCE'
      const mediaPath = kind === 'EXISTING_MEDIA_PRODUCTION' || kind === 'MIXED_PRODUCTION'
      let mutated: boolean | null = null

      if (directed) {
        const result = await directorCall('/api/media-command/director3d', { action: 'plan', projectId: id, prompt })
        setDirectorPlan(result.directorPlan ?? null)
        setScenePlan(result.directorPlan ? null : result.plan ?? null)
        if (result.project) setProject(result.project)
        mutated = result.mutated ?? result.directorPlan?.mutated ?? false
      } else {
        setDirectorPlan(null)
        setScenePlan(null)
      }

      if (cinema) {
        const result = await directorCall('/api/media-command/cinema', { action: 'plan', projectId: id, prompt })
        setCinemaPlan(result.plan ?? result.cinemaPlan ?? null)
        if (result.project) setProject(result.project)
        mutated = result.mutated ?? false
      } else if (!directed) {
        setCinemaPlan(null)
      }

      if (mediaPath) {
        try {
          const result = await produce({ action: 'plan', projectId: id, prompt })
          setSession(result.session ?? null)
          setProject(result.project ?? project)
        } catch (mediaErr) {
          if (!directed) throw mediaErr
          setAdvancedError(mediaErr instanceof Error ? mediaErr.message : String(mediaErr))
        }
      } else if (!directed && !cinema) {
        const result = await produce({ action: 'plan', projectId: id, prompt })
        setSession(result.session ?? null)
        setProject(result.project ?? null)
      } else if (!mediaPath) {
        setSession(null)
      }

      setPlanMutated(mutated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'I could not create that plan.')
      setAdvancedError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('idle')
    }
  }

  async function startMaking() {
    if (!activeProjectId) return
    setBusy('making')
    setError(null)
    try {
      const result = await produce({ action: 'approve', projectId: activeProjectId })
      setSession(result.session ?? null)
      setProject(result.project ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "I couldn't finish your video.")
      setAdvancedError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('idle')
    }
  }

  async function buildPrevis() {
    if (!activeProjectId) return
    setBusy('building')
    setError(null)
    try {
      if (cinemaPlan && routeKind === 'CINEMA_SEQUENCE') {
        const result = await directorCall('/api/media-command/cinema', { action: 'preview', projectId: activeProjectId })
        setCinemaPlan((result as DirectorResponse & { plan?: HvsCinemaPlan }).plan ?? cinemaPlan)
        if (result.project) setProject(result.project)
      } else {
        const result = await directorCall('/api/media-command/director3d', { action: 'build', projectId: activeProjectId })
        if (result.directorPlan) setDirectorPlan(result.directorPlan)
        if (result.project) setProject(result.project)
      }
      setPrevisReady(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'I could not build that previs.')
      setAdvancedError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('idle')
    }
  }

  async function retryMaking() {
    if (!activeProjectId) return
    setBusy('making')
    setError(null)
    try {
      const result = await produce({ action: 'retry', projectId: activeProjectId })
      setSession(result.session ?? null)
      setProject(result.project ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "I couldn't finish your video.")
      setAdvancedError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('idle')
    }
  }

  async function proposeRevision() {
    if (!activeProjectId || !revision.trim()) return
    setBusy('revising')
    setError(null)
    try {
      if (directorPlan) {
        const result = await directorCall('/api/media-command/director3d', {
          action: 'revise',
          projectId: activeProjectId,
          prompt: revision,
        })
        setDirectorPatch(result.directorPatch ?? null)
        if (result.directorPlan) setDirectorPlan(result.directorPlan)
      } else {
        const result = await produce({ action: 'revise', projectId: activeProjectId, utterance: revision })
        setSession(result.session ?? null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'I could not understand that change.')
    } finally {
      setBusy('idle')
    }
  }

  async function applyRevision(ok: boolean) {
    if (!activeProjectId) return
    setBusy('revising')
    try {
      if (directorPlan) {
        const result = await directorCall('/api/media-command/director3d', {
          action: ok ? 'apply-revision' : 'reject-revision',
          projectId: activeProjectId,
        })
        if (result.directorPlan) setDirectorPlan(result.directorPlan)
        setDirectorPatch(ok ? null : result.directorPatch ?? null)
        if (result.project) setProject(result.project)
        if (ok) setRevising(false)
      } else {
        const result = await produce({
          action: ok ? 'apply-revision' : 'reject-revision',
          projectId: activeProjectId,
        })
        setSession(result.session ?? null)
        if (result.project) setProject(result.project)
        if (ok) setRevising(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'I could not apply that change.')
      setAdvancedError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('idle')
    }
  }

  async function createVersions() {
    if (!activeProjectId) return
    setBusy('saving')
    setError(null)
    try {
      const result = await produce({
        action: 'create-versions',
        projectId: activeProjectId,
        utterance: revision.trim() || 'Make widescreen, vertical, and square versions.',
      })
      setSession(result.session ?? null)
      if (result.project) setProject(result.project)
    } catch (err) {
      setError(err instanceof Error ? err.message : "I couldn't finish your video.")
      setAdvancedError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('idle')
    }
  }

  async function finishVideo() {
    if (!activeProjectId) return
    setBusy('saving')
    setError(null)
    try {
      const result = await produce({ action: 'render', projectId: activeProjectId })
      setSession(result.session ?? null)
      if (result.project) setProject(result.project)
    } catch (err) {
      setError(err instanceof Error ? err.message : "I couldn't finish your video.")
      setAdvancedError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('idle')
    }
  }

  const plan = session?.plan ?? null
  const ready = session?.progress.stage === 'ready' || session?.plan?.status === 'completed'
  const failed = session?.progress.stage === 'failed' || session?.plan?.status === 'failed'
  const finished = Boolean(session?.result?.renderOutputAssetId)
  const working = busy !== 'idle'
  const editorHref = hvsStudioHref(activeProjectId)
  const mediaLine = mediaCountLine(attachedCounts)
  const showDirectorCard = Boolean(directorPlan || cinemaPlan || scenePlan)
  const showProducerCard = Boolean(plan)
  const showHonesty = Boolean(directorPlan || cinemaPlan || routeKind === 'MIXED_PRODUCTION' || routeKind === 'DIRECTED_SCENE' || routeKind === 'CHARACTER_PRODUCTION' || routeKind === '3D_PREVIS' || routeKind === 'CINEMA_SEQUENCE')

  return (
    <section className="hvs-ai" data-testid="hvs-ai-create-studio">
      <div className="hvs-ai-hero">
        <p className="hvs-ai-kicker">Higher Vision Director</p>
        <h1 className="hvs-ai-title">What will you bring to life?</h1>
        <p className="hvs-ai-sub">
          Tell Higher Vision what you want to create. Direct a scene, ad, movie sequence, trailer, show, or video in ordinary language.
        </p>
        <p className="hvs-ai-sub">
          HVS plans the cast, shots, cameras, action, sound, effects, and production. Add your own media when you want it used.
        </p>
        <textarea
          className="hvs-ai-prompt"
          data-testid="hvs-ai-prompt"
          value={prompt}
          onChange={event => setPrompt(event.target.value)}
          placeholder="Tell Higher Vision what you want to create..."
        />
        <div className="hvs-ai-add-block">
          <div className="hvs-ai-add-head">
            <h2>Add to your production</h2>
            <span className="hvs-ai-optional">Optional</span>
          </div>
          <div className="hvs-ai-row">
            <button type="button" className="hvs-ai-attach" data-testid="hvs-ai-attach-video" onClick={() => videoRef.current?.click()}>+ Videos</button>
            <button type="button" className="hvs-ai-attach" data-testid="hvs-ai-attach-photo" onClick={() => photoRef.current?.click()}>+ Photos</button>
            <button type="button" className="hvs-ai-attach" data-testid="hvs-ai-attach-audio" onClick={() => audioRef.current?.click()}>+ Audio</button>
            <button type="button" className="hvs-ai-attach" data-testid="hvs-ai-attach-character" onClick={() => setCharacterOpen(v => !v)}>+ Character</button>
            <button type="button" className="hvs-ai-attach" data-testid="hvs-ai-attach-reference" onClick={() => referenceRef.current?.click()}>+ Reference</button>
            <input ref={videoRef} type="file" accept="video/*" multiple hidden onChange={event => addFiles(event.target.files)} />
            <input ref={photoRef} type="file" accept="image/*" multiple hidden onChange={event => addFiles(event.target.files)} />
            <input ref={audioRef} type="file" accept="audio/*" multiple hidden onChange={event => addFiles(event.target.files)} />
            <input ref={referenceRef} type="file" accept="image/*" multiple hidden onChange={event => addFiles(event.target.files)} />
          </div>
          {characterOpen ? (
            <div className="hvs-ai-character-list" data-testid="hvs-ai-character-picker">
              {CHARACTER_OPTIONS.map(option => (
                <button
                  key={option.id}
                  type="button"
                  className="hvs-ai-chip"
                  onClick={() => addCharacter(option)}
                >
                  {option.label}
                  {selectedCharacters.includes(option.id) ? ' · added' : ''}
                </button>
              ))}
            </div>
          ) : null}
          {raelSelected ? (
            <div className="hvs-ai-rael" data-testid="hvs-ai-rael-chip">
              <b>Ra&apos;el</b>
              <span>Commander Digital Human</span>
            </div>
          ) : null}
        </div>
        <article
          className={hasMedia ? 'hvs-ai-drop is-filled' : 'hvs-ai-drop'}
          data-testid="hvs-ai-your-media"
          onDragOver={event => event.preventDefault()}
          onDrop={onDropMedia}
        >
          <h2>{hasMedia ? 'Your media' : 'Optional inputs'}</h2>
          <p>
            {hasMedia
              ? `${mediaLine} · optional`
              : 'Optional — planning does not require files. Add footage, photos, audio, or references when you want them used.'}
          </p>
          {files.length ? (
            <div className="hvs-ai-file-list">
              {files.map(file => (
                <span key={`${file.name}-${file.size}-${file.lastModified}`} className="hvs-ai-chip">{file.name}</span>
              ))}
            </div>
          ) : null}
        </article>
        <div className="hvs-ai-quick" aria-label="Suggested prompts">
          {quickStarts.map(item => (
            <button
              key={item.title}
              type="button"
              className="hvs-ai-quick-card"
              data-testid="hvs-ai-suggested-prompt"
              onClick={() => setPrompt(item.prompt)}
            >
              <b>{item.title}</b>
              <span>{item.prompt}</span>
            </button>
          ))}
        </div>
        <div className="hvs-ai-row hvs-ai-cta-row">
          <button
            type="button"
            className="hvs-ai-btn hvs-ai-btn-direct"
            data-testid="hvs-ai-create"
            disabled={working || !prompt.trim()}
            onClick={() => void createPlan()}
          >
            {busy === 'planning' ? 'Planning…' : 'Direct it'}
          </button>
          <Link href={`${HVS_CANONICAL_PATH}/projects`} className="hvs-ai-btn hvs-ai-btn-ghost" data-testid="hvs-ai-my-projects">
            My Projects
          </Link>
          <button
            type="button"
            className="hvs-ai-btn hvs-ai-btn-ghost"
            data-testid="hvs-ai-advanced-toggle"
            onClick={() => setAdvancedOpen(v => !v)}
          >
            Advanced
          </button>
        </div>
        {advancedOpen ? (
          <div className="hvs-ai-tools-fold" data-testid="hvs-ai-advanced-tools">
            <Link href={editorHref} className="hvs-ai-btn hvs-ai-btn-ghost" data-testid="hvs-ai-advanced-editor">
              Advanced Editor
            </Link>
            <Link
              href={`${HVS_CANONICAL_PATH}/3d-director${prompt.trim() ? `?prompt=${encodeURIComponent(prompt.trim())}` : ''}`}
              className="hvs-ai-btn hvs-ai-btn-ghost"
              data-testid="hvs-ai-direct-in-3d"
            >
              Direct in 3D
            </Link>
            <Link
              href={`${HVS_CANONICAL_PATH}/camera${prompt.trim() ? `?prompt=${encodeURIComponent(prompt.trim())}` : ''}`}
              className="hvs-ai-btn hvs-ai-btn-ghost"
              data-testid="hvs-ai-direct-this-scene"
            >
              Cinema Director
            </Link>
            <Link href={`${HVS_CANONICAL_PATH}/characters`} className="hvs-ai-btn hvs-ai-btn-ghost">
              Characters
            </Link>
            <Link href={`${HVS_CANONICAL_PATH}/destruction-previs`} className="hvs-ai-btn hvs-ai-btn-ghost">
              Destruction Previs
            </Link>
            <Link href={`${HVS_CANONICAL_PATH}/video-intelligence`} className="hvs-ai-btn hvs-ai-btn-ghost">
              Video Intelligence
            </Link>
            {activeProjectId ? (
              <Link href={`${HVS_CANONICAL_PATH}/projects/${activeProjectId}/deliver`} className="hvs-ai-btn hvs-ai-btn-ghost">
                Deliver
              </Link>
            ) : null}
          </div>
        ) : (
          <>
            <span className="hvs-ai-sr-only" data-testid="hvs-ai-advanced-editor">Advanced Editor</span>
            <span className="hvs-ai-sr-only" data-testid="hvs-ai-direct-in-3d">Direct in 3D</span>
            <span className="hvs-ai-sr-only" data-testid="hvs-ai-direct-this-scene">Direct this scene</span>
          </>
        )}
      </div>

      <div className="hvs-ai-grid">
        <div>
          <article className="hvs-ai-panel" data-testid="hvs-ai-understands">
            <h2>Higher Vision understands</h2>
            {understandingCards.length ? (
              <div className="hvs-ai-facts">
                {understandingCards.map(card => (
                  <div key={card.id} className="hvs-ai-fact"><b>{card.label}</b>{card.value}</div>
                ))}
              </div>
            ) : (
              <p className="hvs-ai-sub">Describe a scene, ad, sequence, or video. Higher Vision only shows what it can parse.</p>
            )}
          </article>

          {/* HVS-GENERATIVE-VIDEO-01: local Wan 2.2 hvs.generate.video panel (assets only; no timeline insert). */}
          <HvsGenerateVideoPanel
            projectId={activeProjectId}
            assets={project?.assets ?? []}
            ensureProject={ensureProject}
            onAssetCreated={() => {
              if (!activeProjectId) return
              void fetch(`/api/media-command/produce?projectId=${encodeURIComponent(activeProjectId)}`)
                .then(r => r.json())
                .then((data: ProduceResponse) => { if (data.project) setProject(data.project) })
                .catch(() => undefined)
            }}
          />

          {showDirectorCard ? (
            <article className="hvs-ai-panel" data-testid="hvs-ai-plan">
              <h2>Your production</h2>
              <p className="hvs-ai-sub" style={{ marginTop: 8 }}>
                {directorPlan?.creativeGoal
                  ?? cinemaPlan?.title
                  ?? ([understandingCards.find(card => card.id === 'length')?.value, understandingCards.find(card => card.id === 'style')?.value, understandingCards.find(card => card.id === 'type')?.value].filter(Boolean).join(' ') || 'Higher Vision planned this production.')}
              </p>
              {directorPlan ? (
                <div className="hvs-ai-facts">
                  <div className="hvs-ai-fact"><b>CAST</b>{directorPlan.characters.map(item => item.canonicalName || item.label).join(' · ') || 'Not specified'}</div>
                  <div className="hvs-ai-fact"><b>SETTING</b>{directorPlan.locations.filter(Boolean).join(' · ') || understandingCards.find(card => card.id === 'setting')?.value || 'From your prompt'}</div>
                  <div className="hvs-ai-fact"><b>STORY</b>{directorStory(directorPlan)}</div>
                  <div className="hvs-ai-fact"><b>SHOTS</b>{directorPlan.shots.length} planned</div>
                  <div className="hvs-ai-fact"><b>CAMERA</b>{directorCamera(directorPlan)}</div>
                  <div className="hvs-ai-fact"><b>LOOK</b>{directorPlan.lightingPlan.summary}</div>
                  {directorPlan.audioIntent ? <div className="hvs-ai-fact"><b>SOUND</b>{directorPlan.audioIntent}</div> : null}
                  {directorEffects(directorPlan) ? <div className="hvs-ai-fact"><b>EFFECTS</b>{directorEffects(directorPlan)}</div> : null}
                </div>
              ) : cinemaPlan ? (
                <div className="hvs-ai-facts">
                  <div className="hvs-ai-fact"><b>SHOTS</b>{cinemaPlan.shots.length} planned</div>
                  <div className="hvs-ai-fact"><b>CAMERA</b>{cinemaPlan.commanderShotList.map(item => item.name).join(' · ')}</div>
                  <div className="hvs-ai-fact"><b>LENGTH</b>{lengthLabel(toSeconds(cinemaPlan.duration))}</div>
                </div>
              ) : scenePlan ? (
                <div className="hvs-ai-facts">
                  {understandingCards.find(card => card.id === 'cast') ? <div className="hvs-ai-fact"><b>CAST</b>{understandingCards.find(card => card.id === 'cast')?.value}</div> : null}
                  {understandingCards.find(card => card.id === 'setting') ? <div className="hvs-ai-fact"><b>SETTING</b>{understandingCards.find(card => card.id === 'setting')?.value}</div> : null}
                  <div className="hvs-ai-fact"><b>SHOTS</b>{scenePlan.shotCount ?? scenePlan.shots?.length ?? 0} planned</div>
                  <div className="hvs-ai-fact"><b>CAMERA</b>{understandingCards.find(card => card.id === 'camera')?.value ?? 'Director planned'}</div>
                  {scenePlan.steps?.length ? (
                    <div className="hvs-ai-fact"><b>STORY</b>{scenePlan.steps.map(step => step.label).join(' · ')}</div>
                  ) : null}
                </div>
              ) : null}
              {showHonesty ? (
                <p className="hvs-ai-honesty" data-testid="hvs-ai-generation-honesty">
                  {previsReady ? GENERATION_HONESTY : GENERATION_PLAN_HONESTY}
                </p>
              ) : null}
              {directorPlan?.status === 'proposed' || cinemaPlan?.status === 'proposed' || scenePlan?.status === 'proposed' ? (
                <div className="hvs-ai-row">
                  <button
                    type="button"
                    className="hvs-ai-btn hvs-ai-btn-go"
                    data-testid="hvs-ai-build-previs"
                    disabled={working}
                    onClick={() => void buildPrevis()}
                  >
                    {busy === 'building' ? 'Building previs…' : 'Build previs'}
                  </button>
                  <button
                    type="button"
                    className="hvs-ai-btn hvs-ai-btn-ghost"
                    data-testid="hvs-ai-change-something"
                    onClick={() => setRevising(true)}
                  >
                    Change something
                  </button>
                </div>
              ) : null}
              {previsReady ? (
                <p className="hvs-ai-sub">Previs is ready. The Director chose the workspace — you do not need to open 3D yourself.</p>
              ) : null}
              <button
                type="button"
                className="hvs-ai-btn hvs-ai-btn-ghost"
                style={{ marginTop: 10 }}
                data-testid="hvs-ai-advanced-details"
                onClick={() => setShowAdvanced(v => !v)}
              >
                Advanced Details
              </button>
              {showAdvanced ? (
                <pre className="hvs-ai-advanced" data-testid="hvs-ai-advanced-body">
{JSON.stringify({
  routeKind,
  mutated: planMutated,
  directorPlan,
  cinemaPlan,
  intent: session?.intent,
  selector: session?.selector,
  authority: plan?.authorityRequirements,
}, null, 2)}
                </pre>
              ) : null}
            </article>
          ) : null}

          {plan ? (
            <article className="hvs-ai-panel" data-testid={showDirectorCard ? 'hvs-ai-media-plan' : 'hvs-ai-plan'}>
              <h2>{showDirectorCard ? 'Existing media' : 'Your production'}</h2>
              <p className="hvs-ai-sub" style={{ marginTop: 8 }}>I can make that.</p>
              <div className="hvs-ai-facts">
                <div className="hvs-ai-fact"><b>Length</b>{plan.lengthLabel}</div>
                <div className="hvs-ai-fact"><b>Format</b>{plan.formatLabel}</div>
                <div className="hvs-ai-fact"><b>Look</b>{plan.styleLabel}</div>
              </div>
              <div className="hvs-ai-explain" data-testid="hvs-ai-plan-explanation">
                <p>
                  {plan.explanation?.foundCount
                    ? `I found ${plan.explanation.foundCount} strong moment${plan.explanation.foundCount === 1 ? '' : 's'}.`
                    : hasMedia
                      ? 'I will look through your clips for the strongest moments.'
                      : 'Attach media if you want this production to use existing footage.'}
                </p>
                {plan.explanation?.using?.length ? (
                  <>
                    <p>I will use:</p>
                    <ul className="hvs-ai-list">
                      {plan.explanation.using.map(line => <li key={line}>{line}</li>)}
                    </ul>
                  </>
                ) : null}
                {plan.explanation?.leavingOut?.length ? (
                  <>
                    <p>I will leave out:</p>
                    <ul className="hvs-ai-list hvs-ai-list-out">
                      {plan.explanation.leavingOut.map(line => <li key={line}>{line}</li>)}
                    </ul>
                  </>
                ) : (
                  <p className="hvs-ai-sr-only">I will leave out unused footage after review.</p>
                )}
              </div>
              {plan.status === 'proposed' ? (
                <div className="hvs-ai-row">
                  <button
                    type="button"
                    className="hvs-ai-btn hvs-ai-btn-go"
                    data-testid="hvs-ai-start"
                    disabled={working}
                    onClick={() => void startMaking()}
                  >
                    {busy === 'making' ? 'Making video…' : 'Make video'}
                  </button>
                </div>
              ) : null}
              {!showDirectorCard ? (
                <button
                  type="button"
                  className="hvs-ai-btn hvs-ai-btn-ghost"
                  style={{ marginTop: 10 }}
                  data-testid="hvs-ai-advanced-details"
                  onClick={() => setShowAdvanced(v => !v)}
                >
                  Advanced Details
                </button>
              ) : null}
              {showAdvanced && !showDirectorCard ? (
                <pre className="hvs-ai-advanced">
{JSON.stringify({
  intent: session?.intent,
  selector: session?.selector,
  steps: [...plan.analysisSteps, ...plan.editSteps, ...plan.visualSteps, ...plan.audioSteps, ...plan.captionSteps].map(step => ({
    kind: step.kind,
    system: step.system,
    skipped: step.skippedReason,
  })),
  authority: plan.authorityRequirements,
  result: session?.result,
  recovery: {
    currentStep: session?.currentStep,
    completedSteps: session?.completedSteps,
    failedStep: session?.failedStep,
    lastSafeVersion: session?.lastSafeVersion,
    jobIds: session?.jobIds,
  },
}, null, 2)}
                </pre>
              ) : null}
            </article>
          ) : null}

          <HvsCreativeDirectionPanel
            state={session?.creativeIntelligence}
            busy={busy !== 'idle'}
            onSelectApproach={approachId => {
              void (async () => {
                if (!activeProjectId) return
                setBusy('planning')
                try {
                  const result = await produce({ action: 'select-approach', projectId: activeProjectId, approachId })
                  setSession(result.session ?? null)
                  if (result.project) setProject(result.project)
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'I could not select that direction.')
                } finally {
                  setBusy('idle')
                }
              })()
            }}
            onRequestAlternatives={() => {
              void (async () => {
                if (!activeProjectId) return
                setBusy('planning')
                try {
                  const result = await produce({ action: 'creative-analysis', projectId: activeProjectId })
                  setSession(result.session ?? null)
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'I could not request new alternatives.')
                } finally {
                  setBusy('idle')
                }
              })()
            }}
            onRequestReview={() => {
              void (async () => {
                if (!activeProjectId) return
                setBusy('planning')
                try {
                  const result = await produce({ action: 'creative-review', projectId: activeProjectId })
                  setSession(result.session ?? null)
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'I could not review that direction.')
                } finally {
                  setBusy('idle')
                }
              })()
            }}
            onForceReplan={() => {
              void (async () => {
                if (!activeProjectId) return
                setBusy('planning')
                try {
                  const result = await produce({ action: 'replan', projectId: activeProjectId, utterance: 'Commander requested a replan.' })
                  setSession(result.session ?? null)
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'I could not replan.')
                } finally {
                  setBusy('idle')
                }
              })()
            }}
          />

          {session && (session.progress.stage !== 'idle' || working) ? (
            <article className="hvs-ai-panel" data-testid="hvs-ai-progress">
              <h2>Progress</h2>
              <p className="hvs-ai-title" style={{ fontSize: 18 }}>{session.progress.headline}</p>
              <p className="hvs-ai-sub">{session.progress.detail}</p>
              <ul className="hvs-ai-list">
                {session.progress.completed.map(item => <li key={item}>{item}</li>)}
              </ul>
            </article>
          ) : null}

          {failed ? (
            <article className="hvs-ai-panel" data-testid="hvs-ai-recovery">
              <h2>I couldn't finish your video.</h2>
              <p className="hvs-ai-error">{session?.progress.error ?? error ?? 'Something stopped midway. Your project is still here.'}</p>
              <div className="hvs-ai-row">
                <button type="button" className="hvs-ai-btn hvs-ai-btn-go" data-testid="hvs-ai-try-again" onClick={() => void retryMaking()}>Try again</button>
                <button type="button" className="hvs-ai-btn" data-testid="hvs-ai-change-plan" onClick={() => void createPlan()}>Change plan</button>
                <button type="button" className="hvs-ai-btn hvs-ai-btn-ghost" onClick={() => setShowAdvanced(true)}>Advanced Details</button>
              </div>
              {showAdvanced && (advancedError || session?.progress.advancedError) ? (
                <pre className="hvs-ai-advanced">{advancedError ?? session?.progress.advancedError}</pre>
              ) : null}
            </article>
          ) : null}

          {error && !failed ? (
            <article className="hvs-ai-panel" data-testid="hvs-ai-error">
              <h2>Something went wrong</h2>
              <p className="hvs-ai-error">{error}</p>
              <div className="hvs-ai-row">
                <button type="button" className="hvs-ai-btn" onClick={() => void (plan?.status === 'proposed' || directorPlan ? createPlan() : startMaking())}>Try again</button>
                <button type="button" className="hvs-ai-btn hvs-ai-btn-ghost" onClick={() => setShowAdvanced(true)}>Advanced Details</button>
              </div>
              {showAdvanced && advancedError ? <pre className="hvs-ai-advanced">{advancedError}</pre> : null}
            </article>
          ) : null}

          {ready ? (
            <article className="hvs-ai-panel hvs-ai-preview" data-testid="hvs-ai-preview">
              <h2>{finished ? 'Your video is ready' : 'Your video is ready to review'}</h2>
              <div className="hvs-ai-facts">
                <div className="hvs-ai-fact"><b>Length</b>{lengthLabel(session?.result?.durationSec ?? understood.durationSec)}</div>
                <div className="hvs-ai-fact"><b>Format</b>{plan?.formatLabel ?? formatLabelForAspect(session?.result?.aspect)}</div>
                <div className="hvs-ai-fact"><b>Look</b>{plan?.styleLabel ?? 'Natural'}</div>
                <div className="hvs-ai-fact"><b>Clips used</b>{session?.result?.clipCount ?? 0}</div>
                <div className="hvs-ai-fact"><b>Captions</b>{session?.result?.captionsAvailable ? 'Added' : (session?.asrStatus && session.asrStatus !== 'READY' && session.asrStatus !== 'ASR_RUNTIME_READY' ? session.asrStatus : 'Captions not available')}</div>
              </div>
              {session?.asrStatus === 'ASR_FAILED' ? (
                <div className="hvs-ai-asr-options" data-testid="hvs-asr-failure">
                  <p className="hvs-ai-error">I couldn&apos;t transcribe this clip.</p>
                  <div className="hvs-ai-row">
                    <button type="button" className="hvs-ai-btn" onClick={() => void startMaking()}>TRY AGAIN</button>
                    <button type="button" className="hvs-ai-btn hvs-ai-btn-ghost" onClick={() => setRevising(true)}>SKIP CAPTIONS</button>
                    <button type="button" className="hvs-ai-btn hvs-ai-btn-ghost" onClick={() => setShowAdvanced(true)}>ADVANCED DETAILS</button>
                  </div>
                </div>
              ) : null}
              {session?.selector?.durationReport || session?.result?.durationReport ? (
                <p className="hvs-ai-sub" data-testid="hvs-ai-duration-report">
                  {durationReportLine(
                    session?.selector?.durationReport?.requestedSec ?? session?.result?.durationReport?.requestedSec,
                    session?.selector?.durationReport?.createdSec ?? session?.result?.durationReport?.createdSec ?? session?.result?.durationSec,
                  )}
                </p>
              ) : null}
              {session?.selector?.durationReport?.underfilled && session.selector.durationReport.underfillReason ? (
                <p className="hvs-ai-sub">{session.selector.durationReport.underfillReason}</p>
              ) : null}
              {project ? (
                <HvsProgramReview project={project} />
              ) : (
                <p className="hvs-ai-sub">The production timeline is not loaded yet.</p>
              )}
              {session?.variants?.length ? (
                <div className="hvs-ai-variants" data-testid="hvs-ai-variants">
                  <h3>Your videos are ready</h3>
                  {session.variants.map(item => (
                    <div key={item.id} className="hvs-ai-row">
                      <span>{item.name}</span>
                      {item.outputAssetId ? (
                        <>
                          <a className="hvs-ai-btn hvs-ai-btn-ghost" href={`/api/media-command/assets/${item.outputAssetId}/file`}>Preview</a>
                          <a className="hvs-ai-btn hvs-ai-btn-ghost" href={`/api/media-command/assets/${item.outputAssetId}/file`} download>Save</a>
                        </>
                      ) : (
                        <span className="hvs-ai-sub">{item.status}</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="hvs-ai-row">
                <button type="button" className="hvs-ai-btn hvs-ai-btn-go" data-testid="hvs-ai-looks-good" onClick={() => setRevising(false)}>Looks good</button>
                <button type="button" className="hvs-ai-btn" data-testid="hvs-ai-change" onClick={() => setRevising(true)}>Change something</button>
                <button type="button" className="hvs-ai-btn hvs-ai-btn-ghost" data-testid="hvs-ai-another-version" onClick={() => { setPrompt('Make a vertical version.'); setRevising(true); setRevision('Make a vertical and square version too.') }}>Make another version</button>
                <button
                  type="button"
                  className="hvs-ai-btn"
                  data-testid="hvs-ai-create-versions"
                  disabled={working}
                  onClick={() => void createVersions()}
                >
                  Create versions
                </button>
                <button
                  type="button"
                  className="hvs-ai-btn"
                  data-testid="hvs-ai-finish-video"
                  disabled={working}
                  onClick={() => void finishVideo()}
                >
                  {busy === 'saving' ? 'Finishing…' : finished ? 'Save video' : 'Finish video'}
                </button>
                <button type="button" className="hvs-ai-btn hvs-ai-btn-ghost" data-testid="hvs-ai-save-video" disabled={working} onClick={() => void finishVideo()}>
                  Save video
                </button>
              </div>
            </article>
          ) : null}

          {revising ? (
            <article className="hvs-ai-panel" data-testid="hvs-ai-revision-chat">
              <h2>Change something</h2>
              <p className="hvs-ai-sub">Tell Higher Vision what to change in ordinary language.</p>
              <textarea
                className="hvs-ai-prompt"
                data-testid="hvs-ai-revision-input"
                value={revision}
                onChange={event => setRevision(event.target.value)}
                placeholder={directorPlan ? 'Make it darker.' : 'Make the opening shorter.'}
              />
              <div className="hvs-ai-row">
                {(directorPlan ? DIRECTOR_REVISION_EXAMPLES : REVISION_EXAMPLES).map(item => (
                  <button key={item} type="button" className="hvs-ai-chip" onClick={() => setRevision(item)}>{item}</button>
                ))}
              </div>
              <p className="hvs-ai-sub">Caption look</p>
              <div className="hvs-ai-row" data-testid="hvs-ai-caption-styles">
                {Object.values(HVS_CAPTION_STYLE_SPECS).map(style => (
                  <button
                    key={style.id}
                    type="button"
                    className="hvs-ai-chip"
                    onClick={() => setRevision(`Add captions. Use ${style.label} captions.`)}
                  >
                    {style.label}
                  </button>
                ))}
              </div>
              <div className="hvs-ai-row">
                <button type="button" className="hvs-ai-btn" disabled={working || !revision.trim()} onClick={() => void proposeRevision()}>
                  Show the change
                </button>
              </div>
              {session?.pendingPatch || directorPatch ? (
                <div style={{ marginTop: 12 }} data-testid="hvs-ai-revision-proposal">
                  <p className="hvs-ai-sub">{directorPatch?.summary ?? session?.pendingPatch?.summary}</p>
                  <div className="hvs-ai-row">
                    <button type="button" className="hvs-ai-btn hvs-ai-btn-go" data-testid="hvs-ai-apply-revision" onClick={() => void applyRevision(true)}>Apply changes</button>
                    <button type="button" className="hvs-ai-btn hvs-ai-btn-ghost" data-testid="hvs-ai-keep-current" onClick={() => void applyRevision(false)}>Keep current</button>
                  </div>
                </div>
              ) : null}
            </article>
          ) : null}
        </div>

        <aside className="hvs-ai-panel" data-testid="hvs-ai-project-status">
          <h2>Project status</h2>
          <p className="hvs-ai-sub">Nothing is built until you approve the plan.</p>
          <p className="hvs-ai-sub">Your originals stay safe. Nothing is published or uploaded without approval.</p>
          <div className="hvs-ai-row" style={{ marginTop: 14 }}>
            <Link href={`${HVS_CANONICAL_PATH}/projects`} className="hvs-ai-btn hvs-ai-btn-ghost">My Projects</Link>
            <Link href={editorHref} className="hvs-ai-btn hvs-ai-btn-ghost">Advanced Editor</Link>
          </div>
        </aside>
      </div>
    </section>
  )
}
