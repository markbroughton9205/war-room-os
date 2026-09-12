/**
 * #22 Phase 8 — Ascension DATA_CORPUS_AGENT public exports.
 */
export * from './identity'
export * from './profile'
export * from './scope'
export * from './result'
export * from './ownership'
export {
  analyzeCorpus,
  makeDataCorpusFixtures,
  type CorpusRecordInput,
  type AnalyzeCorpusInput,
  type AnalyzeCorpusOutput,
} from './analyze'
export {
  runBoundedDataCorpusAgent,
  dataCorpusResultForCouncil,
  type RunBoundedDataCorpusInput,
} from './runtime'
