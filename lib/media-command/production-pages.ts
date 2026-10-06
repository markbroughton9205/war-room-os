/**
 * Higher Vision Studios — unified production workspace pages.
 * One application, one .hvsproj, one media system, one timeline, one version system, one render pipeline.
 * Pages are workspaces, not products. No round-trip export/import between them.
 */
import { HVS_CANONICAL_PATH } from './navigation'

export type HvsProductionPageId =
  | 'media'
  | 'cut'
  | 'edit'
  | 'vfx'
  | 'color'
  | 'audio'
  | 'photo'
  | 'ai'
  | 'review'
  | 'deliver'

export type HvsPageHonesty = 'WORKING' | 'PARTIAL' | 'SHELL' | 'COMING LATER'

export type HvsProductionPage = {
  id: HvsProductionPageId
  label: string
  icon: string
  purpose: string
  status: HvsPageHonesty
  phaseHome: string
  directorExample: string
  engines: string[]
  later: string[]
}

export const HVS_PRODUCTION_PAGE_IDS: HvsProductionPageId[] = [
  'media', 'cut', 'edit', 'vfx', 'color', 'audio', 'photo', 'ai', 'review', 'deliver',
]

export const HVS_PRODUCTION_PAGES: HvsProductionPage[] = [
  {
    id: 'media',
    label: 'Media',
    icon: '▣',
    purpose: 'Ingest, organize, search, and understand project media.',
    status: 'PARTIAL',
    phaseHome: '1 / 3',
    directorExample: 'Find every close-up of her.',
    engines: ['AssetRecord', 'ingest', 'proxies', 'thumbs', 'waveforms', 'favorites session', 'Video Intelligence lexical search, observation timeline, analysis cache, MEDIA VI workspace'],
    later: ['bins', 'smart collections', 'slate/take', 'transcript search', 'embedding search'],
  },
  {
    id: 'cut',
    label: 'Cut',
    icon: '✂',
    purpose: 'Fast assembly on the same timeline: selects, append, insert, overwrite, ripple.',
    status: 'PARTIAL',
    phaseHome: '1',
    directorExample: 'Keep only the best takes.',
    engines: ['same Timeline + EditOps as EDIT', 'append/insert/overwrite/ripple'],
    later: ['dedicated assembly chrome', 'multicam', 'beat editing'],
  },
  {
    id: 'edit',
    label: 'Edit',
    icon: '▷',
    purpose: 'Precision editing. Existing HVS Studio / Program Viewer / Inspector / Timeline.',
    status: 'WORKING',
    phaseHome: '1',
    directorExample: 'Cut this scene tighter.',
    engines: ['HvsEditorShell', 'Source Monitor', 'Program Viewer', 'EditOps', 'AI Director', 'captions', 'tracking'],
    later: ['GPU compositor', 'dissolve playback', 'panel resize polish'],
  },
  {
    id: 'vfx',
    label: 'VFX',
    icon: '◇',
    purpose: 'Visual effects, compositing, motion graphics. EffectGraph output joins the same RenderGraph.',
    status: 'PARTIAL',
    phaseHome: '5',
    directorExample: 'Put this image over the shot.',
    engines: ['EffectGraph MediaIn/Transform/Mask/Merge/MediaOut FFmpeg still+video composite', 'typed graph EditOps', 'node graph UI for executable nodes only'],
    later: ['roto', 'keyer', 'full tracker-driven roto', 'generative fill', 'Mask ellipse/polygon runtime', 'Blur/Glow/Keyer until executable'],
  },
  {
    id: 'color',
    label: 'Color',
    icon: '◐',
    purpose: 'Non-destructive color correction and grading on the same clips.',
    status: 'PARTIAL',
    phaseHome: '1 / 5',
    directorExample: 'Make this feel colder.',
    engines: ['applyColor EditOp', 'ColorPipeline lift/gamma/gain/offset/temp/tint/contrast/pivot/saturation + luma curve', 'real histogram/waveform/parade/vectorscope UI', 'before/after from same pipeline'],
    later: ['qualifiers', 'OCIO/ACES/HDR', 'LUTs', 'hue curves'],
  },
  {
    id: 'audio',
    label: 'Audio',
    icon: '♬',
    purpose: 'Audio post synchronized to the same project timeline.',
    status: 'PARTIAL',
    phaseHome: '1 / 5',
    directorExample: 'Clean the dialogue.',
    engines: ['waveform', 'clip volume/fade/duck/pan', 'AudioGraph two-channel mixer + EQ UI + compressor/limiter + volume automation + sample meters'],
    later: ['gate/de-esser/reverb/delay', 'ADR/Foley', 'loudness', 'isolation', 'stem separation', 'full DAW'],
  },
  {
    id: 'photo',
    label: 'Photo',
    icon: '▭',
    purpose: 'Still image production: photographs, generated stills, key art, storyboard panels.',
    status: 'SHELL',
    phaseHome: '2 / 5',
    directorExample: 'Turn this frame into key art.',
    engines: ['image/logo AssetRecords', 'shared color/filter EditOps'],
    later: ['RAW', 'retouch', 'object removal', 'generative extend'],
  },
  {
    id: 'ai',
    label: 'AI',
    icon: '⌬',
    purpose: 'AI production control room. Providers stay behind HVS routing.',
    status: 'PARTIAL',
    phaseHome: '2 / 3 / 4 / 7',
    directorExample: 'Generate an establishing shot.',
    engines: ['AI Director EditOps', 'Provider Router (spend-gated; unconfigured stubs never routed)', 'Video Intelligence FFmpeg analysis + search'],
    later: ['live generate providers', 'script/board/shot planner objects', 'Video Learning'],
  },
  {
    id: 'review',
    label: 'Review',
    icon: '☑',
    purpose: 'Quality control, version review, approval. No publish without Commander authority.',
    status: 'PARTIAL',
    phaseHome: '1 / 9',
    directorExample: 'Check this scene for continuity problems.',
    engines: ['Version Browser', 'render linkage by versionId', 'safe-area warnings'],
    later: ['A/B', 'timeline comments', 'QC checklist', 'approval state'],
  },
  {
    id: 'deliver',
    label: 'Deliver',
    icon: '⇪',
    purpose: 'Master, export, delivery. Existing RenderQueue is the foundation.',
    status: 'PARTIAL',
    phaseHome: '1',
    directorExample: 'Prepare a 9:16 social version.',
    engines: ['render 16:9/9:16/1:1', 'RenderQueue', 'output AssetRecords'],
    later: ['H.265/AV1', 'image sequences', 'audio masters', 'platform presets', 'archive masters'],
  },
]

