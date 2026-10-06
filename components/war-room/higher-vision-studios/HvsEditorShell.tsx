'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { usePathname } from 'next/navigation'
import { formatTimecode, fromSeconds, toSeconds } from '@/lib/media-command/time'
import { mapPlayheadToSource, frameStepFromRate, clipSpeed, programFromSourceSeconds, dissolveProgress, clipSourceSeconds } from '@/lib/media-command/preview-engine'
import {
  emptySourceMonitor,
  loadAssetIntoSource,
  markSourceIn,
  markSourceOut,
  clearSourceIn,
  clearSourceOut,
  setSourcePlayhead,
  seekSourceFromHit,
  sourceRangeFromMarks,
  sourceMonitorFacts,
  type SourceMonitorState,
} from '@/lib/media-command/source-monitor'
import { newCommandId, type EditCommand } from '@/lib/media-command/edit-commands'
import { applyEditCommand } from '@/lib/media-command/edit-ops'
import { FILTER_SPECS } from '@/lib/media-command/filters'
import { composeProgramLookCss } from '@/lib/media-command/look-lowering'
import {
  programLookAt,
  composeProgramFilterCss,
  programAudioPreviewAt,
  lumaQualifierCoverage01,
  type PreviewQuality,
} from '@/lib/media-command/program-deliver-fidelity'
import { clampPan, panLabel } from '@/lib/media-command/pan'
import { pairForPlayhead } from '@/lib/media-command/transitions'
import { getThemeSpec, LUXURY_BEAUTY_V1_ID } from '@/lib/media-command/themes'
import { persistHvsResume, readHvsResume, HVS_CANONICAL_PATH, HVS_DISPLAY_NAME, WAR_ROOM_HOME_HREF } from '@/lib/media-command/navigation'
import { hvsProductionHref, parseHvsProductionPath } from '@/lib/media-command/production-pages'
import { HvsBackButton } from './HvsBackButton'
import { HvsProductionBar } from './HvsProductionBar'
import { HvsVersionBrowser } from './HvsVersionBrowser'
import './hvs-studio-v3.css'
import { HVS_DEMO_CAPTION, HVS_DEMO_THEME_LABEL } from '@/lib/media-command/demo-copy'
import { uniqueCaptionCues } from '@/lib/media-command/captions'
import { timelineDuration, type AssetRecord, type Clip, type HvsProject, type OutputAspect, type Track, type VirtualCamera } from '@/lib/media-command/types'
import { followFramingCrop, interpolateSubject } from '@/lib/media-command/tracking'
import { cropMovementSummary, FOLLOW_MODE_OPTIONS, measuredConfidence, trackStatusAtPlayhead } from '@/lib/media-command/track-ux'
import type { SetVirtualCameraCommand } from '@/lib/media-command/edit-commands'
import { HVS_FONTS } from '@/lib/media-command/fonts'
import { TITLE_PRESETS } from '@/lib/media-command/title-presets'
import {
  POSITION_PRESETS,
  collectSafeWarnings,
  cssTransform,
  overflowLines,
  resolveCaptionStyle,
  resolveOverlayStyle,
} from '@/lib/media-command/text-layout'

type LeftTab = 'library' | 'effects' | 'filters' | 'themes' | 'titles' | 'generated'
type InspectorTab = 'transform' | 'crop' | 'speed' | 'color' | 'effects' | 'audio' | 'tracking' | 'camera' | 'ai'
type WorkspaceMode = 'edit' | 'viewer' | 'timeline'
type StudioChrome = 'none' | 'versions' | 'render'
type MonitorMode = 'program' | 'source' | 'dual'
type MediaCategory = 'all' | 'video' | 'images' | 'audio' | 'generated' | 'graphics' | 'renders' | 'favorites'
type InspectorChrome = 'clip' | 'effects' | 'presets'

const HVS_TAGLINE = 'CREATE A CLEARER TOMORROW'
const LAYOUT_KEY = 'war-room-hvs-studio-v3-layout'

const AI_EXAMPLES = [
  'Cut this shorter.',
  'Reverse this clip.',
  'Follow this person.',
  'Keep her centered.',
  'Put him on the left third.',
  'Make this vertical and follow her.',
  'Use cinematic follow.',
  'Re-track this shot.',
  'Stop following this subject.',
  'Add captions.',
  'Add a title that says Coming Soon.',
  'Add a lower third.',
  'Make this vertical.',
  'Freeze this frame.',
  'Apply the selected theme.',
  'Pan this left.',
  'Add a dissolve here.',
  'Create a version called Director Cut.',
  'Save this as an alternate cut.',
  'Show my versions.',
]

const MEDIA_CATEGORIES: Array<{ id: MediaCategory; label: string }> = [
  { id: 'all', label: 'ALL' },
  { id: 'video', label: 'VIDEO' },
  { id: 'images', label: 'IMAGES' },
  { id: 'audio', label: 'AUDIO' },
  { id: 'generated', label: 'GENERATED' },
  { id: 'graphics', label: 'GRAPHICS' },
  { id: 'renders', label: 'RENDERS' },
  { id: 'favorites', label: 'FAVORITES' },
]

function cmd(partial: { kind: EditCommand['kind'] } & Record<string, unknown>): EditCommand {
  return {
    id: newCommandId(),
    createdAt: new Date().toISOString(),
    actor: 'human',
    ...partial,
  } as EditCommand
}

function favoritesKey(projectId: string) {
  return `war-room-hvs-favorites:${projectId}`
}

function assetMatchesCategory(asset: AssetRecord, category: MediaCategory, favorites: string[]): boolean {
  if (category === 'all') return true
  if (category === 'video') return asset.kind === 'video'
  if (category === 'images') return asset.kind === 'image'
  if (category === 'audio') return asset.kind === 'audio'
  if (category === 'generated') return asset.generated
  if (category === 'graphics') return asset.kind === 'graphic' || asset.kind === 'logo'
  if (category === 'renders') return Boolean(asset.outputOfRenderJobId) || /render/i.test(asset.name)
  if (category === 'favorites') return favorites.includes(asset.id)
  return true
}

function aspectCss(aspect: OutputAspect | string): string {
  if (aspect === '9:16') return '9 / 16'
  if (aspect === '1:1') return '1 / 1'
  return '16 / 9'
}

function trackDisplayName(track: Track): string {
  if (track.kind === 'graphics' || /graphic/i.test(track.name)) return 'Graphics'
  if (track.kind === 'audio' && /music/i.test(track.name)) return 'Music'
  if (track.kind === 'audio' && /dialog|voice|dialogue/i.test(track.name)) return 'Dialogue'
  if (track.kind === 'audio') return track.name
  if (track.kind === 'video') return /graphic/i.test(track.name) ? 'Graphics' : 'Video'
  return track.name
}

