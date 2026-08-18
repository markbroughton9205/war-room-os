export * from './types'
export { assessOpportunityReadiness } from './readinessEngine'
export { matchRequirement, matchRequirements, isHardBlocking } from './requirementMatcher'
export { analyzeFinancials } from './financialAnalysis'
export { buildCommanderQuestions } from './commanderQuestions'
export { buildProviderQuestions } from './providerQuestions'
export { buildPreparationMissions } from './preparationMission'
export { detectRecurringGaps, recordGapObservations, __resetDevelopmentGapLog } from './developmentGapDetector'
export { fromOpportunityAgentRecord } from './adapters'
// Note: validation.ts is intentionally not re-exported here — it uses node:fs
// for source-level checks and must stay out of any client-bundled import path.
// Import it directly (see scripts/run-phase49d-validation.mjs).
