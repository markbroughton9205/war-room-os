import { OUTCOME_LEDGER_ENTRIES, type LearningProvider } from './outcomeLedger'

export type ProviderPerformanceScorecard = {
  provider: LearningProvider
  accuracy: number
  usefulness: number
  hallucinationRate: number
  approvalSuccess: number
  repairSuccess: number
  latency: number
  retrievalQuality: number
  contradictionDetection: number
  synthesisQuality: number
  overallScore: number
  sampleSize: number
  strengths: string[]
  watchItems: string[]
}

const PROVIDER_BASELINES: Record<LearningProvider, Omit<ProviderPerformanceScorecard, 'provider' | 'overallScore' | 'sampleSize'>> = {
  ChatGPT: {
    accuracy: 0.89,
    usefulness: 0.92,
    hallucinationRate: 0.07,
    approvalSuccess: 0.88,
    repairSuccess: 0.8,
    latency: 0.74,
    retrievalQuality: 0.84,
    contradictionDetection: 0.82,
    synthesisQuality: 0.93,
    strengths: ['Strategic synthesis', 'Doctrine extraction'],
    watchItems: ['Confirm live runtime state before summarizing'],
  },
  Claude: {
    accuracy: 0.9,
    usefulness: 0.91,
    hallucinationRate: 0.05,
    approvalSuccess: 0.9,
    repairSuccess: 0.84,
    latency: 0.78,
    retrievalQuality: 0.86,
    contradictionDetection: 0.88,
    synthesisQuality: 0.91,
    strengths: ['Contradiction analysis', 'Risk framing'],
    watchItems: ['Keep recommendations tied to source evidence'],
  },
  Grok: {
    accuracy: 0.78,
    usefulness: 0.82,
    hallucinationRate: 0.11,
    approvalSuccess: 0.74,
    repairSuccess: 0.62,
    latency: 0.86,
    retrievalQuality: 0.8,
    contradictionDetection: 0.72,
    synthesisQuality: 0.77,
    strengths: ['Fast opportunity scan', 'Broad signal sweep'],
    watchItems: ['Raise confidence only after source overlap'],
  },
  Gemini: {
    accuracy: 0.83,
    usefulness: 0.85,
    hallucinationRate: 0.08,
    approvalSuccess: 0.8,
    repairSuccess: 0.7,
    latency: 0.82,
    retrievalQuality: 0.87,
    contradictionDetection: 0.78,
    synthesisQuality: 0.83,
    strengths: ['Research breadth', 'Source comparison'],
    watchItems: ['Separate assumptions from conclusions'],
  },
  'Red Team': {
    accuracy: 0.92,
    usefulness: 0.88,
    hallucinationRate: 0.03,
    approvalSuccess: 0.91,
    repairSuccess: 0.86,
    latency: 0.7,
    retrievalQuality: 0.76,
    contradictionDetection: 0.94,
    synthesisQuality: 0.82,
    strengths: ['Risk detection', 'Repair challenge review'],
    watchItems: ['Avoid blocking low-risk additive work unnecessarily'],
  },
  Cursor: {
    accuracy: 0.91,
    usefulness: 0.93,
    hallucinationRate: 0.04,
    approvalSuccess: 0.9,
    repairSuccess: 0.9,
    latency: 0.8,
    retrievalQuality: 0.82,
    contradictionDetection: 0.84,
    synthesisQuality: 0.88,
    strengths: ['Repository-grounded execution', 'Validation loops'],
    watchItems: ['Preserve user changes in dirty working trees'],
  },
  Codex: {
    accuracy: 0.87,
    usefulness: 0.89,
    hallucinationRate: 0.06,
    approvalSuccess: 0.84,
    repairSuccess: 0.88,
    latency: 0.79,
    retrievalQuality: 0.78,
    contradictionDetection: 0.81,
    synthesisQuality: 0.86,
    strengths: ['Code repair', 'Test-driven iteration'],
    watchItems: ['Check local framework conventions first'],
  },
  'Future Agent': {
    accuracy: 0.5,
    usefulness: 0.5,
    hallucinationRate: 0.5,
    approvalSuccess: 0.5,
    repairSuccess: 0.5,
    latency: 0.5,
    retrievalQuality: 0.5,
    contradictionDetection: 0.5,
    synthesisQuality: 0.5,
    strengths: ['Reserved slot for approved specialized agents'],
    watchItems: ['Requires scoped doctrine and Commander approval before activation'],
  },
}

function scoreProvider(provider: LearningProvider): ProviderPerformanceScorecard {
  const baseline = PROVIDER_BASELINES[provider]
  const events = OUTCOME_LEDGER_ENTRIES.filter(entry => entry.providers.includes(provider))
  const ledgerAccuracy = events.length ? events.reduce((sum, entry) => sum + entry.accuracy, 0) / events.length : baseline.accuracy
  const ledgerUsefulness = events.length ? events.reduce((sum, entry) => sum + entry.usefulness, 0) / events.length : baseline.usefulness
  const approvalWeight = events.some(entry => entry.approvals.some(approval => approval.required && approval.granted)) ? 0.02 : 0
  const contradictionPenalty = events.reduce((sum, entry) => sum + entry.contradictionsMissed, 0) * 0.02
  const overallScore = (
    ledgerAccuracy
    + ledgerUsefulness
    + baseline.approvalSuccess
    + baseline.repairSuccess
    + baseline.retrievalQuality
    + baseline.contradictionDetection
    + baseline.synthesisQuality
    + baseline.latency
    - baseline.hallucinationRate
    + approvalWeight
    - contradictionPenalty
  ) / 8

  return {
    provider,
    ...baseline,
    accuracy: ledgerAccuracy,
    usefulness: ledgerUsefulness,
    overallScore: Math.max(0, Math.min(1, overallScore)),
    sampleSize: events.length,
  }
}

export function getProviderScorecards(): ProviderPerformanceScorecard[] {
  return (Object.keys(PROVIDER_BASELINES) as LearningProvider[])
    .map(scoreProvider)
    .sort((a, b) => b.overallScore - a.overallScore)
}

export function getTopProviderByCapability(capability: keyof Pick<ProviderPerformanceScorecard, 'accuracy' | 'usefulness' | 'repairSuccess' | 'retrievalQuality' | 'contradictionDetection' | 'synthesisQuality'>) {
  return [...getProviderScorecards()].sort((a, b) => b[capability] - a[capability])[0]
}
