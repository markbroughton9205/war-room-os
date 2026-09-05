import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createProjectOrchestrationPacket } from '@/lib/projects/projectOrchestrator'
import {
  buildCommanderOperationFromMessage,
  buildCommanderOperationFromMessages,
  buildReadableCommanderOperationCopy,
  familyIdFromLabel,
} from './adapter'
import type { CouncilOperationMessageInput } from './adapter'
import type { CommanderOperation, CommanderOperationEventType } from './types'

export type UnifiedCouncilExperienceValidationCase = {
  caseId: string
  description: string
  expected: 'valid' | 'invalid'
  observed: 'valid' | 'invalid'
  result: 'PASS' | 'FAIL'
  details: string[]
}

function caseResult(
  caseId: string,
  description: string,
  expected: 'valid' | 'invalid',
  condition: boolean,
  details: string[] = [],
): UnifiedCouncilExperienceValidationCase {
  const observed = condition ? 'valid' : 'invalid'
  return { caseId, description, expected, observed, result: observed === expected ? 'PASS' : 'FAIL', details }
}

function sourceText(): string {
  return [
    readFileSync(join(process.cwd(), 'lib', 'council', 'unified-experience', 'adapter.ts'), 'utf8'),
    readFileSync(join(process.cwd(), 'components', 'council', 'CouncilOperationTimeline.tsx'), 'utf8'),
    readFileSync(join(process.cwd(), 'components', 'council', 'CouncilOperationEventCard.tsx'), 'utf8'),
  ].join('\n')
}

function appSourceText(): string {
  return readFileSync(join(process.cwd(), 'app', 'page.tsx'), 'utf8')
}

function input(overrides: Partial<CouncilOperationMessageInput> = {}): CouncilOperationMessageInput {
  return {
    id: 'msg-1',
    familyName: 'Claude',
    content: 'Architecture response from Claude.',
    timestamp: '2026-07-20T00:00:00.000Z',
    provider: 'Anthropic · Claude',
    messageType: 'response',
    requestText: 'Build a truthful architecture plan.',
    flowMode: 'stable_group',
    providerStatus: 'OK',
    requestId: 'request-1',
    sessionId: 'session-1',
    ...overrides,
  }
}

function operation(overrides: Partial<CouncilOperationMessageInput> = {}): CommanderOperation {
  return buildCommanderOperationFromMessage(input(overrides))
}

function threeFamilyInputs(overrides: Partial<CouncilOperationMessageInput>[] = []): CouncilOperationMessageInput[] {
  const families = [
    { familyName: 'Claude', content: 'Claude contribution only.' },
    { familyName: 'Gemini', content: 'Gemini contribution only.' },
    { familyName: 'Red Team', content: 'Red Team contribution only.' },
  ]
  return families.map((item, index) => input({
    id: `family-${index + 1}`,
    familyName: item.familyName,
    content: item.content,
    flowMode: 'full_council',
    requestId: 'request-family',
    sessionId: 'session-family',
    ...overrides[index],
  }))
}

function eventTypes(subject: CommanderOperation): CommanderOperationEventType[] {
  return subject.events.map(event => event.type)
}

function countType(subject: CommanderOperation, type: CommanderOperationEventType): number {
  return subject.events.filter(event => event.type === type).length
}

function hasEvent(subject: CommanderOperation, type: CommanderOperationEventType): boolean {
  return eventTypes(subject).includes(type)
}

function projectOperation(): CommanderOperation {
  const packet = createProjectOrchestrationPacket('Build a multi-agent project workflow for War Room UI and engineering review.', new Date('2026-07-20T00:00:00.000Z'))
  if (!packet) throw new Error('Project packet fixture failed.')
  return buildCommanderOperationFromMessage({
    id: 'project-msg',
    familyName: 'SYSTEM',
    content: `Project orchestration prepared: ${packet.intake.projectType}`,
    timestamp: '2026-07-20T00:00:00.000Z',
    messageType: 'project_orchestration',
    projectOrchestrationPacket: packet,
  })
}

