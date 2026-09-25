import { readFileSync, existsSync } from 'node:fs'
import { resolveFoundryBrainStatus } from '@/lib/native-builder/foundryBrainStatus'
import { getEngineerStatus } from '@/lib/native-builder/engineerStatus'
import { resolveLocalCoder } from '@/lib/native-builder/localCoder'

const root = process.cwd()
const shell = readFileSync(`${root}/components/war-room/foundry/FoundryShell.tsx`, 'utf8')
const nav = readFileSync(`${root}/components/war-room/foundry/FoundryHomeNav.tsx`, 'utf8')
const header = readFileSync(`${root}/components/war-room/live-room/WarRoomOsHeader.tsx`, 'utf8')
const login = readFileSync(`${root}/app/login/page.tsx`, 'utf8')
const localLogin = readFileSync(`${root}/components/auth/LocalCommanderLoginPanel.tsx`, 'utf8')

const [brain, status, local] = await Promise.all([
  resolveFoundryBrainStatus(),
  getEngineerStatus(),
  resolveLocalCoder(),
])

const defaultMissionMount = shell.includes('<FoundryOperationsPanel />\n      <FoundryMissionControllerPanel />')
const gatedDetails = shell.includes('{opsOpen ? (') && shell.includes('foundry-operations-drawer')
const checks = [
  ['brain_ready', brain.ready, brain.detail],
  ['provider_cursor_agent', brain.provider === 'cursor-agent', brain.provider],
  ['model_gpt56_sol', brain.modelId === 'gpt-5.6-sol-medium', brain.modelId],
  ['executable_present', brain.executablePresent && existsSync('/home/chosenone/.config/Cursor/User/globalStorage/anysphere.cursor-agent-worker/agent-cli/.local/bin/cursor-agent'), String(brain.executablePresent)],
  ['status_brain_matches', status.foundryModelStatus.brain.ready === brain.ready, status.foundryModelStatus.detail],
  ['ui_no_local_coder_badge', !shell.includes('LOCAL CODER') && !shell.includes('Local coder'), 'ok'],
  ['ui_no_default_mission_dashboard', !defaultMissionMount && gatedDetails && shell.includes('foundry-working-strip'), 'ok'],
  ['ui_has_new_session', shell.includes('foundry-new-session-empty') && shell.includes('Tell Foundry the result you want'), 'ok'],
  ['p005_removed', !nav.includes('FOUNDRY-P005') && !header.includes('FOUNDRY-P005') && !login.includes('FOUNDRY-P005') && !localLogin.includes('FOUNDRY-P005'), 'ok'],
  ['p006_removed', !nav.includes('FOUNDRY-P006') && !header.includes('FOUNDRY-P006') && !login.includes('FOUNDRY-P006') && !shell.includes('FOUNDRY-P006'), 'ok'],
  ['ops_gated_advanced', shell.includes('Advanced / Operations') && shell.includes('foundry-operations-toggle'), 'ok'],
  ['projects_commander_filter', shell.includes('workspaces?view=') && shell.includes('foundry-system-projects-toggle') && shell.includes('+ New Project'), 'ok'],
  ['identity_kept', nav.includes('THE FOUNDRY') && nav.includes('← War Room'), 'ok'],
] as const

console.log(JSON.stringify({
  brain,
  localCoder: { status: local.status, detail: local.detail },
  codingModel: status.foundryModelStatus.codingModel,
  overall: status.overall,
  checks: checks.map(([name, pass, detail]) => ({ name, pass, detail })),
}, null, 2))

if (checks.some(([, pass]) => !pass)) process.exit(1)
