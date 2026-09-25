import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { runWithWorkspaceRoot } from '@/lib/repo/workspaceContext'
import {
  createFoundrySession,
  getFoundrySession,
  listFoundrySessions,
  renameFoundrySession,
  FOUNDRY_SESSION_TITLE_MAX,
} from './foundrySessions'
import { createNewProjectWorkspace } from './workspaceRegistry'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

async function withProjectsRoot<T>(fn: (projectsRoot: string) => Promise<T>): Promise<T> {
  const previous = process.env.WAR_ROOM_PROJECTS_ROOT
  const projectsRoot = await mkdtemp(path.join(tmpdir(), 'wr-foundry-rename-'))
  process.env.WAR_ROOM_PROJECTS_ROOT = projectsRoot
  try {
    return await fn(projectsRoot)
  } finally {
    if (previous === undefined) delete process.env.WAR_ROOM_PROJECTS_ROOT
    else process.env.WAR_ROOM_PROJECTS_ROOT = previous
    await rm(projectsRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
  }
}

async function run() {
  const results = await withProjectsRoot(async () => {
    const ws = await createNewProjectWorkspace({ name: 'rename-box', initializeGit: false })
    return runWithWorkspaceRoot(ws.root, async () => {
      const created = await createFoundrySession({ title: 'Original Title', workspaceId: ws.id, projectName: 'rename-box' })
      const other = await createFoundrySession({ title: 'Keep Me', workspaceId: ws.id, projectName: 'rename-box' })
      const padded = await renameFoundrySession(created.id, '   Trimmed Title   ')
      const empty = await renameFoundrySession(created.id, '   ')
      const tooLong = await renameFoundrySession(created.id, 'X'.repeat(FOUNDRY_SESSION_TITLE_MAX + 1))
      const missing = await renameFoundrySession('missing-session', 'Nope')
      const valid = padded.ok ? padded.session : created
      const reloaded = await getFoundrySession(valid.id)
      const listed = await listFoundrySessions(ws.id)
      const otherReloaded = await getFoundrySession(other.id)
      return [
        check('rename_01_valid', padded.ok && padded.session.title === 'Trimmed Title', JSON.stringify(padded)),
        check('rename_02_trim', padded.ok && padded.session.title === 'Trimmed Title', padded.ok ? padded.session.title : padded.error),
        check('rename_03_reject_empty', !empty.ok && empty.code === 'EMPTY_TITLE', empty.ok ? 'ok' : empty.code),
        check('rename_04_id_unchanged', padded.ok && padded.session.id === created.id, padded.ok ? padded.session.id : padded.error),
        check('rename_05_workspace_unchanged', padded.ok && padded.session.workspaceId === ws.id, padded.ok ? String(padded.session.workspaceId) : padded.error),
        check('rename_06_persisted', reloaded?.title === 'Trimmed Title' && reloaded.id === created.id, reloaded?.title ?? 'missing'),
        check('rename_07_unrelated_untouched', otherReloaded?.title === 'Keep Me' && listed.some(item => item.id === other.id && item.title === 'Keep Me'), otherReloaded?.title ?? 'missing'),
        check('rename_08_reject_too_long', !tooLong.ok && tooLong.code === 'TOO_LONG', tooLong.ok ? 'ok' : tooLong.code),
        check('rename_09_missing', !missing.ok && missing.code === 'NOT_FOUND', missing.ok ? 'ok' : missing.code),
        check('rename_10_history_preserved', (reloaded?.chat.length ?? 0) === created.chat.length, String(reloaded?.chat.length)),
      ]
    }, ws.id)
  })
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Foundry session rename: ${results.filter(item => item.pass).length}/${results.length} PASS`)
  if (results.some(item => !item.pass)) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundrySessionRenameValidation }
