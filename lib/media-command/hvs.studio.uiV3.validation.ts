/**
 * Higher Vision Studios — Studio UI V3 layout locks.
 * Visual surface only. Does not replace Slice A/B/C kernel validators.
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
const back = source('components/war-room/higher-vision-studios/HvsBackButton.tsx')
const workspace = source('components/war-room/higher-vision-studios/HvsProductionWorkspace.tsx')
const shell = source('components/war-room/higher-vision-studios/HvsShell.tsx')
const pkg = source('package.json')
const studio = source('lib/media-command/hvs.p1.studio.validation.ts')
const sliceB = source('lib/media-command/hvs.p1.sliceB.validation.ts')
const sliceC = source('lib/media-command/hvs.p1.sliceC.validation.ts')

expect('prior_studio_kept', pkg.includes('hvs.p1.studio.validation.ts'), 'studio validator remains in validate:hvs')
expect('prior_slice_b_kept', pkg.includes('hvs.p1.sliceB.validation.ts'), 'slice B remains')
expect('prior_slice_c_kept', pkg.includes('hvs.p1.sliceC.validation.ts'), 'slice C remains')
expect('ui_v3_in_validate', pkg.includes('hvs.studio.uiV3.validation.ts'), 'V3 validator wired')
expect('slice_id_untouched', ['HVS-P1-SLICE-C', 'HVS-P1-SLICE-D', 'HVS-P1-SLICE-E', 'HVS-P1-SLICE-F', 'HVS-P1-SLICE-G'].includes(HVS_SLICE), HVS_SLICE)

expect('css_tokens', css.includes('--hvs-green') && css.includes('--hvs-cyan') && css.includes('.hvs-v3-body'), 'V3 tokens')
expect('header', editor.includes('data-testid="hvs-studio-header"') && editor.includes('HVS_DISPLAY_NAME') && editor.includes('CREATE A CLEARER TOMORROW') && editor.includes('HvsBackButton') && !editor.includes('history.back') && !editor.includes('router.back()'), 'Studio header + BACK to HVS home')
expect('shared_back', back.includes('data-testid="hvs-studio-back"') && back.includes('Back to Higher Vision Studios') && back.includes('HVS_CANONICAL_PATH') && back.includes('hvs-v3-back') && !back.includes('history.back') && !back.includes('router.back()'), 'one shared BACK control')
expect('production_back', workspace.includes('HvsBackButton') && workspace.includes('data-testid="hvs-production-header"') && !workspace.includes('history.back') && !workspace.includes('router.back()'), 'production workspace BACK')
expect('back_css', css.includes('.hvs-v3-back') && css.includes('.hvs-v3-header-leading') && css.includes('.hvs-v3-back-label') && css.includes('.hvs-v3-back:focus-visible'), 'BACK control styles')
expect('workspace_nav', bar.includes('hvs-workspace-nav') && bar.includes('HVS_PRODUCTION_PAGES') && bar.includes('hvs-surface-${item.id}') && !bar.includes('stayInEditor') && bar.includes("edit: 'EDIT'") && bar.includes('<summary>More</summary>'), 'EDIT COLOR AUDIO VFX AI REVIEW + More extras; pages remain real routes')
expect('media_left', editor.includes('data-testid="hvs-media-library"') && editor.includes('MEDIA LIBRARY') && editor.includes('hvs-v3-library'), 'Media Library left')
expect('program_center', editor.includes('data-testid="hvs-program-viewer"') && editor.includes('hvs-v3-center') && editor.includes('hvs-v3-viewer'), 'Program center')
expect('inspector_right', editor.includes('data-testid="hvs-inspector"') && editor.includes('INSPECTOR') && editor.includes("inspectorChrome"), 'Inspector right')
expect('ai_under_viewer', editor.includes('data-testid="hvs-ai-director-panel"') && editor.includes('hvs-v3-ai') && editor.includes('Ask Higher Vision anything...'), 'AI strip under Program')
expect('ai_before_timeline', editor.indexOf('hvs-v3-ai') < editor.indexOf('data-testid="hvs-timeline"'), 'AI precedes timeline in source')
expect('timeline_bottom', editor.includes('data-testid="hvs-timeline"') && editor.includes('hvs-v3-timeline') && editor.includes('data-testid="hvs-timeline-tools"'), 'professional timeline')
expect('timeline_playhead', editor.includes('hvs-v3-playhead') && css.includes('.hvs-v3-playhead'), 'cyan playhead')
expect('collapse_media', editor.includes('data-testid="hvs-collapse-media"'), 'collapse media')
expect('collapse_inspector', editor.includes('data-testid="hvs-collapse-inspector"'), 'collapse inspector')
expect('collapse_ai', editor.includes('data-testid="hvs-collapse-ai"'), 'collapse AI')
expect('resize_media', editor.includes("startResize('media'") && editor.includes('data-testid="hvs-resize-media"'), 'media resize')
expect('resize_inspector', editor.includes("startResize('inspector'") && editor.includes('data-testid="hvs-resize-inspector"'), 'inspector resize')
expect('resize_timeline', editor.includes("startResize('timeline'") && editor.includes('data-testid="hvs-resize-timeline"'), 'timeline resize')
expect('layout_local_only', editor.includes('war-room-hvs-studio-v3-layout') && editor.includes('localStorage.setItem(LAYOUT_KEY'), 'layout is session preference')
expect('no_layout_in_hvsproj', !editor.includes('workspaceLayout') && !editor.includes('panelLayout'), 'no project-layout concept added')
expect('no_second_media_engine', !editor.includes("from '@/lib/media'") && editor.includes('project.assets'), 'AssetRecord remains')
expect('no_second_project_truth', editor.includes('HvsProject') && editor.includes('/api/media-command/projects'), 'one project truth')
expect('no_second_timeline_truth', editor.includes('project.timeline.tracks') && editor.includes('data-testid="hvs-timeline-clip"'), 'one timeline truth')
expect('source_monitor_kept', editor.includes('data-testid="hvs-source-monitor"') && editor.includes('data-testid="hvs-source-insert"'), 'Source Monitor kept')
expect('editops_kept', editor.includes("kind: 'setTransform'") && editor.includes("kind: 'moveClip'") && editor.includes("kind: 'splitClip'"), 'typed EditOps')
expect('undo_redo_kept', editor.includes('data-testid="hvs-undo"') && editor.includes('data-testid="hvs-redo"'), 'undo/redo')
expect('modes_kept', editor.includes('hvs-mode-${mode}') && editor.includes("'edit', 'viewer', 'timeline'"), 'EDIT/VIEWER/TIMELINE')
expect('phone_nav', editor.includes('data-testid="hvs-phone-nav"') && editor.includes('>VIEW<') && editor.includes('>MEDIA<') && editor.includes('>TIMELINE<'), 'phone surfaces')
expect('shell_hides_browse_chrome', shell.includes('compact={studio}') && shell.includes("{studio ? null : (") && shell.includes("studio ? 'hidden'"), 'studio chrome collapsed')
expect('studio_prompt_kept', editor.includes('What do you want to do'), 'studio validator string remains')
expect('prior_studio_locks', studio.includes('data-testid="hvs-program-viewer"') && studio.includes('label_rail_remains'), 'studio locks not weakened')
expect('prior_slice_b_locks', sliceB.includes('data-testid="hvs-source-monitor"') && sliceB.includes('createFreezeFrame'), 'slice B locks not weakened')
expect('prior_slice_c_locks', sliceC.includes('hvs-add-lower-third') && sliceC.includes('HVS-P1-SLICE-C'), 'slice C locks not weakened')
expect('honest_shells', editor.includes('COMING LATER') && editor.includes('SHELL') && editor.includes('PARTIAL'), 'unavailable workspaces not faked')
expect('generate_broll_honest', editor.includes('Generate B-Roll') && editor.includes('title="SHELL"'), 'B-Roll is shell-labelled')
expect('clean_audio_honest', editor.includes('Clean Audio') && editor.includes('disabled title="COMING LATER"'), 'Clean Audio not faked')

const failed = results.filter(r => !r.pass)
for (const row of results) {
  console.log(`${row.pass ? 'PASS' : 'FAIL'} ${row.name} — ${row.detail}`)
}
if (failed.length) {
  console.error(JSON.stringify({ ok: false, slice: 'HVS-STUDIO-UI-V3', failed }, null, 2))
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, slice: 'HVS-STUDIO-UI-V3', total: results.length }))
