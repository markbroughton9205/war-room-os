/**
 * Media Provider Router. No provider may own HVS project state.
 * Creative request → capability → Router → adapter → Provider Job → artifact → AssetRecord.
 * Unconfigured stubs are never routing candidates. API keys are not spend authorization.
 */
import { createHvsJob, requestCancel, saveJob, type HvsJob } from './jobs'
import {
  backendsFor,
  HVS_CAPABILITIES,
  listCapabilityBackends,
  type CapabilityBackend,
  type HvsCapability,
} from './provider-registry'
import type { AdapterEstimate, HvsProviderAdapter, ProviderHealth } from './provider-adapters'
import { HVS_WAVE1_EXTERNAL_UPLOAD_AUTHORIZED, HVS_WAVE1_PROVIDER_SPEND_AUTHORIZED, HVS_WAVE1_PROVIDER_SUBMIT_AUTHORIZED } from './policy'
import { stripSecrets } from './secrets'

export type ProviderCategory =
  | 'VIDEO_GENERATOR'
  | 'IMAGE_GENERATOR'
  | 'IMAGE_EDITOR'
  | 'TTS'
  | 'VOICE'
  | 'MUSIC'
  | 'SFX'
  | 'LIP_SYNC'
  | 'UPSCALE'
  | 'INTERPOLATION'
  | 'TRANSCRIPTION'
  | 'TRANSLATION'

export type ProviderAdapter = {
  id: string
  category: ProviderCategory
  label: string
  configured: boolean
}

const CATEGORY_TO_CAPABILITY: Partial<Record<ProviderCategory, HvsCapability>> = {
  VIDEO_GENERATOR: 'VIDEO_GENERATION',
  IMAGE_GENERATOR: 'IMAGE_GENERATION',
  IMAGE_EDITOR: 'IMAGE_EDIT',
  TTS: 'VOICE_SYNTHESIS',
  VOICE: 'VOICE_SYNTHESIS',
  MUSIC: 'MUSIC_GENERATION',
  SFX: 'SFX_GENERATION',
  UPSCALE: 'UPSCALE',
  TRANSCRIPTION: 'TRANSCRIPTION',
}

const UNASSIGNED_SHELLS: ProviderAdapter[] = [
  { id: 'stub-video', category: 'VIDEO_GENERATOR', label: 'Unassigned video generator', configured: false },
  { id: 'stub-image', category: 'IMAGE_GENERATOR', label: 'Unassigned image generator', configured: false },
  { id: 'stub-image-edit', category: 'IMAGE_EDITOR', label: 'Unassigned image editor', configured: false },
  { id: 'stub-tts', category: 'TTS', label: 'Unassigned TTS', configured: false },
  { id: 'stub-voice', category: 'VOICE', label: 'Unassigned voice', configured: false },
  { id: 'stub-music', category: 'MUSIC', label: 'Unassigned music', configured: false },
  { id: 'stub-sfx', category: 'SFX', label: 'Unassigned SFX', configured: false },
  { id: 'stub-lipsync', category: 'LIP_SYNC', label: 'Unassigned lip sync', configured: false },
  { id: 'stub-upscale', category: 'UPSCALE', label: 'Unassigned upscale', configured: false },
  { id: 'stub-interp', category: 'INTERPOLATION', label: 'Unassigned interpolation', configured: false },
  { id: 'stub-transcribe', category: 'TRANSCRIPTION', label: 'Unassigned transcription', configured: false },
  { id: 'stub-translate', category: 'TRANSLATION', label: 'Unassigned translation', configured: false },
]

export function listProviders(): ProviderAdapter[] {
  return UNASSIGNED_SHELLS.map(row => ({ ...row }))
}

export function listRouterBackends(): CapabilityBackend[] {
  return listCapabilityBackends()
}

export type RouteRequest = {
  capability: HvsCapability
  projectId: string
  versionId?: string | null
  localPreferred?: boolean
  privacy?: 'local' | 'remote' | 'any'
  qualityTier?: 'draft' | 'standard' | 'high'
  referenceAssetIds?: string[]
  prompt?: string
}

export type RouteDecision =
  | { ok: true; backend: CapabilityBackend; estimate: AdapterEstimate }
  | {
      ok: false
      status: 'BLOCKED' | 'BLOCKED_PENDING_APPROVAL' | 'NOT_AVAILABLE'
      reason: string
      backend: CapabilityBackend | null
      estimate: AdapterEstimate | null
    }

function estimateFor(backend: CapabilityBackend, request: RouteRequest): AdapterEstimate {
  const upload = backend.authority.externalUpload && request.referenceAssetIds && request.referenceAssetIds.length > 0
  return {
    cost: backend.cost.class,
    estimatedCost: backend.cost.spend ? 'metered-unknown' : '0',
    requiresSpendApproval: backend.cost.spend,
    requiresExternalUpload: Boolean(upload),
    uploadSummary: upload
      ? {
          provider: backend.id,
          mediaAssetIds: request.referenceAssetIds ?? [],
          capability: request.capability,
          reason: 'Provider requires uploading referenced project media.',
          privacy: 'remote-upload',
        }
      : null,
  }
}

