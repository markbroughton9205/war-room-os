/**
 * #22 Phase 14 — Cross-agent integration public exports.
 * Helper module. NOT an Ascension agent. Agent count remains 9.
 */
export * from './identity'
export * from './types'
export * from './limits'
export * from './failures'
export * from './authority'
export * from './ownership'
export * from './envelope'
export * from './candidateStore'
export * from './revision'
export * from './phase58aPacket'
export * from './astraBridge'
export {
  runKnowledgePipeline,
  runWorldStatePipeline,
  runEngineeringSafetyPipeline,
  runOfflineLocalWorkflow,
  runValidatorRevisionDemo,
  runIntegrationWorkflow,
  type IntegrationWorkflowInput,
  type IntegrationWorkflowResult,
} from './workflows'
export { requireIntegrationCaller } from './session'
export { tryHandleCrossAgentIntegrationHttp } from './httpCore'
