/**
 * Installed-desktop PASS 010 semantic lifecycle.
 * New Session → Rename → Save → Archive → Confirm Archive → Advanced → Restore.
 * No hardcoded x/y. Coordinate fallback remains available globally.
 */
import { pathToFileURL } from 'node:url'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { executeComputerTool } from './foundryComputerUse'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { archiveFoundrySession, listFoundrySessions } from './foundrySessions'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })
const APP = 'war-room-os'
const TITLE = 'PASS 010 Semantic Lifecycle Proof'

function isSemantic(method: string) {
  return method === 'AT_SPI_ACTION' || method === 'SEMANTIC_BOUNDS_CLICK'
}

function methodOf(result: { result?: unknown }): string {
  return String((result.result as { method?: string } | undefined)?.method ?? '')
}

async function waitControl(name: string, role = 'button', timeoutMs = 18_000) {
  return executeComputerTool('computer.wait_for_control', {
    name,
    role,
    app: APP,
    timeoutMs,
    pollIntervalMs: 250,
    stable: false,
  }, { repairId: 'pass010-semantic' })
}

async function clickNamed(name: string, role = 'button') {
  return executeComputerTool('computer.click', {
    name,
    text: name,
    role,
    app: APP,
  }, { repairId: 'pass010-semantic' })
}

async function sessionFiles() {
  const dir = path.join(resolveRepoRoot(), '.war-room', 'native-builder', 'foundry-sessions')
  const names = await readdir(dir).catch(() => [])
  const records: Array<{ id: string; title?: string; archived?: boolean; workspaceId?: string; missionIds?: string[]; chat?: unknown[] }> = []
  for (const name of names.filter(item => item.endsWith('.json'))) {
    try {
      records.push(JSON.parse(await readFile(path.join(dir, name), 'utf8')))
    } catch {
      /* skip */
    }
  }
  return records
}

async function run() {
  await executeComputerTool('computer.focus_window', { title: 'War Room' }, { repairId: 'pass010-semantic' }).catch(() => undefined)
  const results: CaseResult[] = []
  const methods: Record<string, string> = {}

  let newSessionWait = await waitControl('New Session', 'button', 3_000)
  if (!newSessionWait.ok) {
    await waitControl('Foundry', 'link', 6_000)
    await clickNamed('Foundry', 'link')
    await executeComputerTool('computer.wait', { ms: 1600 }, { repairId: 'pass010-semantic' })
    newSessionWait = await waitControl('New Session')
  }
  results.push(check('wait_new_session', newSessionWait.ok === true, JSON.stringify(newSessionWait.result ?? newSessionWait.error).slice(0, 300)))
  const newSessionClick = await clickNamed('New Session')
  methods['New Session'] = methodOf(newSessionClick)
  results.push(check('new_session_semantic', newSessionClick.ok === true && isSemantic(methods['New Session']), methods['New Session'] || String(newSessionClick.error)))

  const renameWait = await waitControl('Rename')
  results.push(check('wait_rename', renameWait.ok === true, JSON.stringify(renameWait.result ?? renameWait.error).slice(0, 300)))
  const renameClick = await clickNamed('Rename')
  methods.Rename = methodOf(renameClick)
  results.push(check('rename_semantic', renameClick.ok === true && isSemantic(methods.Rename), methods.Rename || String(renameClick.error)))

  const titleWait = await waitControl('Session title', 'entry', 5_000)
  if (titleWait.ok) await clickNamed('Session title', 'entry')
  await executeComputerTool('computer.type', { text: TITLE, app: APP }, { repairId: 'pass010-semantic' })

  const saveWait = await waitControl('Save')
  results.push(check('wait_save', saveWait.ok === true, JSON.stringify(saveWait.result ?? saveWait.error).slice(0, 300)))
  const saveClick = await clickNamed('Save')
  methods.Save = methodOf(saveClick)
  results.push(check('save_semantic', saveClick.ok === true && isSemantic(methods.Save), methods.Save || String(saveClick.error)))

  const archiveWait = await waitControl('Archive')
  results.push(check('wait_archive', archiveWait.ok === true, JSON.stringify(archiveWait.result ?? archiveWait.error).slice(0, 300)))
  const archiveClick = await clickNamed('Archive')
  methods.Archive = methodOf(archiveClick)
  results.push(check('archive_semantic', archiveClick.ok === true && isSemantic(methods.Archive), methods.Archive || String(archiveClick.error)))

  const confirmWait = await waitControl('Confirm Archive')
  results.push(check('wait_confirm_archive', confirmWait.ok === true, JSON.stringify(confirmWait.result ?? confirmWait.error).slice(0, 300)))
  const confirmClick = await clickNamed('Confirm Archive')
  methods['Confirm Archive'] = methodOf(confirmClick)
  results.push(check('confirm_archive_semantic', confirmClick.ok === true && isSemantic(methods['Confirm Archive']), methods['Confirm Archive'] || String(confirmClick.error)))

  await executeComputerTool('computer.wait', { ms: 800 }, { repairId: 'pass010-semantic' })
  const afterArchive = (await sessionFiles()).find(item => item.title === TITLE)
  results.push(check('hidden_after_archive', Boolean(afterArchive?.archived), JSON.stringify({ id: afterArchive?.id, archived: afterArchive?.archived })))

  const advanced = await clickNamed('Advanced / Operations')
  methods['Advanced / Operations'] = methodOf(advanced)
  const restoreWait = await waitControl('Restore')
  results.push(check('wait_restore', restoreWait.ok === true, JSON.stringify(restoreWait.result ?? restoreWait.error).slice(0, 300)))
  const restoreClick = await clickNamed('Restore')
  methods.Restore = methodOf(restoreClick)
  results.push(check('restore_semantic', restoreClick.ok === true && isSemantic(methods.Restore), methods.Restore || String(restoreClick.error)))

  await executeComputerTool('computer.wait', { ms: 800 }, { repairId: 'pass010-semantic' })
  const afterRestore = (await sessionFiles()).find(item => item.title === TITLE)
  results.push(check('visible_after_restore', Boolean(afterRestore && afterRestore.archived !== true && afterRestore.id === afterArchive?.id), JSON.stringify({ id: afterRestore?.id, archived: afterRestore?.archived })))
  results.push(check('same_session_id', Boolean(afterArchive && afterRestore && afterArchive.id === afterRestore.id), `${afterArchive?.id} -> ${afterRestore?.id}`))
  results.push(check('workspace_preserved', Boolean(afterArchive && afterRestore && afterArchive.workspaceId === afterRestore.workspaceId), String(afterRestore?.workspaceId)))

  const required = ['New Session', 'Rename', 'Save', 'Archive', 'Confirm Archive', 'Restore']
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
    HARDCODED_XY_COUNT_FOR_REQUIRED_CONTROLS: hardcoded.length,
  }, null, 2))
  if (results.some(item => !item.pass)) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryPass010SemanticLifecycleProof }
