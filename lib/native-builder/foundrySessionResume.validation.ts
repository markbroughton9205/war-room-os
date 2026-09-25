/**
 * Foundry Engineering Runtime 01A — session-list resume fallback only.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveSessionListMissionId } from './foundrySessionResume'

const results: { name: string; pass: boolean; detail: string }[] = []
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`)
}

const flush = '2e3656ef-a5fd-4e9f-a084-dd3345a3534f'
const governance = '13c002ed-31d8-44c7-a989-507ea45bd0ef'
const active = 'mission-active-current'

const completed = resolveSessionListMissionId({ activeMissionId: null, missionIds: [flush] })
const preferred = resolveSessionListMissionId({ activeMissionId: active, missionIds: [flush, 'older'] })
const sessionA = resolveSessionListMissionId({ missionIds: ['mission-a'] })
const sessionB = resolveSessionListMissionId({ missionIds: ['mission-b', 'mission-b2'] })
const missing = resolveSessionListMissionId({ activeMissionId: '   ', missionIds: ['', '  '] })
const blankSkipped = resolveSessionListMissionId({ missionIds: ['', governance] })

check('SESSION_LIST_COMPLETED_RESUME', completed === flush, completed ?? 'null')
check('ACTIVE_SESSION_RESUME', preferred === active, preferred ?? 'null')
check('SESSION_MISSION_CROSSWIRE_COUNT', sessionA === 'mission-a' && sessionB === 'mission-b2' && sessionA !== sessionB, `${sessionA} ${sessionB}`)
check('MISSING_MISSION_SAFETY', missing === null, missing ?? 'null')
check('blank_ids_skipped', blankSkipped === governance, blankSkipped ?? 'null')

const shell = readFileSync(path.join(process.cwd(), 'components/war-room/foundry/FoundryShell.tsx'), 'utf8')
check('shell_uses_resolver', shell.includes('resolveSessionListMissionId(s)'), 'click')
check('shell_unavailable_state', shell.includes('foundry-mission-history-unavailable') && shell.includes("missionLoad === 'absent'") && !shell.includes('MISSION_HISTORY_UNAVAILABLE') && shell.includes('Loading conversation'), 'banner is state-based, human-language, and only for a genuinely absent/unrecoverable mission')
check('shell_controller_missions_are_not_missing_history', shell.includes('/api/foundry/missions/${missionId}') && shell.includes('mission-controller store'), 'Standalone missions resolve through the controller store')
check('TERMINAL_DEFAULT_COLLAPSED', shell.includes("data-terminal-collapsed={drawer === 'terminal' ? 'false' : 'true'}") && shell.includes("useState<'hidden' | 'terminal' | 'diff' | 'tests' | 'logs' | 'processes'>('hidden')"), 'drawer')
check('activity_restore_owner', shell.includes('FoundryQuietThread') && shell.includes('engineeringRuntime?.events'), 'cards')
check('GOVERNANCE_REGRESSION', shell.includes('Commit requires Commander approval.') && shell.includes('Push requires Commander approval.'), 'gates')
check('no_event_model_edit', !shell.includes('FOUNDRY_ENGINEERING_EVENT_TYPES'), 'shell')

const failed = results.filter(item => !item.pass)
console.log(`SESSION_LIST_COMPLETED_RESUME = ${completed === flush ? 'PASS' : 'FAIL'}`)
console.log(`ACTIVE_SESSION_RESUME = ${preferred === active ? 'PASS' : 'FAIL'}`)
console.log(`SESSION_MISSION_CROSSWIRE_COUNT = ${sessionA !== sessionB && sessionA === 'mission-a' && sessionB === 'mission-b2' ? 0 : 1}`)
console.log(`MISSING_MISSION_SAFETY = ${missing === null ? 'PASS' : 'FAIL'}`)
console.log(`SESSION_RESUME ${results.length - failed.length}/${results.length}`)
if (failed.length) process.exit(1)

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  /* checks already ran at import */
}
