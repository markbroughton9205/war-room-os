import { pathToFileURL } from 'node:url'
import { isActiveStatus, rankSearchCandidates, scoreSearchResult } from './rank'
import type { ScorableCandidate } from './types'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function candidate(overrides: Partial<ScorableCandidate> & { id: string }): ScorableCandidate {
  return {
    status: 'active',
    createdAt: new Date().toISOString(),
    importanceWeight: 0.5,
    projectId: null,
    textMatchStrength: 0.6,
    ...overrides,
  } as ScorableCandidate
}

// Phase 8 — "new decision outranks superseded decision" / "current Commander directive outranks
// stale inferred memory": an active row must always outrank an otherwise-identical superseded one.
function testActiveOutranksSuperseded(): CaseResult[] {
  const now = new Date().toISOString()
  const activeDecision = candidate({ id: 'new', status: 'active', createdAt: now, importanceWeight: 0.8 })
  const supersededDecision = candidate({ id: 'old', status: 'superseded', createdAt: now, importanceWeight: 0.8 })
  const ranked = rankSearchCandidates([supersededDecision, activeDecision], { queryProjectId: null })
  return [
    check('active_decision_ranks_first', ranked[0].id === 'new', ranked.map(r => r.id).join(',')),
    check('superseded_score_is_deeply_negative', ranked.find(r => r.id === 'old')!.score < 0, String(ranked.find(r => r.id === 'old')!.score)),
  ]
}

// Phase 8 — "active project memories outrank unrelated project memories."
function testProjectMatchOutranksUnrelated(): CaseResult[] {
  const inProject = candidate({ id: 'in-project', projectId: 'proj-1', importanceWeight: 0.5 })
  const otherProject = candidate({ id: 'other-project', projectId: 'proj-2', importanceWeight: 0.5 })
  const ranked = rankSearchCandidates([otherProject, inProject], { queryProjectId: 'proj-1' })
  return [check('project_match_ranks_first', ranked[0].id === 'in-project', ranked.map(r => r.id).join(','))]
}

// Phase 8 — "resolved loop not injected as active state": isActiveStatus must reject done/dropped.
function testResolvedLoopStatusesAreInactive(): CaseResult[] {
  return [
    check('done_is_inactive', !isActiveStatus('done'), 'done'),
    check('dropped_is_inactive', !isActiveStatus('dropped'), 'dropped'),
    check('open_is_active', isActiveStatus('open'), 'open'),
  ]
}

function testStrongerTextMatchOutranksWeaker(): CaseResult[] {
  const strong = candidate({ id: 'strong', textMatchStrength: 1 })
  const weak = candidate({ id: 'weak', textMatchStrength: 0.3 })
  const ranked = rankSearchCandidates([weak, strong], { queryProjectId: null })
  return [check('exact_match_outranks_partial_match', ranked[0].id === 'strong', ranked.map(r => r.id).join(','))]
}

function testMoreRecentOutranksOlderAtEqualOtherFactors(): CaseResult[] {
  const older = candidate({ id: 'older', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 90).toISOString() })
  const newer = candidate({ id: 'newer', createdAt: new Date().toISOString() })
  const ranked = rankSearchCandidates([older, newer], { queryProjectId: null })
  return [check('more_recent_outranks_older', ranked[0].id === 'newer', ranked.map(r => r.id).join(','))]
}

function testScoreIsDeterministicForSameInput(): CaseResult[] {
  const c = candidate({ id: 'x', createdAt: '2026-01-01T00:00:00.000Z' })
  const fixedNow = new Date('2026-01-15T00:00:00.000Z').getTime()
  const s1 = scoreSearchResult(c, { queryProjectId: null, now: fixedNow })
  const s2 = scoreSearchResult(c, { queryProjectId: null, now: fixedNow })
  return [check('score_deterministic_for_identical_input', s1 === s2, `${s1} vs ${s2}`)]
}

export function runSearchRankValidation(): CaseResult[] {
  return [
    ...testActiveOutranksSuperseded(),
    ...testProjectMatchOutranksUnrelated(),
    ...testResolvedLoopStatusesAreInactive(),
    ...testStrongerTextMatchOutranksWeaker(),
    ...testMoreRecentOutranksOlderAtEqualOtherFactors(),
    ...testScoreIsDeterministicForSameInput(),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runSearchRankValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Search rank validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
