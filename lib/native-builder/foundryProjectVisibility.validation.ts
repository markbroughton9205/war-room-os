import { pathToFileURL } from 'node:url'
import {
  classifyFoundryProject,
  filterProjectsForView,
  isCommanderVisibleProject,
  isTestProjectClass,
} from './foundryProjectVisibility'
import { WAR_ROOM_CANONICAL_WORKSPACE_ID } from './foundryWorkspaceIdentityCore'
import { isPathInsideRoot } from './workspaceRegistry'
import type { WorkspaceRecord } from './workspaceRegistry'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function stub(overrides: Partial<WorkspaceRecord> & { root: string; label: string }): WorkspaceRecord {
  return {
    id: overrides.id ?? 'proj',
    createdAt: '2026-09-19T00:00:00.000Z',
    ...overrides,
  }
}

async function run() {
  const canonical = classifyFoundryProject(stub({
    id: WAR_ROOM_CANONICAL_WORKSPACE_ID,
    root: '/home/chosenone/Codex/war-room-os',
    label: 'WAR ROOM OS',
    projectType: 'war_room',
  }))
  const escapeBox = classifyFoundryProject(stub({
    root: '/tmp/wr-engineer-e2e-abc/escape-box',
    label: 'escape-box',
    name: 'escape-box',
    projectType: 'new_project',
  }))
  const cancelBox = classifyFoundryProject(stub({
    root: 'C:\\Users\\markb\\AppData\\Local\\Temp\\wr-engineer-e2e-xyz\\cancel-box',
    label: 'cancel-box',
    name: 'cancel-box',
  }))
  const uiVerify = classifyFoundryProject(stub({
    root: 'C:\\Users\\markb\\WarRoomProjects\\foundry-ui-verify',
    label: 'foundry-ui-verify',
    name: 'foundry-ui-verify',
    projectType: 'new_project',
  }))
  const realApp = classifyFoundryProject(stub({
    root: '/home/chosenone/WarRoomProjects/calculator',
    label: 'calculator',
    name: 'calculator',
    projectType: 'new_project',
  }))
  const listed = filterProjectsForView([
    stub({ id: WAR_ROOM_CANONICAL_WORKSPACE_ID, root: '/home/chosenone/Codex/war-room-os', label: 'WAR ROOM OS', projectType: 'war_room', classification: 'COMMANDER_REAL' }),
    stub({ id: 'e', root: '/tmp/wr-engineer-e2e-abc/escape-box', label: 'escape-box', classification: 'SYSTEM_TEST', testArtifact: true, visibility: 'system', archived: true }),
    stub({ id: 'c', root: '/home/chosenone/WarRoomProjects/calculator', label: 'calculator', projectType: 'new_project', classification: 'COMMANDER_REAL' }),
  ], 'commander')
  const results = [
    check('class_canonical', canonical.classification === 'COMMANDER_REAL', JSON.stringify(canonical)),
    check('class_escape_box', escapeBox.classification === 'SYSTEM_TEST' && isTestProjectClass(escapeBox.classification), JSON.stringify(escapeBox)),
    check('class_cancel_box', cancelBox.classification === 'SYSTEM_TEST', JSON.stringify(cancelBox)),
    check('class_foundry_ui_verify', uiVerify.classification === 'SYSTEM_TEST', JSON.stringify(uiVerify)),
    check('class_commander_new', realApp.classification === 'COMMANDER_REAL' && !isTestProjectClass(realApp.classification), JSON.stringify(realApp)),
    check('commander_hides_escape', listed.every(item => item.label !== 'escape-box') && listed.some(item => item.id === WAR_ROOM_CANONICAL_WORKSPACE_ID), listed.map(item => item.label).join(',')),
    check('canonical_always_visible', isCommanderVisibleProject({ id: WAR_ROOM_CANONICAL_WORKSPACE_ID, projectType: 'war_room' }), 'ok'),
    check('posix_rejects_windows_fixture_path', process.platform === 'win32' || !isPathInsideRoot('C:\\Users\\markb\\AppData\\Local\\Temp\\wr-engineer-e2e-ptG7dN\\escape-box', '/home/chosenone/Codex/war-room-os'), String(process.platform)),
  ]
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`Foundry project visibility: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryProjectVisibilityValidation }
