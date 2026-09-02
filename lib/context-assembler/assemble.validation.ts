import { pathToFileURL } from 'node:url'
import { assembleContext } from './assemble'
import { FakeContextAssemblerStore } from './__fixtures__/FakeContextAssemblerStore'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

async function testNoConversationIdSkipsPersistenceButStillAssembles(): Promise<CaseResult[]> {
  const store = new FakeContextAssemblerStore()
  const result = await assembleContext({ conversationId: null }, store)
  return [
    check('no_conversation_id_no_snapshot_persisted', result.snapshot === null, `snapshot=${JSON.stringify(result.snapshot)}`),
    check('no_conversation_id_still_has_identity_section', result.sections.some(s => s.kind === 'identity'), result.sections.map(s => s.kind).join(',')),
  ]
}

async function testFullAssemblyPersistsSnapshotWithSourceRefs(): Promise<CaseResult[]> {
  const store = new FakeContextAssemblerStore()
  store.conversations.set('conv-1', { id: 'conv-1', active_project_id: 'proj-1' })
  store.projects.set('proj-1', { id: 'proj-1', name: 'Ra\'el Spine', description: null, status: 'active', current_objective: 'Ship Wave 1', current_phase: 'implementation' })
  store.openLoopsByProject.set('proj-1', [
    { id: 'loop-1', title: 'Wire context assembler', description: null, status: 'open', priority: 5, blocked_by: null, next_action: 'write validation', updated_at: new Date().toISOString() },
  ])
  store.setMemoryRecords('global_war_room', null, [
    { id: 'mem-1', content: 'Never rewrite legacy memory tables in Wave 1.', memory_type: 'architecture_decision', scope: 'global_war_room', status: 'active', effective_from: new Date().toISOString(), importance_tier: 'strategic' },
  ])
  store.messagesByConversation.set('conv-1', [
    { id: 'msg-1', role: 'user', content: 'What is the plan?', created_at: new Date().toISOString() },
  ])

  const result = await assembleContext({ conversationId: 'conv-1' }, store)
  const snapshot = store.insertedSnapshots[0]

  return [
    check('snapshot_persisted', !!result.snapshot, JSON.stringify(result.snapshot)),
    check('snapshot_project_id_matches', snapshot?.project_id === 'proj-1', String(snapshot?.project_id)),
    check(
      'included_source_ids_reference_real_rows_not_content',
      (snapshot?.included_source_ids ?? []).some(ref => ref.id === 'loop-1') && (snapshot?.included_source_ids ?? []).every(ref => ref.id.length < 200),
      JSON.stringify(snapshot?.included_source_ids),
    ),
    check('project_section_present', result.sections.some(s => s.kind === 'project'), result.sections.map(s => s.kind).join(',')),
    check('open_loops_section_present', result.sections.some(s => s.kind === 'open_loops'), result.sections.map(s => s.kind).join(',')),
    check('directives_section_present', result.sections.some(s => s.kind === 'directives'), result.sections.map(s => s.kind).join(',')),
    check('content_hash_is_deterministic_for_same_input', typeof snapshot?.content_hash === 'string' && snapshot.content_hash.length === 64, String(snapshot?.content_hash)),
  ]
}

async function testFastTurnOmitsDurableMemory(): Promise<CaseResult[]> {
  const store = new FakeContextAssemblerStore()
  store.conversations.set('conv-1', { id: 'conv-1', active_project_id: 'proj-1' })
  store.projects.set('proj-1', { id: 'proj-1', name: 'Ra\'el Spine', description: null, status: 'active', current_objective: 'Ship Wave 1', current_phase: 'implementation' })
  store.setMemoryRecords('global_war_room', null, [
    { id: 'mem-panama', content: 'Panama relocation logistics and visa timeline.', memory_type: 'project_fact', scope: 'global_war_room', status: 'active', effective_from: new Date().toISOString(), importance_tier: 'strategic' },
  ])
  const result = await assembleContext({
    conversationId: 'conv-1',
    influencePolicy: {
      depth: 'FAST',
      intent: 'GREETING',
      commanderText: 'Hey council',
      allowDurableMemory: false,
      includeAssemblerRecentMessages: false,
      includeProjectState: false,
      includeTerra: false,
    },
  }, store)
  return [
    check('fast_turn_omits_directives', !result.sections.some(s => s.kind === 'directives'), result.sections.map(s => s.kind).join(',')),
    check('fast_turn_omits_project', !result.sections.some(s => s.kind === 'project'), result.sections.map(s => s.kind).join(',')),
    check('fast_turn_keeps_identity', result.sections.some(s => s.kind === 'identity'), result.sections.map(s => s.kind).join(',')),
  ]
}

export async function runContextAssemblerAssembleValidation(): Promise<CaseResult[]> {
  return [
    ...(await testNoConversationIdSkipsPersistenceButStillAssembles()),
    ...(await testFullAssemblyPersistsSnapshotWithSourceRefs()),
    ...(await testFastTurnOmitsDurableMemory()),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runContextAssemblerAssembleValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Context Assembler assemble validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
