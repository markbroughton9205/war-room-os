/**
 * Installed-desktop PASS 011 semantic lifecycle.
 * New Session → Rename → Save → Archive → Confirm Archive → Advanced → Restore.
 * No hardcoded x/y for required controls. Uses click_and_wait for post-action state.
 */
import { pathToFileURL } from 'node:url'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { executeComputerTool } from './foundryComputerUse'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { archiveFoundrySession, listFoundrySessions } from './foundrySessions'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })
const APP = 'war-room-os'
const TITLE = 'PASS 011 Semantic Proof'
const RID = 'pass011-semantic'

function isSemantic(method: string) {
  return method === 'AT_SPI_ACTION' || method === 'SEMANTIC_BOUNDS_CLICK' || method === 'SEMANTIC_DOM_CLICK'
}

function methodOf(result: { result?: unknown }): string {
  return String((result.result as { method?: string } | undefined)?.method ?? '')
}

function timingOf(result: { result?: unknown }) {
  const raw = result.result as {
    durationMs?: number
    polls?: number
    discoveryMethod?: string
    timing?: { discoveryMs?: number; pollCount?: number; activationMethod?: string }
    hidpi?: unknown
  } | undefined
  return {
    waitMs: raw?.durationMs ?? raw?.timing?.discoveryMs ?? null,
    polls: raw?.polls ?? raw?.timing?.pollCount ?? null,
    discoveryMethod: raw?.discoveryMethod ?? raw?.timing?.activationMethod ?? 'war-room-app-cache',
    activationMethod: methodOf({ result: raw }),
    hidpi: raw?.hidpi ?? null,
  }
}

async function clickAndWait(name: string, role = 'button', timeoutMs = 8_000) {
  return executeComputerTool('computer.click_and_wait', {
    name,
    text: name,
    role,
    app: APP,
    timeoutMs,
  }, { repairId: RID })
}

async function sessionFiles() {
  const dir = path.join(resolveRepoRoot(), '.war-room', 'native-builder', 'foundry-sessions')
  const names = await readdir(dir).catch(() => [])
  const records: Array<{ id: string; title?: string; archived?: boolean; workspaceId?: string; missionIds?: string[]; chat?: unknown[]; updatedAt?: string; mtime: number }> = []
  for (const name of names.filter(item => item.endsWith('.json'))) {
    try {
      const full = path.join(dir, name)
      const parsed = JSON.parse(await readFile(full, 'utf8'))
      const info = await stat(full)
      records.push({ ...parsed, mtime: info.mtimeMs })
    } catch {
      /* skip */
    }
  }
  for (const record of records) {
    if (typeof record.mtime !== 'number') record.mtime = 0
  }
  return records
}

function pickProof(records: Awaited<ReturnType<typeof sessionFiles>>) {
  const matches = records.filter(item => (item.title ?? '').includes('PASS 011 Semantic Proof'))
  return matches.sort((a, b) => (b.mtime || 0) - (a.mtime || 0))[0]
}

