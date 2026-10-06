/**
 * Higher Vision luxury-beauty demo fixture.
 * Beauty identity morphing OFF. Real talent remains authoritative.
 * File kept at starrdom.ts so slice-0 architecture lock remains stable.
 */
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { mediaCommandDataHierarchy } from './paths'
import { emptyProject, type HvsProject } from './types'
import { saveProject } from './store'
import { LUXURY_BEAUTY_V1_ID } from './themes'
import { fromSeconds } from './time'
import { HVS_DEMO_CAPTION, HVS_DEMO_LOGO_NAME, HVS_DEMO_MASTER_NAME, HVS_DEMO_PROJECT_NAME, HVS_DEMO_VERTICAL_NAME } from './demo-copy'
import { uniqueCaptionCues } from './captions'
import { hvsDemoLogoSvg, rasterizeSvgToPng, writePngFile } from './graphics'

export { hvsDemoLogoSvg }
export const STARRDOM_PROJECT_NAME = HVS_DEMO_PROJECT_NAME
export const STARRDOM_LOGO_SVG = hvsDemoLogoSvg()

export async function ensureStarrdomFixture(): Promise<HvsProject> {
  const dirs = mediaCommandDataHierarchy()
  const existingCatalog = path.join(dirs.projects, 'catalog.json')
  const { listProjects, loadProject } = await import('./store')
  const listed = await listProjects()
  const found = listed.find(p => p.starrdom)
  if (found) {
    const loaded = await loadProject(found.id)
    if (loaded) return saveProject(neutralizeDemoCopy(loaded))
  }

  const id = `hvs-demo-${Date.now().toString(36)}`
  const now = new Date().toISOString()
  const project = emptyProject({
    id,
    name: HVS_DEMO_PROJECT_NAME,
    productionMode: 'COMMERCIAL',
    now,
    starrdom: true,
  })
  project.timeline.themeId = LUXURY_BEAUTY_V1_ID
  project.versions[0].label = HVS_DEMO_MASTER_NAME
  project.versions[0].aspect = '16:9'
  project.versions[0].role = 'master'
  project.notes = [
    'Higher Vision luxury-beauty proving path:',
    'research → concept → script → shot plan → ingest → media analysis → select best clips → TrackSubject → Follow person → 9:16 reframe → generated missing non-identity shots → timeline → luxury theme → captions → logo → music → voice → color → render 16:9 → render 9:16.',
    'Beauty identity morphing: OFF.',
  ].join('\n')
  project.scripts = [
    {
      id: 'script-hvs-demo-v1',
      title: 'Higher Vision 30s luxury commercial',
      body: 'Open on gold light through hair. Stylist hands. Model turn. Before/after split. VO: “Luxury that moves with you.” End card: Higher Vision.',
      updatedAt: now,
    },
  ]
  project.storyboard = [
    { id: 'sb1', index: 0, title: 'Gold light open', description: 'Macro hair in motion.', assetId: null, duration: fromSeconds(3) },
    { id: 'sb2', index: 1, title: 'Stylist', description: 'Hands placing wefts.', assetId: null, duration: fromSeconds(4) },
    { id: 'sb3', index: 2, title: 'Model turn', description: 'Follow the turn into CU.', assetId: null, duration: fromSeconds(5) },
    { id: 'sb4', index: 3, title: 'Before / after', description: 'Lawful real-talent comparison.', assetId: null, duration: fromSeconds(4) },
    { id: 'sb5', index: 4, title: 'End card', description: 'Higher Vision logo + luxury caption.', assetId: null, duration: fromSeconds(3) },
  ]
  project.characters = [
    { id: 'ch-model', name: 'Model', role: 'Talent', notes: 'Real identity is authoritative. Morphing OFF.', referenceAssetIds: [], identityMorphing: 'off' },
    { id: 'ch-stylist', name: 'Stylist', role: 'Expert', notes: 'Hands and craft coverage.', referenceAssetIds: [], identityMorphing: 'off' },
  ]
  project.timeline.captionTracks[0].themeId = LUXURY_BEAUTY_V1_ID
  project.timeline.captionTracks[0].cues = [
    {
      id: 'cue-end',
      start: fromSeconds(0),
      end: fromSeconds(3),
      text: HVS_DEMO_CAPTION,
      speaker: null,
      words: [],
    },
  ]

  await mkdir(dirs.fixtures, { recursive: true })
  const logoPath = path.join(dirs.fixtures, 'hvs-demo-logo.svg')
  await writeFile(logoPath, STARRDOM_LOGO_SVG, 'utf8')
  const assetId = 'asset-hvs-demo-logo'
  const originalPath = path.join(dirs.originals, `${assetId}.svg`)
  await mkdir(dirs.originals, { recursive: true })
  await copyFile(logoPath, originalPath)
  const logoPng = path.join(dirs.fixtures, 'hvs-demo-logo.png')
  await writePngFile(logoPng, rasterizeSvgToPng(STARRDOM_LOGO_SVG, 'HIGHER VISION'))
  const derivedId = `${assetId}-raster`
  const derivedPath = path.join(dirs.originals, `${derivedId}.png`)
  if (!existsSync(derivedPath)) await copyFile(logoPng, derivedPath)
  const thumb = existsSync(logoPng) ? logoPng : originalPath
  project.assets.push({
    id: assetId,
    kind: 'logo',
    name: HVS_DEMO_LOGO_NAME,
    originalPath,
    proxyPath: null,
    thumbPath: thumb,
    waveformPath: null,
    checksumSha256: 'hvs-demo-logo-fixture',
    mimeType: 'image/svg+xml',
    duration: fromSeconds(0),
    width: 640,
    height: 180,
    frameRate: null,
    variableFrameRate: false,
    sampleRate: null,
    channels: null,
    codec: null,
    container: 'svg',
    pixelFormat: null,
    rotation: null,
    audioStreams: [],
    immutableOriginal: true,
    generated: false,
    provenance: null,
    createdAt: now,
  })
  project.assets.push({
    id: derivedId,
    kind: 'logo',
    name: `${HVS_DEMO_LOGO_NAME} (render-safe PNG)`,
    originalPath: derivedPath,
    proxyPath: null,
    thumbPath: derivedPath,
    waveformPath: null,
    checksumSha256: 'hvs-demo-logo-raster',
    mimeType: 'image/png',
    duration: fromSeconds(0),
    width: 640,
    height: 180,
    frameRate: null,
    variableFrameRate: false,
    sampleRate: null,
    channels: null,
    codec: 'png',
    container: 'png',
    pixelFormat: 'rgba',
    rotation: null,
    audioStreams: [],
    immutableOriginal: true,
    generated: true,
    provenance: {
      provider: 'hvs-graphics',
      model: 'svg-to-png-v1',
      prompt: null,
      parameters: { role: 'render-safe-raster', sourceAssetId: assetId },
      seed: null,
      referenceAssetIds: [assetId],
      sourceAssetIds: [assetId],
      createdAt: now,
      commercialUse: 'unknown',
      parentAssetId: assetId,
      projectId: id,
    },
    createdAt: now,
  })
  const end = fromSeconds(2.4)
  project.timeline.overlays.push({
    id: 'ov-hvs-demo-logo',
    kind: 'logo',
    assetId,
    text: null,
    start: fromSeconds(0),
    duration: end,
    x: 0.84,
    y: 0.08,
    scale: 0.16,
    opacity: 1,
  })

  void existingCatalog
  return saveProject(project)
}

