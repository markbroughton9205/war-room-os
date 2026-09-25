/**
 * Canonical Higher Vision Studios directories under the existing War Room
 * application-data hierarchy (~/.local/share/war-room-os on Linux).
 * Sibling of Foundry. Never invent a second data root. Never reuse lib/media.
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { ensureLocalAppDataDirs, resolveLocalAppDataPaths } from '@/lib/sovereign-runtime/local-ownership/paths'

export type MediaCommandDataHierarchy = {
  appRoot: string
  mediaCommandRoot: string
  projects: string
  originals: string
  proxies: string
  thumbs: string
  waveforms: string
  renders: string
  jobs: string
  analysis: string
  knowledge: string
  lessons: string
  cache: string
  fixtures: string
  tmp: string
  tools: string
  models: string
  modelsImage: string
  modelsVoice: string
  modelsAudio: string
}

export function mediaCommandDataHierarchy(): MediaCommandDataHierarchy {
  const app = resolveLocalAppDataPaths()
  ensureLocalAppDataDirs(app)
  const mediaCommandRoot = path.join(app.data, 'media-command')
  const dirs: MediaCommandDataHierarchy = {
    appRoot: app.root,
    mediaCommandRoot,
    projects: path.join(mediaCommandRoot, 'projects'),
    originals: path.join(mediaCommandRoot, 'originals'),
    proxies: path.join(mediaCommandRoot, 'proxies'),
    thumbs: path.join(mediaCommandRoot, 'thumbs'),
    waveforms: path.join(mediaCommandRoot, 'waveforms'),
    renders: path.join(mediaCommandRoot, 'renders'),
    jobs: path.join(mediaCommandRoot, 'jobs'),
    analysis: path.join(mediaCommandRoot, 'analysis'),
    knowledge: path.join(mediaCommandRoot, 'knowledge'),
    lessons: path.join(mediaCommandRoot, 'knowledge', 'lessons'),
    cache: path.join(mediaCommandRoot, 'cache'),
    fixtures: path.join(mediaCommandRoot, 'fixtures'),
    tmp: path.join(mediaCommandRoot, 'tmp'),
    tools: path.join(mediaCommandRoot, 'tools'),
    models: path.join(mediaCommandRoot, 'models'),
    modelsImage: path.join(mediaCommandRoot, 'models', 'image'),
    modelsVoice: path.join(mediaCommandRoot, 'models', 'voice'),
    modelsAudio: path.join(mediaCommandRoot, 'models', 'audio'),
  }
  for (const dir of Object.values(dirs)) {
    mkdirSync(dir, { recursive: true })
  }
  return dirs
}

export function projectFilePath(projectId: string): string {
  return path.join(mediaCommandDataHierarchy().projects, `${projectId}.hvsproj`)
}

export function projectVersionsDir(projectId: string): string {
  const dir = path.join(mediaCommandDataHierarchy().projects, projectId, 'versions')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function projectLogPath(projectId: string): string {
  const dir = path.join(mediaCommandDataHierarchy().projects, projectId)
  mkdirSync(dir, { recursive: true })
  return path.join(dir, 'edit-command.log.jsonl')
}

export function projectUndoDir(projectId: string): string {
  const dir = path.join(mediaCommandDataHierarchy().projects, projectId, 'undo')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function projectRedoDir(projectId: string): string {
  const dir = path.join(mediaCommandDataHierarchy().projects, projectId, 'redo')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function originalAssetPath(assetId: string, ext: string): string {
  const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, '') || '.bin'
  return path.join(mediaCommandDataHierarchy().originals, `${assetId}${safeExt.startsWith('.') ? safeExt : `.${safeExt}`}`)
}
