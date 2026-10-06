/**
 * Generation surface job states + blocked paid-request UX.
 * No HTTP. No spend. No Execute unless Commander separately authorized spend.
 */
import type { HvsJob, HvsJobStatus } from './jobs'
import type { HvsCapability } from './provider-registry'
import type { AdapterEstimate } from './provider-adapters'
import { routeCapability } from './provider-router'
import { localEngineCards, type LocalEngineCard } from './model-install'

export const GENERATION_SURFACE_STATES = [
  'NOT AVAILABLE',
  'LOCAL ENGINE NOT INSTALLED',
  'BLOCKED PENDING APPROVAL',
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
] as const

export type GenerationSurfaceState = (typeof GENERATION_SURFACE_STATES)[number]

export function jobToSurfaceState(status: HvsJobStatus | string | null | undefined): GenerationSurfaceState {
  if (status === 'QUEUED') return 'QUEUED'
  if (status === 'RUNNING') return 'RUNNING'
  if (status === 'COMPLETED') return 'COMPLETED'
  if (status === 'FAILED' || status === 'CANCELLED') return 'FAILED'
  if (status === 'BLOCKED_PENDING_APPROVAL' || status === 'blocked_pending_approval') return 'BLOCKED PENDING APPROVAL'
  return 'NOT AVAILABLE'
}

export type GenerationAuthorityCard = {
  surfaceState: GenerationSurfaceState
  provider: string
  capability: HvsCapability | string
  estimatedCost: string | null
  externalUploadRequired: boolean
  assetsTransferred: string[]
  whyApproval: string
  actions: Array<'CANCEL' | 'APPROVE LATER'>
  executeAvailable: false
  localEngine?: LocalEngineCard | null
}

export function blockedGenerationCard(input: {
  provider?: string | null
  capability: HvsCapability | string
  estimate?: AdapterEstimate | null
  reason?: string
}): GenerationAuthorityCard {
  return {
    surfaceState: 'BLOCKED PENDING APPROVAL',
    provider: input.provider ?? 'none',
    capability: input.capability,
    estimatedCost: input.estimate?.estimatedCost ?? (input.estimate?.cost === 'metered' ? 'metered — Commander spend not authorized' : 'unknown'),
    externalUploadRequired: Boolean(input.estimate?.requiresExternalUpload),
    assetsTransferred: input.estimate?.uploadSummary?.mediaAssetIds ?? [],
    whyApproval: input.reason
      ?? 'Paid/metered generation requires a separate Commander spend authorization. API keys are not spend approval. No remote request is sent.',
    actions: ['CANCEL', 'APPROVE LATER'],
    executeAvailable: false,
  }
}

export function inspectLocalEngineSurface(capability: HvsCapability | string = 'IMAGE_GENERATION'): {
  surfaceState: GenerationSurfaceState
  cards: LocalEngineCard[]
  card: GenerationAuthorityCard
} {
  const cards = localEngineCards()
  const match = cards.find(c => c.capability === capability) ?? cards[0]
  const local = match.installState !== 'INSTALLED'
  return {
    surfaceState: local ? 'LOCAL ENGINE NOT INSTALLED' : 'NOT AVAILABLE',
    cards,
    card: {
      surfaceState: local ? 'LOCAL ENGINE NOT INSTALLED' : 'NOT AVAILABLE',
      provider: match.engine,
      capability: match.capability,
      estimatedCost: 'local — $0 after install (not installed)',
      externalUploadRequired: false,
      assetsTransferred: [],
      whyApproval: `${match.engine} is ${match.installState}. Install is a separate Commander action. Generate does not install models.`,
      actions: ['CANCEL', 'APPROVE LATER'],
      executeAvailable: false,
      localEngine: match,
    },
  }
}

export function inspectGenerationRequest(capability: HvsCapability, projectId: string, prompt: string): {
  surfaceState: GenerationSurfaceState
  card: GenerationAuthorityCard | null
  jobStatus: HvsJobStatus | 'NOT_AVAILABLE' | 'LOCAL_ENGINE_NOT_INSTALLED'
  localEngines: LocalEngineCard[]
} {
  const local = inspectLocalEngineSurface(capability)
  const decision = routeCapability({ capability, projectId, prompt })
  if (capability === 'IMAGE_GENERATION' || capability === 'VOICE_SYNTHESIS' || capability === 'IMAGE_EDIT') {
    return {
      surfaceState: local.surfaceState,
      jobStatus: local.surfaceState === 'LOCAL ENGINE NOT INSTALLED' ? 'LOCAL_ENGINE_NOT_INSTALLED' : 'NOT_AVAILABLE',
      card: local.card,
      localEngines: local.cards,
    }
  }
  if (!decision.ok && decision.status === 'NOT_AVAILABLE') {
    return {
      surfaceState: 'NOT AVAILABLE',
      jobStatus: 'NOT_AVAILABLE',
      localEngines: local.cards,
      card: {
        surfaceState: 'NOT AVAILABLE',
        provider: decision.backend?.id ?? 'none',
        capability,
        estimatedCost: decision.estimate?.estimatedCost ?? null,
        externalUploadRequired: Boolean(decision.estimate?.requiresExternalUpload),
        assetsTransferred: [],
        whyApproval: decision.reason,
        actions: ['CANCEL', 'APPROVE LATER'],
        executeAvailable: false,
      },
    }
  }
  const card = blockedGenerationCard({
    provider: decision.backend?.id,
    capability,
    estimate: decision.estimate,
    reason: decision.ok ? 'Spend is not authorized this wave. Adapter will not submit.' : decision.reason,
  })
  return { surfaceState: card.surfaceState, card, jobStatus: 'BLOCKED_PENDING_APPROVAL', localEngines: local.cards }
}

export function surfaceFromJob(job: HvsJob): GenerationAuthorityCard {
  return {
    surfaceState: jobToSurfaceState(job.status),
    provider: job.backend,
    capability: job.provenance.capability ?? job.kind,
    estimatedCost: typeof job.parameters.estimatedCost === 'string' ? job.parameters.estimatedCost : 'unknown',
    externalUploadRequired: job.authority.externalUpload,
    assetsTransferred: Array.isArray(job.inputs.referenceAssetIds) ? job.inputs.referenceAssetIds.map(String) : [],
    whyApproval: job.error ?? 'Commander approval required before any paid provider request.',
    actions: ['CANCEL', 'APPROVE LATER'],
    executeAvailable: false,
  }
}
