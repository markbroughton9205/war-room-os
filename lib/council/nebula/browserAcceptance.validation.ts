import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { presentAgentMessage } from './presentation'
import { stripHiddenReasoning } from './thinkingStrip'
import { nebulaCommanderEventLabel } from './visibleEvents'

export type BrowserAcceptanceCheck = { name: string; pass: boolean; detail: string; fixture: true }

function check(name: string, pass: boolean, detail: string): BrowserAcceptanceCheck {
  return { name, pass, detail, fixture: true }
}

function source(rel: string): string {
  try {
    return readFileSync(join(process.cwd(), rel), 'utf8')
  } catch {
    return ''
  }
}

export function runCouncilBrowserAcceptanceFixtureValidation(): BrowserAcceptanceCheck[] {
  const page = source('app/page.tsx')
  const banner = source('components/council/CouncilLiveRoundBanner.tsx')
  const inspector = source('components/council/CouncilRoundInspector.tsx')
  const controls = source('components/war-room/council/CouncilCommandControls.tsx')
  const consoleSource = source('components/war-room/live-room/CommandConsole.tsx')
  const controller = source('lib/council/unified-experience/live-controller.ts')
  const sample = presentAgentMessage({
    agentId: 'aurora',
    raw: '<think>中文推理</think>{"decisionOrSynthesis":"War Room is online on the current host.","supportingFindings":["LOCAL_FIRST"],"tradeoffs":[],"uncertainties":[],"dissentingViews":[],"recommendationConfidence":0.8}',
  })
  const visible = stripHiddenReasoning(sample.prose)
  return [
    check('optimistic_round_shell_exists', page.includes('setNebulaRoundShell') && banner.includes('ASTRA coordinating'), 'shell+banner'),
    check('group_mode_testid', controls.includes('council-mode-${mode}') || controls.includes('council-mode-stable_group'), 'group testid'),
    check('execute_testid', consoleSource.includes('council-execute') && consoleSource.includes('council-command-input'), 'execute/input testids'),
    check('provider_not_in_bubble_header', !page.includes('{msg.provider && <span className="text-xs" style={{ color: \'#444\' }}>{msg.provider}</span>}'), 'provider subtitle removed'),
    check('streaming_cursor_present', page.includes('msg.streaming') && banner.includes('▍'), 'cursor'),
    check('inspector_provenance_component', inspector.includes('Round provenance') && inspector.includes('Metrics'), 'inspector'),
    check('no_family_assigned_label', !controller.includes("'Families assigned'") && nebulaCommanderEventLabel({ eventType: 'request_selection_resolved', family: null, payload: {} }) === 'Participants Selected', 'nebula labels'),
    check('waiting_for_provider_not_default_running', controller.includes("return 'running'") && !/family_started'\) return 'waiting_for_provider'/.test(controller), 'running not waiting_for_provider'),
    check('fixture_no_raw_schema_or_thinking', !visible.includes('<think') && !visible.includes('decisionOrSynthesis') && /war room is online/i.test(visible), visible),
  ]
}