const PAGE_SET = new Set<string>(HVS_PRODUCTION_PAGE_IDS)

export function isHvsProductionPageId(value: string | null | undefined): value is HvsProductionPageId {
  return Boolean(value && PAGE_SET.has(value))
}

export function hvsProductionHref(projectId: string, page: HvsProductionPageId): string {
  const slug = page === 'edit' ? 'editor' : page
  return `${HVS_CANONICAL_PATH}/projects/${encodeURIComponent(projectId)}/${slug}`
}

export function parseHvsProductionPath(pathname: string | null | undefined): {
  projectId: string | null
  page: HvsProductionPageId | null
} {
  if (!pathname) return { projectId: null, page: null }
  const projectMatch = pathname.match(/\/higher-vision-studios\/projects\/([^/]+)(?:\/([^/]+))?/)
  if (projectMatch) {
    const projectId = decodeURIComponent(projectMatch[1])
    const slug = projectMatch[2]
    if (!slug || slug === 'overview') return { projectId, page: null }
    if (slug === 'editor') return { projectId, page: 'edit' }
    if (isHvsProductionPageId(slug)) return { projectId, page: slug }
    return { projectId, page: null }
  }
  if (pathname === `${HVS_CANONICAL_PATH}/studio` || pathname === `${HVS_CANONICAL_PATH}/editor`) {
    return { projectId: null, page: 'edit' }
  }
  if (pathname === `${HVS_CANONICAL_PATH}/library`) return { projectId: null, page: 'media' }
  if (pathname === `${HVS_CANONICAL_PATH}/color`) return { projectId: null, page: 'color' }
  if (pathname === `${HVS_CANONICAL_PATH}/audio`) return { projectId: null, page: 'audio' }
  if (pathname === `${HVS_CANONICAL_PATH}/generate` || pathname === `${HVS_CANONICAL_PATH}/ai-director` || pathname === `${HVS_CANONICAL_PATH}/video-intelligence`) {
    return { projectId: null, page: 'ai' }
  }
  if (pathname === `${HVS_CANONICAL_PATH}/render-queue`) return { projectId: null, page: 'deliver' }
  return { projectId: null, page: null }
}

export function isHvsProductionPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return isHvsProjectWorkspacePath(pathname)
    || pathname === `${HVS_CANONICAL_PATH}/studio`
    || pathname === `${HVS_CANONICAL_PATH}/editor`
}

export function isHvsProjectWorkspacePath(pathname: string | null | undefined): boolean {
  return Boolean(pathname && /\/higher-vision-studios\/projects\/[^/]+\/(media|cut|editor|vfx|color|audio|photo|ai|review|deliver)$/.test(pathname))
}