export function isHvsDisposableDemoProject(project: Pick<HvsProject, 'name' | 'starrdom'>): boolean {
  return Boolean(project.starrdom) || project.name === HVS_DEMO_PROJECT_NAME || /starrdom/i.test(project.name)
}

export function neutralizeDemoCopy(project: HvsProject): HvsProject {
  if (!isHvsDisposableDemoProject(project)) return project
  const next: HvsProject = { ...project }
  if (/starrdom/i.test(next.name) || !next.name.trim()) next.name = HVS_DEMO_PROJECT_NAME
  if (typeof next.notes === 'string' && /starrdom/i.test(next.notes)) {
    next.notes = next.notes.replace(/STARRDOM/gi, 'Higher Vision')
  }
  next.scripts = (next.scripts ?? []).map(script => ({
    ...script,
    title: /starrdom/i.test(script.title) ? 'Higher Vision 30s luxury commercial' : script.title,
    body: script.body.replace(/STARRDOM/gi, 'Higher Vision'),
  }))
  next.assets = next.assets.map(asset => ({
    ...asset,
    name: /starrdom/i.test(asset.name) ? (asset.kind === 'logo' ? HVS_DEMO_LOGO_NAME : asset.name.replace(/STARRDOM/gi, 'Higher Vision')) : asset.name,
  }))
  next.versions = next.versions.map(version => ({
    ...version,
    label: /starrdom/i.test(version.label)
      ? (version.aspect === '9:16' ? HVS_DEMO_VERTICAL_NAME : HVS_DEMO_MASTER_NAME)
      : version.label,
  }))
  next.timeline = {
    ...next.timeline,
    captionTracks: next.timeline.captionTracks.map(track => ({
      ...track,
      cues: uniqueCaptionCues(track.cues.map(cue => ({
        ...cue,
        text: /starrdom/i.test(cue.text) ? HVS_DEMO_CAPTION : cue.text,
      }))),
    })),
  }
  return next
}