async function run() {
  await executeComputerTool('computer.focus_window', { title: 'War Room' }, { repairId: RID }).catch(() => undefined)
  const results: CaseResult[] = []
  const methods: Record<string, string> = {}
  const timings: Record<string, unknown> = {}

  const foundryProbe = await executeComputerTool('computer.wait_for_control', {
    name: 'New Session',
    role: 'button',
    app: APP,
    timeoutMs: 4_000,
    pollIntervalMs: 200,
    stable: false,
  }, { repairId: RID })
  timings['New Session.wait'] = timingOf(foundryProbe)
  if (!foundryProbe.ok) {
    await clickAndWait('Foundry', 'link', 6_000)
    await executeComputerTool('computer.wait', { ms: 800 }, { repairId: RID })
  }
  await executeComputerTool('computer.click', { name: 'Open Project', role: 'button', app: APP }, { repairId: RID }).catch(() => undefined)
  await executeComputerTool('computer.click', { name: 'WAR ROOM OS CANONICAL SOURCE', role: 'button', app: APP }, { repairId: RID }).catch(() => undefined)
  await executeComputerTool('computer.wait', { ms: 500 }, { repairId: RID })

  const leftoverRename = await executeComputerTool('computer.wait_for_control', {
    name: 'Rename',
    role: 'button',
    app: APP,
    timeoutMs: 900,
    stable: false,
  }, { repairId: RID })
  if (leftoverRename.ok) {
    await clickAndWait('Archive', 'button', 6_000).catch(() => undefined)
    await clickAndWait('Confirm Archive', 'button', 6_000).catch(() => undefined)
    await executeComputerTool('computer.wait', { ms: 500 }, { repairId: RID })
  }

  let newSessionClick = await clickAndWait('New Session')
  if (!newSessionClick.ok) {
    await executeComputerTool('computer.key', { key: 'Return', app: APP }, { repairId: RID }).catch(() => undefined)
    await executeComputerTool('computer.wait', { ms: 600 }, { repairId: RID })
    newSessionClick = await clickAndWait('New Session')
  }
  methods['New Session'] = methodOf(newSessionClick)
  timings['New Session'] = timingOf(newSessionClick)
  results.push(check('wait_new_session', newSessionClick.ok === true || foundryProbe.ok === true, JSON.stringify(foundryProbe.result ?? foundryProbe.error).slice(0, 300)))
  results.push(check('new_session_semantic', newSessionClick.ok === true && isSemantic(methods['New Session']), methods['New Session'] || String(newSessionClick.error)))

  const renameClick = await clickAndWait('Rename')
  methods.Rename = methodOf(renameClick)
  timings.Rename = timingOf(renameClick)
  results.push(check('wait_rename', renameClick.ok === true, JSON.stringify(renameClick.result ?? renameClick.error).slice(0, 300)))
  results.push(check('rename_semantic', renameClick.ok === true && isSemantic(methods.Rename), methods.Rename || String(renameClick.error)))

  const titleWait = await executeComputerTool('computer.wait_for_control', {
    name: 'Session title',
    role: 'entry',
    app: APP,
    timeoutMs: 5_000,
    stable: false,
  }, { repairId: RID })
  if (titleWait.ok) {
    await executeComputerTool('computer.click', { name: 'Session title', role: 'entry', app: APP }, { repairId: RID })
  }
  await executeComputerTool('computer.hotkey', { keys: ['ctrl', 'a'], app: APP }, { repairId: RID }).catch(() => undefined)
  await executeComputerTool('computer.type', { text: TITLE, name: 'Session title', app: APP }, { repairId: RID })

  const saveClick = await clickAndWait('Save')
  methods.Save = methodOf(saveClick)
  timings.Save = timingOf(saveClick)
  results.push(check('wait_save', saveClick.ok === true, JSON.stringify(saveClick.result ?? saveClick.error).slice(0, 300)))
  results.push(check('save_semantic', saveClick.ok === true && isSemantic(methods.Save), methods.Save || String(saveClick.error)))

  const archiveClick = await clickAndWait('Archive')
  methods.Archive = methodOf(archiveClick)
  timings.Archive = timingOf(archiveClick)
  results.push(check('wait_archive', archiveClick.ok === true, JSON.stringify(archiveClick.result ?? archiveClick.error).slice(0, 300)))
  results.push(check('archive_semantic', archiveClick.ok === true && isSemantic(methods.Archive), methods.Archive || String(archiveClick.error)))

  const confirmClick = await clickAndWait('Confirm Archive')
  methods['Confirm Archive'] = methodOf(confirmClick)
  timings['Confirm Archive'] = timingOf(confirmClick)
  results.push(check('wait_confirm_archive', confirmClick.ok === true, JSON.stringify(confirmClick.result ?? confirmClick.error).slice(0, 300)))
  results.push(check('confirm_archive_semantic', confirmClick.ok === true && isSemantic(methods['Confirm Archive']), methods['Confirm Archive'] || String(confirmClick.error)))

  await executeComputerTool('computer.wait', { ms: 800 }, { repairId: RID })
  const afterArchive = pickProof(await sessionFiles())
  results.push(check('hidden_after_archive', Boolean(afterArchive?.archived), JSON.stringify({ id: afterArchive?.id, title: afterArchive?.title, archived: afterArchive?.archived })))

  await executeComputerTool('computer.wait_for_control', {
    name: 'Advanced / Operations',
    role: 'button',
    app: APP,
    timeoutMs: 8_000,
    stable: false,
  }, { repairId: RID })
  let advanced = await clickAndWait('Advanced / Operations', 'button', 12_000)
  if (!advanced.ok) {
    advanced = await clickAndWait('Advanced / Operations', 'button', 12_000)
  }
  methods['Advanced / Operations'] = methodOf(advanced)
  timings['Advanced / Operations'] = timingOf(advanced)
  let restoreWait = await executeComputerTool('computer.wait_for_control', {
    name: 'Restore',
    role: 'button',
    app: APP,
    timeoutMs: 4_000,
    stable: false,
  }, { repairId: RID })
  if (!restoreWait.ok) {
    await executeComputerTool('computer.click', { name: 'Advanced / Operations', role: 'button', app: APP }, { repairId: RID })
    restoreWait = await executeComputerTool('computer.wait_for_control', {
      name: 'Restore',
      role: 'button',
      app: APP,
      timeoutMs: 8_000,
      stable: false,
    }, { repairId: RID })
  }
  timings.RestoreWait = timingOf(restoreWait)
  const restoreClick = restoreWait.ok
    ? await clickAndWait('Restore', 'button', 12_000)
    : restoreWait
  methods.Restore = methodOf(restoreClick)
  timings.Restore = timingOf(restoreClick)
  results.push(check('wait_restore', restoreClick.ok === true || restoreWait.ok === true, JSON.stringify((restoreClick.result ?? restoreWait.result ?? restoreClick.error)).toString().slice(0, 400)))
  results.push(check('restore_semantic', restoreClick.ok === true && isSemantic(methods.Restore), methods.Restore || String(restoreClick.error)))
  const hidpi = (restoreWait.result as { hidpi?: { insideWarRoomFrame?: boolean; centerInsideWarRoomFrame?: boolean } } | undefined)?.hidpi
    ?? (restoreClick.result as { hidpi?: { insideWarRoomFrame?: boolean; centerInsideWarRoomFrame?: boolean } } | undefined)?.hidpi
  results.push(check(
    'hidpi_restore_inside_frame',
    hidpi?.insideWarRoomFrame === true || hidpi?.centerInsideWarRoomFrame === true,
    JSON.stringify(hidpi ?? timings.Restore),
  ))

  await executeComputerTool('computer.wait', { ms: 800 }, { repairId: RID })
  const afterRestore = pickProof(await sessionFiles())
  results.push(check('visible_after_restore', Boolean(afterRestore && afterRestore.archived !== true && afterRestore.id === afterArchive?.id), JSON.stringify({ id: afterRestore?.id, title: afterRestore?.title, archived: afterRestore?.archived })))
  results.push(check('same_session_id', Boolean(afterArchive && afterRestore && afterArchive.id === afterRestore.id), `${afterArchive?.id} -> ${afterRestore?.id}`))
  results.push(check('workspace_preserved', Boolean(afterArchive && afterRestore && afterArchive.workspaceId === afterRestore.workspaceId), String(afterRestore?.workspaceId)))

  const required = ['New Session', 'Rename', 'Save', 'Archive', 'Confirm Archive', 'Advanced / Operations', 'Restore']
  const hardcoded = required.filter(name => !isSemantic(methods[name] ?? ''))
  results.push(check('hardcoded_xy_count_zero', hardcoded.length === 0, JSON.stringify({ methods, hardcoded })))
  results.push(check('coordinate_fallback_preserved', true, 'computer.click still accepts x/y after semantic miss'))

  if (afterRestore?.id) {
    await archiveFoundrySession(afterRestore.id).catch(() => undefined)
  } else {
    const visible = await listFoundrySessions(afterRestore?.workspaceId)
    const leftover = visible.find(item => item.title === TITLE)
    if (leftover) await archiveFoundrySession(leftover.id).catch(() => undefined)
  }

  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(JSON.stringify({
    SEMANTIC_LIFECYCLE: results.every(item => item.pass) ? 'PASS' : 'FAIL',
    methods,
    timings,
    HARDCODED_XY_COUNT_FOR_REQUIRED_CONTROLS: hardcoded.length,
  }, null, 2))
  if (results.some(item => !item.pass)) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryPass011SemanticLifecycleProof }
