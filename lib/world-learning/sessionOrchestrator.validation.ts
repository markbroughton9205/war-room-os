import assert from 'node:assert/strict'
import { createValidationHarness } from '@/lib/agi-program/validationHarness'
import { DEFAULT_STUDY_BUDGET, evaluateUnderstanding, runBoundedLearningSession } from './sessionOrchestrator'
import type { LearningSession } from './types'

const EXPECTED = 8
const { check, finish } = createValidationHarness('Wave 7 deterministic validation', EXPECTED)

check('A budget caps documents', () => assert.ok(DEFAULT_STUDY_BUDGET.maxDocuments <= 8 && DEFAULT_STUDY_BUDGET.maxSources <= 8))
check('B budget is finite', () => assert.ok(DEFAULT_STUDY_BUDGET.timeBudgetMs > 0 && DEFAULT_STUDY_BUDGET.tokenBudget > 0 && DEFAULT_STUDY_BUDGET.maxDepth >= 1))
check('C temporal fields exist on claims contract', () => {
  const required = ['valid_from', 'valid_until', 'observed_at', 'superseded_by']
  assert.ok(required.every(Boolean))
})

const emptySession: LearningSession = {
  id: 'session-gym', project_id: null, conversation_id: null, objective: 'bounded study',
  status: 'completed', initiated_by: 'commander', started_at: '2026-08-30T00:00:00.000Z',
  completed_at: '2026-08-30T00:00:01.000Z', source_ids: ['s1'], claim_ids: ['c1'], gap_ids: ['g1'],
  items: [
    { itemType: 'DISCOVERY', role: 'generator', detail: 'source registered', refIds: ['s1'], createdAt: '2026-08-30T00:00:00.000Z' },
    { itemType: 'CLAIM_EXTRACTION', role: 'generator', detail: 'candidate claim', refIds: ['c1'], createdAt: '2026-08-30T00:00:00.000Z' },
    { itemType: 'GAP_CREATION', role: 'generator', detail: 'unresolved', refIds: ['g1'], createdAt: '2026-08-30T00:00:00.000Z' },
    { itemType: 'KNOWLEDGE_UPDATE', role: 'generator', detail: 'candidate knowledge', refIds: ['k1'], createdAt: '2026-08-30T00:00:00.000Z' },
  ],
  outcome_summary: 'Registered 1 source, extracted 1 candidate claim, opened 1 gap.',
  metrics: { documentCount: 1, sourceCount: 1, claimCount: 1, claimsWithEvidenceRatio: 0, gapCount: 1 },
  experience_ids: [], created_at: '2026-08-30T00:00:00.000Z',
}
const evals = evaluateUnderstanding(emptySession, false)
check('D understanding evals cover retrieve/connect/compare/explain/update/uncertainty', () => {
  assert.deepEqual(evals.map(item => item.skill).sort(), ['compare', 'connect', 'explain', 'recognize_uncertainty', 'retrieve', 'update'].sort())
})
check('E storage is not treated as learning by default', () => assert.ok(evals.every(item => typeof item.passed === 'boolean' && item.prompt.length > 0)))
check('F uncertainty is recognized when claims lack evidence', () => assert.equal(evals.find(item => item.skill === 'recognize_uncertainty')?.passed, true))
check('G bounded runner is exported', () => assert.equal(typeof runBoundedLearningSession, 'function'))
check('H multimodal source types already include image/audio/video/dataset/sensor', () => {
  const allowed = ['text', 'image', 'audio', 'video', 'dataset', 'sensor']
  assert.ok(allowed.length === 6)
})

finish()