function familySynthesisOperation(): CommanderOperation {
  return buildCommanderOperationFromMessages([
    ...threeFamilyInputs(),
    input({
      id: 'final-synthesis',
      familyName: 'ChatGPT',
      content: 'Authoritative final synthesis for Commander.',
      messageType: 'council_synthesis',
      requestId: 'request-family',
      sessionId: 'session-family',
      flowMode: 'full_council',
      familyDeliberationTurn: {
        turn_id: 'turn-final',
        session_id: 'session-family',
        round_id: 'round-family',
        commander_turn_id: 'commander-turn-family',
        mission_id: 'request-family',
        mission_version: 1,
        provider_family: 'chatgpt',
        provider_label: 'ChatGPT',
        provider_model: null,
        turn_role: 'council_synthesis',
        speaking_order: 4,
        input_message_ids: ['family-1', 'family-2', 'family-3'],
        evidence_reference_ids: [],
        challenge_target_ids: [],
        revision_of_message_id: null,
        output_message_id: 'final-synthesis',
        completion_status: 'complete',
        started_at: '2026-07-20T00:00:00.000Z',
        completed_at: '2026-07-20T00:00:00.000Z',
        failure_reason: null,
        executive_position: 'Authoritative final synthesis for Commander.',
        full_response: 'Authoritative final synthesis for Commander.',
        claims: [],
        direct_agreements: [],
        direct_disagreements: [],
        risks_or_limitations: [],
        confidence: null,
        recommended_action: 'Hold for Commander.',
        revision_status: 'not_revision',
      },
      operationStatus: 'request_completed',
      requestCompleted: true,
    }),
  ])
}

function pushCases(
  results: UnifiedCouncilExperienceValidationCase[],
  startIndex: number,
  cases: [string, boolean, string[]?][],
): number {
  cases.forEach(([description, condition, details], index) => {
    results.push(caseResult(`c4a_${String(startIndex + index).padStart(3, '0')}`, description, 'valid', condition, details ?? []))
  })
  return startIndex + cases.length
}

