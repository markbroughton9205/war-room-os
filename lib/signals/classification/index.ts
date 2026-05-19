export {
  classifySignal,
  withClassificationMetadata,
} from './classify'
export { classifyIntelligenceCategory } from './categories'
export { buildCanonicalSummary } from './summary'
export {
  applySignalClassificationPipeline,
  isActionableClassifiedSignal,
  isOperatorActionableClassifiedSignal,
  partitionClassifiedSignals,
} from './pipeline'
export type {
  ClassificationInput,
  ClassificationPipelineDiagnostics,
  ClassifiedSignalResult,
  IntelligenceCategory,
  IntelligenceOperationalClass,
  IntelligenceSeverity,
  IntelligenceTruthLabel,
  SignalClassification,
} from './types'
export {
  INTELLIGENCE_CATEGORIES,
  INTELLIGENCE_OPERATIONAL_CLASSES,
  INTELLIGENCE_SEVERITY_LEVELS,
} from './types'