export function HvsEditorShell({ projectId }: { projectId?: string }) {
  const pathname = usePathname() || ''
  const productionPage = parseHvsProductionPath(pathname).page === 'cut' ? 'cut' : 'edit'
  const [project, setProject] = useState<HvsProject | null>(null)
  const [status, setStatus] = useState('Loading…')
  const [leftTab, setLeftTab] = useState<LeftTab>('library')
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('transform')
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null)
  const [selectedCueId, setSelectedCueId] = useState<string | null>(null)
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [playheadSec, setPlayheadSec] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [source, setSource] = useState<SourceMonitorState>(() => emptySourceMonitor())
  const [sourcePlaying, setSourcePlaying] = useState(false)
  const [safeAreas, setSafeAreas] = useState(true)
  const [guides, setGuides] = useState(true)
  const [aiOpen, setAiOpen] = useState(true)
  const [utterance, setUtterance] = useState('')
  const [proposalSummary, setProposalSummary] = useState<string | null>(null)
  const [pendingCommands, setPendingCommands] = useState<EditCommand[] | null>(null)
  const [seedBox, setSeedBox] = useState({ x: 0.38, y: 0.16, width: 0.24, height: 0.58 })
  const [followMode, setFollowMode] = useState<SetVirtualCameraCommand['mode']>('FACE_LOCK')
  const [pickMode, setPickMode] = useState(false)
  const [pickPending, setPickPending] = useState(false)
  const [showTrack, setShowTrack] = useState(true)
  const [framingPreview, setFramingPreview] = useState<'source' | 'camera'>('source')
  const [reframeAspect, setReframeAspect] = useState<OutputAspect>('9:16')
  const [trackingBusy, setTrackingBusy] = useState(false)
  const [waveforms, setWaveforms] = useState<Record<string, number[]>>({})
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('edit')
  const [monitorMode, setMonitorMode] = useState<MonitorMode>('program')
  const [mediaCategory, setMediaCategory] = useState<MediaCategory>('all')
  const [viewerZoom, setViewerZoom] = useState<'fit' | '100'>('fit')
  const [viewerAspect, setViewerAspect] = useState<OutputAspect | 'project'>('project')
  const [pxPerSec, setPxPerSec] = useState(64)
  const [playheadFollow, setPlayheadFollow] = useState(true)
  const [favorites, setFavorites] = useState<string[]>([])
  const [studioChrome, setStudioChrome] = useState<StudioChrome>('none')
  const versionsOpen = studioChrome === 'versions'
  const renderOpen = studioChrome === 'render'
  const [generateOpen, setGenerateOpen] = useState(false)
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null)
  const [versionCompareIds, setVersionCompareIds] = useState<[string, string] | null>(null)
  const [renderAspect, setRenderAspect] = useState<OutputAspect>('16:9')
  const [savedFlash, setSavedFlash] = useState('Saved')
  const [inspectorChrome, setInspectorChrome] = useState<InspectorChrome>('clip')
  const [mediaCollapsed, setMediaCollapsed] = useState(false)
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false)
  const [mediaWidth, setMediaWidth] = useState(336)
  const [inspectorWidth, setInspectorWidth] = useState(336)
  const [timelineHeight, setTimelineHeight] = useState(248)
  const [aiExpanded, setAiExpanded] = useState(false)
  const [advancedTools, setAdvancedTools] = useState(false)
  const [phonePane, setPhonePane] = useState<'view' | 'media' | 'ai' | 'timeline' | 'render'>('view')
  const videoRef = useRef<HTMLVideoElement>(null)
  const dissolveVideoRef = useRef<HTMLVideoElement>(null)
  const blurBgRef = useRef<HTMLVideoElement>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const pannerRef = useRef<StereoPannerNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const mediaSourceBound = useRef(false)
  const [previewQuality, setPreviewQuality] = useState<PreviewQuality>('accurate')
  const sourceRef = useRef<HTMLVideoElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const viewerRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)

  const persistStudio = useCallback((id: string, extra?: { playheadSec?: number; selectedClipId?: string | null }) => {
    persistHvsResume({
      basePath: hvsProductionHref(id, productionPage),
      projectId: id,
      section: 'editor',
      playheadSec: extra?.playheadSec ?? playheadSec,
      selectedClipId: extra?.selectedClipId === undefined ? selectedClipId : extra.selectedClipId,
    })
  }, [playheadSec, selectedClipId, productionPage])

  const load = useCallback(async (id: string) => {
    const res = await fetch(`/api/media-command/projects/${id}`)
    const data = await res.json() as { project?: HvsProject; error?: string }
    if (data.project) {
      setProject(data.project)
      const resume = readHvsResume()
      if (resume?.projectId === data.project.id) {
        if (typeof resume.playheadSec === 'number') setPlayheadSec(Math.max(0, resume.playheadSec))
        if (resume.selectedClipId) setSelectedClipId(resume.selectedClipId)
      }
      persistHvsResume({ basePath: hvsProductionHref(data.project.id, productionPage), projectId: data.project.id, section: 'editor', playheadSec: resume?.playheadSec ?? 0, selectedClipId: resume?.selectedClipId ?? null })
      setStatus(`Loaded ${data.project.name}`)
      setSavedFlash('Saved')
      try {
        const raw = localStorage.getItem(favoritesKey(data.project.id))
        setFavorites(raw ? JSON.parse(raw) as string[] : [])
      } catch {
        setFavorites([])
      }
    } else {
      setStatus(data.error ?? 'Project missing.')
    }
  }, [productionPage])

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const raw = localStorage.getItem(LAYOUT_KEY)
        if (!raw) return
        const parsed = JSON.parse(raw) as { mediaWidth?: number; inspectorWidth?: number; timelineHeight?: number; mediaCollapsed?: boolean; inspectorCollapsed?: boolean }
        if (parsed.mediaWidth) setMediaWidth(Math.min(420, Math.max(200, parsed.mediaWidth)))
        if (parsed.inspectorWidth) setInspectorWidth(Math.min(420, Math.max(220, parsed.inspectorWidth)))
        if (parsed.timelineHeight) setTimelineHeight(Math.min(420, Math.max(160, parsed.timelineHeight)))
        if (typeof parsed.mediaCollapsed === 'boolean') setMediaCollapsed(parsed.mediaCollapsed)
        if (typeof parsed.inspectorCollapsed === 'boolean') setInspectorCollapsed(parsed.inspectorCollapsed)
      } catch { /* ignore */ }
    })
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({ mediaWidth, inspectorWidth, timelineHeight, mediaCollapsed, inspectorCollapsed }))
    } catch { /* ignore */ }
  }, [mediaWidth, inspectorWidth, timelineHeight, mediaCollapsed, inspectorCollapsed])

  function startResize(kind: 'media' | 'inspector' | 'timeline', event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    const target = event.currentTarget
    try { target.setPointerCapture(event.pointerId) } catch { /* capture unavailable */ }
    const startX = event.clientX
    const startY = event.clientY
    const startMedia = mediaWidth
    const startInspector = inspectorWidth
    const startTimeline = timelineHeight
    function onMove(ev: PointerEvent) {
      if (kind === 'media') setMediaWidth(Math.min(420, Math.max(200, startMedia + (ev.clientX - startX))))
      if (kind === 'inspector') setInspectorWidth(Math.min(420, Math.max(220, startInspector - (ev.clientX - startX))))
      if (kind === 'timeline') setTimelineHeight(Math.min(420, Math.max(160, startTimeline - (ev.clientY - startY))))
    }
    function onUp(ev: PointerEvent) {
      try { if (target.hasPointerCapture(ev.pointerId)) target.releasePointerCapture(ev.pointerId) } catch { /* ignore */ }
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onUp)
  }

  function applyWorkspaceMode(mode: WorkspaceMode) {
    setWorkspaceMode(mode)
    setStudioChrome('none')
  }

  async function proposeDirector() {
    if (!project) return
    const res = await fetch('/api/media-command/director', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      projectId: project.id,
      utterance,
      mode: 'AI_DIRECTOR',
      playheadSeconds: playheadSec,
      selectedClipId,
      selectedCueId,
      selectedOverlayId,
      followMode,
      sourceAssetId: source.selectedAssetId,
      sourceIn: source.markIn,
      sourceOut: source.markOut,
      sourcePlayheadSeconds: toSeconds(source.playhead),
      workspacePage: productionPage,
    }) })
    const data = await res.json() as { proposal?: { summary: string; commands: EditCommand[]; sourceActions?: Array<{ kind: string; time?: { ticks: number; timescale: number }; assetId?: string }>; openVersionBrowser?: boolean; requiresConfirmation?: boolean; compareVersionIds?: [string, string]; sourceSeek?: { assetId: string; time: { ticks: number; timescale: number }; reason: string } } }
    setProposalSummary(data.proposal?.summary ?? null)
    setPendingCommands(data.proposal?.commands ?? null)
    if (data.proposal?.openVersionBrowser) setStudioChrome('versions')
    const restore = data.proposal?.commands?.find(c => c.kind === 'restoreVersion')
    if (restore && 'versionId' in restore) {
      setStudioChrome('versions')
      setPendingRestoreId(String(restore.versionId))
    }
    if (data.proposal?.compareVersionIds) {
      setVersionCompareIds(data.proposal.compareVersionIds)
      setStudioChrome('versions')
    }
    for (const action of data.proposal?.sourceActions ?? []) {
      if (action.kind === 'markIn') setSource(s => markSourceIn(s))
      if (action.kind === 'markOut') setSource(s => markSourceOut(s))
      if (action.kind === 'clearIn') setSource(s => clearSourceIn(s))
      if (action.kind === 'clearOut') setSource(s => clearSourceOut(s))
      if (action.kind === 'seek' && action.time) {
        const asset = project.assets.find(a => a.id === (action.assetId ?? source.selectedAssetId))
        if (asset) {
          setSourcePlaying(false)
          setSource(s => seekSourceFromHit(s, asset, { start: action.time!, assetId: asset.id }))
        }
      }
    }
    if (data.proposal?.sourceSeek) {
      const asset = project.assets.find(a => a.id === data.proposal!.sourceSeek!.assetId)
      if (asset) {
        setSourcePlaying(false)
        setSource(s => seekSourceFromHit(s, asset, { start: data.proposal!.sourceSeek!.time, assetId: asset.id }))
      }
    }
    setStatus(data.proposal?.summary ?? 'No proposal')
    setAiExpanded(true)
  }

  useEffect(() => {
    queueMicrotask(() => {
      if (projectId) {
        void load(projectId)
        return
      }
      const resume = readHvsResume()
      void fetch('/api/media-command/projects')
        .then(r => r.json())
        .then((data: { projects?: Array<{ id: string; starrdom?: boolean }> }) => {
          const pick = (resume?.projectId && data.projects?.some(p => p.id === resume.projectId) ? data.projects.find(p => p.id === resume.projectId) : null)
            ?? data.projects?.find(p => p.starrdom)
            ?? data.projects?.[0]
          if (pick) void load(pick.id)
          else setStatus('Create a project from Home first.')
        })
    })
  }, [load, projectId])

  const selected = (() => {
    if (!project || !selectedClipId) return null
    for (const track of project.timeline.tracks) {
      const clip = track.clips.find(c => c.id === selectedClipId)
      if (clip) return { track, clip }
    }
    return null
  })()

  const selectedTransition = selected
    ? selected.track.transitions.find(t => t.outgoingClipId === selected.clip.id || t.incomingClipId === selected.clip.id) ?? null
    : null
  const playheadPair = project ? pairForPlayhead(project, playheadSec) : null

  const selectedOverlay = project?.timeline.overlays.find(o => o.id === selectedOverlayId) ?? null
  const selectedCue = project?.timeline.captionTracks[0]?.cues.find(c => c.id === selectedCueId) ?? null
  const selectedAsset = project?.assets.find(a => a.id === selectedAssetId) ?? null
  const selectedSubject = project
    ? (selected ? project.timeline.subjects.find(s => s.clipId === selected.clip.id) : null) ?? project.timeline.subjects[0] ?? null
    : null
  const playheadTicks = project ? Math.round(playheadSec * project.timeline.timescale) : 0
  const trackStatus = trackStatusAtPlayhead(selectedSubject, playheadTicks, project?.timeline.timescale ?? 24000, trackingBusy)
  const trackConfidence = measuredConfidence(selectedSubject, playheadTicks, project?.timeline.timescale ?? 24000)
  const subjectBox = selectedSubject && project
    ? interpolateSubject(selectedSubject, playheadTicks, project.timeline.timescale)
    : null

  const preview = useMemo(() => (project ? mapPlayheadToSource(project, playheadSec) : null), [playheadSec, project])
  const mix = preview?.dissolve ?? null
  const mixU = mix ? dissolveProgress(mix, playheadSec) : 0
  const programClip = mix?.outgoing ?? preview?.clip ?? null
  const programLook = useMemo(
    () => (project ? programLookAt(project, playheadSec, { quality: previewQuality, clip: programClip }) : null),
    [project, playheadSec, previewQuality, programClip],
  )
  const audioPreview = useMemo(
    () => (project ? programAudioPreviewAt(project, programClip, preview?.track ?? null, playheadSec) : null),
    [project, programClip, preview?.track, playheadSec],
  )
  const previewAsset = programClip && project ? project.assets.find(a => a.id === programClip.assetId) : null
  const incomingAsset = mix?.incoming && project ? project.assets.find(a => a.id === mix.incoming.assetId) : null
  const isStill = previewAsset?.kind === 'image' || previewAsset?.kind === 'logo' || previewAsset?.kind === 'graphic'
  const mediaUrl = previewAsset && !isStill ? `/api/media-command/assets/${previewAsset.id}/file?kind=proxy` : null
  const incomingUrl = incomingAsset && incomingAsset.kind === 'video' ? `/api/media-command/assets/${incomingAsset.id}/file?kind=proxy` : null
  const stillUrl = previewAsset && isStill ? `/api/media-command/assets/${previewAsset.id}/file?kind=proxy` : null
  const sourceUrl = selectedAsset
    ? `/api/media-command/assets/${selectedAsset.id}/file?kind=${source.previewRepresentation === 'original' ? 'original' : 'proxy'}`
    : null
  const sourceFacts = sourceMonitorFacts(selectedAsset)
  const sourceRange = selectedAsset ? sourceRangeFromMarks(source, selectedAsset) : null
  const programSpecial = Boolean(preview?.gap || preview?.clip?.reversed || preview?.clip?.freeze)
  const programFrameStep = frameStepFromRate(project?.timeline.frameRate)
  const sourceFrameStep = frameStepFromRate(selectedAsset?.frameRate ?? project?.timeline.frameRate)
  const theme = getThemeSpec(project?.timeline.themeId ?? null)
  const activeAspect: OutputAspect = viewerAspect === 'project' ? (project?.timeline.aspect ?? '16:9') : viewerAspect
  const vcam: VirtualCamera | null = project?.timeline.virtualCameras.find(c => c.outputAspect === reframeAspect)
    ?? project?.timeline.virtualCameras.find(c => c.outputAspect === '9:16')
    ?? project?.timeline.virtualCameras[0]
    ?? null
  const applyFollowFraming = framingPreview === 'camera' || project?.timeline.aspect === '9:16'
  const followCrop = (() => {
    if (!project || !vcam) return null
    const subject = project.timeline.subjects.find(s => s.id === vcam.subjectId) ?? project.timeline.subjects[0]
    if (!subject) return vcam.keyframes[0]?.crop ?? null
    const box = interpolateSubject(subject, Math.round(playheadSec * project.timeline.timescale), project.timeline.timescale)
    return box ? followFramingCrop(box, vcam.mode, vcam.outputAspect, previewAsset ? (previewAsset.width && previewAsset.height ? previewAsset.width / previewAsset.height : 16 / 9) : 16 / 9) : null
  })()
  const cameraSummary = cropMovementSummary(vcam)
  const framingAspect: OutputAspect = framingPreview === 'camera' && vcam ? vcam.outputAspect : activeAspect
  const programAspect = aspectCss(framingAspect)

  const authoredDurationSec = useMemo(() => (project ? toSeconds(timelineDuration(project.timeline)) : 0), [project])
  const durationSec = useMemo(() => {
    if (!project) return 30
    let max = 8
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) max = Math.max(max, toSeconds(clip.start) + toSeconds(clip.duration))
    }
    return Math.max(8, max + 2, authoredDurationSec + 2)
  }, [project, authoredDurationSec])

  const currentVersion = project?.versions.find(v => v.id === project.currentVersionId) ?? project?.versions.at(-1)
  const lastRender = project?.renderJobs.at(-1)
  const visibleAssets = (project?.assets ?? []).filter(asset => assetMatchesCategory(asset, mediaCategory, favorites))

  useEffect(() => {
    if (!project) return
    for (const asset of project.assets) {
      if (!asset.waveformPath || waveforms[asset.id]) continue
      void fetch(`/api/media-command/assets/${asset.id}/file?kind=waveform`)
        .then(r => (r.ok ? r.json() : null))
        .then((data: { samples?: number[] } | null) => {
          if (data?.samples?.length) setWaveforms(w => ({ ...w, [asset.id]: data.samples! }))
        })
        .catch(() => { /* ignore */ })
    }
  }, [project, waveforms])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !preview || !programClip) return
    const source = clipSourceSeconds(programClip, Math.max(0, playheadSec - toSeconds(programClip.start)))
    if ((!playing || programSpecial) && Math.abs(video.currentTime - source) > 0.04) {
      try { video.currentTime = Math.max(0, source) } catch { /* ignore */ }
    }
    const blurBg = blurBgRef.current
    if (blurBg && Math.abs(blurBg.currentTime - source) > 0.04) {
      try { blurBg.currentTime = Math.max(0, source) } catch { /* ignore */ }
    }
    const incoming = dissolveVideoRef.current
    if (incoming && mix?.incoming) {
      const inSrc = clipSourceSeconds(mix.incoming, Math.max(0, playheadSec - toSeconds(mix.incoming.start)))
      if (Math.abs(incoming.currentTime - inSrc) > 0.04) {
        try { incoming.currentTime = Math.max(0, inSrc) } catch { /* ignore */ }
      }
    }
  }, [preview, playing, programSpecial, programClip, playheadSec, mix])

  useEffect(() => {
    const video = videoRef.current
    if (playing && video && mediaUrl && !programSpecial) {
      video.playbackRate = programClip ? clipSpeed(programClip) : 1
      void video.play().catch(() => { /* autoplay may be blocked; cursor still advances */ })
      const blurBg = blurBgRef.current
      if (blurBg && mediaUrl) {
        blurBg.playbackRate = programClip ? clipSpeed(programClip) : 1
        blurBg.muted = true
        void blurBg.play().catch(() => { /* ignore */ })
      }
      const incoming = dissolveVideoRef.current
      if (incoming && incomingUrl) {
        incoming.playbackRate = mix?.incoming ? clipSpeed(mix.incoming) : 1
        incoming.muted = true
        void incoming.play().catch(() => { /* ignore */ })
      }
    } else {
      video?.pause()
      dissolveVideoRef.current?.pause()
      blurBgRef.current?.pause()
    }
  }, [playing, mediaUrl, incomingUrl, programSpecial, programClip, mix])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const pan = audioPreview?.pan ?? clampPan(programClip?.pan ?? 0)
    const gain = audioPreview?.gain ?? (programClip?.volume ?? 1)
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      if (!audioCtxRef.current) audioCtxRef.current = new Ctor()
      const ctx = audioCtxRef.current
      if (!mediaSourceBound.current) {
        const src = ctx.createMediaElementSource(video)
        const gainNode = ctx.createGain()
        const panner = ctx.createStereoPanner()
        src.connect(gainNode)
        gainNode.connect(panner)
        panner.connect(ctx.destination)
        gainRef.current = gainNode
        pannerRef.current = panner
        mediaSourceBound.current = true
      }
      if (pannerRef.current) pannerRef.current.pan.value = pan
      if (gainRef.current) gainRef.current.gain.value = gain
      if (playing && ctx.state === 'suspended') void ctx.resume()
    } catch {
      /* MediaElementSource can only bind once; ignore */
    }
  }, [selected, programClip, playing, audioPreview])

  useEffect(() => {
    if (!playing) return
    if (mediaUrl && !programSpecial && videoRef.current) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      setPlayheadSec(v => {
        const next = v + dt
        const end = authoredDurationSec > 0 ? Math.max(0, authoredDurationSec - 1 / 24) : durationSec
        if (next >= end) {
          queueMicrotask(() => setPlaying(false))
          return end
        }
        return next
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, mediaUrl, programSpecial, durationSec, authoredDurationSec])

  useEffect(() => {
    if (!playing || !playheadFollow) return
    const el = scrollerRef.current
    if (!el) return
    const x = playheadSec * pxPerSec
    const view = el.clientWidth
    if (x < el.scrollLeft + 40 || x > el.scrollLeft + view - 40) {
      el.scrollLeft = Math.max(0, x - view / 2)
    }
  }, [playing, playheadSec, pxPerSec, playheadFollow])

  useEffect(() => {
    if (!project || playing) return
    persistStudio(project.id)
  }, [playing, playheadSec, selectedClipId, project, persistStudio])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => { /* ignore */ })
        return
      }
      if (studioChrome !== 'none') {
        setStudioChrome('none')
        return
      }
      if (workspaceMode === 'viewer' || workspaceMode === 'timeline') setWorkspaceMode('edit')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [workspaceMode, studioChrome])

  async function commit(commands: EditCommand[], previewOnly = false) {
    if (!project) return
    if (!previewOnly && commands.some(c => c.kind === 'restoreVersion' && !('confirmed' in c && c.confirmed))) {
      const restore = commands.find(c => c.kind === 'restoreVersion')
      setStudioChrome('versions')
      if (restore && 'versionId' in restore) setPendingRestoreId(String(restore.versionId))
      setStatus('Restore requires confirmation in the Version Browser.')
      return
    }
    let current = project
    if (!previewOnly) setSavedFlash('Saving…')
    if (!previewOnly) {
      for (const command of commands) {
        if (command.kind === 'undo' || command.kind === 'redo' || command.kind === 'createVersion' || command.kind === 'restoreVersion' || command.kind === 'createVersionFrom' || command.kind === 'trackSubject' || command.kind === 'reacquireTrack') continue
        const applied = applyEditCommand(current, command)
        if (applied.ok) current = applied.project
      }
      setProject(current)
    }
    const tracking = commands.some(c => c.kind === 'trackSubject' || c.kind === 'reacquireTrack')
    if (tracking) {
      setTrackingBusy(true)
      setStatus('TRACKING…')
    }
    const res = await fetch(`/api/media-command/projects/${project.id}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commands, preview: previewOnly }),
    })
    const data = await res.json() as { project?: HvsProject; errors?: string[]; warnings?: string[] }
    if (data.project && !previewOnly) setProject(data.project)
    setStatus((data.errors?.join('; ')) || (data.warnings?.join('; ')) || (previewOnly ? 'Preview only — not committed.' : 'Committed.'))
    if (!previewOnly) setSavedFlash('Saved')
    if (tracking) {
      setTrackingBusy(false)
      setPickMode(false)
      setPickPending(false)
    }
  }

  async function ingest(file: File) {
    if (!project) return
    setStatus(`Ingesting ${file.name}…`)
    const form = new FormData()
    form.set('projectId', project.id)
    form.set('file', file)
    const res = await fetch('/api/media-command/ingest', { method: 'POST', body: form })
    const data = await res.json() as { project?: HvsProject; error?: string; warnings?: string[] }
    if (data.project) {
      setProject(data.project)
      setStatus(data.warnings?.join('; ') || `Ingested ${file.name}. Original is immutable.${data.project?.assets.at(-1)?.thumbPath ? ' Thumb/proxy/waveform generated.' : ''}`)
    } else setStatus(data.error ?? 'Ingest failed.')
  }

  function dropOnTrack(track: Track, assetId: string) {
    void commit([cmd({ kind: 'insertClip', trackId: track.id, assetId, start: { ticks: Math.round(playheadSec * (project?.timeline.timescale ?? 24000)), timescale: project?.timeline.timescale ?? 24000 } })])
  }

  function editFromSource(kind: 'insertClip' | 'overwriteClip' | 'appendClip') {
    if (!project || !selectedAsset) {
      setStatus('Select a source asset first.')
      return
    }
    const range = sourceRangeFromMarks(source, selectedAsset)
    if (!range.ok) {
      setStatus(range.error)
      return
    }
    const track = project.timeline.tracks.find(t => t.kind === 'video') ?? project.timeline.tracks[0]
    const ts = project.timeline.timescale
    if (kind === 'appendClip') {
      void commit([cmd({ kind, trackId: track.id, assetId: selectedAsset.id, sourceIn: range.sourceIn, sourceOut: range.sourceOut, duration: range.duration })])
      return
    }
    void commit([cmd({
      kind,
      trackId: track.id,
      assetId: selectedAsset.id,
      start: fromSeconds(playheadSec, ts),
      sourceIn: range.sourceIn,
      sourceOut: range.sourceOut,
      duration: range.duration,
    })])
  }

  function toggleFavorite(assetId: string) {
    if (!project) return
    setFavorites(current => {
      const next = current.includes(assetId) ? current.filter(id => id !== assetId) : [...current, assetId]
      try { localStorage.setItem(favoritesKey(project.id), JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  function selectAssetForSource(assetId: string) {
    setSelectedAssetId(assetId)
    setSourcePlaying(false)
    const asset = project?.assets.find(a => a.id === assetId) ?? null
    setSource(s => loadAssetIntoSource(s, asset))
    setMonitorMode(mode => (mode === 'source' ? 'source' : 'dual'))
  }

  // HVS-GENERATIVE-VIDEO-01: `?sourceAsset=<assetId>` opens an existing AssetRecord (e.g. a local Wan 2.2
  // generation) in the existing Source monitor. Read-only: no timeline mutation.
  const [sourceAssetParamHandled, setSourceAssetParamHandled] = useState(false)
  useEffect(() => {
    if (sourceAssetParamHandled || !project || typeof window === 'undefined') return
    const requested = new URLSearchParams(window.location.search).get('sourceAsset')
    setSourceAssetParamHandled(true)
    if (requested && project.assets.some(a => a.id === requested)) selectAssetForSource(requested)
  }, [project, sourceAssetParamHandled]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const video = sourceRef.current
    if (!video) return
    if (sourcePlaying) void video.play().catch(() => { /* autoplay may be blocked */ })
    else video.pause()
  }, [sourcePlaying, sourceUrl])

  useEffect(() => {
    const video = sourceRef.current
    if (!video || sourcePlaying) return
    const t = toSeconds(source.playhead)
    if (Math.abs(video.currentTime - t) > 0.08) {
      try { video.currentTime = Math.max(0, t) } catch { /* ignore */ }
    }
  }, [source.playhead, sourcePlaying])

  async function toggleFullscreen() {
    const node = viewerRef.current
    if (!node) return
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await node.requestFullscreen()
    } catch {
      setStatus('Fullscreen blocked by the browser.')
    }
  }

  function fitTimeline() {
    const el = scrollerRef.current
    const width = el?.clientWidth ?? 800
    setPxPerSec(Math.max(16, Math.min(240, (width - 8) / Math.max(1, durationSec))))
  }

  async function renderAspectTarget(aspect: OutputAspect) {
    if (!project) return
    setStatus(`Rendering ${aspect}…`)
    const res = await fetch('/api/media-command/render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, aspect }),
    })
    const data = await res.json() as { project?: HvsProject }
    if (data.project) setProject(data.project)
    const job = data.project?.renderJobs.filter(j => j.target.aspect === aspect).at(-1)
    setStatus(job?.status === 'completed' && job.outputPath ? `${aspect} rendered (${job.encoder ?? 'cpu'})` : job?.error || job?.blockedReason || `${aspect} render did not produce a file.`)
  }

  function playCompletedRender() {
    const job = project?.renderJobs.filter(j => j.status === 'completed').at(-1)
    if (!job?.outputAssetId) {
      setStatus('No completed render asset yet.')
      return
    }
    selectAssetForSource(job.outputAssetId)
    setPlaying(false)
  }

  const gridClass = 'hvs-v3-body'
  void advancedTools
  const categoryCounts = {
    all: project?.assets.length ?? 0,
    video: (project?.assets ?? []).filter(a => a.kind === 'video').length,
    images: (project?.assets ?? []).filter(a => a.kind === 'image').length,
    audio: (project?.assets ?? []).filter(a => a.kind === 'audio').length,
    graphics: (project?.assets ?? []).filter(a => a.kind === 'graphic' || a.kind === 'logo').length,
    generated: (project?.assets ?? []).filter(a => a.generated).length,
    renders: (project?.assets ?? []).filter(a => Boolean(a.outputOfRenderJobId) || /render/i.test(a.name)).length,
    favorites: favorites.length,
  }

  const inspectorKind = selectedMarkerId ? 'marker' : selectedCue ? 'caption' : selectedOverlay?.titleKind === 'lower-third' ? 'title' : selectedOverlay?.kind === 'title' ? 'title' : selectedOverlay?.kind === 'logo' ? 'logo' : selectedOverlay ? 'graphic' : selected?.track.kind === 'audio' ? 'audio' : selected ? 'video' : 'none'
  const captionStyle = selectedCue && project ? resolveCaptionStyle(selectedCue, project.timeline.captionTracks[0], theme) : null
  const overlayStyle = selectedOverlay && selectedOverlay.kind === 'title' ? resolveOverlayStyle(selectedOverlay, theme) : null
  const safeWarnings = project ? collectSafeWarnings(project, theme, activeAspect) : []
  const visibleSafeWarnings = safeWarnings.filter(w => w.status === 'WARNING')

  return (
    <div
      className="hvs-v3"
      data-testid="hvs-editor-shell"
      data-mode={workspaceMode}
      data-ai-collapsed={aiOpen ? 'false' : 'true'}
      style={{
        ['--hvs-media-w' as string]: mediaCollapsed || workspaceMode === 'viewer' ? '28px' : `${mediaWidth}px`,
        ['--hvs-inspector-w' as string]: inspectorCollapsed || workspaceMode === 'viewer' ? '28px' : `${inspectorWidth}px`,
        ['--hvs-timeline-h' as string]: `${workspaceMode === 'timeline' ? Math.max(timelineHeight, 320) : workspaceMode === 'viewer' ? 0 : timelineHeight}px`,
      }}
    >
      <header className="hvs-v3-header" data-testid="hvs-studio-header">
        <div className="hvs-v3-header-leading">
          <HvsBackButton onNavigate={() => { if (project?.id) persistStudio(project.id) }} />
          <div className="hvs-v3-brand">
            <strong>{HVS_DISPLAY_NAME}</strong>
            <span>{HVS_TAGLINE}</span>
          </div>
        </div>
        <div className="hvs-v3-header-center">
          <span>Project:</span>
          <b>{project?.name ?? 'No project'}</b>
          <span>Version:</span>
          <span data-testid="hvs-current-version">{currentVersion?.label ?? 'Version 1'}</span>
          <span className="hvs-v3-dot" />
          <span data-testid="hvs-save-state">{savedFlash === 'Saving…' ? 'Saving…' : savedFlash === 'Saved' ? 'Saved just now' : savedFlash}</span>
          <span className="font-mono text-[10px] text-cyan-200">{formatTimecode({ ticks: Math.round(playheadSec * 24000), timescale: 24000 })} / {formatTimecode({ ticks: Math.round(Math.max(0, authoredDurationSec) * 24000), timescale: 24000 })}</span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {(['edit', 'viewer', 'timeline'] as WorkspaceMode[]).map(mode => (
            <button
              key={mode}
              type="button"
              data-testid={`hvs-mode-${mode}`}
              data-active={workspaceMode === mode ? 'true' : 'false'}
              className="hvs-v3-icon"
              title={mode}
              onPointerDown={event => { event.preventDefault(); applyWorkspaceMode(mode) }}
              onClick={() => applyWorkspaceMode(mode)}
              style={{ color: workspaceMode === mode ? '#3dff8a' : undefined }}
            >{mode === 'edit' ? 'Edit' : mode === 'viewer' ? 'Viewer' : 'Timeline'}</button>
          ))}
          <button type="button" data-testid="hvs-versions-toggle" aria-pressed={versionsOpen} className="hvs-v3-icon" title="Version Browser" onClick={() => setStudioChrome(c => c === 'versions' ? 'none' : 'versions')}>VERSION</button>
          <button type="button" className="hvs-v3-icon" title="Undo" onClick={() => void commit([cmd({ kind: 'undo' })])}>↶</button>
          <button type="button" className="hvs-v3-icon" title="Redo" onClick={() => void commit([cmd({ kind: 'redo' })])}>↷</button>
          <button type="button" data-testid="hvs-generate-toggle" className="hvs-v3-icon" title="Generate" onClick={() => { setGenerateOpen(v => !v); setLeftTab('library'); applyWorkspaceMode('edit'); setMediaCollapsed(false) }}>Gen</button>
          <button type="button" data-testid="hvs-render-toggle" aria-pressed={renderOpen} className="hvs-v3-render" onClick={() => setStudioChrome(c => c === 'render' ? 'none' : 'render')}>RENDER →</button>
          <a href={WAR_ROOM_HOME_HREF} className="pl-2 text-[8px] font-bold uppercase tracking-[0.16em] text-slate-400">War Room OS<br />Media Production</a>
        </div>
      </header>
      <HvsProductionBar
        projectId={project?.id ?? projectId}
        page={productionPage}
        projectName={project?.name}
        playheadSec={playheadSec}
        selectedClipId={selectedClipId}
      />
      <p className="truncate px-2 py-0.5 text-[10px] text-cyan-300">{status}</p>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden max-lg:overflow-visible">
      {(versionsOpen || renderOpen) ? (
        <div className="pointer-events-none absolute right-0 top-0 z-30 flex w-[min(44rem,calc(100%-0.5rem))] flex-col gap-2">
          {versionsOpen && project ? (
            <div className="pointer-events-auto" data-testid="hvs-versions">
              <HvsVersionBrowser project={project} onProject={setProject} pendingRestoreId={pendingRestoreId} compareIds={versionCompareIds} />
            </div>
          ) : null}
          {renderOpen ? (
            <section className="pointer-events-auto foundry-glass rounded-lg border border-amber-900/40 p-3 shadow-[0_18px_40px_rgba(0,0,0,0.55)]" data-testid="hvs-render-panel">
              <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-amber-300">Render / Export</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {(['16:9', '9:16', '1:1'] as OutputAspect[]).map(aspect => (
                  <button key={aspect} type="button" className="rounded border px-2 py-1 text-[10px] uppercase tracking-widest" style={{ borderColor: renderAspect === aspect ? 'rgba(52,211,153,0.6)' : 'rgba(255,255,255,0.15)', color: renderAspect === aspect ? '#bbf7d0' : '#cbd5e1' }} onClick={() => setRenderAspect(aspect)}>{aspect}</button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">Resolution {renderAspect === '9:16' ? '1080×1920' : renderAspect === '1:1' ? '1080×1080' : '1920×1080'} · captions from the project caption track · output name from the render job.</p>
              <div className="mt-2 flex flex-wrap gap-1">
                <button type="button" className="rounded border border-emerald-400/50 px-2 py-1 text-[10px] uppercase tracking-widest text-emerald-100" onClick={() => void renderAspectTarget(renderAspect)}>Render {renderAspect}</button>
                <button type="button" className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase tracking-widest text-slate-200" onClick={playCompletedRender}>Play last render</button>
                <button type="button" className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase tracking-widest text-slate-200" onClick={() => { setMediaCategory('renders'); setLeftTab('library'); setWorkspaceMode('edit') }}>Open in Media Library</button>
                <a href={`${HVS_CANONICAL_PATH}/render-queue`} className="rounded border border-cyan-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-cyan-200">Queue</a>
              </div>
              <ul className="mt-2 max-h-24 space-y-1 overflow-auto text-[11px] text-slate-400">
                {(project?.renderJobs ?? []).slice(-4).reverse().map(job => (
                  <li key={job.id}>{job.target.aspect} · {job.status}{job.encoder ? ` · ${job.encoder}` : ''}{job.blockedReason ? ` · ${job.blockedReason}` : ''}</li>
                ))}
                {(project?.renderJobs.length ?? 0) === 0 ? <li>No renders yet.</li> : null}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

      <div
        className={gridClass}
        data-testid="hvs-studio-workspace"
        data-mode={workspaceMode}
        data-media-collapsed={mediaCollapsed ? 'true' : 'false'}
        data-inspector-collapsed={inspectorCollapsed ? 'true' : 'false'}
        data-phone={phonePane}
      >
        <aside className="hvs-v3-panel hvs-v3-library-host" data-testid="hvs-media-library">
            <div className="hvs-v3-panel-h">
              <span>MEDIA LIBRARY</span>
              <span className="flex items-center gap-1">
                <button type="button" data-testid="hvs-collapse-media" className="hvs-v3-icon" title="Collapse media" onClick={() => setMediaCollapsed(v => !v)}>{mediaCollapsed ? '⟩' : '⟨'}</button>
                <button type="button" data-testid="hvs-resize-media" className="hvs-v3-split" aria-label="Resize media" onPointerDown={event => startResize('media', event)} />
              </span>
            </div>
            {mediaCollapsed ? <p className="p-1 text-[9px] uppercase tracking-widest text-slate-600">Media</p> : (
            <>
            <div className="flex flex-wrap gap-1 border-b border-white/5 p-1">
              {(['library', 'effects', 'filters', 'themes', 'titles', 'generated'] as LeftTab[]).map(tab => (
                <button key={tab} type="button" onClick={() => setLeftTab(tab)} className="rounded px-2 py-1 text-[9px] font-bold uppercase tracking-widest" style={{ color: leftTab === tab ? '#3dff8a' : '#64748b', border: leftTab === tab ? '1px solid rgba(61,255,138,0.4)' : '1px solid transparent' }}>{tab === 'library' ? 'Bin' : tab}</button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {leftTab === 'library' ? (
                <div className="hvs-v3-library">
                  <input ref={fileRef} type="file" accept="video/*,audio/*,image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void ingest(f); e.target.value = '' }} />
                  <div className="hvs-v3-cats">
                    <button type="button" onClick={() => fileRef.current?.click()} className="mb-1 text-emerald-200">+ Import</button>
                    {MEDIA_CATEGORIES.filter(c => c.id !== 'favorites').map(cat => (
                      <button key={cat.id} type="button" data-testid={`hvs-media-filter-${cat.id}`} data-active={mediaCategory === cat.id} onClick={() => setMediaCategory(cat.id)}>
                        <span>{cat.label}</span>
                        <span>{categoryCounts[cat.id]}</span>
                      </button>
                    ))}
                    <p className="px-2 pt-2 text-[8px] font-bold uppercase tracking-[0.18em] text-slate-600">Favorites</p>
                    <button type="button" data-testid="hvs-media-filter-favorites" data-active={mediaCategory === 'favorites'} onClick={() => setMediaCategory('favorites')}>
                      <span>Favorites</span>
                      <span>{categoryCounts.favorites}</span>
                    </button>
                    <p className="px-2 pt-2 text-[8px] font-bold uppercase tracking-[0.18em] text-slate-600">Smart collections</p>
                    <button type="button" onClick={() => setMediaCategory('all')}><span>Recent</span><span>{Math.min(12, categoryCounts.all)}</span></button>
                    <button type="button" disabled title="COMING LATER"><span>AI Picks</span><span className="text-[8px] text-amber-300">LATER</span></button>
                    <button type="button" disabled title="COMING LATER"><span>Scene Analysis</span><span className="text-[8px] text-amber-300">LATER</span></button>
                    <button type="button" disabled title="COMING LATER"><span>Narrative</span><span className="text-[8px] text-amber-300">LATER</span></button>
                  </div>
                  <div className="hvs-v3-bin">
                    {visibleAssets.map(asset => (
                      <button
                        key={asset.id}
                        type="button"
                        draggable
                        data-testid="hvs-library-asset"
                        data-asset-id={asset.id}
                        aria-pressed={selectedAssetId === asset.id}
                        onDragStart={e => e.dataTransfer.setData('application/hvs-asset', asset.id)}
                        onClick={() => selectAssetForSource(asset.id)}
                        onDoubleClick={() => project && dropOnTrack(project.timeline.tracks[0], asset.id)}
                        className="hvs-v3-asset"
                      >
                        {(asset.kind === 'video' || asset.kind === 'image' || asset.kind === 'logo') ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img alt="" src={`/api/media-command/assets/${asset.id}/file?kind=thumb`} />
                        ) : <div className="flex aspect-video items-center justify-center text-[9px] uppercase tracking-widest text-slate-600">{asset.kind}</div>}
                        <figcaption>
                          <span className="truncate">{asset.name}</span>
                          <span className="font-mono text-[9px] text-slate-400">{formatTimecode(asset.duration)}</span>
                        </figcaption>
                      </button>
                    ))}
                    <button type="button" className="hvs-v3-chip w-full" onClick={() => setGenerateOpen(v => !v)}>Generate inside Studio</button>
                    {generateOpen ? (
                    <div className="mt-2 space-y-1 rounded border border-cyan-900/40 p-2" data-testid="hvs-generate-shells">
                      <p className="text-[9px] uppercase tracking-widest text-amber-300">SHELL — providers not connected</p>
                      <button type="button" className="w-full rounded border border-white/10 px-2 py-1 text-left text-[10px] text-slate-200" onClick={() => void commit([cmd({ kind: 'generateVideo', prompt: utterance || 'Generate a missing shot.' })])}>Generate Video · queues blocked ProviderJob</button>
                      <button type="button" className="w-full rounded border border-white/10 px-2 py-1 text-left text-[10px] text-slate-200" onClick={() => void commit([cmd({ kind: 'generateImage', prompt: utterance || 'Generate a still.' })])}>Generate Image · queues blocked ProviderJob</button>
                      <a href={`${HVS_CANONICAL_PATH}/voice`} className="block rounded border border-white/10 px-2 py-1 text-[10px] text-slate-400">Generate Voice · shell</a>
                      <a href={`${HVS_CANONICAL_PATH}/music`} className="block rounded border border-white/10 px-2 py-1 text-[10px] text-slate-400">Generate Music · shell</a>
                      <a href={`${HVS_CANONICAL_PATH}/music`} className="block rounded border border-white/10 px-2 py-1 text-[10px] text-slate-400">Generate SFX · shell</a>
                    </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {leftTab === 'filters' ? (
                <ul className="space-y-1">
                  {FILTER_SPECS.map(filter => (
                    <li key={filter.id}>
                      <button type="button" className="w-full rounded border border-white/10 px-2 py-1.5 text-left text-[11px] text-amber-100" onClick={() => selected && void commit([cmd({ kind: 'applyFilter', clipId: selected.clip.id, filterId: filter.id, amount: 0.7 })])}>
                        {filter.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {leftTab === 'themes' ? (
                <button type="button" className="w-full rounded border border-amber-400/40 px-2 py-2 text-left text-[11px] text-amber-100" onClick={() => void commit([cmd({ kind: 'applyTheme', themeId: LUXURY_BEAUTY_V1_ID })])}>
                  luxury_beauty_v1 · Higher Vision proving theme
                </button>
              ) : null}
              {leftTab === 'effects' ? <p className="text-[11px] text-slate-500">Extensible effect kinds are registered. Apply from Inspector after selecting a clip.</p> : null}
              {leftTab === 'titles' ? (
                <div className="space-y-1" data-testid="hvs-titles-presets">
                  {TITLE_PRESETS.map(preset => (
                    <button
                      key={preset.id}
                      type="button"
                      data-testid={`hvs-title-preset-${preset.id}`}
                      className="w-full rounded border border-white/10 px-2 py-2 text-left text-[11px] text-amber-100"
                      onClick={() => {
                        if (!project) return
                        const start = { ticks: Math.round(playheadSec * project.timeline.timescale), timescale: project.timeline.timescale }
                        const duration = { ticks: project.timeline.timescale * (preset.titleKind === 'lower-third' ? 4 : 3), timescale: project.timeline.timescale }
                        if (selectedOverlay?.kind === 'title') {
                          void commit([cmd({ kind: 'setTitleStyle', overlayId: selectedOverlay.id, stylePreset: preset.id })])
                          return
                        }
                        if (preset.titleKind === 'lower-third') {
                          void commit([cmd({ kind: 'addLowerThird', text: 'HIGHER VISION', secondaryText: 'Studios', start, duration })])
                          return
                        }
                        void commit([cmd({ kind: 'addTitle', text: preset.id === 'cinematic' ? 'Coming Soon' : 'HIGHER VISION', start, duration, stylePreset: preset.id })])
                      }}
                    >{preset.label}</button>
                  ))}
                </div>
              ) : null}
              {leftTab === 'generated' ? (
                <ul className="space-y-1 p-2 text-[11px] text-slate-400">
                  {(project?.assets ?? []).filter(a => a.generated).map(a => <li key={a.id}>{a.name}</li>)}
                  {(project?.assets ?? []).every(a => !a.generated) ? <li>No generated assets yet. Provider jobs resolve here with provenance.</li> : null}
                </ul>
              ) : null}
            </div>
            </>
            )}
          </aside>

        <section className="hvs-v3-center">
          <div className="hvs-v3-viewer">
            <div className="hvs-v3-viewer-head">
              <strong>{monitorMode === 'source' ? 'SOURCE' : monitorMode === 'dual' ? 'DUAL' : 'PROGRAM'}</strong>
              <span className="flex items-center gap-0.5">
                {(['source', 'program', 'dual'] as MonitorMode[]).map(mode => (
                  <button key={mode} type="button" data-testid={`hvs-monitor-${mode}`} className="hvs-v3-icon" style={{ width: 'auto', padding: '0 6px', letterSpacing: '0.14em', fontSize: 9, fontWeight: 800, color: monitorMode === mode ? '#5ce1ff' : undefined }} onClick={() => setMonitorMode(mode)}>{mode === 'program' ? 'PROGRAM' : mode === 'source' ? 'SOURCE' : 'DUAL'}</button>
                ))}
              </span>
              <span className="ml-auto font-mono text-[10px] text-slate-500">
                {project ? `${project.timeline.width}×${project.timeline.height} ${(project.timeline.frameRate.n / Math.max(1, project.timeline.frameRate.d)).toFixed(2).replace(/\.00$/, '')}p` : '—'}
              </span>
              <button type="button" className="hvs-v3-icon" title="Fit" onClick={() => setViewerZoom('fit')}>Fit</button>
              <button type="button" data-testid="hvs-program-full" className="hvs-v3-icon" title="Fullscreen" onClick={() => void toggleFullscreen()}>⛶</button>
            </div>
          <div className={`hvs-v3-canvas grid min-h-0 flex-1 ${monitorMode === 'dual' ? 'xl:grid-cols-2' : 'grid-cols-1'}`}>
            {monitorMode !== 'program' ? (
              <div className="relative min-h-0 overflow-hidden bg-black" data-testid="hvs-source-monitor">
                <p className="absolute left-2 top-2 z-10 text-[9px] font-bold uppercase tracking-widest text-cyan-300">SOURCE</p>
                <button
                  type="button"
                  className="absolute right-2 top-2 z-10 rounded border border-white/15 px-1.5 py-0.5 text-[8px] uppercase tracking-widest text-amber-100"
                  data-testid="hvs-source-proxy-badge"
                  onClick={() => setSource(s => ({ ...s, previewRepresentation: s.previewRepresentation === 'proxy' ? 'original' : 'proxy' }))}
                >{source.previewRepresentation === 'original' ? 'ORIGINAL' : (sourceFacts?.previewKind ?? 'PROXY')}</button>
                <div className="flex h-[calc(100%-4.4rem)] items-center justify-center p-0">
                  {sourceUrl && selectedAsset && (selectedAsset.kind === 'image' || selectedAsset.kind === 'logo' || selectedAsset.kind === 'graphic') ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt="" src={sourceUrl} className="max-h-full max-w-full object-contain" />
                  ) : sourceUrl ? (
                    <video
                      ref={sourceRef}
                      src={sourceUrl}
                      className="max-h-full max-w-full object-contain"
                      onTimeUpdate={() => {
                        const video = sourceRef.current
                        if (!sourcePlaying || !selectedAsset || !video) return
                        setSource(s => setSourcePlayhead(s, fromSeconds(video.currentTime, s.timescale), selectedAsset))
                      }}
                    />
                  ) : (
                    <p className="text-[11px] uppercase tracking-[0.28em] text-slate-600">Select media to preview the original</p>
                  )}
                </div>
                <div className="absolute bottom-2 left-2 right-2 space-y-1">
                  <div className="flex flex-wrap gap-1">
                    <button type="button" data-testid="hvs-source-play" className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase tracking-widest text-slate-200" onClick={() => setSourcePlaying(p => !p)}>{sourcePlaying ? 'Pause' : 'Play'}</button>
                    <button type="button" data-testid="hvs-source-frame-back" className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase tracking-widest text-slate-200" onClick={() => { setSourcePlaying(false); setSource(s => setSourcePlayhead(s, fromSeconds(Math.max(0, toSeconds(s.playhead) - sourceFrameStep), s.timescale), selectedAsset)) }}>−1f</button>
                    <button type="button" data-testid="hvs-source-frame-forward" className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase tracking-widest text-slate-200" onClick={() => { setSourcePlaying(false); setSource(s => setSourcePlayhead(s, fromSeconds(toSeconds(s.playhead) + sourceFrameStep, s.timescale), selectedAsset)) }}>+1f</button>
                    <button type="button" data-testid="hvs-source-mark-in" className="rounded border border-emerald-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-emerald-100" onClick={() => setSource(s => markSourceIn(s))}>Mark In</button>
                    <button type="button" data-testid="hvs-source-mark-out" className="rounded border border-emerald-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-emerald-100" onClick={() => setSource(s => markSourceOut(s))}>Mark Out</button>
                    <button type="button" data-testid="hvs-source-clear-in" className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase tracking-widest text-slate-300" onClick={() => setSource(s => clearSourceIn(s))}>Clear In</button>
                    <button type="button" data-testid="hvs-source-clear-out" className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase tracking-widest text-slate-300" onClick={() => setSource(s => clearSourceOut(s))}>Clear Out</button>
                    <button type="button" data-testid="hvs-source-insert" className="rounded border border-cyan-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-cyan-100" onClick={() => editFromSource('insertClip')}>Insert</button>
                    <button type="button" data-testid="hvs-source-overwrite" className="rounded border border-amber-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-amber-100" onClick={() => editFromSource('overwriteClip')}>Overwrite</button>
                    <button type="button" data-testid="hvs-source-append" className="rounded border border-amber-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-amber-100" onClick={() => editFromSource('appendClip')}>Append</button>
                  </div>
                  <p className="font-mono text-[10px] text-emerald-200">
                    <span data-testid="hvs-source-current">{formatTimecode(source.playhead)}</span>
                    {' · IN '}
                    <span data-testid="hvs-source-in-display">{source.markIn ? formatTimecode(source.markIn) : '—'}</span>
                    {' · OUT '}
                    <span data-testid="hvs-source-out-display">{source.markOut ? formatTimecode(source.markOut) : '—'}</span>
                    {' · DUR '}
                    <span data-testid="hvs-source-duration-display">{sourceRange?.ok ? formatTimecode(sourceRange.duration) : '—'}</span>
                  </p>
                  <input
                    type="range"
                    aria-label="Seek source"
                    data-testid="hvs-source-seek"
                    className="w-full accent-cyan-400"
                    min={0}
                    max={Math.max(0.001, toSeconds(source.sourceDuration?.ticks ? source.sourceDuration : (selectedAsset?.duration ?? source.duration)))}
                    step={sourceFrameStep}
                    value={toSeconds(source.playhead)}
                    onChange={e => {
                      const seconds = Number(e.target.value)
                      setSourcePlaying(false)
                      setSource(s => setSourcePlayhead(s, fromSeconds(seconds, s.timescale), selectedAsset))
                    }}
                  />
                  {sourceFacts ? (
                    <p className="truncate text-[9px] uppercase tracking-widest text-slate-500">
                      {sourceFacts.name} · {sourceFacts.width}×{sourceFacts.height} · {sourceFacts.codec ?? 'codec?'} · {sourceFacts.sourceFrameRate.n}/{sourceFacts.sourceFrameRate.d} · {sourceFacts.sourceAudioPresence ? 'audio' : 'no audio'} · {sourceFacts.previewKind}
                    </p>
                  ) : (
                    <p className="text-[9px] uppercase tracking-widest text-slate-500">{selectedAsset ? `${selectedAsset.name} · raw` : 'No source selected'}</p>
                  )}
                </div>
              </div>
            ) : null}
            {monitorMode !== 'source' ? (
              <div ref={viewerRef} className="relative min-h-0 flex-1 overflow-hidden bg-black" data-testid="hvs-program-viewer" data-framing-preview={framingPreview}>
                <div className="pointer-events-auto absolute left-2 top-2 z-30 flex flex-wrap gap-1" data-testid="hvs-track-viewer-tools">
                  <button type="button" data-testid="hvs-show-track" className="rounded border border-white/20 bg-black/70 px-1.5 py-0.5 text-[8px] uppercase tracking-widest text-cyan-100" onClick={() => setShowTrack(true)}>Show track</button>
                  <button type="button" data-testid="hvs-hide-track" className="rounded border border-white/20 bg-black/70 px-1.5 py-0.5 text-[8px] uppercase tracking-widest text-slate-300" onClick={() => setShowTrack(false)}>Hide track</button>
                  <button type="button" data-testid="hvs-source-preview" aria-pressed={framingPreview === 'source'} className="rounded border px-1.5 py-0.5 text-[8px] uppercase tracking-widest" style={{ borderColor: framingPreview === 'source' ? 'rgba(92,225,255,0.8)' : 'rgba(255,255,255,0.2)', color: framingPreview === 'source' ? '#5ce1ff' : '#94a3b8', background: 'rgba(0,0,0,0.7)' }} onClick={() => setFramingPreview('source')}>Source frame</button>
                  <button type="button" data-testid="hvs-camera-preview" aria-pressed={framingPreview === 'camera'} className="rounded border px-1.5 py-0.5 text-[8px] uppercase tracking-widest" style={{ borderColor: framingPreview === 'camera' ? 'rgba(92,225,255,0.8)' : 'rgba(255,255,255,0.2)', color: framingPreview === 'camera' ? '#5ce1ff' : '#94a3b8', background: 'rgba(0,0,0,0.7)' }} onClick={() => setFramingPreview('camera')}>Virtual camera</button>
                  <button type="button" data-testid="hvs-preview-quality" className="rounded border border-white/20 bg-black/70 px-1.5 py-0.5 text-[8px] uppercase tracking-widest text-amber-100" onClick={() => setPreviewQuality(q => q === 'accurate' ? 'fast' : 'accurate')}>{previewQuality === 'accurate' ? 'ACCURATE' : 'FAST'}</button>
                  {programLook?.labels.map(label => (
                    <span key={label} data-testid="hvs-program-fidelity-label" className="rounded border border-white/15 bg-black/70 px-1.5 py-0.5 text-[8px] uppercase tracking-widest text-slate-400">{label}</span>
                  ))}
                  {programLook?.lutHonesty ? <span className="rounded border border-amber-400/30 bg-black/70 px-1.5 py-0.5 text-[8px] uppercase tracking-widest text-amber-200">{programLook.lutHonesty}</span> : null}
                </div>
                <div className="flex h-full items-center justify-center p-0">
                  <div
                    className={`relative h-full w-full overflow-hidden bg-black${pickMode ? ' hvs-program-pick' : ''}`}
                    style={{
                      aspectRatio: programAspect,
                      width: viewerZoom === '100' && previewAsset?.width ? Math.min(previewAsset.width, 960) : '100%',
                      maxWidth: '100%',
                      transform: viewerZoom === '100' ? 'none' : undefined,
                    }}
                    data-testid="hvs-program-canvas"
                    data-pick-mode={pickMode ? 'on' : 'off'}
                    onClick={e => {
                      if (!pickMode) return
                      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                      const x = (e.clientX - rect.left) / rect.width
                      const y = (e.clientY - rect.top) / rect.height
                      setSeedBox({ x: Math.max(0, x - 0.12), y: Math.max(0, y - 0.22), width: 0.24, height: 0.5 })
                      setPickPending(true)
                      setInspectorTab('tracking')
                      setStatus(`Subject selected at ${Math.round(x * 100)}% ${Math.round(y * 100)}% — confirm target, then run tracking.`)
                    }}
                  >
                    {preview?.gap ? (
                      <div className="h-full w-full bg-black" data-testid="hvs-gap-frame" />
                    ) : mediaUrl ? (
                      <>
                        {programLook?.svgFilterMarkup ? (
                          <svg width="0" height="0" className="absolute" aria-hidden data-testid="hvs-program-svg-filter">
                            <defs dangerouslySetInnerHTML={{ __html: programLook.svgFilterMarkup }} />
                          </svg>
                        ) : null}
                        {programLook?.invertBlur && programLook.blurPx > 0 ? (
                          <video
                            ref={blurBgRef}
                            src={mediaUrl}
                            muted
                            className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                            data-testid="hvs-program-blur-bg"
                            style={{ filter: `blur(${programLook.blurPx}px)` }}
                          />
                        ) : null}
                        <video
                        ref={videoRef}
                        src={mediaUrl}
                        className="h-full w-full object-contain"
                        muted={Boolean(programClip?.reversed || programClip?.freeze)}
                        data-testid="hvs-program-video"
                        data-blur={programLook?.blurPx ?? 0}
                        data-invert-blur={programLook?.invertBlur ? '1' : '0'}
                        data-tracker={programLook?.trackerFollows ? '1' : '0'}
                        style={{
                          filter: programLook ? composeProgramFilterCss(programLook) : (programClip ? composeProgramLookCss(programClip.color, programClip.filters) : undefined),
                          opacity: (programLook?.opacity ?? programClip?.opacity ?? 1) * (mix ? 1 - mixU : 1),
                          transform: programLook?.transformCss || (programClip ? `translate(${programClip.transform.x * 100}%, ${programClip.transform.y * 100}%) scale(${programClip.transform.scaleX}) rotate(${programClip.transform.rotation}deg)` : undefined),
                          clipPath: programLook?.clipPath ?? undefined,
                          objectPosition: followCrop && applyFollowFraming
                            ? `${((1 - followCrop.right + followCrop.left) / 2) * 100}% ${((1 - followCrop.bottom + followCrop.top) / 2) * 100}%`
                            : undefined,
                          objectFit: applyFollowFraming ? 'cover' : 'contain',
                        }}
                        onPlay={() => setPlaying(true)}
                        onPause={() => { if (playing) { /* keep state; user may have clicked pause */ } }}
                        onTimeUpdate={() => {
                          const video = videoRef.current
                          if (!playing || !programClip || programClip.reversed || programClip.freeze || !video) return
                          setPlayheadSec(programFromSourceSeconds(programClip, video.currentTime))
                          const blurBg = blurBgRef.current
                          if (blurBg && Math.abs(blurBg.currentTime - video.currentTime) > 0.05) {
                            try { blurBg.currentTime = video.currentTime } catch { /* ignore */ }
                          }
                          if (audioPreview?.panAutomation && pannerRef.current) pannerRef.current.pan.value = audioPreview.pan
                          if (gainRef.current && audioPreview) gainRef.current.gain.value = audioPreview.gain
                        }}
                      >
                        <track kind="captions" srcLang="en" label="Captions" />
                      </video>
                      {programLook?.showQualifierMask && programLook.qualifier ? (
                        <canvas
                          data-testid="hvs-program-show-mask"
                          className="pointer-events-none absolute inset-0 h-full w-full mix-blend-screen opacity-80"
                          ref={node => {
                            if (!node || !programLook.qualifier) return
                            const w = 160
                            const h = 90
                            node.width = w
                            node.height = h
                            const ctx = node.getContext('2d')
                            if (!ctx) return
                            const video = videoRef.current
                            try { if (video) ctx.drawImage(video, 0, 0, w, h) } catch { return }
                            const img = ctx.getImageData(0, 0, w, h)
                            const q = programLook.qualifier
                            for (let i = 0; i < img.data.length; i += 4) {
                              const y = (0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2]) / 255
                              const c = lumaQualifierCoverage01(y, q)
                              const v = Math.round(c * 255)
                              img.data[i] = v
                              img.data[i + 1] = v
                              img.data[i + 2] = v
                              img.data[i + 3] = 220
                            }
                            ctx.putImageData(img, 0, 0)
                          }}
                        />
                      ) : null}
                      {incomingUrl && mix ? (
                        <video
                          ref={dissolveVideoRef}
                          src={incomingUrl}
                          muted
                          data-testid="hvs-program-dissolve"
                          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                          style={{
                            filter: mix.incoming ? composeProgramLookCss(mix.incoming.color, mix.incoming.filters) : undefined,
                            opacity: (mix.incoming.opacity ?? 1) * mixU,
                            objectFit: applyFollowFraming ? 'cover' : 'contain',
                          }}
                        />
                      ) : null}
                      </>
                    ) : stillUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt="" src={stillUrl} className="h-full w-full object-contain" style={{ opacity: preview?.clip?.opacity ?? 1, transform: preview?.clip ? `scale(${preview.clip.transform.scaleX}) rotate(${preview.clip.transform.rotation}deg)` : undefined }} />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[11px] uppercase tracking-[0.28em] text-slate-600">Drop footage to preview</div>
                    )}
                    {safeAreas ? (
                      <>
                        <div data-testid="hvs-action-safe" className="pointer-events-none absolute border border-cyan-400/35" style={{ left: '5%', top: '5%', right: '5%', bottom: '5%' }} />
                        <div data-testid="hvs-title-safe" className="pointer-events-none absolute border border-amber-300/50" style={{ left: '10%', top: '10%', right: '10%', bottom: '10%' }} />
                      </>
                    ) : null}
                    {guides ? (
                      <>
                        <div className="pointer-events-none absolute left-1/3 top-0 h-full w-px bg-amber-400/20" />
                        <div className="pointer-events-none absolute left-2/3 top-0 h-full w-px bg-amber-400/20" />
                        <div className="pointer-events-none absolute left-0 top-1/3 h-px w-full bg-amber-400/20" />
                        <div className="pointer-events-none absolute left-0 top-2/3 h-px w-full bg-amber-400/20" />
                      </>
                    ) : null}
                    {(project?.timeline.overlays ?? []).filter(o => playheadSec >= toSeconds(o.start) && playheadSec < toSeconds(o.start) + toSeconds(o.duration)).map(overlay => {
                      if (overlay.kind === 'logo' && overlay.assetId) {
                        return (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={overlay.id} alt="" data-testid="hvs-program-logo" src={`/api/media-command/assets/${overlay.assetId}/file?kind=thumb`} className="pointer-events-none absolute" style={{ left: `${overlay.x * 100}%`, top: `${overlay.y * 100}%`, width: `${overlay.scale * 100}%`, opacity: overlay.opacity, transform: 'translate(-50%, -50%)' }} />
                        )
                      }
                      const style = resolveOverlayStyle(overlay, theme)
                      const wrapped = overflowLines(style, project?.timeline.width ?? 1920)
                      return (
                        <div
                          key={overlay.id}
                          data-testid={overlay.titleKind === 'lower-third' ? 'hvs-program-lower-third' : 'hvs-program-title'}
                          className="pointer-events-none absolute"
                          style={{
                            left: `${style.x * 100}%`,
                            top: `${style.y * 100}%`,
                            width: `${style.maxWidth * 100}%`,
                            transform: cssTransform(style.alignment),
                            textAlign: style.alignment,
                            color: style.color,
                            fontFamily: style.cssFontFamily,
                            fontSize: Math.max(12, style.fontSize * (activeAspect === '9:16' ? 0.72 : 0.55)),
                            fontWeight: style.fontWeight,
                            opacity: style.opacity,
                            background: style.background ?? undefined,
                            textShadow: style.shadow ? `0 0 ${style.outlineWidth}px ${style.outlineColor}` : undefined,
                            padding: style.background ? '6px 10px' : undefined,
                          }}
                        >
                          <div>{wrapped.lines.join(' ')}</div>
                          {style.secondaryText ? <div className="text-[0.7em] tracking-normal opacity-80">{style.secondaryText}</div> : null}
                        </div>
                      )
                    })}
                    {uniqueCaptionCues(project?.timeline.captionTracks[0]?.cues ?? []).filter(c => playheadSec >= toSeconds(c.start) && playheadSec < toSeconds(c.end)).map(cue => {
                      const style = resolveCaptionStyle(cue, project?.timeline.captionTracks[0], theme)
                      const wrapped = overflowLines(style, project?.timeline.width ?? 1920)
                      return (
                        <div
                          key={cue.id}
                          data-testid="hvs-program-caption"
                          className="pointer-events-none absolute"
                          style={{
                            left: `${style.x * 100}%`,
                            top: `${style.y * 100}%`,
                            width: `${style.maxWidth * 100}%`,
                            transform: cssTransform(style.alignment),
                            textAlign: style.alignment,
                            color: style.color,
                            fontFamily: style.cssFontFamily,
                            fontSize: Math.max(12, style.fontSize * (activeAspect === '9:16' ? 0.7 : 0.5)),
                            fontWeight: style.fontWeight,
                            fontStyle: style.italic ? 'italic' : 'normal',
                            background: style.background ?? undefined,
                            textShadow: style.shadow ? `0 0 ${style.outlineWidth}px ${style.outlineColor}` : undefined,
                            padding: style.background ? '4px 8px' : undefined,
                          }}
                        >{wrapped.lines.join(' ')}</div>
                      )
                    })}
                    {visibleSafeWarnings.length ? (
                      <p data-testid="hvs-safe-warning" className="pointer-events-none absolute left-2 top-8 z-20 max-w-[70%] rounded border border-amber-400/50 bg-black/70 px-2 py-1 text-[10px] uppercase tracking-widest text-amber-200">
                        WARNING · {visibleSafeWarnings[0].message}
                      </p>
                    ) : safeAreas ? (
                      <p data-testid="hvs-safe-status" className="pointer-events-none absolute left-2 top-8 z-20 text-[9px] uppercase tracking-widest text-emerald-300">SAFE</p>
                    ) : null}
                    {(showTrack || pickMode || pickPending) ? (
                      <div className="hvs-track-overlay" data-testid="hvs-track-overlay">
                        {(pickMode || pickPending) ? (
                          <div
                            className="hvs-track-box"
                            data-testid="hvs-pick-box"
                            style={{ left: `${seedBox.x * 100}%`, top: `${seedBox.y * 100}%`, width: `${seedBox.width * 100}%`, height: `${seedBox.height * 100}%` }}
                          />
                        ) : null}
                        {showTrack && subjectBox ? (
                          <>
                            <div
                              className={`hvs-track-box${trackStatus === 'TARGET LOST' ? ' hvs-track-lost' : ''}`}
                              data-testid="hvs-subject-box"
                              style={{ left: `${subjectBox.x * 100}%`, top: `${subjectBox.y * 100}%`, width: `${subjectBox.width * 100}%`, height: `${subjectBox.height * 100}%` }}
                            />
                            <div
                              className="hvs-track-center"
                              data-testid="hvs-track-center"
                              style={{ left: `${(subjectBox.x + subjectBox.width / 2) * 100}%`, top: `${(subjectBox.y + subjectBox.height / 2) * 100}%` }}
                            />
                          </>
                        ) : null}
                        {showTrack && selectedSubject && selectedSubject.keyframes.length > 1 ? (
                          <svg className="pointer-events-none absolute inset-0 h-full w-full" data-testid="hvs-track-path" viewBox="0 0 100 100" preserveAspectRatio="none">
                            <polyline
                              fill="none"
                              stroke={trackStatus === 'TARGET LOST' ? '#f59e0b' : '#5ce1ff'}
                              strokeWidth="0.6"
                              points={selectedSubject.keyframes.map(kf => `${(kf.x + kf.width / 2) * 100},${(kf.y + kf.height / 2) * 100}`).join(' ')}
                            />
                          </svg>
                        ) : null}
                        {trackStatus === 'TARGET LOST' ? (
                          <p data-testid="hvs-lost-indicator" className="absolute right-2 top-10 rounded border border-amber-400/60 bg-black/75 px-2 py-1 text-[9px] uppercase tracking-widest text-amber-200">Target lost</p>
                        ) : null}
                      </div>
                    ) : null}
                    {pickPending ? (
                      <div className="absolute bottom-2 left-1/2 z-30 flex -translate-x-1/2 gap-1" data-testid="hvs-pick-confirm">
                        <button type="button" className="rounded border border-cyan-400/50 bg-black/80 px-2 py-1 text-[9px] uppercase tracking-widest text-cyan-100" onClick={e => { e.stopPropagation(); setPickPending(false); setPickMode(false); setStatus('Target confirmed. Run tracking.') }}>Confirm target</button>
                        <button type="button" className="rounded border border-white/20 bg-black/80 px-2 py-1 text-[9px] uppercase tracking-widest text-slate-300" onClick={e => { e.stopPropagation(); setPickPending(false) }}>Retry pick</button>
                      </div>
                    ) : null}
                    {trackStatus === 'TARGET LOST' && selected && project ? (
                      <div className="absolute bottom-2 left-1/2 z-30 flex -translate-x-1/2 flex-wrap justify-center gap-1" data-testid="hvs-lost-actions">
                        <button type="button" data-testid="hvs-reacquire" className="rounded border border-amber-400/50 bg-black/80 px-2 py-1 text-[9px] uppercase tracking-widest text-amber-100" onClick={e => { e.stopPropagation(); setPickMode(true); setInspectorTab('tracking'); setStatus('Click the subject to reacquire. Prior keys are kept.') }}>Reacquire</button>
                        <button type="button" data-testid="hvs-select-new-target" className="rounded border border-amber-400/50 bg-black/80 px-2 py-1 text-[9px] uppercase tracking-widest text-amber-100" onClick={e => { e.stopPropagation(); setPickMode(true); setInspectorTab('tracking') }}>Select new target</button>
                        <button type="button" data-testid="hvs-continue-track" className="rounded border border-white/20 bg-black/80 px-2 py-1 text-[9px] uppercase tracking-widest text-slate-200" onClick={e => {
                          e.stopPropagation()
                          const box = subjectBox ?? seedBox
                          void commit([cmd({
                            kind: 'reacquireTrack',
                            clipId: selected.clip.id,
                            from: { ticks: playheadTicks, timescale: project.timeline.timescale },
                            seedBox: { x: box.x, y: box.y, width: box.width, height: box.height },
                          })])
                        }}>Continue</button>
                        <button type="button" data-testid="hvs-cancel-lost" className="rounded border border-white/20 bg-black/80 px-2 py-1 text-[9px] uppercase tracking-widest text-slate-400" onClick={e => { e.stopPropagation(); setPickMode(false); setPickPending(false) }}>Cancel</button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          {monitorMode !== 'source' ? (
            <div className="hvs-v3-transport">
              <span className="hvs-v3-tc" data-testid="hvs-program-timecode">{formatTimecode({ ticks: Math.round(playheadSec * 24000), timescale: 24000 })}</span>
              <button type="button" className="hvs-v3-icon" title="Start" onClick={() => setPlayheadSec(0)}>⏮</button>
              <button type="button" data-testid="hvs-program-frame-back" className="hvs-v3-icon" title="Frame back" onClick={() => setPlayheadSec(s => Math.max(0, s - programFrameStep))}>‹</button>
              <button type="button" data-testid="hvs-program-play" className="hvs-v3-icon" title={playing ? 'Pause' : 'Play'} onClick={() => { const v = videoRef.current; if (!v || !mediaUrl || programSpecial) { setPlaying(p => !p); return } if (playing) { v.pause(); setPlaying(false) } else { void v.play(); setPlaying(true) } }}>{playing ? '❚❚' : '▶'}</button>
              <button type="button" data-testid="hvs-program-frame-forward" className="hvs-v3-icon" title="Frame forward" onClick={() => setPlayheadSec(s => s + programFrameStep)}>›</button>
              <button type="button" className="hvs-v3-icon" title="End" onClick={() => setPlayheadSec(Math.max(0, authoredDurationSec))}>⏭</button>
              <input type="range" min={0} max={Math.max(0.1, durationSec)} step={1 / 24} value={playheadSec} onChange={e => { setPlaying(false); setPlayheadSec(Number(e.target.value)) }} className="mx-2 min-w-0 flex-1 accent-cyan-400" aria-label="Scrub playhead" data-testid="hvs-program-seek" />
              <button type="button" data-testid="hvs-safe-toggle" className="hvs-v3-icon" title="Safe area" onClick={() => setSafeAreas(v => !v)}>safe</button>
              <button type="button" className="hvs-v3-icon" title="Guides" onClick={() => setGuides(v => !v)}>grd</button>
              <button type="button" className="hvs-v3-icon" title="100%" onClick={() => setViewerZoom('100')}>1:1</button>
              {(['16:9', '9:16', '1:1'] as OutputAspect[]).map(aspect => (
                <button key={aspect} type="button" className="hvs-v3-icon" title={aspect} style={{ width: 'auto', padding: '0 4px', color: activeAspect === aspect ? '#5ce1ff' : undefined }} onClick={() => setViewerAspect(aspect)}>{aspect}</button>
              ))}
            </div>
          ) : null}
          </div>

          {aiOpen ? (
            <section className="hvs-v3-ai" data-testid="hvs-ai-director-panel">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-[rgba(61,255,138,0.16)] text-[10px] font-black text-emerald-200">AI</span>
              <div className="min-w-0 flex-1">
                <p className="sr-only">What do you want to do with this project?</p>
                <input
                  value={utterance}
                  onChange={e => setUtterance(e.target.value)}
                  placeholder="Ask Higher Vision anything..."
                  className="w-full"
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void proposeDirector() } }}
                />
              </div>
              <button type="button" className="hvs-v3-chip" title="SHELL" onClick={() => { setGenerateOpen(true); setLeftTab('library'); setUtterance('Generate B-Roll') }}>Generate B-Roll</button>
              <button type="button" className="hvs-v3-chip opacity-50" disabled title="COMING LATER">Clean Audio</button>
              <button type="button" className="hvs-v3-chip" title="Propose EditOps" onClick={() => { setUtterance('Suggest cuts'); void proposeDirector() }}>Suggest Cuts</button>
              <button type="button" className="hvs-v3-chip" onClick={() => project && void commit([cmd({ kind: 'addTitle', text: 'Coming Soon', start: { ticks: Math.round(playheadSec * project.timeline.timescale), timescale: project.timeline.timescale }, duration: { ticks: project.timeline.timescale * 3, timescale: project.timeline.timescale }, stylePreset: 'cinematic' })])}>Create Title</button>
              <button type="button" className="hvs-v3-chip" title="PARTIAL" onClick={() => { setInspectorTab('color'); setInspectorCollapsed(false) }}>Color Grade This</button>
              <button type="button" className="hvs-v3-send" title="Propose EditOps" onClick={() => void proposeDirector()}>→</button>
              <button type="button" data-testid="hvs-collapse-ai" className="hvs-v3-icon" title="Collapse AI Director" onClick={() => setAiOpen(false)}>×</button>
              {aiExpanded || pendingCommands ? (
                <div className="flex w-full flex-wrap items-center gap-1">
                  <button type="button" className="hvs-v3-chip" onClick={() => void proposeDirector()}>Propose EditOps</button>
                  <button type="button" data-testid="hvs-director-preview" className="hvs-v3-chip" disabled={!pendingCommands} onClick={() => pendingCommands && void commit(pendingCommands, true)}>Preview</button>
                  <button type="button" data-testid="hvs-director-commit" className="hvs-v3-chip" disabled={!pendingCommands} onClick={() => { if (pendingCommands) { void commit(pendingCommands); setPendingCommands(null) } }}>Commit</button>
                  <button type="button" data-testid="hvs-director-reject" className="hvs-v3-chip" onClick={() => { setPendingCommands(null); setProposalSummary('Rejected.') }}>Reject</button>
                  <button type="button" className="hvs-v3-chip" onClick={() => setAiExpanded(v => !v)}>{aiExpanded ? 'Less' : 'More'}</button>
                  {proposalSummary ? <p className="w-full text-[11px] text-amber-100">{proposalSummary}</p> : null}
                  {pendingCommands ? <pre className="max-h-16 w-full overflow-auto text-[10px] text-cyan-200">{pendingCommands.map(c => c.kind).join('\n')}</pre> : null}
                  <div className="flex flex-wrap gap-1">
                    {AI_EXAMPLES.map(example => (
                      <button key={example} type="button" className="hvs-v3-chip" onClick={() => setUtterance(example)}>{example}</button>
                    ))}
                  </div>
                </div>
              ) : (
                <button type="button" className="hvs-v3-chip" onClick={() => setAiExpanded(true)}>Expand</button>
              )}
            </section>
          ) : (
            <button type="button" className="hvs-v3-chip self-start" data-testid="hvs-show-ai" onClick={() => { setAiOpen(true); setAiExpanded(true) }}>Show AI Director</button>
          )}
        </section>

        <aside className="hvs-v3-panel hvs-v3-inspector flex" data-testid="hvs-inspector">
            <div className="hvs-v3-panel-h">
              <span>INSPECTOR</span>
              <span className="flex items-center gap-1">
                <button type="button" data-testid="hvs-collapse-inspector" className="hvs-v3-icon" title="Collapse inspector" onClick={() => setInspectorCollapsed(v => !v)}>{inspectorCollapsed ? '⟨' : '⟩'}</button>
                <button type="button" data-testid="hvs-resize-inspector" className="hvs-v3-split" aria-label="Resize inspector" onPointerDown={event => startResize('inspector', event)} />
              </span>
            </div>
            {inspectorCollapsed ? <p className="p-1 text-[9px] uppercase tracking-widest text-slate-600">Insp</p> : (
            <>
            <div className="hvs-v3-inspector-tabs">
              {(['clip', 'effects', 'presets'] as InspectorChrome[]).map(tab => (
                <button key={tab} type="button" data-active={inspectorChrome === tab} onClick={() => {
                  setInspectorChrome(tab)
                  if (tab === 'clip') setInspectorTab('transform')
                  if (tab === 'effects') setInspectorTab('effects')
                  if (tab === 'presets') setInspectorTab('color')
                }}>{tab.toUpperCase()}</button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1 border-b border-white/5 px-2 py-1">
              {(['transform', 'crop', 'speed', 'color', 'effects', 'audio', 'tracking', 'camera', 'ai'] as InspectorTab[]).map(tab => (
                <button key={tab} type="button" onClick={() => setInspectorTab(tab)} className="rounded px-1.5 py-1 text-[8px] font-bold uppercase tracking-widest" style={{ color: inspectorTab === tab ? '#3dff8a' : '#64748b' }}>{tab}</button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2 text-[12px] text-slate-300">
              {selected ? (
                <div className="mb-2 flex items-center gap-2">
                  {(previewAsset || project?.assets.find(a => a.id === selected.clip.assetId)) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt="" className="h-10 w-14 rounded object-cover" src={`/api/media-command/assets/${selected.clip.assetId}/file?kind=thumb`} />
                  ) : null}
                  <div className="min-w-0">
                    <p className="truncate text-[11px] text-slate-100">{selected.clip.name}</p>
                    <p className="text-[9px] uppercase tracking-widest text-slate-500">
                      {project?.assets.find(a => a.id === selected.clip.assetId)?.codec ?? 'media'}
                      {' · '}
                      {project?.assets.find(a => a.id === selected.clip.assetId)?.width}×{project?.assets.find(a => a.id === selected.clip.assetId)?.height}
                      {' · '}
                      {project?.assets.find(a => a.id === selected.clip.assetId)?.container}
                    </p>
                  </div>
                </div>
              ) : <p className="mb-2 text-[9px] uppercase tracking-widest text-slate-500">Inspector · {inspectorKind}</p>}
              {inspectorKind === 'marker' && selectedMarkerId && project ? (
                <div className="space-y-2" data-testid="hvs-inspector-marker">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-amber-200">MARKER</p>
                  {(() => {
                    const marker = project.timeline.markers.find(m => m.id === selectedMarkerId)
                    if (!marker) return <p>Marker missing.</p>
                    return (
                      <>
                        <label className="block text-[10px] uppercase tracking-widest">LABEL
                          <input data-testid="hvs-marker-label" className="mt-1 w-full rounded border border-white/10 bg-black/40 p-1 text-[12px]" defaultValue={marker.label} key={marker.id} onBlur={e => { if (e.target.value !== marker.label) void commit([cmd({ kind: 'updateMarker', markerId: marker.id, label: e.target.value })]) }} />
                        </label>
                        <label className="block text-[10px] uppercase tracking-widest">TIME (s)
                          <input data-testid="hvs-marker-time" type="number" step="0.0417" min={0} className="mt-1 w-full rounded border border-white/10 bg-black/40 p-1 text-[12px]" defaultValue={toSeconds(marker.time).toFixed(3)} key={`${marker.id}-t`} onBlur={e => {
                            const sec = Number(e.target.value)
                            if (!Number.isFinite(sec)) return
                            void commit([cmd({ kind: 'updateMarker', markerId: marker.id, time: { ticks: Math.round(sec * project.timeline.timescale), timescale: project.timeline.timescale } })])
                          }} />
                        </label>
                        <button type="button" data-testid="hvs-remove-marker" className="rounded border border-rose-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-rose-200" onClick={() => { void commit([cmd({ kind: 'removeMarker', markerId: marker.id })]); setSelectedMarkerId(null) }}>Remove marker</button>
                        <p className="text-[10px] text-slate-500">Manual marker. Beat detection is Phase 5 and is not this control.</p>
                      </>
                    )
                  })()}
                </div>
              ) : null}
              {!selected && inspectorTab !== 'ai' && inspectorTab !== 'camera' && inspectorTab !== 'tracking' && !selectedOverlay && !selectedCue && !selectedMarkerId ? <p>Select a clip.</p> : null}
              {inspectorKind === 'caption' && selectedCue && captionStyle ? (
                <div className="space-y-2" data-testid="hvs-inspector-caption">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-200">CAPTION</p>
                  <label className="block text-[10px] uppercase tracking-widest">TEXT
                    <textarea data-testid="hvs-caption-text" className="mt-1 w-full rounded border border-white/10 bg-black/40 p-1 text-[12px] text-amber-50" rows={3} defaultValue={selectedCue.text} key={selectedCue.id} onBlur={e => { if (e.target.value !== selectedCue.text) void commit([cmd({ kind: 'updateCaption', cueId: selectedCue.id, text: e.target.value })]) }} />
                  </label>
                  <p className="font-mono text-[10px] text-slate-400">START {formatTimecode(selectedCue.start)} · DUR {formatTimecode({ ticks: selectedCue.end.ticks - selectedCue.start.ticks, timescale: selectedCue.start.timescale })}</p>
                  <div className="flex flex-wrap gap-1" data-testid="hvs-caption-position">
                    {(Object.keys(POSITION_PRESETS) as Array<keyof typeof POSITION_PRESETS>).map(preset => (
                      <button key={preset} type="button" data-testid={`hvs-caption-pos-${preset}`} className="rounded border px-1.5 py-0.5 text-[8px] uppercase tracking-widest" style={{ borderColor: captionStyle.positionPreset === preset ? 'rgba(34,211,238,0.6)' : 'rgba(255,255,255,0.12)', color: captionStyle.positionPreset === preset ? '#67e8f9' : '#94a3b8' }} onClick={() => void commit([cmd({ kind: 'updateCaption', cueId: selectedCue.id, positionPreset: preset })])}>{preset.replace('-', ' ')}</button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(['left', 'center', 'right'] as const).map(align => (
                      <button key={align} type="button" className="rounded border px-1.5 py-0.5 text-[8px] uppercase tracking-widest" style={{ borderColor: captionStyle.alignment === align ? 'rgba(52,211,153,0.5)' : 'rgba(255,255,255,0.12)', color: captionStyle.alignment === align ? '#bbf7d0' : '#94a3b8' }} onClick={() => void commit([cmd({ kind: 'updateCaption', cueId: selectedCue.id, alignment: align })])}>{align}</button>
                    ))}
                  </div>
                  <label className="block text-[10px] uppercase tracking-widest">FONT
                    <select data-testid="hvs-caption-font" className="mt-1 w-full rounded border border-white/10 bg-black/40 p-1 text-[11px]" value={HVS_FONTS.find(f => captionStyle.fontFamily.toLowerCase().includes(f.assName.toLowerCase()))?.id ?? 'dejavu-sans'} onChange={e => {
                      const font = HVS_FONTS.find(f => f.id === e.target.value)
                      if (font) void commit([cmd({ kind: 'updateCaption', cueId: selectedCue.id, fontFamily: font.css })])
                    }}>
                      {HVS_FONTS.map(font => <option key={font.id} value={font.id}>{font.label}</option>)}
                    </select>
                  </label>
                  <RangeField label="SIZE" min={18} max={96} value={captionStyle.fontSize} onValue={value => void commit([cmd({ kind: 'updateCaption', cueId: selectedCue.id, fontSize: Math.round(value) })])} />
                  <label className="block text-[10px] uppercase tracking-widest">COLOR
                    <input data-testid="hvs-caption-color" type="color" className="ml-2 h-6 w-10" value={/^#[0-9a-f]{6}$/i.test(captionStyle.color) ? captionStyle.color : '#F6E7C1'} onChange={e => void commit([cmd({ kind: 'updateCaption', cueId: selectedCue.id, color: e.target.value })])} />
                  </label>
                  <label className="block text-[10px] uppercase tracking-widest">BACKGROUND
                    <input data-testid="hvs-caption-background" type="color" className="ml-2 h-6 w-10" value="#080400" onChange={e => void commit([cmd({ kind: 'updateCaption', cueId: selectedCue.id, background: e.target.value, backgroundOpacity: 0.55 })])} />
                  </label>
                  <button type="button" data-testid="hvs-caption-outline" className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase tracking-widest text-slate-200" onClick={() => void commit([cmd({ kind: 'updateCaption', cueId: selectedCue.id, outlineColor: '#140C04', outlineWidth: captionStyle.outlineWidth ? 0 : 2, shadow: !captionStyle.shadow })])}>{captionStyle.shadow ? 'Outline on' : 'Outline off'}</button>
                  <p data-testid="hvs-caption-safe" className="text-[10px] uppercase tracking-widest" style={{ color: visibleSafeWarnings.some(w => w.id === selectedCue.id) ? '#fbbf24' : '#6ee7b7' }}>{visibleSafeWarnings.some(w => w.id === selectedCue.id) ? 'WARNING' : 'SAFE'}</p>
                  <p className="text-[10px] text-slate-500">Committed via updateCaption. Animation is not implemented and is not shown as a working control.</p>
                </div>
              ) : null}
              {(inspectorKind === 'title' || inspectorKind === 'logo' || inspectorKind === 'graphic') && selectedOverlay ? (
                <div className="space-y-2" data-testid="hvs-inspector-title">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-amber-200">{selectedOverlay.titleKind === 'lower-third' ? 'LOWER THIRD' : selectedOverlay.kind === 'logo' ? 'LOGO' : 'TITLE'}</p>
                  {selectedOverlay.kind !== 'logo' ? (
                    <>
                      <label className="block text-[10px] uppercase tracking-widest">TEXT
                        <input data-testid="hvs-title-text" className="mt-1 w-full rounded border border-white/10 bg-black/40 p-1 text-[12px] text-amber-50" defaultValue={selectedOverlay.text ?? ''} key={`${selectedOverlay.id}-text`} onBlur={e => { if (e.target.value !== (selectedOverlay.text ?? '')) void commit([cmd({ kind: 'updateTitle', overlayId: selectedOverlay.id, text: e.target.value })]) }} />
                      </label>
                      {selectedOverlay.titleKind === 'lower-third' ? (
                        <label className="block text-[10px] uppercase tracking-widest">SECONDARY
                          <input data-testid="hvs-title-secondary" className="mt-1 w-full rounded border border-white/10 bg-black/40 p-1 text-[12px] text-amber-50" defaultValue={selectedOverlay.secondaryText ?? ''} key={`${selectedOverlay.id}-sec`} onBlur={e => void commit([cmd({ kind: 'updateTitle', overlayId: selectedOverlay.id, secondaryText: e.target.value })])} />
                        </label>
                      ) : null}
                      <div className="flex flex-wrap gap-1">
                        {TITLE_PRESETS.map(preset => (
                          <button key={preset.id} type="button" className="rounded border px-1.5 py-0.5 text-[8px] uppercase tracking-widest" style={{ borderColor: selectedOverlay.stylePreset === preset.id ? 'rgba(201,162,39,0.7)' : 'rgba(255,255,255,0.12)', color: selectedOverlay.stylePreset === preset.id ? '#f6e7c1' : '#94a3b8' }} onClick={() => void commit([cmd({ kind: 'setTitleStyle', overlayId: selectedOverlay.id, stylePreset: preset.id })])}>{preset.label.split(' ')[0]}</button>
                        ))}
                      </div>
                      <RangeField label="SIZE" min={18} max={120} value={overlayStyle?.fontSize ?? 48} onValue={value => void commit([cmd({ kind: 'updateTitle', overlayId: selectedOverlay.id, fontSize: Math.round(value) })])} />
                    </>
                  ) : null}
                  <RangeField label="X" min={0} max={1} value={selectedOverlay.x} onValue={value => void commit([cmd({ kind: 'moveTitle', overlayId: selectedOverlay.id, x: value, y: selectedOverlay.y })])} />
                  <RangeField label="Y" min={0} max={1} value={selectedOverlay.y} onValue={value => void commit([cmd({ kind: 'moveTitle', overlayId: selectedOverlay.id, x: selectedOverlay.x, y: value })])} />
                  {selectedOverlay.kind !== 'logo'
                    ? <RangeField label="SCALE" min={0.4} max={2} value={selectedOverlay.scale} onValue={value => void commit([cmd({ kind: 'updateTitle', overlayId: selectedOverlay.id, scale: value })])} />
                    : <RangeField label="SCALE" min={0.05} max={0.6} value={selectedOverlay.scale} onValue={value => void commit([cmd({ kind: 'updateTitle', overlayId: selectedOverlay.id, scale: value })])} />}
                  <p data-testid="hvs-title-safe" className="text-[10px] uppercase tracking-widest" style={{ color: visibleSafeWarnings.some(w => w.id === selectedOverlay.id) ? '#fbbf24' : '#6ee7b7' }}>{visibleSafeWarnings.some(w => w.id === selectedOverlay.id) ? 'WARNING' : 'SAFE'}</p>
                  <button type="button" className="rounded border border-amber-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-amber-100" onClick={() => void commit([cmd({ kind: 'moveTitle', overlayId: selectedOverlay.id, x: selectedOverlay.x, y: selectedOverlay.y, clampToSafe: true })])}>Move into safe area</button>
                  {selectedOverlay.kind !== 'logo' ? <button type="button" data-testid="hvs-title-remove" className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase tracking-widest text-slate-300" onClick={() => void commit([cmd({ kind: 'removeTitle', overlayId: selectedOverlay.id })])}>Remove</button> : null}
                  <p className="text-[10px] text-slate-500">Typed EditOps only. Immutable originals are not rewritten.</p>
                </div>
              ) : null}
              {inspectorTab === 'transform' && selected ? (
                <details className="hvs-v3-section" open>
                  <summary>Transform</summary>
                  <div className="mt-2 space-y-2">
                  <RangeField label="Position X" min={-1} max={1} value={selected.clip.transform.x} onValue={value => void commit([cmd({ kind: 'setTransform', clipId: selected.clip.id, transform: { x: value } })])} />
                  <RangeField label="Position Y" min={-1} max={1} value={selected.clip.transform.y} onValue={value => void commit([cmd({ kind: 'setTransform', clipId: selected.clip.id, transform: { y: value } })])} />
                  <RangeField
                    label="Scale"
                    min={0.2}
                    max={3}
                    value={selected.clip.transform.scaleX}
                    onValue={value => void commit([cmd({ kind: 'setTransform', clipId: selected.clip.id, transform: { scaleX: value, scaleY: value } })])}
                  />
                  <RangeField label="Rotation" min={-180} max={180} value={selected.clip.transform.rotation} onValue={value => void commit([cmd({ kind: 'setTransform', clipId: selected.clip.id, transform: { rotation: value } })])} />
                  <RangeField
                    label="Opacity"
                    min={0}
                    max={1}
                    value={selected.clip.opacity}
                    onValue={value => void commit([cmd({ kind: 'setOpacity', clipId: selected.clip.id, opacity: value })])}
                    testId="hvs-inspector-opacity"
                  />
                  </div>
                </details>
              ) : null}
              {selected && inspectorTab === 'transform' ? (
                <>
                  <details className="hvs-v3-section">
                    <summary>Motion</summary>
                    <p className="mt-2 text-[10px] text-slate-500">Speed / reverse / freeze live in the Motion tab. Open Speed to edit.</p>
                  </details>
                  <details className="hvs-v3-section">
                    <summary>Look</summary>
                    <p className="mt-2 text-[10px] text-slate-500">Color grade lives in Look / Color. Partial, not a fake grade engine.</p>
                  </details>
                  <details className="hvs-v3-section">
                    <summary>Camera</summary>
                    <p className="mt-2 text-[10px] text-slate-500">VirtualCamera and tracking stay on the Camera / Tracking tabs.</p>
                  </details>
                  <details className="hvs-v3-section">
                    <summary>Audio</summary>
                    <p className="mt-2 text-[10px] text-slate-500">Volume, fade, pan, and ducking live on the Audio tab.</p>
                  </details>
                </>
              ) : null}
              {inspectorTab === 'crop' && selected ? (
                <div className="space-y-2">
                  <button type="button" className="rounded border border-cyan-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-cyan-200" onClick={() => void commit([cmd({ kind: 'autoReframe', outputAspect: '9:16', mode: 'RULE_OF_THIRDS' })])}>Intelligent 9:16 reframe</button>
                  {(['left', 'top', 'right', 'bottom'] as const).map(edge => (
                    <RangeField key={edge} label={`Crop ${edge}`} min={0} max={0.45} value={selected.clip.crop[edge]} onValue={value => void commit([cmd({ kind: 'setCrop', clipId: selected.clip.id, crop: { [edge]: value } })])} />
                  ))}
                </div>
              ) : null}
              {inspectorTab === 'speed' && selected ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1">
                    {[0.5, 1, 1.25, 1.5, 2].map(s => (
                      <button key={s} type="button" data-testid={`hvs-speed-${String(s).replace('.', '')}`} className="rounded border border-white/15 px-2 py-1 text-[10px]" onClick={() => void commit([cmd({ kind: 'setSpeed', clipId: selected.clip.id, speed: { n: Math.round(s * 100), d: 100 } })])}>{s}x</button>
                    ))}
                    <button type="button" data-testid="hvs-reverse" className="rounded border border-white/15 px-2 py-1 text-[10px]" onClick={() => void commit([cmd({ kind: 'reverseClip', clipId: selected.clip.id, reversed: !selected.clip.reversed })])}>Reverse</button>
                    <button type="button" className="rounded border border-white/15 px-2 py-1 text-[10px]" onClick={() => void commit([cmd({ kind: 'freezeFrame', clipId: selected.clip.id, freeze: !selected.clip.freeze })])}>Hold freeze</button>
                    <button type="button" data-testid="hvs-create-freeze" className="rounded border border-amber-400/40 px-2 py-1 text-[10px]" onClick={() => void commit([cmd({
                      kind: 'createFreezeFrame',
                      clipId: selected.clip.id,
                      at: { ticks: Math.round((preview?.sourceSeconds ?? toSeconds(selected.clip.sourceIn)) * selected.clip.sourceIn.timescale), timescale: selected.clip.sourceIn.timescale },
                      start: fromSeconds(playheadSec, selected.clip.start.timescale),
                      duration: fromSeconds(2, selected.clip.start.timescale),
                    })])}>Freeze frame</button>
                  </div>
                  <p className="text-[10px] text-slate-500">Speed rescales timeline duration. Preview uses HTML5 playbackRate (pitch shifts). Render uses FFmpeg atempo. Reverse/freeze preview is silent; render uses areverse / omits freeze audio.</p>
                </div>
              ) : null}
              {inspectorTab === 'color' && selected ? (
                <div className="space-y-2">
                  {(['exposure', 'contrast', 'saturation', 'temperature'] as const).map(key => (
                    <RangeField
                      key={key}
                      label={key}
                      min={-1}
                      max={1}
                      value={selected.clip.color[key]}
                      onValue={value => void commit([cmd({ kind: 'applyColor', clipId: selected.clip.id, color: { [key]: value } })])}
                    />
                  ))}
                </div>
              ) : null}
              {inspectorTab === 'audio' && selected ? (
                <div className="space-y-2" data-testid="hvs-inspector-audio">
                  <RangeField
                    label="Volume"
                    min={0}
                    max={2}
                    value={selected.clip.volume}
                    testId="hvs-volume"
                    onValue={value => void commit([cmd({ kind: 'setVolume', clipId: selected.clip.id, volume: value })])}
                  />
                  <div data-testid="hvs-pan-control">
                    <RangeField
                      label={`Pan ${panLabel(selected.clip.pan)} ${selected.clip.pan.toFixed(2)}`}
                      min={-1}
                      max={1}
                      value={selected.clip.pan}
                      testId="hvs-pan"
                      onValue={value => void commit([cmd({ kind: 'setPan', clipId: selected.clip.id, pan: value })])}
                    />
                    <div className="mt-1 flex gap-1">
                      <button type="button" data-testid="hvs-pan-left" className="rounded border border-white/15 px-2 py-1 text-[10px]" onClick={() => void commit([cmd({ kind: 'setPan', clipId: selected.clip.id, pan: -1 })])}>L</button>
                      <button type="button" data-testid="hvs-pan-center" className="rounded border border-white/15 px-2 py-1 text-[10px]" onClick={() => void commit([cmd({ kind: 'setPan', clipId: selected.clip.id, pan: 0 })])}>C</button>
                      <button type="button" data-testid="hvs-pan-right" className="rounded border border-white/15 px-2 py-1 text-[10px]" onClick={() => void commit([cmd({ kind: 'setPan', clipId: selected.clip.id, pan: 1 })])}>R</button>
                    </div>
                    <p className="mt-1 text-[10px] text-slate-500">-1 full left · 0 center · +1 full right. Clip-level only. Web Audio preview; FFmpeg pan in render.</p>
                  </div>
                  <button type="button" className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase" onClick={() => void commit([cmd({ kind: 'setFade', clipId: selected.clip.id, fadeIn: { ticks: Math.round(0.4 * selected.clip.start.timescale), timescale: selected.clip.start.timescale }, fadeOut: { ticks: Math.round(0.4 * selected.clip.start.timescale), timescale: selected.clip.start.timescale } })])}>Fade in/out 0.4s</button>
                  <button type="button" className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase" onClick={() => void commit([cmd({ kind: 'duckMusic', duckDb: -8 })])}>Duck music under voice</button>
                </div>
              ) : null}
              {inspectorTab === 'effects' && selected ? (
                <div className="space-y-2" data-testid="hvs-inspector-dissolve">
                  <button type="button" className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase" onClick={() => void commit([cmd({ kind: 'applyEffect', clipId: selected.clip.id, effectId: 'glow' })])}>Apply glow</button>
                  <p className="text-[10px] uppercase tracking-widest text-slate-500">Dissolve</p>
                  {selectedTransition ? (
                    <>
                      <p className="text-[11px] text-cyan-200">{selectedTransition.kind} · {toSeconds(selectedTransition.duration).toFixed(2)}s</p>
                      <RangeField
                        label="Duration"
                        min={0.1}
                        max={2}
                        value={toSeconds(selectedTransition.duration)}
                        testId="hvs-dissolve-duration"
                        onValue={value => void commit([cmd({
                          kind: 'updateTransition',
                          transitionId: selectedTransition.id,
                          duration: fromSeconds(value, selected.clip.start.timescale),
                        })])}
                      />
                      <button type="button" data-testid="hvs-remove-dissolve" className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase" onClick={() => void commit([cmd({ kind: 'removeTransition', transitionId: selectedTransition.id })])}>Remove dissolve</button>
                    </>
                  ) : (
                    <button
                      type="button"
                      data-testid="hvs-add-dissolve"
                      className="rounded border border-amber-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-amber-100"
                      onClick={() => {
                        const pair = playheadPair
                        if (!pair || !project) return
                        void commit([cmd({
                          kind: 'addTransition',
                          outgoingClipId: pair.outgoing.id,
                          incomingClipId: pair.incoming.id,
                          transitionKind: 'dissolve',
                          duration: fromSeconds(1, project.timeline.timescale),
                        })])
                      }}
                    >Add dissolve</button>
                  )}
                  <p className="text-[10px] text-slate-500">Glow is stored only. Dissolve is a real EditOp on the cut — Program and render crossfade.</p>
                </div>
              ) : null}
              {inspectorTab === 'tracking' ? (
                <div className="space-y-2" data-testid="hvs-inspector-tracking">
                  <p className="text-[10px] uppercase tracking-widest text-slate-500">Camera / Tracking</p>
                  <p className="text-[11px] text-slate-400">FACE LOCK follows one selected real person in this clip. Not biometric ID, not cross-scene identity.</p>
                  {!selected || selected.track.kind !== 'video' ? (
                    <p className="text-[11px] text-slate-500">Select a video clip.</p>
                  ) : (
                    <>
                      <p className="text-[10px] uppercase tracking-widest text-slate-500">Track subject</p>
                      <div className="flex flex-wrap gap-1">
                        <button type="button" data-testid="hvs-track-pick" disabled={trackingBusy} className="rounded border border-cyan-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-cyan-100" onClick={() => { setPickMode(true); setPickPending(false); setStatus('Track Subject mode: click the person in Program Viewer.') }}>Track subject</button>
                        <button
                          type="button"
                          data-testid="hvs-run-track"
                          disabled={trackingBusy}
                          className="rounded border border-amber-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-amber-100"
                          onClick={() => void commit([
                            cmd({ kind: 'trackSubject', clipId: selected.clip.id, label: 'Primary talent', subjectKind: 'person', seedBox }),
                          ])}
                        >{trackingBusy ? 'Tracking…' : 'Run tracking'}</button>
                        <button type="button" disabled={!selected} className="rounded border border-amber-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-amber-100" onClick={() => selected && project && void commit([
                          cmd({ kind: 'trackSubject', clipId: selected.clip.id, label: 'Primary talent', subjectKind: 'person', seedBox }),
                          cmd({ kind: 'setVirtualCamera', mode: followMode, outputAspect: reframeAspect }),
                        ])}>Follow this person</button>
                      </div>
                      <p className="text-[10px] uppercase tracking-widest text-slate-500">Follow mode</p>
                      <div className="flex flex-wrap gap-1">
                        {FOLLOW_MODE_OPTIONS.map(mode => (
                          <button
                            key={mode.id}
                            type="button"
                            data-testid={`hvs-follow-mode-${mode.id}`}
                            className="rounded border px-1.5 py-0.5 text-[8px] uppercase tracking-widest"
                            style={{ borderColor: followMode === mode.id ? 'rgba(246,231,193,0.7)' : 'rgba(255,255,255,0.12)', color: followMode === mode.id ? '#F6E7C1' : '#94a3b8' }}
                            onClick={() => {
                              setFollowMode(mode.id)
                              if (selectedSubject) void commit([cmd({ kind: 'setVirtualCamera', mode: mode.id, outputAspect: reframeAspect, subjectId: selectedSubject.id })])
                            }}
                          >{mode.label}</button>
                        ))}
                      </div>
                      <div className="rounded border border-white/10 p-2 text-[11px] text-slate-300" data-testid="hvs-track-status">
                        <p>Status · {trackStatus}</p>
                        <p data-testid="hvs-track-confidence">Confidence · {trackConfidence == null ? '—' : `${Math.round(trackConfidence * 100)}% measured`}</p>
                        <p data-testid="hvs-track-target">Target · {selectedSubject ? `${selectedSubject.label} (${selectedSubject.kind})` : 'none'}</p>
                        <p>{selectedSubject ? `${selectedSubject.keyframes.length} keys · ${selectedSubject.status}` : 'Not tracked'}</p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <button type="button" data-testid="hvs-retrack" disabled={trackingBusy || !selectedSubject} className="rounded border border-white/20 px-2 py-1 text-[10px] uppercase tracking-widest text-slate-200" onClick={() => void commit([cmd({ kind: 'trackSubject', clipId: selected.clip.id, label: selectedSubject?.label ?? 'Primary talent', subjectKind: 'person', seedBox })])}>Retrack</button>
                        <button type="button" data-testid="hvs-clear-track" disabled={!selectedSubject} className="rounded border border-white/20 px-2 py-1 text-[10px] uppercase tracking-widest text-slate-200" onClick={() => void commit([cmd({ kind: 'clearTrack', clipId: selected.clip.id })])}>Clear track</button>
                        <button
                          type="button"
                          data-testid="hvs-correct-track"
                          disabled={!selectedSubject}
                          className="rounded border border-white/20 px-2 py-1 text-[10px] uppercase tracking-widest text-slate-200"
                          onClick={() => {
                            if (pickMode || pickPending) {
                              void commit([cmd({
                                kind: 'correctTrack',
                                clipId: selected.clip.id,
                                at: { ticks: playheadTicks, timescale: project?.timeline.timescale ?? 24000 },
                                box: seedBox,
                              })])
                              setPickMode(false)
                              setPickPending(false)
                              return
                            }
                            setPickMode(true)
                            setStatus('Click the subject to correct this frame, then press Correct again.')
                          }}
                        >Correct frame</button>
                        <button
                          type="button"
                          data-testid="hvs-inspector-reacquire"
                          disabled={!selectedSubject || trackingBusy}
                          className="rounded border border-amber-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-amber-100"
                          onClick={() => void commit([cmd({
                            kind: 'reacquireTrack',
                            clipId: selected.clip.id,
                            from: { ticks: playheadTicks, timescale: project?.timeline.timescale ?? 24000 },
                            seedBox,
                          })])}
                        >Reacquire</button>
                      </div>
                      <p className="text-[10px] uppercase tracking-widest text-slate-500">Virtual camera</p>
                      <div className="flex flex-wrap gap-1">
                        <button type="button" data-testid="hvs-vcam-enable" disabled={!selectedSubject} className="rounded border border-cyan-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-cyan-100" onClick={() => void commit([cmd({ kind: 'setVirtualCamera', mode: followMode, outputAspect: reframeAspect, subjectId: selectedSubject?.id })])}>Enable</button>
                        <button type="button" data-testid="hvs-vcam-reset" disabled={!vcam} className="rounded border border-white/20 px-2 py-1 text-[10px] uppercase tracking-widest text-slate-200" onClick={() => void commit([cmd({ kind: 'setVirtualCamera', mode: followMode, outputAspect: reframeAspect, reset: true })])}>Reset</button>
                      </div>
                      <p className="text-[10px] uppercase tracking-widest text-slate-500">Auto reframe</p>
                      <div className="flex flex-wrap gap-1">
                        {(['16:9', '9:16', '1:1'] as OutputAspect[]).map(aspect => (
                          <button
                            key={aspect}
                            type="button"
                            data-testid={`hvs-reframe-${aspect}`}
                            className="rounded border px-1.5 py-0.5 text-[8px] uppercase tracking-widest"
                            style={{ borderColor: reframeAspect === aspect ? 'rgba(92,225,255,0.7)' : 'rgba(255,255,255,0.12)', color: reframeAspect === aspect ? '#5ce1ff' : '#94a3b8' }}
                            onClick={() => setReframeAspect(aspect)}
                          >{aspect}</button>
                        ))}
                        <button type="button" data-testid="hvs-auto-reframe" disabled={!selectedSubject} className="rounded border border-cyan-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-cyan-100" onClick={() => void commit([cmd({ kind: 'autoReframe', outputAspect: reframeAspect, mode: followMode, subjectId: selectedSubject?.id })])}>Auto reframe</button>
                      </div>
                      {vcam ? (
                        <div className="text-[10px] text-slate-400" data-testid="hvs-vcam-keys">
                          <p>{vcam.name} · {cameraSummary.keyCount} keys</p>
                          <p>Start {cameraSummary.startSec == null ? '—' : cameraSummary.startSec.toFixed(2)}s → {cameraSummary.endSec == null ? '—' : cameraSummary.endSec.toFixed(2)}s</p>
                          <p>Crop move {cameraSummary.cropDelta.toFixed(3)} · zoom {cameraSummary.zoomDelta.toFixed(3)}</p>
                        </div>
                      ) : <p className="text-[10px] text-slate-500">No VirtualCamera. Enable after tracking.</p>}
                    </>
                  )}
                </div>
              ) : null}
              {inspectorTab === 'camera' ? (
                <div className="space-y-2 text-[11px] text-slate-400" data-testid="hvs-inspector-camera">
                  <p>Multicam ≠ CameraSpec ≠ Virtual Camera. Framing uses TrackSubject crop keys — not CSS-only camera.</p>
                  {(project?.timeline.virtualCameras ?? []).map(cam => <p key={cam.id} className="text-cyan-200">{cam.name} · {cam.mode} · {cam.outputAspect} · {cam.keyframes.length} keys</p>)}
                  <div className="flex flex-wrap gap-1">
                    <button type="button" disabled={!selectedSubject} className="rounded border border-cyan-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-cyan-200" onClick={() => void commit([cmd({ kind: 'setVirtualCamera', mode: followMode, outputAspect: reframeAspect })])}>Enable VirtualCamera</button>
                    <button type="button" className="rounded border border-cyan-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-cyan-200" onClick={() => void commit([cmd({ kind: 'autoReframe', outputAspect: '9:16', mode: followMode })])}>9:16 cinematic follow</button>
                    <button type="button" disabled={!vcam} className="rounded border border-white/20 px-2 py-1 text-[10px] uppercase tracking-widest" onClick={() => void commit([cmd({ kind: 'setVirtualCamera', mode: followMode, outputAspect: reframeAspect, reset: true })])}>Reset</button>
                  </div>
                  {vcam ? <p data-testid="hvs-camera-key-summary">{cameraSummary.keyCount} keys · crop Δ {cameraSummary.cropDelta.toFixed(3)}</p> : null}
                </div>
              ) : null}
              {inspectorTab === 'ai' ? (
                <p className="text-[11px] text-slate-500">AI Director is docked under the viewer. It proposes typed EditOps only.</p>
              ) : null}
            </div>
            </>
            )}
          </aside>
      </div>

      {workspaceMode !== 'viewer' ? (
        <button type="button" data-testid="hvs-resize-timeline" className="hvs-v3-split-y mx-2" aria-label="Resize timeline" onPointerDown={event => startResize('timeline', event)} />
      ) : null}

      {workspaceMode !== 'viewer' ? (
      <div className="hvs-v3-timeline overflow-hidden">
      <HvsTimeline
        project={project}
        playheadSec={playheadSec}
        durationSec={durationSec}
        pxPerSec={pxPerSec}
        selectedClipId={selectedClipId}
        selectedOverlayId={selectedOverlayId}
        selectedCueId={selectedCueId}
        selectedMarkerId={selectedMarkerId}
        snapEnabled={snapEnabled}
        playheadFollow={playheadFollow}
        scrollerRef={scrollerRef}
        expanded={workspaceMode === 'timeline'}
        onSelectClip={id => { setSelectedClipId(id); setSelectedOverlayId(null); setSelectedCueId(null); setSelectedMarkerId(null) }}
        onSelectOverlay={id => { setSelectedOverlayId(id); setSelectedClipId(null); setSelectedCueId(null); setSelectedMarkerId(null) }}
        onSelectCue={id => { setSelectedCueId(id); setSelectedClipId(null); setSelectedOverlayId(null); setSelectedMarkerId(null) }}
        onSeek={setPlayheadSec}
        onZoomIn={() => setPxPerSec(v => Math.min(320, v * 1.25))}
        onZoomOut={() => setPxPerSec(v => Math.max(16, v / 1.25))}
        onFit={fitTimeline}
        onToggleFollow={() => setPlayheadFollow(v => !v)}
        onDropAsset={(track, assetId, startSec) => void commit([cmd({ kind: 'insertClip', trackId: track.id, assetId, start: { ticks: Math.round(startSec * (project?.timeline.timescale ?? 24000)), timescale: project?.timeline.timescale ?? 24000 } })])}
        onMove={(clip, startSec, trackId) => void commit([cmd({ kind: 'moveClip', clipId: clip.id, trackId, start: { ticks: Math.round(startSec * clip.start.timescale), timescale: clip.start.timescale } })])}
        onSplit={(clip, atSec) => void commit([cmd({ kind: 'splitClip', clipId: clip.id, at: { ticks: Math.round((atSec ?? playheadSec) * clip.start.timescale), timescale: clip.start.timescale } })])}
        onRipple={clip => { void commit([cmd({ kind: 'rippleDelete', clipId: clip.id })]) }}
        onTrim={(clip, edge) => { void commit([cmd({ kind: 'trimClip', clipId: clip.id, edge, to: { ticks: Math.round(playheadSec * clip.start.timescale), timescale: clip.start.timescale } })]) }}
        onUndo={() => void commit([cmd({ kind: 'undo' })])}
        onRedo={() => void commit([cmd({ kind: 'redo' })])}
        onAppend={() => {
          if (!project) return
          const asset = project.assets.find(a => a.id === selectedAssetId) ?? project.assets.find(a => a.kind === 'video') ?? project.assets[0]
          const track = selected?.track ?? project.timeline.tracks.find(t => t.kind === 'video') ?? project.timeline.tracks[0]
          if (!asset || !track) return
          void commit([cmd({ kind: 'appendClip', trackId: track.id, assetId: asset.id })])
        }}
        onOverwrite={() => {
          if (!project) return
          const asset = project.assets.find(a => a.id === selectedAssetId) ?? project.assets.find(a => a.kind === 'video') ?? project.assets[0]
          const track = selected?.track ?? project.timeline.tracks.find(t => t.kind === 'video') ?? project.timeline.tracks[0]
          if (!asset || !track) return
          void commit([cmd({
            kind: 'overwriteClip',
            trackId: track.id,
            assetId: asset.id,
            start: { ticks: Math.round(playheadSec * project.timeline.timescale), timescale: project.timeline.timescale },
            duration: asset.duration,
          })])
        }}
        onReplace={() => {
          if (!project || !selected) return
          const asset = project.assets.find(a => a.id === selectedAssetId) ?? project.assets.find(a => a.id !== selected.clip.assetId)
          if (!asset) return
          void commit([cmd({ kind: 'replaceAsset', clipId: selected.clip.id, assetId: asset.id })])
        }}
        onLift={clip => void commit([cmd({ kind: 'liftClip', clipId: clip.id })])}
        onExtract={clip => void commit([cmd({ kind: 'extractClip', clipId: clip.id })])}
        onRippleTrim={(clip, edge) => void commit([cmd({ kind: 'rippleTrim', clipId: clip.id, edge, to: { ticks: Math.round(playheadSec * clip.start.timescale), timescale: clip.start.timescale } })])}
        onRoll={clip => {
          if (!project) return
          const track = project.timeline.tracks.find(t => t.clips.some(c => c.id === clip.id))
          const sorted = [...(track?.clips ?? [])].sort((a, b) => a.start.ticks - b.start.ticks)
          const index = sorted.findIndex(c => c.id === clip.id)
          const incoming = sorted[index + 1]
          if (!incoming) return
          void commit([cmd({
            kind: 'rollEdit',
            outgoingClipId: clip.id,
            incomingClipId: incoming.id,
            to: { ticks: Math.round(playheadSec * clip.start.timescale), timescale: clip.start.timescale },
          })])
        }}
        onSlip={(clip, seconds) => void commit([cmd({ kind: 'slipClip', clipId: clip.id, delta: { ticks: Math.round(seconds * clip.start.timescale), timescale: clip.start.timescale } })])}
        onSlide={(clip, seconds) => void commit([cmd({
          kind: 'slideClip',
          clipId: clip.id,
          start: { ticks: clip.start.ticks + Math.round(seconds * clip.start.timescale), timescale: clip.start.timescale },
        })])}
        onExtend={clip => void commit([cmd({ kind: 'extendEdit', clipId: clip.id, to: { ticks: Math.round(playheadSec * clip.start.timescale), timescale: clip.start.timescale } })])}
        onDuplicate={clip => void commit([cmd({ kind: 'duplicateClip', clipId: clip.id })])}
        onMarker={() => project && void commit([cmd({ kind: 'addMarker', time: { ticks: Math.round(playheadSec * project.timeline.timescale), timescale: project.timeline.timescale }, label: 'Marker' })])}
        onSelectMarker={id => { setSelectedMarkerId(id); setSelectedClipId(null); setSelectedOverlayId(null); setSelectedCueId(null) }}
        onMoveMarker={(id, sec) => project && void commit([cmd({ kind: 'updateMarker', markerId: id, time: { ticks: Math.round(sec * project.timeline.timescale), timescale: project.timeline.timescale } })])}
        onToggleSnap={() => setSnapEnabled(v => !v)}
        onLogo={() => {
          const logo = project?.assets.find(a => a.kind === 'logo' && !a.provenance?.parentAssetId) ?? project?.assets.find(a => a.kind === 'logo')
          if (!logo || !project) return
          let end = 2.4
          for (const track of project.timeline.tracks) {
            for (const clip of track.clips) end = Math.max(end, toSeconds(clip.start) + toSeconds(clip.duration))
          }
          const start = Math.max(0, end - 2.4)
          void commit([cmd({ kind: 'addLogo', assetId: logo.id, start: { ticks: Math.round(start * project.timeline.timescale), timescale: project.timeline.timescale }, duration: { ticks: Math.round(2.4 * project.timeline.timescale), timescale: project.timeline.timescale } })])
        }}
        onCaption={() => project && void commit([cmd({ kind: 'addCaption', start: { ticks: Math.round(playheadSec * project.timeline.timescale), timescale: project.timeline.timescale }, end: { ticks: Math.round((playheadSec + 2.5) * project.timeline.timescale), timescale: project.timeline.timescale }, text: HVS_DEMO_CAPTION })])}
        onTitle={() => project && void commit([cmd({ kind: 'addTitle', text: 'Coming Soon', start: { ticks: Math.round(playheadSec * project.timeline.timescale), timescale: project.timeline.timescale }, duration: { ticks: project.timeline.timescale * 3, timescale: project.timeline.timescale }, stylePreset: 'cinematic' })])}
        onLowerThird={() => project && void commit([cmd({ kind: 'addLowerThird', text: 'HIGHER VISION', secondaryText: 'Studios', start: { ticks: Math.round(playheadSec * project.timeline.timescale), timescale: project.timeline.timescale }, duration: { ticks: project.timeline.timescale * 4, timescale: project.timeline.timescale } })])}
        onDissolve={() => {
          const pair = playheadPair
          if (!pair || !project) return
          void commit([cmd({
            kind: 'addTransition',
            outgoingClipId: pair.outgoing.id,
            incomingClipId: pair.incoming.id,
            transitionKind: 'dissolve',
            duration: fromSeconds(1, project.timeline.timescale),
          })])
        }}
        onDuck={() => void commit([cmd({ kind: 'duckMusic', duckDb: -8 })])}
        onRender16={() => void renderAspectTarget('16:9')}
        onRender9={() => void renderAspectTarget('9:16')}
        waveforms={waveforms}
      />
      </div>
      ) : null}
      <nav className="hvs-v3-phone" data-testid="hvs-phone-nav">
        <button type="button" className="hvs-v3-chip" onClick={() => { setPhonePane('view'); setWorkspaceMode('viewer') }}>VIEW</button>
        <button type="button" className="hvs-v3-chip" onClick={() => { setPhonePane('media'); setWorkspaceMode('edit'); setMediaCollapsed(false); setInspectorCollapsed(true) }}>MEDIA</button>
        <button type="button" className="hvs-v3-chip" onClick={() => { setPhonePane('ai'); setAiOpen(true); setAiExpanded(true); setWorkspaceMode('edit') }}>AI</button>
        <button type="button" className="hvs-v3-chip" onClick={() => { setPhonePane('timeline'); setWorkspaceMode('timeline') }}>TIMELINE</button>
        <button type="button" className="hvs-v3-chip" onClick={() => { setPhonePane('render'); setStudioChrome('render') }}>RENDER</button>
      </nav>
      </div>
    </div>
  )
}

function HvsTimeline({
  project,
  playheadSec,
  durationSec,
  pxPerSec,
  selectedClipId,
  selectedOverlayId,
  selectedCueId,
  selectedMarkerId,
  snapEnabled,
  playheadFollow,
  scrollerRef,
  expanded,
  onSelectClip,
  onSelectOverlay,
  onSelectCue,
  onSeek,
  onZoomIn,
  onZoomOut,
  onFit,
  onToggleFollow,
  onDropAsset,
  onMove,
  onSplit,
  onRipple,
  onTrim,
  onLogo,
  onCaption,
  onTitle,
  onLowerThird,
  onDissolve,
  onDuck,
  onUndo,
  onRedo,
  onAppend,
  onOverwrite,
  onReplace,
  onLift,
  onExtract,
  onRippleTrim,
  onRoll,
  onSlip,
  onSlide,
  onExtend,
  onDuplicate,
  onMarker,
  onSelectMarker,
  onMoveMarker,
  onToggleSnap,
  onRender16,
  onRender9,
  waveforms,
}: {
  project: HvsProject | null
  playheadSec: number
  durationSec: number
  pxPerSec: number
  selectedClipId: string | null
  selectedOverlayId: string | null
  selectedCueId: string | null
  selectedMarkerId: string | null
  snapEnabled: boolean
  playheadFollow: boolean
  scrollerRef: RefObject<HTMLDivElement | null>
  expanded: boolean
  onSelectClip: (id: string) => void
  onSelectOverlay: (id: string) => void
  onSelectCue: (id: string) => void
  onSeek: (sec: number) => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  onToggleFollow: () => void
  onDropAsset: (track: Track, assetId: string, startSec: number) => void
  onMove: (clip: Clip, startSec: number, trackId: string) => void
  onSplit: (clip: Clip, atSec?: number) => void
  onRipple: (clip: Clip) => void
  onTrim: (clip: Clip, edge: 'in' | 'out') => void
  onLogo: () => void
  onCaption: () => void
  onTitle: () => void
  onLowerThird: () => void
  onDissolve: () => void
  onDuck: () => void
  onUndo: () => void
  onRedo: () => void
  onAppend: () => void
  onOverwrite: () => void
  onReplace: () => void
  onLift: (clip: Clip) => void
  onExtract: (clip: Clip) => void
  onRippleTrim: (clip: Clip, edge: 'in' | 'out') => void
  onRoll: (clip: Clip) => void
  onSlip: (clip: Clip, seconds: number) => void
  onSlide: (clip: Clip, seconds: number) => void
  onExtend: (clip: Clip) => void
  onDuplicate: (clip: Clip) => void
  onMarker: () => void
  onSelectMarker: (id: string) => void
  onMoveMarker: (id: string, sec: number) => void
  onToggleSnap: () => void
  onRender16: () => void
  onRender9: () => void
  waveforms: Record<string, number[]>
}) {
  const [more, setMore] = useState(false)
  const [timelineTool, setTimelineTool] = useState<'select' | 'blade'>('select')
  const width = Math.max(800, durationSec * pxPerSec)
  const clip = project?.timeline.tracks.flatMap(t => t.clips).find(c => c.id === selectedClipId)
  const rulerMarks: number[] = []
  const step = pxPerSec >= 80 ? 1 : pxPerSec >= 40 ? 2 : 5
  for (let t = 0; t <= durationSec; t += step) rulerMarks.push(t)
  return (
    <section className={`hvs-v3-panel h-full overflow-hidden ${expanded ? 'min-h-[22rem]' : ''}`} data-testid="hvs-timeline">
      <div className="flex flex-wrap items-center gap-1 border-b border-white/5 px-2 py-1" data-testid="hvs-timeline-tools">
        <button type="button" data-testid="hvs-tool-select" className="hvs-v3-icon" title="Select" aria-label="Select" aria-pressed={timelineTool === 'select'} onClick={() => setTimelineTool('select')} style={{ color: timelineTool === 'select' ? '#3dff8a' : undefined }}>↖</button>
        <button type="button" data-testid="hvs-tool-blade" className="hvs-v3-icon" title="Blade" aria-label="Blade" aria-pressed={timelineTool === 'blade'} onClick={() => setTimelineTool('blade')} style={{ color: timelineTool === 'blade' ? '#3dff8a' : undefined }}>✂</button>
        <button type="button" className="hvs-v3-icon" title="Trim in" aria-label="Trim" onClick={() => { if (clip) onTrim(clip, 'in') }}>┤</button>
        <button type="button" data-testid="hvs-snap-toggle" aria-pressed={snapEnabled} className="hvs-v3-icon" title={snapEnabled ? 'Snap on' : 'Snap off'} onClick={onToggleSnap} style={{ color: snapEnabled ? '#3dff8a' : undefined }}>⌖</button>
        <button type="button" data-testid="hvs-add-dissolve-tool" className="hvs-v3-chip" title="Add dissolve" onClick={onDissolve}>Dissolve</button>
        <button type="button" data-testid="hvs-add-marker" className="hvs-v3-icon" title="Marker" onClick={onMarker}>◆</button>
        <button type="button" data-testid="hvs-undo" className="hvs-v3-icon" title="Undo" onClick={onUndo}>↶</button>
        <button type="button" data-testid="hvs-redo" className="hvs-v3-icon" title="Redo" onClick={onRedo}>↷</button>
        <span className="mx-1 h-4 w-px bg-white/10" />
        <button type="button" data-testid="hvs-timeline-zoom-out" aria-label="Zoom out" className="hvs-v3-icon" title="Zoom out" onClick={onZoomOut}>−</button>
        <button type="button" data-testid="hvs-timeline-zoom-in" aria-label="Zoom in" className="hvs-v3-icon" title="Zoom in" onClick={onZoomIn}>+</button>
        <button type="button" data-testid="hvs-timeline-fit" aria-label="Fit timeline" className="hvs-v3-icon" title="Fit timeline" onClick={onFit}>Fit</button>
        <button type="button" className="hvs-v3-icon" title="Follow playhead" onClick={onToggleFollow} style={{ color: playheadFollow ? '#3dff8a' : undefined }}>⊙</button>
        <button type="button" className="hvs-v3-chip" onClick={() => setMore(v => !v)}>{more ? 'Less' : 'More'}</button>
        {more ? (
          <>
            <button type="button" className="hvs-v3-chip" onClick={() => { if (clip) onTrim(clip, 'out') }}>Trim out</button>
            <button type="button" className="hvs-v3-chip" onClick={() => { if (clip) onRipple(clip) }}>Ripple delete</button>
            <button type="button" data-testid="hvs-append" className="hvs-v3-chip" onClick={onAppend}>Append</button>
            <button type="button" data-testid="hvs-overwrite" className="hvs-v3-chip" onClick={onOverwrite}>Overwrite</button>
            <button type="button" data-testid="hvs-replace" className="hvs-v3-chip" onClick={onReplace}>Replace</button>
            <button type="button" data-testid="hvs-lift" className="hvs-v3-chip" onClick={() => { if (clip) onLift(clip) }}>Lift</button>
            <button type="button" data-testid="hvs-extract" className="hvs-v3-chip" onClick={() => { if (clip) onExtract(clip) }}>Extract</button>
            <button type="button" data-testid="hvs-ripple-trim" className="hvs-v3-chip" onClick={() => { if (clip) onRippleTrim(clip, 'out') }}>Ripple trim</button>
            <button type="button" data-testid="hvs-roll" className="hvs-v3-chip" onClick={() => { if (clip) onRoll(clip) }}>Roll</button>
            <button type="button" data-testid="hvs-slip" className="hvs-v3-chip" onClick={() => { if (clip) onSlip(clip, 0.25) }}>Slip</button>
            <button type="button" data-testid="hvs-slide" className="hvs-v3-chip" onClick={() => { if (clip) onSlide(clip, 0.25) }}>Slide</button>
            <button type="button" data-testid="hvs-extend" className="hvs-v3-chip" onClick={() => { if (clip) onExtend(clip) }}>Extend</button>
            <button type="button" data-testid="hvs-duplicate" className="hvs-v3-chip" onClick={() => { if (clip) onDuplicate(clip) }}>Duplicate</button>
            <button type="button" data-testid="hvs-add-caption" className="hvs-v3-chip" onClick={onCaption}>Caption</button>
            <button type="button" data-testid="hvs-add-title" className="hvs-v3-chip" onClick={onTitle}>Title</button>
            <button type="button" data-testid="hvs-add-lower-third" className="hvs-v3-chip" onClick={onLowerThird}>Lower third</button>
            <button type="button" data-testid="hvs-timeline-dissolve" className="hvs-v3-chip" onClick={onDissolve}>Dissolve</button>
            <button type="button" className="hvs-v3-chip" onClick={onLogo}>Logo</button>
            <button type="button" className="hvs-v3-chip" onClick={onDuck}>Duck music</button>
            <button type="button" className="hvs-v3-chip" onClick={() => {
              const music = project?.assets.find(a => a.kind === 'audio')
              if (!music || !project) return
              onDropAsset(project.timeline.tracks.find(t => t.id === 'A2') ?? project.timeline.tracks[3], music.id, 0)
            }}>Add music</button>
            <button type="button" className="hvs-v3-chip" onClick={onRender16}>Render 16:9</button>
            <button type="button" className="hvs-v3-chip" onClick={onRender9}>Render 9:16</button>
          </>
        ) : null}
      </div>
      <div className="flex min-w-0" data-testid="hvs-timeline-body">
        <div className="w-24 shrink-0 border-r border-white/5 bg-[#050607]" data-testid="hvs-track-label-rail">
          <div className="h-6 border-b border-white/5" />
          {(project?.timeline.tracks ?? []).map(track => (
            <div
              key={track.id}
              className="pointer-events-none flex h-12 items-center px-2 text-[9px] font-bold uppercase tracking-widest text-slate-500"
              data-testid="hvs-track-label"
            >
              {trackDisplayName(track)}
            </div>
          ))}
          <div className="pointer-events-none flex h-10 items-center px-2 text-[9px] font-bold uppercase tracking-widest text-slate-500">TITLE</div>
          <div className="pointer-events-none flex h-10 items-center px-2 text-[9px] font-bold uppercase tracking-widest text-slate-500">CAPTION</div>
        </div>
        <div ref={scrollerRef} className="min-w-0 flex-1 overflow-x-auto" data-testid="hvs-timeline-scroller">
          <div
            className="relative"
            style={{ width }}
            onClick={e => {
              const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
              onSeek(Math.max(0, (e.clientX - rect.left) / pxPerSec))
            }}
          >
            <div className="relative h-6 border-b border-white/10 bg-[#080604]" data-testid="hvs-time-ruler">
              {rulerMarks.map(mark => (
                <span key={mark} className="pointer-events-none absolute top-0 h-full border-l border-white/15 pl-1 font-mono text-[8px] text-slate-500" style={{ left: mark * pxPerSec }}>{formatTimecode({ ticks: Math.round(mark * 24000), timescale: 24000 }).slice(3, 8)}</span>
              ))}
            </div>
            <div className="pointer-events-none absolute top-0 z-10 h-full w-px hvs-v3-playhead" style={{ left: playheadSec * pxPerSec }} />
            <div className="hvs-v3-playhead-badge" style={{ left: playheadSec * pxPerSec }}>{formatTimecode({ ticks: Math.round(playheadSec * 24000), timescale: 24000 }).slice(0, 11)}</div>
            {(project?.timeline.markers ?? []).map(marker => (
              <button
                key={marker.id}
                type="button"
                data-testid="hvs-marker"
                data-marker-id={marker.id}
                className="absolute top-0 z-20 h-full border-l"
                style={{
                  left: toSeconds(marker.time) * pxPerSec,
                  width: Math.max(8, toSeconds(marker.duration) * pxPerSec),
                  borderColor: selectedMarkerId === marker.id ? '#fde68a' : (marker.color || '#fbbf24'),
                  background: toSeconds(marker.duration) > 0 ? 'rgba(251,191,36,0.12)' : 'transparent',
                  boxShadow: selectedMarkerId === marker.id ? '0 0 0 1px #fde68a' : undefined,
                }}
                title={marker.label}
                onClick={e => {
                  e.stopPropagation()
                  onSelectMarker(marker.id)
                  onSeek(toSeconds(marker.time))
                }}
                onPointerDown={e => {
                  if (e.button !== 0) return
                  e.stopPropagation()
                  const lane = (e.currentTarget.parentElement as HTMLElement | null)?.getBoundingClientRect()
                  const move = (ev: PointerEvent) => {
                    if (!lane) return
                    onMoveMarker(marker.id, Math.max(0, (ev.clientX - lane.left) / pxPerSec))
                  }
                  const up = () => {
                    window.removeEventListener('pointermove', move)
                    window.removeEventListener('pointerup', up)
                  }
                  window.addEventListener('pointermove', move)
                  window.addEventListener('pointerup', up)
                }}
              />
            ))}
            {(project?.timeline.tracks ?? []).map(track => (
              <div
                key={track.id}
                className="relative h-12 border-b border-white/5"
                data-testid={`hvs-track-lane-${track.id}`}
                onDragOver={e => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                }}
                onDrop={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                  const rawStart = Math.max(0, (e.clientX - rect.left) / pxPerSec)
                  const startSec = snapTimelineSeconds(rawStart, project, pxPerSec, snapEnabled, playheadSec)
                  const clipRaw = e.dataTransfer.getData('application/hvs-clip') || e.dataTransfer.getData('text/plain')
                  if (clipRaw) {
                    try {
                      const payload = clipRaw.startsWith('{') ? JSON.parse(clipRaw) as { clipId: string } : { clipId: clipRaw }
                      const clip = project?.timeline.tracks.flatMap(t => t.clips).find(c => c.id === payload.clipId)
                      if (clip) onMove(clip, startSec, track.id)
                    } catch { /* ignore malformed drag payload */ }
                    return
                  }
                  const assetId = e.dataTransfer.getData('application/hvs-asset')
                  if (!assetId) return
                  onDropAsset(track, assetId, startSec)
                }}
              >
                {track.clips.map(clip => {
                  const left = toSeconds(clip.start) * pxPerSec
                  const widthPx = Math.max(32, toSeconds(clip.duration) * pxPerSec)
                  const thumb = track.kind === 'video' || track.kind === 'graphics'
                    ? `/api/media-command/assets/${clip.assetId}/file?kind=thumb`
                    : undefined
                  return (
                    <button
                      key={clip.id}
                      type="button"
                      draggable={timelineTool !== 'blade'}
                      data-testid="hvs-timeline-clip"
                      data-clip-id={clip.id}
                      data-clip-start={String(toSeconds(clip.start))}
                      onDragStart={e => {
                        if (timelineTool === 'blade') {
                          e.preventDefault()
                          return
                        }
                        e.stopPropagation()
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('application/hvs-clip', JSON.stringify({ clipId: clip.id, trackId: track.id }))
                        e.dataTransfer.setData('text/plain', clip.id)
                      }}
                      onClick={e => {
                        e.stopPropagation()
                        if (timelineTool === 'blade') {
                          const lane = (e.currentTarget.parentElement as HTMLElement | null)?.getBoundingClientRect()
                          const atSec = lane ? Math.max(0, (e.clientX - lane.left) / pxPerSec) : undefined
                          onSplit(clip, atSec)
                          return
                        }
                        onSelectClip(clip.id)
                      }}
                      className="absolute top-1 z-20 h-10 cursor-grab overflow-hidden rounded border px-1 text-left text-[10px] active:cursor-grabbing"
                      style={{
                        left,
                        width: widthPx,
                        borderColor: selectedClipId === clip.id ? 'rgba(61,255,138,0.95)' : track.kind === 'graphics' ? 'rgba(167,139,250,0.4)' : 'rgba(255,255,255,0.12)',
                        background: track.kind === 'audio' ? 'rgba(92,225,255,0.12)' : track.kind === 'graphics' ? 'rgba(124,92,255,0.18)' : 'rgba(61,255,138,0.08)',
                        boxShadow: selectedClipId === clip.id ? '0 0 0 1px rgba(61,255,138,0.7)' : undefined,
                        color: '#e8edf2',
                        backgroundImage: thumb ? `linear-gradient(90deg, rgba(8,6,4,0.28), rgba(8,6,4,0.12)), url(${thumb})` : undefined,
                        backgroundRepeat: thumb ? 'no-repeat, repeat-x' : undefined,
                        backgroundSize: thumb ? '100% 100%, 56px 100%' : undefined,
                      }}
                    >
                      {clip.name}
                      {track.kind === 'video' && project?.timeline.subjects.some(s => s.clipId === clip.id) ? (
                        <span
                          data-testid="hvs-track-strip"
                          className="hvs-track-strip"
                          style={{
                            background: (() => {
                              const sub = project.timeline.subjects.find(s => s.clipId === clip.id)
                              if (!sub) return '#3dff8a'
                              const stops = [...sub.keyframes]
                                .sort((a, b) => a.time.ticks - b.time.ticks)
                                .map(kf => {
                                  const u = Math.max(0, Math.min(1, (toSeconds(kf.time) - toSeconds(clip.start)) / Math.max(0.001, toSeconds(clip.duration))))
                                  const color = kf.confidence < 0.32 ? '#f59e0b' : sub.humanCorrected && kf.confidence >= 0.9 ? '#67e8f9' : '#3dff8a'
                                  return `${color} ${u * 100}%`
                                })
                              return stops.length ? `linear-gradient(90deg, ${stops.join(', ')})` : '#3dff8a'
                            })(),
                          }}
                        />
                      ) : null}
                      {track.kind === 'audio' && waveforms[clip.assetId] ? (
                        <span className="pointer-events-none mt-0.5 flex h-3 items-end gap-px">
                          {waveforms[clip.assetId].slice(0, 48).map((s, i) => (
                            <span key={i} className="inline-block w-px bg-cyan-300/80" style={{ height: `${Math.max(10, s * 100)}%` }} />
                          ))}
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            ))}
            <div className="relative h-10 border-b border-white/5">
              {(project?.timeline.overlays ?? []).map(overlay => (
                <button
                  key={overlay.id}
                  type="button"
                  className="absolute top-1 h-8 overflow-hidden rounded border px-1 text-left text-[10px] text-amber-100"
                  style={{
                    left: toSeconds(overlay.start) * pxPerSec,
                    width: Math.max(32, toSeconds(overlay.duration) * pxPerSec),
                    borderColor: selectedOverlayId === overlay.id ? 'rgba(61,255,138,0.8)' : 'rgba(167,139,250,0.4)',
                    background: 'rgba(124,92,255,0.22)',
                    color: '#e9e4ff',
                  }}
                  onClick={e => { e.stopPropagation(); onSelectOverlay(overlay.id) }}
                >
                  {overlay.kind === 'logo' ? 'LOGO' : overlay.titleKind === 'lower-third' ? `LOWER THIRD · ${overlay.text || ''}` : `TITLE · ${overlay.text || overlay.kind}`}
                </button>
              ))}
            </div>
            <div className="relative h-10 border-b border-white/5">
              {(project?.timeline.captionTracks[0]?.cues ?? []).map(cue => (
                <button
                  key={cue.id}
                  type="button"
                  className="absolute top-1 h-8 overflow-hidden rounded border border-cyan-400/30 bg-cyan-950/40 px-1 text-left text-[10px] text-cyan-100"
                  style={{
                    left: toSeconds(cue.start) * pxPerSec,
                    width: Math.max(8, (toSeconds(cue.end) - toSeconds(cue.start)) * pxPerSec),
                    outline: selectedCueId === cue.id ? '1px solid #67e8f9' : undefined,
                  }}
                  onClick={e => { e.stopPropagation(); onSelectCue(cue.id) }}
                >
                  CAPTION · {cue.text}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <p className="hidden">{HVS_DEMO_THEME_LABEL}</p>
    </section>
  )
}

function snapTimelineSeconds(seconds: number, project: HvsProject | null | undefined, pxPerSec: number, enabled = true, playheadSec = 0): number {
  if (!project || !enabled) return Math.max(0, seconds)
  const threshold = Math.max(0.04, 8 / Math.max(1, pxPerSec))
  const candidates = [0, playheadSec]
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      candidates.push(toSeconds(clip.start), toSeconds(clip.start) + toSeconds(clip.duration))
    }
  }
  for (const marker of project.timeline.markers) {
    candidates.push(toSeconds(marker.time))
    if (marker.duration.ticks > 0) candidates.push(toSeconds(marker.time) + toSeconds(marker.duration))
  }
  let best = seconds
  let bestDist = threshold
  for (const candidate of candidates) {
    const dist = Math.abs(candidate - seconds)
    if (dist < bestDist) {
      bestDist = dist
      best = candidate
    }
  }
  return Math.max(0, best)
}

function RangeField({
  label,
  min,
  max,
  value,
  onValue,
  testId,
}: {
  label: string
  min: number
  max: number
  value: number
  onValue: (value: number) => void
  testId?: string
}) {
  return (
    <label className="block text-[10px] uppercase tracking-widest">
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={0.01}
        value={value}
        onChange={event => onValue(Number(event.target.value))}
        data-testid={testId}
      />
    </label>
  )
}
