/**
 * Higher Vision Studios — Studio workspace UX slice.
 * Surface integration only. Does not replace the editor kernel or .hvsproj truth.
 * Live browser proof is a separate operator pass recorded in the report.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { HVS_SLICE, hvsProjectHref, hvsStudioHref, isHvsStudioPath } from './navigation'
import { listProjects, loadProject, saveProject } from './store'
import { applyEditCommand } from './edit-ops'
import { newCommandId, type EditCommand } from './edit-commands'
import { fromSeconds } from './time'
import { emptyProject } from './types'
import { mediaCommandDataHierarchy, projectFilePath } from './paths'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []

function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}

function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

function cmd(kind: EditCommand['kind'], extra: Record<string, unknown> = {}): EditCommand {
  return {
    id: newCommandId(),
    kind,
    actor: 'human',
    createdAt: new Date().toISOString(),
    ...extra,
  } as EditCommand
}

expect('slice_id', ['HVS-P1-UX-SLICE-STUDIO', 'HVS-P1-SLICE-C', 'HVS-P1-SLICE-D', 'HVS-P1-SLICE-E', 'HVS-P1-SLICE-F', 'HVS-P1-SLICE-G'].includes(HVS_SLICE), HVS_SLICE)

const editor = source('components/war-room/higher-vision-studios/HvsEditorShell.tsx')
const projectsPage = source('app/higher-vision-studios/projects/page.tsx')
const studioPage = source('app/higher-vision-studios/studio/page.tsx')
const editorRoute = source('app/higher-vision-studios/projects/[id]/editor/page.tsx')
const nav = source('lib/media-command/navigation.ts')
const shell = source('components/war-room/higher-vision-studios/HvsShell.tsx')
const homeNav = source('components/war-room/higher-vision-studios/HvsHomeNav.tsx')
const host = source('components/war-room/media/MediaHost.tsx')

expect('studio_nav_label', (nav.includes("label: 'Advanced Editor'") || nav.includes("label: 'Studio'")) && nav.includes("id: 'editor'"), 'Advanced Editor is the editor section')
expect('canonical_editor_route', editorRoute.includes('HvsEditorShell') && editorRoute.includes('projectId={String(params.id)}'), 'projects/:id/editor keeps kernel')
expect('studio_route_reuses_kernel', studioPage.includes('HvsEditorShell') && !studioPage.includes('createProject'), 'studio page is the same shell')
expect('studio_href_editor', hvsStudioHref('hvs-demo') === '/higher-vision-studios/projects/hvs-demo/editor', hvsStudioHref('hvs-demo'))
expect('studio_path_helper', isHvsStudioPath('/higher-vision-studios/projects/x/editor') && isHvsStudioPath('/higher-vision-studios/studio'), 'studio paths')
expect('projects_open_studio', projectsPage.includes('hvsStudioHref') && projectsPage.includes('data-testid="hvs-project-card"'), 'project cards → Studio')
expect('projects_real_store', projectsPage.includes('/api/media-command/projects') && projectsPage.includes('timelineDuration'), 'catalog + .hvsproj cards')
expect('projects_card_facts', projectsPage.includes('card.aspect') && projectsPage.includes('card.version') && projectsPage.includes('card.lastRender'), 'aspect/version/render')

expect('no_second_kernel', !editor.includes("from '@/lib/media'") && !studioPage.includes("from '@/lib/media'"), 'does not import War Room Media')
expect('media_host_isolation', host.includes('isHigherVisionStudiosPath') && host.includes('/higher-vision-studios'), 'HVS Media isolation')
expect('single_editor_shell', editor.includes('export function HvsEditorShell') && editorRoute.includes('HvsEditorShell'), 'one shell')

expect('workspace_layout', editor.includes('data-testid="hvs-studio-workspace"') && editor.includes('data-testid="hvs-media-library"') && editor.includes('data-testid="hvs-inspector"') && editor.includes('data-testid="hvs-timeline"'), 'media | viewer | inspector + timeline')
expect('program_center', editor.includes('data-testid="hvs-program-viewer"') && editor.includes('data-testid="hvs-program-play"'), 'Program Viewer')
expect('source_preserved', editor.includes('data-testid="hvs-source-monitor"') && editor.includes('data-testid="hvs-source-mark-in"') && editor.includes("editFromSource('insertClip')"), 'Slice B Source Monitor')
expect('clocks_not_merged', editor.includes('sourcePlaying') && editor.includes('setPlayheadSec') && editor.includes('emptySourceMonitor'), 'independent clocks')
expect('header', editor.includes('data-testid="hvs-studio-header"') && editor.includes('data-testid="hvs-save-state"') && editor.includes('data-testid="hvs-current-version"'), 'Studio header')
expect('no_manual_save_truth', !editor.includes('>Save</button>') && editor.includes("setSavedFlash('Saving…')") && editor.includes("setSavedFlash('Saved')"), 'autosave via EditTransaction')
expect('undo_redo', editor.includes("kind: 'undo'") && editor.includes("kind: 'redo'"), 'typed history')
expect('inspector_editops', editor.includes("kind: 'setTransform'") && editor.includes("kind: 'setOpacity'") && editor.includes("kind: 'setSpeed'"), 'Inspector → EditOps')
expect('ai_director_in_studio', editor.includes('data-testid="hvs-ai-director-panel"') && editor.includes('Propose EditOps') && editor.includes('What do you want to do'), 'AI Director docked')
expect('versions_access', editor.includes('data-testid="hvs-versions"') && editor.includes('data-testid="hvs-versions-toggle"') && (editor.includes('HvsVersionBrowser') || editor.includes("kind: 'createVersion'")), 'versions panel')
expect('render_access', editor.includes('data-testid="hvs-render-panel"') && editor.includes('data-testid="hvs-render-toggle"') && editor.includes('/render-queue'), 'render in Studio')
expect('generate_honest', editor.includes('data-testid="hvs-generate-shells"') && editor.includes('SHELL') && editor.includes('Generate Video'), 'Generate labeled SHELL')
expect('workspace_modes', editor.includes('hvs-mode-${mode}') && editor.includes("'edit', 'viewer', 'timeline'"), 'edit/viewer/timeline')
expect('viewer_escape', editor.includes("workspaceMode === 'viewer'") && editor.includes("event.key !== 'Escape'"), 'Escape returns from viewer')
expect('media_filters', editor.includes('hvs-media-filter-${cat.id}') && editor.includes("'favorites'"), 'library filters')
expect('compact_studio_chrome', homeNav.includes('compact') && shell.includes('compact={studio}') && shell.includes('{studio ? null : ('), 'Studio chrome does not bury the viewer')
expect('production_bar_pages', source('components/war-room/higher-vision-studios/HvsProductionBar.tsx').includes('MEDIA') || source('components/war-room/higher-vision-studios/HvsProductionBar.tsx').includes("label: 'Media'") || source('lib/media-command/production-pages.ts').includes("'media'"), 'unified pages exist')
expect('slice_b_not_removed', editor.includes('hvs-source-insert') && editor.includes('hvs-gap-frame') && editor.includes('hvs-create-freeze'), 'Slice B controls remain')
expect('label_rail_remains', editor.includes('hvs-track-label-rail') && editor.includes('pointer-events-none flex h-12 items-center'), 'Slice 1.2 rail')

expect('project_href_overview', hvsProjectHref('abc') === '/higher-vision-studios/projects/abc', hvsProjectHref('abc'))
expect('project_href_editor', hvsProjectHref('abc', 'editor') === '/higher-vision-studios/projects/abc/editor', hvsProjectHref('abc', 'editor'))

const local = emptyProject({ id: 'hvs-studio-kernel', name: 'Studio kernel' })
local.assets.push({
  id: 'a1',
  kind: 'video',
  name: 'plate.mp4',
  originalPath: '/tmp/a1.mp4',
  proxyPath: null,
  thumbPath: null,
  waveformPath: null,
  checksumSha256: 'x',
  mimeType: 'video/mp4',
  duration: fromSeconds(4),
  width: 1920,
  height: 1080,
  frameRate: { n: 24, d: 1 },
  variableFrameRate: false,
  sampleRate: 48000,
  channels: 2,
  codec: 'h264',
  container: 'mp4',
  pixelFormat: 'yuv420p',
  rotation: null,
  audioStreams: [{ codec: 'aac', sampleRate: 48000, channels: 2 }],
  immutableOriginal: true,
  generated: false,
  provenance: null,
  createdAt: new Date().toISOString(),
})
const inserted = applyEditCommand(local, cmd('insertClip', {
  trackId: 'V1',
  assetId: 'a1',
  start: fromSeconds(0),
  duration: fromSeconds(2),
}))
expect('kernel_still_inserts', inserted.ok, inserted.ok ? 'ok' : inserted.error)
const faded = inserted.ok
  ? applyEditCommand(inserted.project, cmd('setOpacity', { clipId: inserted.project.timeline.tracks[0].clips[0].id, opacity: 0.4 }))
  : inserted
expect('kernel_inspector_opacity', faded.ok && Math.abs((faded.project.timeline.tracks[0].clips[0]?.opacity ?? 1) - 0.4) < 0.001, faded.ok ? String(faded.project.timeline.tracks[0].clips[0]?.opacity) : faded.error)

// The reload checks run on the project this validation saves itself, not on whatever the operator's store happens to hold.
let savedId: string | null = null
if (faded.ok) {
  faded.project.id = `hvs-studio-persist-${Date.now().toString(36)}`
  faded.project.name = 'HVS STUDIO WORKSPACE VALIDATION'
  savedId = faded.project.id
  await saveProject(faded.project)
  const listed = await listProjects()
  expect('store_lists_projects', listed.some(p => p.id === savedId), String(listed.length))
  const loaded = await loadProject(faded.project.id)
  expect('reload_project_truth', Boolean(loaded && loaded.assets.length >= 1 && loaded.timeline.tracks.length >= 1), loaded ? `${loaded.id} assets=${loaded.assets.length} clips=${loaded.timeline.tracks.reduce((n, t) => n + t.clips.length, 0)}` : 'none')
  expect('reload_version_truth', Boolean(loaded?.currentVersionId && loaded.versions.length >= 1), loaded?.versions.find(v => v.id === loaded.currentVersionId)?.label ?? 'none')
  expect('no_duplicate_asset_system', editor.includes('project.assets') && !editor.includes('warRoomMediaAssets'), 'AssetRecord from HVS project')
  const clip = loaded?.timeline.tracks[0]?.clips[0]
  expect('editop_persists', Boolean(clip && Math.abs((clip.opacity ?? 1) - 0.4) < 0.001 && loaded?.assets.length === 1), `opacity=${clip?.opacity}`)
} else {
  expect('store_lists_projects', false, 'kernel fade failed')
  expect('reload_project_truth', false, 'kernel fade failed')
  expect('reload_version_truth', false, 'kernel fade failed')
  expect('no_duplicate_asset_system', editor.includes('project.assets') && !editor.includes('warRoomMediaAssets'), 'AssetRecord from HVS project')
  expect('editop_persists', false, 'kernel fade failed')
}
// The validation project is not the operator's work: take it back out of the store and the catalog.
if (savedId) {
  rmSync(projectFilePath(savedId), { force: true })
  rmSync(path.join(mediaCommandDataHierarchy().projects, savedId), { recursive: true, force: true })
  const catalogFile = path.join(mediaCommandDataHierarchy().projects, 'catalog.json')
  try {
    const catalog = JSON.parse(readFileSync(catalogFile, 'utf8')) as { projects?: { id: string }[] }
    writeFileSync(catalogFile, JSON.stringify({ projects: (catalog.projects ?? []).filter(entry => entry.id !== savedId) }, null, 2), 'utf8')
  } catch { /* no catalog to tidy */ }
}

const failed = results.filter(r => !r.pass)
for (const row of results) {
  console.log(`${row.pass ? 'PASS' : 'FAIL'} ${row.name} — ${row.detail}`)
}
if (failed.length) {
  console.error(JSON.stringify({ ok: false, slice: HVS_SLICE, failed }, null, 2))
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, slice: HVS_SLICE, total: results.length }))
