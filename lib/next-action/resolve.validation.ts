import { pathToFileURL } from 'node:url'
import { resolveNextAction } from './resolve'
import type { NextActionInput, OpenLoopForNextAction } from './types'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function loop(overrides: Partial<OpenLoopForNextAction> & { id: string; title: string }): OpenLoopForNextAction {
  return { status: 'open', priority: 0, next_action: null, updated_at: new Date(0).toISOString(), description: null, ...overrides } as OpenLoopForNextAction
}

function testPicksHighestPriorityOpenLoop(): CaseResult[] {
  const input: NextActionInput = {
    project: { id: 'p1', name: 'Ra\'el Spine', status: 'active', current_objective: 'Ship Wave 1' },
    openLoops: [
      loop({ id: 'l1', title: 'Low priority', priority: 1 }),
      loop({ id: 'l2', title: 'High priority', priority: 9, next_action: 'write tests' }),
    ],
    pendingPromptArtifacts: [],
  }
  const rec = resolveNextAction(input)
  return [
    check('picks_highest_priority_loop', rec.kind === 'resume_open_loop' && rec.sourceRefs[0]?.id === 'l2', JSON.stringify(rec)),
    check('rationale_includes_recorded_next_action', rec.rationale.includes('write tests'), rec.rationale),
  ]
}

function testTiesBrokenByOldestUpdated(): CaseResult[] {
  const input: NextActionInput = {
    project: null,
    openLoops: [
      loop({ id: 'newer', title: 'Newer', priority: 5, updated_at: new Date(2000).toISOString() }),
      loop({ id: 'older', title: 'Older', priority: 5, updated_at: new Date(1000).toISOString() }),
    ],
    pendingPromptArtifacts: [],
  }
  const rec = resolveNextAction(input)
  return [check('ties_broken_by_oldest_updated_at', rec.sourceRefs[0]?.id === 'older', JSON.stringify(rec))]
}

function testFallsBackToPendingPromptOutcome(): CaseResult[] {
  const input: NextActionInput = {
    project: { id: 'p1', name: 'Ra\'el Spine', status: 'active', current_objective: null },
    openLoops: [loop({ id: 'l1', title: 'Done already', status: 'done' })],
    pendingPromptArtifacts: [{ id: 'pa1', target_agent_id: 'claude_code', intent: 'GIVE_CLAUDE_NEXT_PROMPT', created_at: new Date().toISOString() }],
  }
  const rec = resolveNextAction(input)
  return [check('falls_back_to_pending_prompt_outcome', rec.kind === 'follow_up_prompt_outcome' && rec.sourceRefs[0]?.id === 'pa1', JSON.stringify(rec))]
}

function testFallsBackToReviewProject(): CaseResult[] {
  const input: NextActionInput = { project: { id: 'p1', name: 'Ra\'el Spine', status: 'active', current_objective: 'Ship Wave 1' }, openLoops: [], pendingPromptArtifacts: [] }
  const rec = resolveNextAction(input)
  return [check('falls_back_to_review_project', rec.kind === 'review_project' && rec.sourceRefs[0]?.id === 'p1', JSON.stringify(rec))]
}

function testFallsBackToNoAction(): CaseResult[] {
  const rec = resolveNextAction({ project: null, openLoops: [], pendingPromptArtifacts: [] })
  return [check('falls_back_to_no_action', rec.kind === 'no_action' && rec.sourceRefs.length === 0, JSON.stringify(rec))]
}

function testDoneAndDroppedLoopsExcluded(): CaseResult[] {
  const input: NextActionInput = {
    project: { id: 'p1', name: 'X', status: 'active', current_objective: null },
    openLoops: [loop({ id: 'd1', title: 'Done', status: 'done', priority: 99 }), loop({ id: 'dr1', title: 'Dropped', status: 'dropped', priority: 99 })],
    pendingPromptArtifacts: [],
  }
  const rec = resolveNextAction(input)
  return [check('done_and_dropped_loops_never_recommended', rec.kind !== 'resume_open_loop', JSON.stringify(rec))]
}

export function runNextActionResolveValidation(): CaseResult[] {
  return [
    ...testPicksHighestPriorityOpenLoop(),
    ...testTiesBrokenByOldestUpdated(),
    ...testFallsBackToPendingPromptOutcome(),
    ...testFallsBackToReviewProject(),
    ...testFallsBackToNoAction(),
    ...testDoneAndDroppedLoopsExcluded(),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runNextActionResolveValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Next Action resolve validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