export function routeCapability(request: RouteRequest): RouteDecision {
  try {
    if (!HVS_CAPABILITIES.includes(request.capability)) {
      return { ok: false, status: 'NOT_AVAILABLE', reason: `Unknown capability ${request.capability}.`, backend: null, estimate: null }
    }
    const candidates = backendsFor(request.capability).filter(row => row.routeable && row.configured && row.available && row.health !== 'UNAVAILABLE')
    const privacyFiltered = candidates.filter(row => {
      if (request.privacy === 'local') return row.local
      if (request.privacy === 'remote') return !row.local
      return true
    })
    const ordered = [...privacyFiltered].sort((a, b) => {
      if (request.localPreferred !== false) {
        if (a.local !== b.local) return a.local ? -1 : 1
      }
      return a.id.localeCompare(b.id)
    })
    const metered = backendsFor(request.capability).filter(row => row.configured && row.cost.spend)
    if (ordered.length === 0 && metered.length > 0 && !HVS_WAVE1_PROVIDER_SPEND_AUTHORIZED) {
      const backend = metered[0]
      return {
        ok: false,
        status: 'BLOCKED_PENDING_APPROVAL',
        reason: 'Metered backend is configured but Commander has not authorized spend. No request was sent.',
        backend,
        estimate: estimateFor(backend, request),
      }
    }
    if (ordered.length === 0) {
      return {
        ok: false,
        status: 'NOT_AVAILABLE',
        reason: `No routeable backend for ${request.capability}. Unconfigured stubs are not used.`,
        backend: null,
        estimate: null,
      }
    }
    const backend = ordered[0]
    const estimate = estimateFor(backend, request)
    if (estimate.requiresSpendApproval && !HVS_WAVE1_PROVIDER_SPEND_AUTHORIZED) {
      return {
        ok: false,
        status: 'BLOCKED_PENDING_APPROVAL',
        reason: 'Spend approval required before provider submission. API key presence is not authorization.',
        backend,
        estimate,
      }
    }
    if (estimate.requiresExternalUpload && !HVS_WAVE1_EXTERNAL_UPLOAD_AUTHORIZED) {
      return {
        ok: false,
        status: 'BLOCKED',
        reason: 'External media upload is not authorized.',
        backend,
        estimate,
      }
    }
    return { ok: true, backend, estimate }
  } catch (error) {
    return {
      ok: false,
      status: 'BLOCKED',
      reason: error instanceof Error ? error.message : 'Router failure isolated.',
      backend: null,
      estimate: null,
    }
  }
}

/** @deprecated Unconfigured stubs must not be routed. Prefer routeCapability. */
export function routeProvider(category: ProviderCategory): ProviderAdapter | null {
  const capability = CATEGORY_TO_CAPABILITY[category]
  if (!capability) return null
  const decision = routeCapability({ capability, projectId: 'router-probe', localPreferred: true })
  if (!decision.ok) return null
  return { id: decision.backend.id, category, label: decision.backend.label, configured: decision.backend.configured }
}

export function describeRouter(): string {
  return 'HVS Provider Router is provider-neutral. Unconfigured stubs are never selected. Spend and external upload require Commander authority. Jobs resolve to AssetRecords with provenance.'
}

export function persistRoutedJob(input: {
  request: RouteRequest
  decision: RouteDecision
  actor?: 'human' | 'ai-director' | 'system'
}): HvsJob {
  const backendId = input.decision.backend?.id ?? 'none'
  const status = input.decision.ok
    ? 'QUEUED'
    : input.decision.status === 'NOT_AVAILABLE'
      ? 'BLOCKED'
      : input.decision.status
  const job = createHvsJob({
    kind: input.request.capability === 'VISION_ANALYSIS' || input.request.capability === 'TRANSCRIPTION' || input.request.capability === 'EMBEDDINGS'
      ? 'analysis'
      : 'provider',
    projectId: input.request.projectId,
    versionId: input.request.versionId,
    backend: backendId,
    status,
    inputs: stripSecrets({
      capability: input.request.capability,
      prompt: input.request.prompt ?? null,
      referenceAssetIds: input.request.referenceAssetIds ?? [],
    }),
    parameters: stripSecrets({
      qualityTier: input.request.qualityTier ?? 'draft',
      estimatedCost: input.decision.estimate?.estimatedCost ?? null,
      costClass: input.decision.estimate?.cost ?? null,
      requiresExternalUpload: Boolean(input.decision.estimate?.requiresExternalUpload),
      uploadSummary: input.decision.estimate?.uploadSummary ?? null,
    }),
    authority: {
      spend: Boolean(input.decision.estimate?.requiresSpendApproval),
      externalUpload: Boolean(input.decision.estimate?.requiresExternalUpload),
      sensitiveTransfer: Boolean(input.decision.estimate?.requiresExternalUpload),
    },
    provenance: {
      createdBy: input.actor ?? 'system',
      capability: input.request.capability,
      notes: input.decision.ok ? 'Routed; Wave 1 does not submit paid providers.' : input.decision.reason,
    },
  })
  if (!input.decision.ok) job.error = input.decision.reason
  if (input.decision.ok && !HVS_WAVE1_PROVIDER_SUBMIT_AUTHORIZED) {
    if (job.kind === 'analysis') {
      job.status = 'QUEUED'
    } else {
      job.status = 'BLOCKED'
      job.error = 'Wave 1 does not submit provider jobs.'
    }
  }
  return saveJob(job)
}

export const disabledAdapter: HvsProviderAdapter = {
  id: 'disabled',
  label: 'Disabled Wave-1 adapter',
  capabilities: [...HVS_CAPABILITIES],
  local: true,
  canHandle: () => ({ ok: false, reason: 'Wave 1 adapters do not submit.' }),
  estimate: () => ({
    cost: 'unknown',
    estimatedCost: null,
    requiresSpendApproval: true,
    requiresExternalUpload: false,
    uploadSummary: null,
  }),
  submit: () => ({ status: 'BLOCKED', reason: 'Wave 1 provider submit is not authorized.', job: createHvsJob({ kind: 'provider', projectId: 'none', backend: 'disabled', status: 'BLOCKED' }) }),
  status: job => job.status,
  cancel: job => requestCancel(job),
  normalize: result => stripSecrets({ ...result, fixture: true }),
  health: (): ProviderHealth => 'UNAVAILABLE',
}
