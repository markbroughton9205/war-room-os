/**
 * #22 Phase 11B — Canonical local model path exports.
 * Single router — no LocalModelRouter2 / DesktopModelRouter.
 */
export * from './types'
export * from './endpointGuard'
export {
  LOCAL_MODEL_ROUTER_ID,
  discoverLocalModels,
  discoverOllama,
  runLocalModelInference,
  buildLocalCouncilModeReport,
  lmStudioPathTruth,
  localOpenAiCompatiblePathTruth,
  redTeamEndpointProbe,
} from './router'
