/**
 * Focused checks for desktop exit tags and campaign recovery eligibility.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { isRecoverableEngineeringCampaign } from './foundryCampaignRecovery'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const main = readFileSync(path.join(root, 'desktop/src/main.cjs'), 'utf8')
const required = [
  'APP_START',
  'APP_READY',
  'WINDOW_CREATED',
  'WINDOW_CLOSED',
  'WINDOW_ALL_CLOSED',
  'BEFORE_QUIT',
  'WILL_QUIT',
  'APP_QUIT_CALLED',
  'SHUTDOWN_OWNED_START',
  'SHUTDOWN_OWNED_END',
  'SECOND_INSTANCE',
  'CORE_START',
  'CORE_STOP',
  'UI_CHILD_START',
  'UI_CHILD_EXIT',
  'UNCAUGHT_EXCEPTION',
  'UNHANDLED_REJECTION',
  'SIGTERM',
  'SIGINT',
  'SIGHUP',
  'PROCESS_EXIT',
  "quitFor('SECOND_INSTANCE')",
  "quitFor('WINDOW_ALL_CLOSED')",
]
const missing = required.filter(token => !main.includes(token))
const active = isRecoverableEngineeringCampaign({
  id: 'm1',
  state: 'collecting_evidence',
  codingMission: {
    mode: 'bounded_coding',
    currentStep: 'EDITING',
    engineeringRuntime: { campaign: { phase: 'PLAN', checkpoints: ['PLAN_READY'] } },
  },
})
const done = isRecoverableEngineeringCampaign({
  id: 'm2',
  state: 'resolved',
  codingMission: {
    mode: 'bounded_coding',
    currentStep: 'DONE',
    engineeringRuntime: { completion: { canComplete: true }, campaign: { phase: 'COMPLETE' } },
  },
})
const ok = missing.length === 0 && active === true && done === false
console.log(JSON.stringify({ ok, missing, active, done }))
if (!ok) process.exit(1)
