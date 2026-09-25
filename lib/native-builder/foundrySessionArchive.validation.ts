import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { runWithWorkspaceRoot } from '@/lib/repo/workspaceContext'
import {
  archiveFoundrySession,
  createFoundrySession,
  getFoundrySession,
  listFoundrySessions,
  saveFoundrySession,
} from './foundrySessions'
import { createNewProjectWorkspace } from './workspaceRegistry'
import { startMissionInput } from './foundryMissionController'
import { saveMission } from './foundryMissionStore'
import { archiveConfirmedSystemTestMission } from './foundryMissionVisibility'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

async function withProjectsRoot<T>(fn: (projectsRoot: string) => Promise<T>): Promise<T> {
  const previous = process.env.WAR_ROOM_PROJECTS_ROOT
  const projectsRoot = await mkdtemp(path.join(tmpdir(), 'wr-foundry-archive-'))
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
  const liveMission = startMissionInput('PASS 009 archive protection fixture. This is a test application fixture, not a production install.')
  liveMission.status = 'EXECUTING'
  liveMission.testArtifact = true
  liveMission.visibility = 'system'
  liveMission.resumeEligible = false
  await saveMission(liveMission)
  let results: CaseResult[] = []
  try {
    results = await withProjectsRoot(async () => {
      const ws = await createNewProjectWorkspace({ name: 'archive-box', initializeGit: false })
      return runWithWorkspaceRoot(ws.root, async () => {
        const created = await createFoundrySession({ title: 'Archive Me', workspaceId: ws.id, projectName: 'archive-box' })
        const other = await createFoundrySession({ title: 'Keep Me', workspaceId: ws.id, projectName: 'archive-box' })
        const protectedSession = await createFoundrySession({ title: 'Live Mission Session', workspaceId: ws.id, projectName: 'archive-box' })
        await saveFoundrySession({ ...protectedSession, activeMissionId: liveMission.missionId })
        const workspaceBefore = created.workspaceId
        const first = await archiveFoundrySession(created.id)
        const listed = await listFoundrySessions(ws.id)
        const listedAll = await listFoundrySessions(ws.id, { includeArchived: true })
        const reloaded = await getFoundrySession(created.id)
        const otherReloaded = await getFoundrySession(other.id)
        const repeat = await archiveFoundrySession(created.id)
        const missing = await archiveFoundrySession('missing-session')
        const blocked = await archiveFoundrySession(protectedSession.id)
        return [
          check('archive_01_existing', first.ok && first.session.archived === true, JSON.stringify(first)),
          check('archive_02_hidden_from_normal_list', first.ok && !listed.some(item => item.id === created.id), listed.map(item => item.title).join(',')),
          check('archive_03_retrievable_advanced', Boolean(listedAll.find(item => item.id === created.id && item.archived === true)), listedAll.map(item => `${item.title}:${item.archived}`).join(',')),
          check('archive_04_id_unchanged', first.ok && first.session.id === created.id, first.ok ? first.session.id : first.error),
          check('archive_05_workspace_unchanged', first.ok && first.session.workspaceId === workspaceBefore, first.ok ? String(first.session.workspaceId) : first.error),
          check('archive_06_unrelated_untouched', otherReloaded?.title === 'Keep Me' && listed.some(item => item.id === other.id && item.archived !== true), otherReloaded?.title ?? 'missing'),
          check('archive_07_reload_preserves', reloaded?.archived === true && reloaded.id === created.id, reloaded ? `${reloaded.archived}` : 'archived-missing'),
          check('archive_08_active_mission_protection', !blocked.ok && blocked.code === 'ACTIVE_MISSION', blocked.ok ? 'ok' : blocked.code),
          check('archive_09_missing', !missing.ok && missing.code === 'NOT_FOUND', missing.ok ? 'ok' : missing.code),
          check('archive_10_idempotent', repeat.ok && repeat.alreadyArchived === true && repeat.session.id === created.id, JSON.stringify(repeat)),
          check('archive_11_history_preserved', (reloaded?.chat.length ?? 0) === created.chat.length && (reloaded?.missionIds.length ?? 0) === created.missionIds.length, String(reloaded?.chat.length)),
          check('archive_12_not_current_resume', reloaded?.archived === true && listed.every(item => item.id !== created.id), 'archived hidden from commander list'),
        ]
      }, ws.id)
    })
  } finally {
    await archiveConfirmedSystemTestMission(liveMission).catch(() => undefined)
  }
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Foundry session archive: ${results.filter(item => item.pass).length}/${results.length} PASS`)
  if (results.some(item => !item.pass)) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundrySessionArchiveValidation }
