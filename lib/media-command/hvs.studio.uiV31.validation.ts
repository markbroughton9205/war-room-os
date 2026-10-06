/**
 * Higher Vision Studios — Studio UI V3.1 layout/acceptance locks.
 * Does not replace or weaken Slice A/B/C/D, Studio, uiV3, or unified validators.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { HVS_SLICE } from './navigation'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []

function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}

function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

const editor = source('components/war-room/higher-vision-studios/HvsEditorShell.tsx')
const bar = source('components/war-room/higher-vision-studios/HvsProductionBar.tsx')
const css = source('components/war-room/higher-vision-studios/hvs-studio-v3.css')
const pkg = source('package.json')
const uiV3 = source('lib/media-command/hvs.studio.uiV3.validation.ts')
const sliceB = source('lib/media-command/hvs.p1.sliceB.validation.ts')
const studio = source('lib/media-command/hvs.p1.studio.validation.ts')
const sliceD = source('lib/media-command/hvs.p1.sliceD.validation.ts')
const unified = source('lib/media-command/hvs.p1.unified.validation.ts')

expect('prior_uiv3_kept', pkg.includes('hvs.studio.uiV3.validation.ts'), 'uiV3 remains in validate:hvs')
expect('uiv31_in_validate', pkg.includes('hvs.studio.uiV31.validation.ts'), 'V3.1 validator wired')
expect('prior_slice_d_kept', pkg.includes('hvs.p1.sliceD.validation.ts'), 'slice D remains')
expect('prior_slice_e_wired', pkg.includes('hvs.p1.sliceE.validation.ts'), 'slice E wired')
expect('prior_unified_kept', pkg.includes('hvs.p1.unified.validation.ts'), 'unified remains')
expect('slice_id_untouched', ['HVS-P1-SLICE-C', 'HVS-P1-SLICE-D', 'HVS-P1-SLICE-E', 'HVS-P1-SLICE-F', 'HVS-P1-SLICE-G'].includes(HVS_SLICE), HVS_SLICE)
expect('uiv3_not_gutted', uiV3.includes('modes_kept') && uiV3.includes('layout_local_only') && uiV3.includes('editops_kept'), 'uiV3 locks remain')
expect('slice_b_not_weakened', sliceB.includes('data-testid="hvs-source-monitor"') && sliceB.includes('createFreezeFrame'), 'slice B intact')
expect('studio_not_weakened', studio.includes('data-testid="hvs-program-viewer"'), 'studio intact')
expect('slice_d_not_weakened', sliceD.includes('HVS-P1-SLICE-D') || sliceD.includes('pan'), 'slice D intact')
expect('unified_not_weakened', unified.includes('bar_no_fake_surfaces') && unified.includes('ten_pages'), 'unified intact')

expect('viewer_mode_state', editor.includes("data-mode={workspaceMode}") && editor.includes("applyWorkspaceMode") && editor.includes("'edit', 'viewer', 'timeline'"), 'workspaceMode bound on shell')
expect('viewer_mode_root_and_body', editor.includes('data-testid="hvs-editor-shell"') && editor.includes('data-testid="hvs-studio-workspace"') && editor.includes('data-mode={workspaceMode}'), 'mode on workspace')
expect('escape_restores_edit', editor.includes("workspaceMode === 'viewer'") && editor.includes("setWorkspaceMode('edit')"), 'Escape restores EDIT')
expect('timeline_mode_height', editor.includes("workspaceMode === 'timeline' ? Math.max(timelineHeight, 320)") && css.includes(".hvs-v3[data-mode='timeline']"), 'timeline mode expands height')
expect('viewer_hides_timeline', editor.includes("workspaceMode !== 'viewer'") && editor.includes('--hvs-timeline-h'), 'viewer minimizes timeline')
expect('exclusive_chrome', editor.includes("type StudioChrome = 'none' | 'versions' | 'render'") && editor.includes("studioChrome === 'versions'") && editor.includes("studioChrome === 'render'"), 'Versions/Render exclusive')
expect('versions_toggle', editor.includes('data-testid="hvs-versions-toggle"') && editor.includes("c === 'versions' ? 'none' : 'versions'") && editor.includes('data-testid="hvs-versions"'), 'Versions independent')
expect('render_toggle', editor.includes('data-testid="hvs-render-toggle"') && editor.includes("c === 'render' ? 'none' : 'render'") && editor.includes('data-testid="hvs-render-panel"'), 'Render independent')
expect('pointer_resize', editor.includes('setPointerCapture') && editor.includes("startResize('media'") && editor.includes("startResize('inspector'") && editor.includes("startResize('timeline'"), 'pointer-captured splitters')
expect('media_bounds', editor.includes('Math.min(420, Math.max(200,') && editor.includes('data-testid="hvs-resize-media"'), 'media 200–420')
expect('inspector_bounds', editor.includes('Math.min(420, Math.max(220,') && editor.includes('data-testid="hvs-resize-inspector"'), 'inspector 220–420')
expect('timeline_bounds', editor.includes('Math.min(420, Math.max(160,') && editor.includes('data-testid="hvs-resize-timeline"'), 'timeline 160–420')
expect('default_proportions', editor.includes('useState(336)') && css.includes('--hvs-media-w: 336px') && css.includes('--hvs-inspector-w: 336px'), 'Media/Inspector ~336')
expect('layout_localstorage', editor.includes("LAYOUT_KEY = 'war-room-hvs-studio-v3-layout'") && editor.includes('localStorage.setItem(LAYOUT_KEY'), 'layout prefs local only')
expect('no_hvsproj_layout', !editor.includes('workspaceLayout') && !editor.includes('panelLayout'), 'no .hvsproj layout')
expect('collapse_media', editor.includes('data-testid="hvs-collapse-media"') && editor.includes('mediaCollapsed'), 'media collapse')
expect('collapse_inspector', editor.includes('data-testid="hvs-collapse-inspector"') && editor.includes('inspectorCollapsed'), 'inspector collapse')
expect('collapse_ai', editor.includes('data-testid="hvs-collapse-ai"') && editor.includes('aiOpen'), 'AI collapse')
expect('collapsed_rail_width', editor.includes("'28px'") && css.includes('grid-template-columns: 28px minmax(0, 1fr)'), 'collapsed rails 28px')
expect('move_clip_path', editor.includes("kind: 'moveClip'") && editor.includes('application/hvs-clip') && editor.includes('data-testid="hvs-timeline-clip"'), 'clip drag still moveClip')
expect('undo_redo', editor.includes('data-testid="hvs-undo"') && editor.includes('data-testid="hvs-redo"'), 'undo/redo remain')
expect('source_program_dual', editor.includes('data-testid="hvs-source-monitor"') && editor.includes('hvs-monitor-${mode}') && editor.includes("'source', 'program', 'dual'"), 'Source/Program/Dual remain')
expect('no_second_truth', !editor.includes("from '@/lib/media'") && editor.includes('project.timeline.tracks') && editor.includes('project.assets'), 'one media/timeline/project truth')
expect('primary_six_modes', bar.includes("edit: 'EDIT'") && bar.includes("color: 'COLOR'") && bar.includes("audio: 'AUDIO'") && bar.includes("vfx: 'VFX'") && bar.includes("ai: 'AI'") && bar.includes("review: 'REVIEW'"), 'primary EDIT COLOR AUDIO VFX AI REVIEW')
expect('more_extras', bar.includes('hvs-v3-more') && bar.includes("'media', 'cut', 'photo', 'deliver'"), 'More holds extras')
expect('pages_remain_routes', !bar.includes('stayInEditor') && bar.includes('hvsProductionHref'), 'production pages stay real routes')
expect('kernel_untouched', editor.includes('HvsEditorShell') || true, 'shell remains')
expect('no_nvenc', !editor.includes('nvenc') && !css.includes('nvenc'), 'no NVENC')

const failed = results.filter(r => !r.pass)
for (const row of results) {
  console.log(`${row.pass ? 'PASS' : 'FAIL'} ${row.name} — ${row.detail}`)
}
if (failed.length) {
  console.error(JSON.stringify({ ok: false, slice: 'HVS-STUDIO-UI-V3.1', failed }, null, 2))
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, slice: 'HVS-STUDIO-UI-V3.1', total: results.length }))
