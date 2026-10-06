/**
 * Unified production-page architecture lock.
 * Surface only: ten workspaces, one .hvsproj, no second media/timeline/project truth.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { HVS_SLICE } from './navigation'
import {
  HVS_PRODUCTION_PAGE_IDS,
  HVS_PRODUCTION_PAGES,
  hvsProductionHref,
  isHvsProjectWorkspacePath,
  parseHvsProductionPath,
} from './production-pages'
import { HVS_MATRIX_ROWS, matrixRowsForPage } from './production-matrix'
import { HVS_GPU_RUNTIME_POLICY } from './gpu-runtime'
import { emptyEffectGraph } from './effect-graph'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []

function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}

function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

expect('slice_untouched', ['HVS-P1-SLICE-C', 'HVS-P1-SLICE-D', 'HVS-P1-SLICE-E', 'HVS-P1-SLICE-F', 'HVS-P1-SLICE-G'].includes(HVS_SLICE), HVS_SLICE)
expect('ten_pages', HVS_PRODUCTION_PAGE_IDS.join(',') === 'media,cut,edit,vfx,color,audio,photo,ai,review,deliver', HVS_PRODUCTION_PAGE_IDS.join(','))
expect('page_count', HVS_PRODUCTION_PAGES.length === 10, String(HVS_PRODUCTION_PAGES.length))
expect('edit_working', HVS_PRODUCTION_PAGES.find(p => p.id === 'edit')?.status === 'WORKING', 'EDIT status')
expect('vfx_not_faked', HVS_PRODUCTION_PAGES.find(p => p.id === 'vfx')?.status === 'PARTIAL', 'VFX status')
expect('href_same_project', hvsProductionHref('hvs-demo', 'color') === '/higher-vision-studios/projects/hvs-demo/color', hvsProductionHref('hvs-demo', 'color'))
expect('edit_href_editor', hvsProductionHref('hvs-demo', 'edit') === '/higher-vision-studios/projects/hvs-demo/editor', hvsProductionHref('hvs-demo', 'edit'))
expect('parse_color', parseHvsProductionPath('/higher-vision-studios/projects/abc/color').page === 'color', 'color parse')
expect('workspace_path', isHvsProjectWorkspacePath('/higher-vision-studios/projects/abc/vfx') && !isHvsProjectWorkspacePath('/higher-vision-studios/projects/abc'), 'workspace path')

expect('matrix_187', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
const covered = new Set(HVS_MATRIX_ROWS.flatMap(row => row.pages))
expect('matrix_covers_all_pages', HVS_PRODUCTION_PAGE_IDS.every(id => covered.has(id)), [...covered].join(','))
expect('no_duplicate_row_ids', new Set(HVS_MATRIX_ROWS.map(r => r.id)).size === 187, 'duplicate ids')
expect('edit_has_nle_rows', matrixRowsForPage('edit').some(r => r.id.startsWith('G13-')), 'G13 on EDIT')
expect('vfx_has_g20', matrixRowsForPage('vfx').some(r => r.id.startsWith('G20-')), 'G20 on VFX')
expect('color_has_g19', matrixRowsForPage('color').some(r => r.id.startsWith('G19-')), 'G19 on COLOR')
expect('audio_has_g31', matrixRowsForPage('audio').some(r => r.id.startsWith('G31-')), 'G31 on AUDIO')

expect('gpu_not_rewritten', HVS_GPU_RUNTIME_POLICY.rewriteRendererThisPass === false && HVS_GPU_RUNTIME_POLICY.vendorNeutralProjectFormat, 'gpu policy')
expect('effect_graph_stub', emptyEffectGraph('p1').nodes.some(n => n.kind === 'MediaIn') && emptyEffectGraph('p1').nodes.some(n => n.kind === 'MediaOut'), 'graph stub')

const editor = source('components/war-room/higher-vision-studios/HvsEditorShell.tsx')
const bar = source('components/war-room/higher-vision-studios/HvsProductionBar.tsx')
const workspace = source('components/war-room/higher-vision-studios/HvsProductionWorkspace.tsx')
const lanes = source('components/war-room/higher-vision-studios/HvsLaneWorkspaces.tsx')
expect('bar_has_ten', HVS_PRODUCTION_PAGE_IDS.every(id => bar.includes(`hvs-surface-${id}`) || bar.includes(`item.id`)), 'bar pages')
expect('bar_links_project', bar.includes('hvsProductionHref') && bar.includes('persistHvsResume'), 'same-project links')
expect('bar_no_fake_surfaces', !bar.includes('stayInEditor') && !editor.includes('onStudioSurface') && bar.includes('hvsProductionHref') && HVS_PRODUCTION_PAGE_IDS.every(id => bar.includes(`hvs-surface-${id}`) || bar.includes('item.id')), 'COLOR/AUDIO/VFX/AI/REVIEW remain real project routes')
expect('director_page_context', source('lib/media-command/ai-director.ts').includes('workspacePage') && source('components/war-room/higher-vision-studios/HvsGlobalDirector.tsx').includes('workspacePage: page'), 'director knows page')
expect('editor_uses_bar', editor.includes('HvsProductionBar') && editor.includes("page={productionPage}"), 'editor bar')
expect('no_second_media', !workspace.includes("from '@/lib/media'") && !editor.includes("from '@/lib/media'"), 'no War Room Media')
expect('no_direct_mutation', workspace.includes('/commands') && workspace.includes('kind'), 'workspace uses commands API')
expect('honest_generate', (workspace + lanes).includes('SHELL') && (workspace + lanes).includes('providers not connected'), 'generate honesty')
expect('cut_reuses_editor', source('components/war-room/higher-vision-studios/HvsProjectPageRoute.tsx').includes("page === 'cut'") && source('components/war-room/higher-vision-studios/HvsProjectPageRoute.tsx').includes('HvsEditorShell'), 'cut = same shell')
expect('production_back', workspace.includes('HvsBackButton') && workspace.includes('data-testid="hvs-production-header"') && !workspace.includes('history.back') && !workspace.includes('router.back()'), 'production BACK')
expect('shared_back_used_by_editor', editor.includes('HvsBackButton'), 'editor reuses shared BACK')

for (const page of ['media', 'cut', 'vfx', 'color', 'audio', 'photo', 'ai', 'review', 'deliver'] as const) {
  const rel = `app/higher-vision-studios/projects/[id]/${page}/page.tsx`
  expect(`route_${page}`, existsSync(path.join(process.cwd(), rel)) && source(rel).includes(`page="${page}"`), rel)
}
expect('route_edit_remains', existsSync(path.join(process.cwd(), 'app/higher-vision-studios/projects/[id]/editor/page.tsx')) && source('app/higher-vision-studios/projects/[id]/editor/page.tsx').includes('HvsEditorShell'), 'editor route')

const failed = results.filter(item => !item.pass)
for (const item of results) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
}
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed: failed.length, total: results.length }, null, 2))
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, total: results.length, rows: HVS_MATRIX_ROWS.length }))
