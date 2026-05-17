import { OUTCOME_LEDGER_ENTRIES } from './outcomeLedger'

export type DoctrineEntry = {
  id: string
  principle: string
  evidence: string[]
  originEventId: string
  recurrenceFrequency: number
  confidence: number
  contradictions: string[]
  status: 'candidate' | 'promoted' | 'watching'
}

export const DOCTRINE_ENTRIES: DoctrineEntry[] = [
  {
    id: 'doctrine-retrieval-before-synthesis',
    principle: 'Retrieve and cite source evidence before strategic synthesis.',
    evidence: ['outcome-intel-retrieval-003', 'Persistent source network', 'Contradiction scanner'],
    originEventId: 'outcome-intel-retrieval-003',
    recurrenceFrequency: 4,
    confidence: 0.91,
    contradictions: [],
    status: 'promoted',
  },
  {
    id: 'doctrine-approval-before-mutation',
    principle: 'Require Commander approval before production mutation, spending, deployment, outreach, or repair execution.',
    evidence: ['outcome-repair-ledger-002', 'Action approval ledger', 'Standing permission gate'],
    originEventId: 'outcome-repair-ledger-002',
    recurrenceFrequency: 6,
    confidence: 0.97,
    contradictions: [],
    status: 'promoted',
  },
  {
    id: 'doctrine-runtime-truth',
    principle: 'Prefer runtime evidence over static assumptions when reporting current system state.',
    evidence: ['outcome-runtime-truth-001', 'Live Environment packet', 'Runtime integrity mapper'],
    originEventId: 'outcome-runtime-truth-001',
    recurrenceFrequency: 5,
    confidence: 0.95,
    contradictions: [],
    status: 'promoted',
  },
  {
    id: 'doctrine-rollback-before-repair',
    principle: 'Create rollback checkpoints before repair execution.',
    evidence: ['outcome-repair-ledger-002', 'Rollback status endpoint', 'Patch history summarizer'],
    originEventId: 'outcome-repair-ledger-002',
    recurrenceFrequency: 3,
    confidence: 0.88,
    contradictions: ['Emergency read-only diagnosis does not require a checkpoint.'],
    status: 'promoted',
  },
]

export function getDoctrineEntries(): DoctrineEntry[] {
  const knownOutcomeIds = new Set(OUTCOME_LEDGER_ENTRIES.map(entry => entry.id))
  return DOCTRINE_ENTRIES.map(entry => ({
    ...entry,
    confidence: knownOutcomeIds.has(entry.originEventId) ? entry.confidence : Math.min(entry.confidence, 0.6),
  }))
}

export function getDoctrineSummary() {
  const entries = getDoctrineEntries()
  return {
    promoted: entries.filter(entry => entry.status === 'promoted').length,
    candidates: entries.filter(entry => entry.status === 'candidate').length,
    averageConfidence: entries.reduce((sum, entry) => sum + entry.confidence, 0) / entries.length,
    hardBoundary: 'Doctrine can guide recommendations; it cannot bypass approval gates.',
  }
}
