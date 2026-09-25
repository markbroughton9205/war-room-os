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
  restoreFoundrySession,
  saveFoundrySession,
} from './foundrySessions'
import { createNewProjectWorkspace } from './workspaceRegistry'
import { startMissionInput } from './foundryMissionController'
import { loadMission, saveMission } from './foundryMissionStore'
import { archiveConfirmedSystemTestMission } from './foundryMissionVisibility'
import { listResourceClaims } from './foundryResourceLocks'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

async function withProjectsRoot<T>(fn: (projectsRoot: string) => Promise<T>): Promise<T> {
  const previous = process.env.WAR_ROOM_PROJECTS_ROOT
  const projectsRoot = await mkdtemp(path.join(tmpdir(), 'wr-foundry-restore-'))
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
  const historical = startMissionInput('PASS 010 restore history fixture. This is a test application fixture, not a production install.')
  historical.status = 'COMPLETE'
  historical.testArtifact = true
  historical.visibility = 'system'
  historical.resumeEligible = false
  historical.archived = true
  await saveMission(historical)
  let results: CaseResult[] = []
  try {
    results = await withProjectsRoot(async () => {
      const ws = await createNewProjectWorkspace({ name: 'restore-box', initializeGit: false })
      return runWithWorkspaceRoot(ws.root, async () => {
        const created = await createFoundrySession({ title: 'Restore Me', workspaceId: ws.id, projectName: 'restore-box' })
        const other = await createFoundrySession({ title: 'Keep Visible', workspaceId: ws.id, projectName: 'restore-box' })
        await saveFoundrySession({
          ...created,
          chat: [{ id: 'c1', at: new Date().toISOString(), speaker: 'COMMANDER', text: 'keep this chat' }],
          missionIds: [historical.missionId],
          activeMissionId: historical.missionId,
        })
        const original = await getFoundrySession(created.id)
        const archived = await archiveFoundrySession(created.id)
        const hidden = await listFoundrySessions(ws.id)
        const archivedList = await listFoundrySessions(ws.id, { archivedOnly: true })
        const restored = await restoreFoundrySession(created.id)
        const visible = await listFoundrySessions(ws.id)
        const archivedAfter = await listFoundrySessions(ws.id, { archivedOnly: true })
        const reloaded = await getFoundrySession(created.id)
        const otherAfter = await getFoundrySession(other.id)
        const repeatRestore = await restoreFoundrySession(created.id)
        const missing = await restoreFoundrySession('missing-session')
        const neverArchived = await restoreFoundrySession(other.id)
        const reArchive = await archiveFoundrySession(created.id)
        const stillHidden = await listFoundrySessions(ws.id)
        const restoredAgain = await restoreFoundrySession(created.id)
        const persistVisible = await listFoundrySessions(ws.id)
        const missionAfter = await loadMission(historical.missionId)
        const claimsAfter = await listResourceClaims()
        const restoreClaims = claimsAfter.filter(claim => claim.missionId === historical.missionId)
        return [
          check('restore_01_archive', archived.ok && archived.session.archived === true, JSON.stringify(archived.ok ? { id: archived.session.id, archived: archived.session.archived } : archived)),
          check('restore_02_hidden_normal', archived.ok && !hidden.some(item => item.id === created.id), hidden.map(item => item.title).join(',')),
          check('restore_03_visible_archived', Boolean(archivedList.find(item => item.id === created.id && item.archived === true)), archivedList.map(item => item.title).join(',')),
          check('restore_04_restore', restored.ok && restored.session.archived === false && restored.alreadyRestored === false, restored.ok ? restored.session.id : restored.error),
          check('restore_05_visible_normal_again', restored.ok && visible.some(item => item.id === created.id && item.archived !== true), visible.map(item => item.title).join(',')),
          check('restore_06_removed_archived_list', !archivedAfter.some(item => item.id === created.id), archivedAfter.map(item => item.title).join(',')),
          check('restore_07_same_id', restored.ok && restored.session.id === created.id, restored.ok ? restored.session.id : restored.error),
          check('restore_08_same_workspace', restored.ok && restored.session.workspaceId === original?.workspaceId, restored.ok ? String(restored.session.workspaceId) : restored.error),
          check('restore_09_chat_preserved', restored.ok && restored.session.chat.length === (original?.chat.length ?? 0) && restored.session.chat[0]?.text === 'keep this chat', String(restored.ok ? restored.session.chat.length : 0)),
          check('restore_10_mission_ids_preserved', restored.ok && restored.session.missionIds.includes(historical.missionId), restored.ok ? restored.session.missionIds.join(',') : restored.error),
          check('restore_11_no_mission_resume', missionAfter?.status === 'COMPLETE' && missionAfter.resumeEligible === false && missionAfter.visibility === 'system' && restored.ok && restored.session.activeMissionId == null, `${missionAfter?.status}:${missionAfter?.resumeEligible}:activeMission=${restored.ok ? restored.session.activeMissionId : 'n/a'}`),
          check('restore_12_no_resource_reacquire', restoreClaims.length === 0, restoreClaims.map(claim => claim.resource).join(',') || 'none'),
          check('restore_12b_repeat_archive', reArchive.ok && stillHidden.every(item => item.id !== created.id), reArchive.ok ? String(reArchive.alreadyArchived) : reArchive.error),
          check('restore_13_repeat_restore', repeatRestore.ok && repeatRestore.alreadyRestored === true && restoredAgain.ok, JSON.stringify(repeatRestore.ok ? { alreadyRestored: repeatRestore.alreadyRestored } : repeatRestore)),
          check('restore_14_missing', !missing.ok && missing.code === 'NOT_FOUND', missing.ok ? 'ok' : missing.code),
          check('restore_15_unrelated', otherAfter?.title === 'Keep Visible' && otherAfter.archived !== true && persistVisible.some(item => item.id === other.id), otherAfter?.title ?? 'missing'),
          check('restore_16_reload_both_directions', reloaded?.id === created.id && persistVisible.some(item => item.id === created.id) && neverArchived.ok === false && neverArchived.code === 'NOT_ARCHIVED', `${reloaded?.archived}:${neverArchived.ok ? 'ok' : neverArchived.code}`),
        ]
      }, ws.id)
    })
  } finally {
    historical.testArtifact = true
    historical.visibility = 'system'
    historical.resumeEligible = false
    historical.archived = true
    await saveMission(historical)
    await archiveConfirmedSystemTestMission(historical).catch(() => undefined)
  }
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Foundry session restore: ${results.filter(item => item.pass).length}/${results.length} PASS`)
  if (results.some(item => !item.pass)) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundrySessionRestoreValidation }
