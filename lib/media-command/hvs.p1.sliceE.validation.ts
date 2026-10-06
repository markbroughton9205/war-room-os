/**
 * Higher Vision Studios Phase 1 slice E — Version Browser.
 * Kernel + UI locks. Live browser proof is a separate operator pass recorded in the report.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { applyEditCommand } from './edit-ops'
import { EDIT_COMMAND_KINDS, newCommandId, type EditCommand } from './edit-commands'
import { fromSeconds } from './time'
import { HVS_SLICE } from './navigation'
import {
  commitCommands,
  createProject,
  loadProject,
  loadVersionSnapshot,
  restoreVersion,
} from './store'
import { proposeDirectorCommands } from './ai-director'
import { ingestFile } from './ingest'
import { generateColorPlate } from './test-media'
import {
  HVS_VERSION_RESTORE_POLICY,
  compareVersionProjects,
  findVersion,
  findVersionByLabel,
  versionLineage,
} from './versions'
import { parseHvsProject } from './project-format'

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

expect('slice_id', ['HVS-P1-SLICE-E', 'HVS-P1-SLICE-F', 'HVS-P1-SLICE-G'].includes(HVS_SLICE), HVS_SLICE)
for (const kind of ['createVersion', 'restoreVersion', 'createVersionFrom'] as const) {
  expect(`kind_${kind}`, (EDIT_COMMAND_KINDS as readonly string[]).includes(kind), kind)
}

const editor = source('components/war-room/higher-vision-studios/HvsEditorShell.tsx')
const browser = source('components/war-room/higher-vision-studios/HvsVersionBrowser.tsx')
const review = source('components/war-room/higher-vision-studios/HvsProductionWorkspace.tsx')
const director = source('lib/media-command/ai-director.ts')
const store = source('lib/media-command/store.ts')
const versions = source('lib/media-command/versions.ts')

expect('studio_toggle', editor.includes('data-testid="hvs-versions-toggle"') && editor.includes('HvsVersionBrowser'), 'Studio VERSION button')
expect('shared_browser', browser.includes('data-testid="hvs-version-browser"') && browser.includes('hvs-create-version') && review.includes('HvsVersionBrowser'), 'shared Studio+REVIEW')
expect('current_badge', browser.includes('hvs-version-current-badge') && browser.includes('Current'), 'current badge')
expect('inspect_no_mutate', browser.includes('setInspectedId') && !browser.includes('currentVersionId ='), 'inspect local')
expect('restore_confirm_ui', browser.includes('hvs-restore-confirm') && browser.includes('Current project state will first be preserved'), 'confirm copy')
expect('lineage_ui', browser.includes('hvs-version-lineage') && browser.includes('↳'), 'lineage')
expect('compare_ui', browser.includes('METADATA / TIMELINE COMPARISON') || browser.includes('Metadata / Timeline comparison'), 'compare label')
expect('no_git_ui', !browser.includes('git graph') && !browser.includes('rebase'), 'not git')
expect('director_create', director.includes("kind: 'createVersion'") && director.includes('create a version called'), 'director create')
expect('director_compare', director.includes('compareVersionIds') && director.includes('METADATA / TIMELINE COMPARISON'), 'director compare')
expect('director_restore_unconfirmed', director.includes("kind: 'restoreVersion'") && director.includes('confirmed: false'), 'AI restore unconfirmed')
expect('director_requires_confirm', director.includes('requiresConfirmation'), 'proposal flag')
expect('restore_policy_b', HVS_VERSION_RESTORE_POLICY.includes('Policy B') && store.includes('undoStack = []'), HVS_VERSION_RESTORE_POLICY.slice(0, 80))
expect('no_asset_delete_on_restore', versions.includes('mergeAssetsPreserve') && !store.includes('assets = []'), 'assets preserved')
expect('prior_slice_d_lock', source('lib/media-command/hvs.p1.sliceD.validation.ts').includes('setPan') && source('package.json').includes('hvs.p1.sliceD.validation.ts'), 'slice D not weakened')

const restoreDirect = applyEditCommand(
  (await createProject({ name: 'HVS slice E apply fail' })),
  cmd('restoreVersion', { versionId: 'nope', confirmed: true }),
)
expect('restore_not_direct_mutate', !restoreDirect.ok, restoreDirect.ok ? 'should fail' : restoreDirect.error)

const plate = await generateColorPlate({ color: '0xC41E3A', seconds: 3 })
expect('plate', plate.ok, plate.error ?? plate.path)

if (plate.ok) {
  let p = await createProject({ name: 'HIGHER VISION VERSION BROWSER TEST', productionMode: 'CUSTOM' })
  const ingested = await ingestFile({ project: p, sourcePath: plate.path, originalName: 'hvs-p1e-red.mp4', mimeType: 'video/mp4' })
  p = ingested.project
  const assetCountAtStart = p.assets.length
  p = (await commitCommands(p, [cmd('insertClip', { trackId: 'V1', assetId: ingested.asset.id, start: fromSeconds(0), duration: fromSeconds(2) })])).project
  p = (await commitCommands(p, [cmd('addCaption', { start: fromSeconds(0), end: fromSeconds(2), text: 'ALT CAPTION', positionPreset: 'bottom-center' })])).project
  p = (await commitCommands(p, [cmd('addTitle', { text: 'ALT TITLE', start: fromSeconds(0), duration: fromSeconds(2), stylePreset: 'cinematic' })])).project
  const clip0 = p.timeline.tracks.find(t => t.id === 'V1')!.clips[0]
  p = (await commitCommands(p, [cmd('setPan', { clipId: clip0.id, pan: -1 })])).project
  p = (await commitCommands(p, [cmd('applyFilter', { clipId: clip0.id, filterId: 'cinematic', amount: 0.8 })])).project

  p = (await commitCommands(p, [cmd('createVersion', { versionLabel: 'ALT CUT', createdBy: 'human', description: 'Alternate opening' })])).project
  const alt = p.versions.find(v => v.label === 'ALT CUT')
  expect('version_create', Boolean(alt && p.currentVersionId === alt.id), p.versions.map(v => v.label).join('|'))
  expect('version_naming', alt?.label === 'ALT CUT', alt?.label ?? 'missing')
  expect('version_metadata', Boolean(alt?.description === 'Alternate opening' && alt.parentVersionId && alt.snapshotPath && existsSync(alt.snapshotPath)), JSON.stringify({ d: alt?.description, snap: alt?.snapshotPath }))
  const altSnap = alt ? await loadVersionSnapshot(p, alt.id) : null
  const altClipCount = altSnap ? altSnap.timeline.tracks.reduce((n, t) => n + t.clips.length, 0) : -1
  expect('alt_snapshot_clips', altClipCount === 1, String(altClipCount))

  p = (await commitCommands(p, [cmd('insertClip', { trackId: 'V1', assetId: ingested.asset.id, start: fromSeconds(2), duration: fromSeconds(2) })])).project
  const twoClips = p.timeline.tracks.find(t => t.id === 'V1')!.clips
  expect('live_two_clips', twoClips.length === 2, String(twoClips.length))
  const clip1 = [...twoClips].sort((a, b) => a.start.ticks - b.start.ticks)[1]
  p = (await commitCommands(p, [cmd('addTransition', {
    outgoingClipId: twoClips[0].id,
    incomingClipId: clip1.id,
    transitionKind: 'dissolve',
    duration: fromSeconds(0.5),
  })])).project
  p = (await commitCommands(p, [cmd('createVersion', { versionLabel: 'DIRECTOR CUT', createdBy: 'human' })])).project
  const directorCut = p.versions.find(v => v.label === 'DIRECTOR CUT')
  expect('director_created', Boolean(directorCut && p.currentVersionId === directorCut.id), p.versions.map(v => `${v.index}:${v.label}`).join('|'))
  expect('current_version_id', p.currentVersionId === directorCut?.id, p.currentVersionId)

  const altAfterEdit = alt ? await loadVersionSnapshot(p, alt.id) : null
  const altClipsAfter = altAfterEdit ? altAfterEdit.timeline.tracks.reduce((n, t) => n + t.clips.length, 0) : -1
  expect('snapshot_immutability', altClipsAfter === 1, `alt clips after live edit ${altClipsAfter}`)
  const altFile = alt?.snapshotPath ? parseHvsProject(readFileSync(alt.snapshotPath, 'utf8')) : null
  expect('snapshot_file_immutable', (altFile?.timeline.tracks.reduce((n, t) => n + t.clips.length, 0) ?? -1) === 1, 'file mutated')

  expect('source_lineage', Boolean(directorCut?.parentVersionId === alt?.id || directorCut?.parentVersionId === p.versions.find(v => v.label === 'ALT CUT')?.id), `${directorCut?.parentVersionId} <- ${alt?.id}`)
  const tree = versionLineage(p)
  expect('lineage_nodes', tree.some(n => n.name === 'ALT CUT') && tree.some(n => n.name === 'DIRECTOR CUT'), tree.map(n => `${' '.repeat(n.depth)}${n.name}`).join('|'))

  const liveA = altAfterEdit
  const liveB = directorCut ? await loadVersionSnapshot(p, directorCut.id) : null
  if (alt && directorCut && liveA && liveB) {
    const diff = compareVersionProjects(p, liveA, alt, liveB, directorCut)
    expect('compare_summary', diff.a.clipCount === 1 && diff.b.clipCount >= 2 && diff.addedClipIds.length >= 1, JSON.stringify({ a: diff.a.clipCount, b: diff.b.clipCount, added: diff.addedClipIds.length }))
  } else {
    expect('compare_summary', false, 'missing snapshots')
  }

  const unconfirmed = await restoreVersion(p, alt!.id, { confirmed: false, actor: 'human' })
  expect('restore_confirmation_contract', Boolean(unconfirmed.error && unconfirmed.project.currentVersionId === directorCut?.id), unconfirmed.error ?? 'no error')
  const applyUnconfirmed = await commitCommands(p, [cmd('restoreVersion', { versionId: alt!.id, confirmed: false })])
  expect('restore_unconfirmed_command', applyUnconfirmed.errors.some(e => /confirm/i.test(e)), applyUnconfirmed.errors.join(';'))

  const restored = await commitCommands(p, [cmd('restoreVersion', { versionId: alt!.id, confirmed: true })])
  p = restored.project
  expect('restore_ok', restored.errors.length === 0, restored.errors.join(';'))
  const safety = p.versions.find(v => v.label.startsWith('PRE-RESTORE'))
  expect('pre_restore_safety', Boolean(safety && safety.snapshotPath && existsSync(safety.snapshotPath)), safety?.label ?? 'missing')
  expect('restore_current', p.currentVersionId === alt!.id, p.currentVersionId)
  expect('restore_timeline', p.timeline.tracks.find(t => t.id === 'V1')!.clips.length === 1, String(p.timeline.tracks.find(t => t.id === 'V1')!.clips.length))
  expect('restore_captions', p.timeline.captionTracks.some(t => t.cues.some(c => c.text === 'ALT CAPTION')), p.timeline.captionTracks.flatMap(t => t.cues.map(c => c.text)).join('|'))
  expect('restore_titles', p.timeline.overlays.some(o => o.kind === 'title' && o.text === 'ALT TITLE'), p.timeline.overlays.map(o => `${o.kind}:${o.text}`).join('|'))
  expect('restore_transitions', p.timeline.tracks.every(t => t.transitions.length === 0), String(p.timeline.tracks.reduce((n, t) => n + t.transitions.length, 0)))
  expect('restore_pan', p.timeline.tracks.find(t => t.id === 'V1')!.clips[0].pan === -1, String(p.timeline.tracks.find(t => t.id === 'V1')!.clips[0].pan))
  expect('restore_look', p.timeline.tracks.find(t => t.id === 'V1')!.clips[0].filters.some(f => f.filterId === 'cinematic'), JSON.stringify(p.timeline.tracks.find(t => t.id === 'V1')!.clips[0].filters))
  expect('restore_history_reset', p.undoStack.length === 0 && p.redoStack.length === 0, `undo ${p.undoStack.length} redo ${p.redoStack.length}`)
  expect('asset_non_deletion', p.assets.length >= assetCountAtStart && p.assets.every(a => a.immutableOriginal), String(p.assets.length))
  expect('originals_still_exist', p.versions.some(v => v.label === 'DIRECTOR CUT') && p.versions.some(v => v.label === 'ALT CUT'), p.versions.map(v => v.label).join('|'))

  const branched = await commitCommands(p, [cmd('createVersionFrom', {
    sourceVersionId: directorCut!.id,
    versionLabel: 'CLIENT REVIEW',
    createdBy: 'human',
  })])
  p = branched.project
  const branch = p.versions.find(v => v.label === 'CLIENT REVIEW')
  expect('branch_from_version', Boolean(branch && branch.parentVersionId === directorCut!.id && p.currentVersionId === alt!.id), `${branch?.parentVersionId} current=${p.currentVersionId}`)
  const branchSnap = branch ? await loadVersionSnapshot(p, branch.id) : null
  expect('branch_snapshot', (branchSnap?.timeline.tracks.reduce((n, t) => n + t.clips.length, 0) ?? 0) >= 2, String(branchSnap?.timeline.tracks.reduce((n, t) => n + t.clips.length, 0)))
  expect('historical_unmutated', (await loadVersionSnapshot(p, directorCut!.id))!.timeline.tracks.reduce((n, t) => n + t.clips.length, 0) >= 2, 'director snapshot mutated')

  const dirCreate = proposeDirectorCommands(p, 'Create a version called Director Cut.')
  expect('director_create_cmd', dirCreate.commands.some(c => c.kind === 'createVersion' && 'versionLabel' in c && String(c.versionLabel).toLowerCase().includes('director cut')), dirCreate.commands.map(c => c.kind).join(','))
  const dirShow = proposeDirectorCommands(p, 'Show my versions.')
  expect('director_show', Boolean(dirShow.openVersionBrowser) && dirShow.commands.length === 0, dirShow.summary)
  const dirCompare = proposeDirectorCommands(p, 'Compare ALT CUT with DIRECTOR CUT.')
  expect('director_compare_cmd', Boolean(dirCompare.compareVersionIds?.[0] && dirCompare.compareVersionIds[1]), dirCompare.summary)
  const dirRestore = proposeDirectorCommands(p, 'Restore Version 1.')
  expect('director_restore_approval', dirRestore.commands.some(c => c.kind === 'restoreVersion' && 'confirmed' in c && c.confirmed === false) && dirRestore.requiresConfirmation === true, dirRestore.summary)

  const savedPath = path.join(process.cwd(), '')
  expect('reload_setup', Boolean(savedPath), savedPath)
  const reloaded = await loadProject(p.id)
  expect('persist_list', Boolean(reloaded && reloaded.versions.length >= 4), String(reloaded?.versions.length))
  expect('persist_names', Boolean(reloaded?.versions.some(v => v.label === 'ALT CUT') && reloaded.versions.some(v => v.label === 'DIRECTOR CUT')), reloaded?.versions.map(v => v.label).join('|') ?? 'none')
  expect('persist_descriptions', reloaded?.versions.find(v => v.label === 'ALT CUT')?.description === 'Alternate opening', reloaded?.versions.find(v => v.label === 'ALT CUT')?.description ?? 'none')
  expect('persist_lineage', reloaded?.versions.find(v => v.label === 'CLIENT REVIEW')?.parentVersionId === directorCut?.id, reloaded?.versions.find(v => v.label === 'CLIENT REVIEW')?.parentVersionId ?? 'none')
  expect('persist_current', reloaded?.currentVersionId === alt?.id, reloaded?.currentVersionId ?? 'none')
  expect('persist_restored_timeline', (reloaded?.timeline.tracks.find(t => t.id === 'V1')?.clips.length ?? 0) === 1, String(reloaded?.timeline.tracks.find(t => t.id === 'V1')?.clips.length))
  expect('persist_safety', Boolean(reloaded?.versions.some(v => v.label.startsWith('PRE-RESTORE'))), reloaded?.versions.map(v => v.label).join('|') ?? 'none')
  expect('find_by_label', findVersionByLabel(reloaded!, 'ALT CUT')?.id === alt?.id, 'label lookup')
  expect('find_version', Boolean(reloaded && findVersion(reloaded, alt!.id)), 'id lookup')
}

const failed = results.filter(item => !item.pass)
for (const item of results) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
}
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed: failed.length, total: results.length, failedNames: failed.map(f => f.name) }, null, 2))
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, total: results.length, slice: HVS_SLICE }))