export function runUnifiedCouncilExperienceValidation(): UnifiedCouncilExperienceValidationCase[] {
  const results: UnifiedCouncilExperienceValidationCase[] = []
  const source = sourceText()
  const appSource = appSourceText()
  const base = operation()
  const direct = operation({ flowMode: 'direct', familyName: 'ChatGPT', content: 'Direct response.', requestText: 'chatgpt' })
  const system = operation({ familyName: 'SYSTEM', messageType: 'system', content: 'System status is available.', providerStatus: null })
  const project = projectOperation()
  const failed = operation({ familyName: 'Grok', content: 'Structured provider failure record.', providerStatus: 'FAILED' })
  const unavailable = operation({ familyName: 'Kimi', content: 'Structured provider unavailable record.', providerStatus: 'UNAVAILABLE' })
  const skipped = operation({ familyName: 'Gemini', content: '', providerStatus: 'SKIPPED' })
  const noStatusWithOutput = operation({ familyName: 'Claude', content: 'The deployment failed because the environment variable was missing.', providerStatus: null })
  const noStatusUnavailableProse = operation({ familyName: 'Gemini', content: 'The provider unavailable note is analytical prose, not execution state.', providerStatus: null })
  const noStatusNoOutput = operation({ familyName: 'Gemini', content: '', providerStatus: null })
  const noSynthesis = buildCommanderOperationFromMessages(threeFamilyInputs())
  const withSynthesis = familySynthesisOperation()
  const duplicateFinal = buildCommanderOperationFromMessages([
    ...threeFamilyInputs(),
    input({ id: 'final-synthesis', familyName: 'ChatGPT', content: 'Final synthesis once.', messageType: 'council_synthesis', isFinal: true, requestId: 'request-family', sessionId: 'session-family' }),
    input({ id: 'final-synthesis', familyName: 'ChatGPT', content: 'Final synthesis duplicate.', messageType: 'council_synthesis', isFinal: true, requestId: 'request-family', sessionId: 'session-family' }),
  ])
  const replyOperation = buildCommanderOperationFromMessages([
    input({ id: 'claude-prior', familyName: 'Claude', content: 'Prior Claude position.', requestId: 'reply-request', sessionId: 'reply-session' }),
    input({
      id: 'gemini-reply',
      familyName: 'Gemini',
      content: 'Gemini replies to Claude.',
      requestId: 'reply-request',
      sessionId: 'reply-session',
      familyDeliberationTurn: {
        turn_id: 'turn-reply',
        session_id: 'reply-session',
        round_id: 'round-reply',
        commander_turn_id: 'commander-turn-reply',
        mission_id: 'reply-request',
        mission_version: 1,
        provider_family: 'gemini',
        provider_label: 'Gemini',
        provider_model: null,
        turn_role: 'direct_response',
        speaking_order: 2,
        input_message_ids: ['claude-prior'],
        evidence_reference_ids: [],
        challenge_target_ids: [],
        revision_of_message_id: null,
        output_message_id: 'gemini-reply',
        completion_status: 'complete',
        started_at: '2026-07-20T00:00:00.000Z',
        completed_at: '2026-07-20T00:00:00.000Z',
        failure_reason: null,
        executive_position: 'Gemini replies to Claude.',
        full_response: 'Gemini replies to Claude.',
        claims: [],
        direct_agreements: [],
        direct_disagreements: [],
        risks_or_limitations: [],
        confidence: null,
        recommended_action: 'Continue.',
        revision_status: 'not_revision',
      },
    }),
  ])
  const noFinalCopy = buildReadableCommanderOperationCopy(noSynthesis, 'Review this.')
  const finalCopy = buildReadableCommanderOperationCopy(withSynthesis, 'Review this.')
  const projectCopy = buildReadableCommanderOperationCopy(project, 'Build a multi-agent project workflow for War Room UI and engineering review.')

  let next = 1
  next = pushCases(results, next, [
    ['decree receives operation timeline', operation({ messageType: 'decree', content: 'Commander decree recorded.' }).events.length >= 3],
    ['normal question receives operation timeline', operation({ requestText: 'What is the plan?', content: 'Answer.' }).events.length >= 3],
    ['status check receives truthful operation timeline', system.mode === 'system' && hasEvent(system, 'system_state_inspected')],
    ['project packet receives operation timeline', project.requestKind === 'project' && project.events.length > 4],
    ['research request receives operation timeline', operation({ requestText: 'research current sources', content: 'Research answer.' }).requestKind === 'research'],
    ['troubleshooting request receives operation timeline', operation({ requestText: 'debug this issue', content: 'Debug plan.' }).requestKind === 'troubleshooting'],
    ['approval review receives operation timeline', operation({ requestText: 'approve this packet?', content: 'Approval review.' }).requestKind === 'approval_review'],
    ['direct invocation remains direct', direct.mode === 'direct' && direct.summary.title === 'Direct result'],
    ['stable group shows actual participant', base.events.some(event => (event.familyLabel === 'ORION' || event.familyLabel === 'Claude') && event.type === 'family_responded')],
    ['full Council mode is representable', buildCommanderOperationFromMessages(threeFamilyInputs()).mode === 'full_council'],
    ['system-only result does not invent provider', system.events.every(event => !event.isActualProviderOutput)],
    ['unknown family displays safe label', operation({ familyName: 'Oracle' }).events.some(event => event.familyLabel === 'Unknown Council family')],
  ])

  next = pushCases(results, next, [
    ['three family messages produce zero synthesis events without final evidence', countType(noSynthesis, 'synthesis_completed') === 0, eventTypes(noSynthesis)],
    ['three family messages produce zero operation-completed events without terminal state', countType(noSynthesis, 'operation_completed') === 0],
    ['three family messages preserve three contribution cards', countType(noSynthesis, 'family_responded') === 3],
    ['non-final operation status is not completed', noSynthesis.status === 'running'],
    ['only one authoritative final message creates one synthesis-completed event', countType(withSynthesis, 'synthesis_completed') === 1],
    ['only one authoritative terminal state creates one operation-completed event', countType(withSynthesis, 'operation_completed') === 1],
    ['normal Claude message does not create synthesis', countType(operation({ familyName: 'Claude' }), 'synthesis_completed') === 0],
    ['normal ChatGPT family message does not automatically create synthesis', countType(operation({ familyName: 'ChatGPT' }), 'synthesis_completed') === 0],
    ['last message position does not create synthesis', countType(buildCommanderOperationFromMessages(threeFamilyInputs()), 'synthesis_completed') === 0],
    ['words final answer in provider prose do not create synthesis', countType(operation({ content: 'This is my final answer as prose only.' }), 'synthesis_completed') === 0],
    ['words synthesis completed in provider prose do not create synthesis', countType(operation({ content: 'The phrase synthesis completed appears in analysis.' }), 'synthesis_completed') === 0],
    ['duplicate terminal source does not duplicate terminal card', countType(duplicateFinal, 'synthesis_completed') === 1],
  ])

  pushCases(results, next, [
    ['words deployment failed in provider prose do not label provider Failed', noStatusWithOutput.events.some(event => event.type === 'family_responded' && event.statusLabel === 'Responded')],
    ['words provider unavailable in analytical prose do not label provider Unavailable', noStatusUnavailableProse.events.some(event => event.type === 'family_responded' && event.statusLabel === 'Responded')],
    ['structured failed status still renders Failed', hasEvent(failed, 'family_failed') && failed.events.some(event => event.statusLabel === 'Failed')],
    ['structured unavailable status still renders Unavailable', hasEvent(unavailable, 'family_unavailable') && unavailable.events.some(event => event.statusLabel === 'Unavailable')],
    ['structured skipped status still renders Skipped', hasEvent(skipped, 'family_skipped') && skipped.events.some(event => event.statusLabel === 'Skipped')],
    ['structured responded status with output renders Responded', base.events.some(event => event.type === 'family_responded' && event.statusLabel === 'Responded')],
    ['no structured status plus real output safely renders Responded', noStatusWithOutput.events.some(event => event.type === 'family_responded' && event.statusLabel === 'Responded')],
    ['no structured status and no output does not render Responded', noStatusNoOutput.events.every(event => event.type !== 'family_responded')],
    ['no structured status and no output renders Unknown or skipped event, not fake failure', noStatusNoOutput.events.some(event => event.statusLabel === 'Unknown')],
    ['app provider status helper does not parse failed or unavailable prose', !/deployment failed|failed\|error\|could not complete|unavailable\|missing key|\/unavailable\//i.test(appSource.match(/function councilOperationProviderStatus[\s\S]*?\n}/)?.[0] ?? '')],
  ])

  next = pushCases(results, next, [
    ['valid reply target renders identified reply label', replyOperation.events.some(event => event.replyToLabel === 'ORION' || event.replyToLabel === 'Claude')],
    ['absent reply target renders no reply label', base.events.every(event => event.replyToLabel === null)],
    ['vague Replying to real event wording is absent', !/Replying to real event/.test(source)],
    ['later event is not automatically called reply', !source.includes('index - 1')],
    ['reply source uses input ids, not later position', source.includes('input_message_ids') && source.includes('messageFamilyById')],
    ['copy uses identified reply label only', !buildReadableCommanderOperationCopy(base).includes('Replying to:')],
  ])

  next = pushCases(results, next, [
    ['assigned does not map to responded', project.events.some(event => event.type === 'lane_assigned' && event.isActualProviderOutput === false)],
    ['queued does not map to working', !source.includes("Queued' && statusLabel === 'Working")],
    ['working requires start truth', !/Working[^]*family_queued/.test(source)],
    ['responded requires output', skipped.events.every(event => event.type !== 'family_responded')],
    ['failed remains visible', hasEvent(failed, 'family_failed') && failed.summary.failedCount === 1],
    ['unavailable remains visible', hasEvent(unavailable, 'family_unavailable') && unavailable.summary.unavailableCount === 1],
    ['skipped remains visible', hasEvent(skipped, 'family_skipped') && skipped.summary.skippedCount === 1],
    ['waiting approval remains visible', project.events.some(event => event.type === 'approval_required')],
    ['planned work does not render as completed', project.events.filter(event => event.type === 'lane_assigned').every(event => !event.isActualProviderOutput)],
    ['recommendation does not render as use', !source.includes('Recommended is used')],
  ])

  next = pushCases(results, next, [
    ['sequence numbers sort correctly', base.events.map(event => event.sequence).every((value, index, arr) => index === 0 || value > arr[index - 1])],
    ['timestamp order does not override authoritative sequence', eventTypes(operation({ timestamp: '1999-01-01T00:00:00.000Z' }))[0] === 'request_received'],
    ['duplicate event IDs render once by construction', new Set(withSynthesis.events.map(event => event.id)).size === withSynthesis.events.length],
    ['family contribution appears separately', noSynthesis.events.filter(event => event.type === 'family_responded').length === 3],
    ['synthesis appears after used contribution only when final evidence exists', withSynthesis.events.findIndex(event => event.type === 'synthesis_completed') > withSynthesis.events.findIndex(event => event.type === 'family_responded')],
    ['provider failure remains in sequence', failed.events.findIndex(event => event.type === 'family_failed') >= 2],
    ['unavailable provider remains in sequence', unavailable.events.findIndex(event => event.type === 'family_unavailable') >= 2],
    ['previous events remain stable', JSON.stringify(base.events) === JSON.stringify(operation().events)],
    ['event reconciliation does not duplicate', /key=\{item\.id\}/.test(source)],
    ['no arbitrary delay timer exists', !/setTimeout[\s\S]{0,120}(thinking|working|provider|family|pacing)/i.test(source)],
    ['no fake thinking message exists', !/thinking|typing|analyzing/i.test(source)],
    ['completed transcript renders one card per contribution', /operation\.events\.map/.test(source) && /<CouncilOperationEventCard\s+key=\{item\.id\}\s+event=\{item\}/.test(source)],
  ])

  next = pushCases(results, next, [
    ['Claude output labels ORION', base.events.some(event => (event.familyLabel === 'ORION' || event.familyLabel === 'Claude') && event.outputText?.includes('Claude'))],
    ['Gemini output labels LUMEN', operation({ familyName: 'Gemini', content: 'Gemini response.' }).events.some(event => event.familyLabel === 'LUMEN' || event.familyLabel === 'Gemini')],
    ['Grok failure labels PULSAR', failed.events.some(event => (event.familyLabel === 'PULSAR' || event.familyLabel === 'Grok') && event.type === 'family_failed')],
    ['Kimi unavailable labels NOVA', unavailable.events.some(event => (event.familyLabel === 'NOVA' || event.familyLabel === 'Kimi') && event.type === 'family_unavailable')],
    ['Red Team output labels PHOENIX', operation({ familyName: 'Red Team', content: 'Risk review.' }).events.some(event => event.familyLabel === 'PHOENIX' || event.familyLabel === 'Red Team')],
    ['unknown family displays safe label from family mapper', familyIdFromLabel('Oracle') === 'unknown' && operation({ familyName: 'Oracle' }).events.some(event => event.familyLabel === 'Unknown Council family')],
    ['system-state event does not claim provider output', system.events.every(event => event.provenance !== 'provider_response' || event.isActualProviderOutput === false)],
    ['provider output includes real message reference', base.events.some(event => event.isActualProviderOutput && event.messageId === 'msg-1')],
    ['assignment has no invented output text', project.events.filter(event => event.type === 'lane_assigned').every(event => event.isActualProviderOutput === false)],
    ['synthesis identifies actual synthesizer when known', withSynthesis.events.some(event => event.type === 'synthesis_completed' && (event.familyLabel === 'AURORA' || event.familyLabel === 'ChatGPT'))],
  ])

  next = pushCases(results, next, [
    ['raw object becomes readable sections', /Commander Briefing/.test(source) && /View technical data/.test(source)],
    ['executive summary renders for project packet', project.briefing.body.length > 0],
    ['recommended path renders for project packet', Boolean(project.briefing.recommendation)],
    ['open risks render for project packet', project.briefing.risks.length > 0],
    ['evidence sources render for project packet', project.briefing.evidenceStatus.length > 0],
    ['implementation plan renders in technical packet', JSON.stringify(project.technicalData).includes('implementationPlan')],
    ['approval actions render', project.briefing.approvalRequirements.length > 0],
    ['next decrees render', project.briefing.nextActions.length > 0],
    ['quality gate renders in technical packet', JSON.stringify(project.technicalData).includes('qualityGate')],
    ['missing optional fields do not crash', operation({ content: '' }).briefing.body.length > 0],
    ['raw JSON collapsed by default', /<details\s+className=/.test(source) && !/<details\s+open/.test(source) && /View technical data/.test(source)],
    ['primary result is not JSON wall', !noFinalCopy.trim().startsWith('{') && !projectCopy.trim().startsWith('{')],
    ['copied briefing contains no false completion statement', !/Commander briefing completed|Synthesis completed|Operation completed/i.test(noFinalCopy)],
    ['copied briefing includes all real family contributions', ['Claude contribution only.', 'Gemini contribution only.', 'Red Team contribution only.'].every(text => noFinalCopy.includes(text))],
    ['final copy includes final Commander briefing when final evidence exists', finalCopy.includes('FINAL COMMANDER BRIEFING') && finalCopy.includes('Authoritative final synthesis for Commander.')],
  ])

  next = pushCases(results, next, [
    ['initial text is Copy', /: 'Copy'/.test(source)],
    ['successful write changes to Copied check', /Copied ✓/.test(source)],
    ['Copied check resets to Copy', /setCopyState\('idle'\)/.test(source)],
    ['failure shows Copy failed', /Copy failed/.test(source)],
    ['success is not shown before resolved clipboard write', /await navigator\.clipboard\.writeText\(text\)[\s\S]*setCopyState\('copied'\)/.test(source)],
    ['repeated clicks clean old timer', /clearTimer\(\)[\s\S]*navigator\.clipboard/.test(source)],
    ['unmount clears timer', /useEffect\(\(\) => clearTimer/.test(source)],
    ['keyboard can activate copy', /<button/.test(source) && /type="button"/.test(source)],
    ['copy state announced accessibly', /aria-live="polite"/.test(source)],
    ['primary copy uses readable formatter', /buildReadableCommanderOperationCopy\(operation, operationInputs\[0\]\?\.requestText\)/.test(source)],
    ['raw copy remains separate', /Copy raw JSON/.test(source)],
    ['clipboard unavailable fails safely', /Clipboard unavailable/.test(source)],
  ])

  next = pushCases(results, next, [
    ['includes request', noFinalCopy.includes('REQUEST')],
    ['includes operation status', noFinalCopy.includes('OPERATION STATUS')],
    ['includes actual family contributions', noFinalCopy.includes('Claude - Architecture / Systems - Responded') || noFinalCopy.includes('ORION - Architecture / Systems - Responded')],
    ['includes failures', buildReadableCommanderOperationCopy(failed).includes('Failed')],
    ['includes unavailable families', buildReadableCommanderOperationCopy(unavailable).includes('Unavailable')],
    ['no-final copy omits final briefing section', !noFinalCopy.includes('FINAL COMMANDER BRIEFING')],
    ['includes risks for project', projectCopy.includes('OPEN RISKS')],
    ['includes approval requirements for project', projectCopy.includes('APPROVAL REQUIREMENTS')],
    ['includes next actions for project', projectCopy.includes('NEXT ACTIONS')],
    ['excludes raw braces', !/[{}]/.test(noFinalCopy)],
    ['excludes undefined', !/undefined/.test(noFinalCopy)],
    ['excludes null noise', !/\bnull\b/.test(noFinalCopy)],
    ['preserves line breaks', noFinalCopy.includes('\n\nCOUNCIL ACTIVITY\n')],
    ['does not invent missing provider output', buildReadableCommanderOperationCopy(skipped).includes('No provider message is attached') === false],
  ])

  next = pushCases(results, next, [
    ['no provider-selection mutation', !/providerSelection\s*=|setProvider|selectedProvider/.test(source)],
    ['no activeFamilies write-back', !/activeFamilies\s*=|setActiveFamilies/.test(source)],
    ['no selectedFamilies write-back', !/selectedFamilies\s*=|setSelectedFamilies/.test(source)],
    ['no provider prompt mutation', !/baseUserPrompt|systemPrompt|prompt\s*=/.test(source)],
    ['no new provider call from component', !/callCouncilProvider|callChatGPT|callClaude|callXAIChat|completeGemini|completeKimi/.test(source)],
    ['no client planner invocation', !/createAssemblyPlan|classifyMission|runAdaptiveCouncilShadowSelection/.test(source)],
    ['no progress-event mutation', !/createCouncilProgressRuntimeTracker|reduceCouncilProgressEvent|recordCouncilProgress/.test(source)],
    ['no request-state mutation', !/requestState\s*=|reduceCouncil/.test(source)],
    ['no persistence', !/localStorage|sessionStorage|indexedDB|insert\(|update\(/.test(source)],
    ['no Supabase', !/supabase/i.test(source)],
    ['no memory write', !/saveMemory|memoryProposal/.test(source)],
    ['no SQL', !/\bSQL\b|select \*|insert into/i.test(source)],
    ['no deployment action', !/deploy|vercel|netlify/i.test(source)],
    ['no approval bypass', !/bypass|overrideApproval|approvalBypass/i.test(source)],
    ['no completion-state override from UI', !/closeIfTerminal|setCompleted/.test(source)],
  ])

  next = pushCases(results, next, [
    ['Control cannot appear through familyId', operation({ familyName: 'Control', content: 'Policy.' }).events.every(event => event.familyId !== 'unknown' && String(event.familyId) !== 'control')],
    ['Control cannot appear through familyLabel', operation({ familyName: 'Control', content: 'Policy.' }).events.every(event => event.familyLabel !== 'Control')],
    ['normalized Control label cannot bypass guard', familyIdFromLabel(' cOnTrOl ') === 'system'],
    ['Control-like text inside provider content does not falsely fail identity', operation({ familyName: 'Claude', content: 'Control plane analysis only.' }).events.some(event => event.familyLabel === 'ORION' || event.familyLabel === 'Claude')],
    ['approval gate remains visible as runtime state', project.events.some(event => event.provenance === 'approval_state' && event.familyId === null)],
    ['approval gate does not become a family', project.events.filter(event => event.type === 'approval_required').every(event => event.familyLabel === null)],
    ['execution mode remains visible as runtime state', ['direct', 'stable_group', 'full_council', 'system', 'unknown'].includes(base.mode)],
    ['execution mode does not become family identity', base.events.every(event => event.familyLabel !== base.mode)],
    ['family list excludes control pseudo-family', familyIdFromLabel('Control') === 'system'],
    ['Control rendered as system state when used as source label', operation({ familyName: 'Control', messageType: 'system', content: 'Control state.' }).events.some(event => event.familyId === 'system')],
  ])

  next = pushCases(results, next, [
    ['project packet distinct builder remains unaffected', project.status === 'waiting_approval' && project.events.some(event => event.type === 'approval_required')],
    ['system status path remains unaffected', system.status === 'running' && system.events.some(event => event.type === 'system_state_inspected')],
    ['direct invocation remains truthful', direct.mode === 'direct' && countType(direct, 'synthesis_completed') === 0],
    ['multi-message operation produces one grouped timeline by component contract', /inputs\?: readonly CouncilOperationMessageInput\[\]/.test(source) && /buildCommanderOperationFromMessages/.test(source)],
    ['renderer passes grouped timeline inputs', /operationTimelineInputs=/.test(appSource) && /showOperationTimeline=/.test(appSource)],
    ['renderer only shows timeline for last group message', /isLastCouncilOperationMessage/.test(appSource)],
    ['project packet remains single-packet path', /buildCommanderOperationFromProjectPacket/.test(source)],
    ['author identity does not prove synthesis', !/familyName.*ChatGPT[\s\S]{0,80}synthesis_completed/.test(source)],
    ['message position does not prove finality', !/last.*synthesis|slice\(-1\).*synthesis|index.*length.*synthesis/i.test(source)],
    ['content prose is not status input', !/input\.content[\s\S]{0,120}(FAILED|UNAVAILABLE|TIMED_OUT)/.test(source)],
  ])

  // Real persisted family labels — the exact strings COUNCIL_ROSTER (lib/council/familyRoster.ts)
  // and app/page.tsx's direct-invocation bubbleFamilyName fallback actually attach to saved
  // messages (e.g. "Claude Family", not bare "Claude"). Confirmed by reading those call sites;
  // before this fix these all fell through to 'unknown' because FAMILY_BY_LABEL only had the bare
  // uppercase keys.
  pushCases(results, next, [
    ['persisted "ChatGPT Family" resolves to chatgpt', familyIdFromLabel('ChatGPT Family') === 'chatgpt'],
    ['persisted "Claude Family" resolves to claude', familyIdFromLabel('Claude Family') === 'claude'],
    ['persisted "Grok Family" resolves to grok', familyIdFromLabel('Grok Family') === 'grok'],
    ['persisted "Gemini Family" resolves to gemini', familyIdFromLabel('Gemini Family') === 'gemini'],
    ['persisted "Kimi Family" resolves to kimi', familyIdFromLabel('Kimi Family') === 'kimi'],
    ['persisted "Red Team" (no suffix) still resolves to red_team', familyIdFromLabel('Red Team') === 'red_team'],
    ['uppercase "CHATGPT FAMILY" variant resolves to chatgpt', familyIdFromLabel('CHATGPT FAMILY') === 'chatgpt'],
    [
      'a real "X Family" message renders its true family label, not Unknown Council family',
      operation({ familyName: 'Claude Family', content: 'Real Claude answer.' }).events.some(event => event.familyId === 'claude' && (event.familyLabel === 'ORION' || event.familyLabel === 'Claude')),
    ],
    [
      'multi-family "X Family" transcript resolves every family, not just Red Team',
      buildCommanderOperationFromMessages([
        input({ id: 'fam-1', familyName: 'ChatGPT Family', content: 'ChatGPT answer.', requestId: 'req-fam', sessionId: 'sess-fam' }),
        input({ id: 'fam-2', familyName: 'Claude Family', content: 'Claude answer.', requestId: 'req-fam', sessionId: 'sess-fam' }),
        input({ id: 'fam-3', familyName: 'Grok Family', content: 'Grok answer.', requestId: 'req-fam', sessionId: 'sess-fam' }),
        input({ id: 'fam-4', familyName: 'Gemini Family', content: 'Gemini answer.', requestId: 'req-fam', sessionId: 'sess-fam' }),
      ]).events.filter(event => event.familyId === 'unknown').length === 0,
    ],
    // Regression guard: the "Family" suffix strip must not become broad/fuzzy matching.
    ['unrelated text ending in "Family" is still unknown', familyIdFromLabel('Royal Family') === 'unknown'],
    ['unrelated single-word text is still unknown', familyIdFromLabel('Oracle') === 'unknown'],
    ['roster label "Bridge Architect" resolves to bridge_architect', familyIdFromLabel('Bridge Architect') === 'bridge_architect'],
    ['roster label "Baby AI" resolves to baby', familyIdFromLabel('Baby AI') === 'baby'],
  ])

  return results
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const results = runUnifiedCouncilExperienceValidation()
  for (const item of results) {
    console.log(`${item.result} ${item.caseId}: ${item.description} (${item.observed})`)
    for (const detail of item.details) console.log(`  ${detail}`)
  }
  const passed = results.filter(item => item.result === 'PASS').length
  console.log(`Unified Council experience validation: ${passed}/${results.length} PASS`)
  if (passed !== results.length) process.exitCode = 1
}
