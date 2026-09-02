import { pathToFileURL } from 'node:url'
import { rankAndBudget } from './rank'
import type { ContextBudget, ContextSection } from './types'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function section(kind: ContextSection['kind'], text: string, refId = kind): ContextSection {
  return {
    kind,
    heading: kind,
    text,
    tokenEstimate: Math.ceil(text.length / 4),
    sourceRefs: [{ type: 'project', id: refId }],
  }
}

function testOrderingPreservedWhenUnderBudget(): CaseResult[] {
  const sections = [section('identity', 'id'), section('project', 'proj'), section('open_loops', 'loops')]
  const result = rankAndBudget(sections, { totalTokens: 1000, sectionCaps: { identity: 100, directives: 100, project: 100, open_loops: 100, summary: 100, memories: 100, artifacts: 100, recent_messages: 100, terra: 100, world_knowledge: 100 } })
  return [
    check('ordering_preserved_under_budget', result.included.map(s => s.kind).join(',') === 'identity,project,open_loops', result.included.map(s => s.kind).join(',')),
    check('nothing_excluded_under_budget', result.excludedSourceIds.length === 0, `excluded=${result.excludedSourceIds.length}`),
  ]
}

function testPerSectionTruncation(): CaseResult[] {
  const huge = section('memories', 'x'.repeat(10_000))
  const budget: ContextBudget = { totalTokens: 6000, sectionCaps: { identity: 200, directives: 400, project: 300, open_loops: 600, summary: 800, memories: 50, artifacts: 400, recent_messages: 2000, terra: 500, world_knowledge: 600 } }
  const result = rankAndBudget([section('identity', 'id'), huge], budget)
  const memSection = result.included.find(s => s.kind === 'memories')
  return [
    check('section_truncated_to_its_cap', !!memSection && memSection.tokenEstimate <= 50, `tokenEstimate=${memSection?.tokenEstimate}`),
    check('identity_survives_alongside_truncated_section', result.included.some(s => s.kind === 'identity'), result.included.map(s => s.kind).join(',')),
  ]
}

function testLowValueSectionsDroppedFirstWhenOverBudget(): CaseResult[] {
  const sections = [
    section('identity', 'x'.repeat(400)),
    section('directives', 'x'.repeat(400)),
    section('memories', 'x'.repeat(4000)),
    section('open_loops', 'x'.repeat(2000)),
  ]
  const budget: ContextBudget = { totalTokens: 1200, sectionCaps: { identity: 5000, directives: 5000, project: 5000, open_loops: 5000, summary: 5000, memories: 5000, artifacts: 5000, recent_messages: 5000, terra: 5000, world_knowledge: 5000 } }
  const result = rankAndBudget(sections, budget)
  const kinds = result.included.map(s => s.kind)
  return [
    check('memories_dropped_before_open_loops', !kinds.includes('memories') && kinds.includes('open_loops'), kinds.join(',')),
    check('total_fits_budget_after_drop', result.totalTokens <= budget.totalTokens || kinds.length === 1, `total=${result.totalTokens} budget=${budget.totalTokens}`),
  ]
}

function testWorldKnowledgeDroppedBeforeMemories(): CaseResult[] {
  const sections = [
    section('identity', 'x'.repeat(400)),
    section('world_knowledge', 'x'.repeat(2000)),
    section('memories', 'x'.repeat(2000)),
  ]
  const budget: ContextBudget = { totalTokens: 900, sectionCaps: { identity: 5000, directives: 5000, project: 5000, open_loops: 5000, summary: 5000, memories: 5000, artifacts: 5000, recent_messages: 5000, terra: 5000, world_knowledge: 5000 } }
  const result = rankAndBudget(sections, budget)
  const kinds = result.included.map(s => s.kind)
  return [check('world_knowledge_dropped_before_memories', !kinds.includes('world_knowledge') && kinds.includes('memories'), kinds.join(','))]
}

function testIdentityNeverDropped(): CaseResult[] {
  const sections = [section('identity', 'x'.repeat(50_000)), section('memories', 'y')]
  const budget: ContextBudget = { totalTokens: 10, sectionCaps: { identity: 50_000, directives: 10, project: 10, open_loops: 10, summary: 10, memories: 10, artifacts: 10, recent_messages: 10, terra: 10, world_knowledge: 10 } }
  const result = rankAndBudget(sections, budget)
  return [check('identity_never_dropped_even_over_budget', result.included.some(s => s.kind === 'identity'), result.included.map(s => s.kind).join(','))]
}

export function runContextAssemblerRankValidation(): CaseResult[] {
  return [
    ...testOrderingPreservedWhenUnderBudget(),
    ...testPerSectionTruncation(),
    ...testLowValueSectionsDroppedFirstWhenOverBudget(),
    ...testWorldKnowledgeDroppedBeforeMemories(),
    ...testIdentityNeverDropped(),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runContextAssemblerRankValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Context Assembler rank validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
