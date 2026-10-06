/**
 * Normalized HVS provider adapter contract.
 * Studio UI never calls provider SDKs. Wave 1 adapters do not submit paid work.
 */
import type { HvsJob } from './jobs'
import { requestCancel } from './jobs'
import type { HvsCapability } from './provider-registry'
import { envConfigured } from './secrets'
import { normalizeProviderArtifact } from './generation-requests'

export type ProviderHealth = 'CONFIGURED' | 'UNCONFIGURED' | 'UNAVAILABLE' | 'HEALTHY' | 'DEGRADED'

export type AdapterEstimate = {
  cost: 'none' | 'metered' | 'unknown'
  estimatedCost: string | null
  requiresSpendApproval: boolean
  requiresExternalUpload: boolean
  uploadSummary: {
    provider: string
    mediaAssetIds: string[]
    capability: HvsCapability
    reason: string
    privacy: 'local' | 'remote-upload'
  } | null
}

export type AdapterHandleResult =
  | { ok: true }
  | { ok: false; reason: string }

export type AdapterSubmitResult =
  | { status: 'QUEUED'; job: HvsJob }
  | { status: 'BLOCKED'; job: HvsJob; reason: string }
  | { status: 'BLOCKED_PENDING_APPROVAL'; job: HvsJob; reason: string }
  | { status: 'NOT_AVAILABLE'; reason: string }

export interface HvsProviderAdapter {
  id: string
  label: string
  capabilities: HvsCapability[]
  local: boolean
  canHandle(request: { capability: HvsCapability; [k: string]: unknown }): AdapterHandleResult
  estimate(request: { capability: HvsCapability; [k: string]: unknown }): AdapterEstimate
  submit(request: { capability: HvsCapability; [k: string]: unknown }): Promise<AdapterSubmitResult> | AdapterSubmitResult
  status(job: HvsJob): HvsJob['status']
  cancel(job: HvsJob): HvsJob
  normalize(result: { artifactPath?: string; [k: string]: unknown }): Record<string, unknown>
  health(): ProviderHealth
}

function remoteStub(
  id: string,
  label: string,
  capabilities: HvsCapability[],
  envName: string,
): HvsProviderAdapter {
  return {
    id,
    label,
    capabilities,
    local: false,
    canHandle: request => (
      capabilities.includes(request.capability)
        ? { ok: true }
        : { ok: false, reason: `${id} does not handle ${request.capability}.` }
    ),
    estimate: request => ({
      cost: 'metered',
      estimatedCost: 'metered — not quoted this wave (no HTTP)',
      requiresSpendApproval: true,
      requiresExternalUpload: true,
      uploadSummary: {
        provider: id,
        mediaAssetIds: Array.isArray(request.referenceAssetIds) ? request.referenceAssetIds.map(String) : [],
        capability: request.capability,
        reason: 'Prompt and any reference assets would leave the machine if spend were authorized.',
        privacy: 'remote-upload',
      },
    }),
    submit: () => ({
      status: 'NOT_AVAILABLE',
      reason: `${label} submit is disabled. No HTTP generation request is sent.`,
    }),
    status: job => job.status,
    cancel: job => requestCancel(job),
    normalize: result => {
      if (typeof result.artifactPath !== 'string') return { ok: false, reason: 'No artifact. Class existence is not generation.' }
      return normalizeProviderArtifact({
        artifactPath: result.artifactPath,
        mimeType: String(result.mimeType ?? 'application/octet-stream'),
        kind: (result.kind as 'video' | 'image' | 'audio') ?? 'image',
        provider: id,
        model: null,
        prompt: typeof result.prompt === 'string' ? result.prompt : null,
        promptHash: null,
        seed: null,
        parameters: {},
        providerJobId: String(result.providerJobId ?? 'none'),
        referenceAssetIds: [],
        parentAssetIds: [],
        license: null,
        externalTransfer: { provider: id, transferred: false, reason: 'No HTTP this wave.' },
        fixture: false,
      })
    },
    health: () => (envConfigured(envName) ? 'CONFIGURED' : 'UNCONFIGURED'),
  }
}

export const openaiImageAdapter = remoteStub('openai-image', 'OpenAI Images', ['IMAGE_GENERATION', 'IMAGE_EDIT'], 'OPENAI_API_KEY')
export const geminiImageAdapter = remoteStub('gemini-imagen', 'Gemini Imagen', ['IMAGE_GENERATION'], 'GEMINI_API_KEY')
export const geminiVideoAdapter = remoteStub('gemini-veo', 'Gemini Veo', ['VIDEO_GENERATION'], 'GEMINI_API_KEY')
export const replicateAdapter = remoteStub('replicate-video', 'Replicate', ['VIDEO_GENERATION', 'IMAGE_GENERATION'], 'REPLICATE_API_TOKEN')
export const elevenLabsAdapter = remoteStub('elevenlabs-tts', 'ElevenLabs', ['VOICE_SYNTHESIS', 'MUSIC_GENERATION', 'SFX_GENERATION'], 'ELEVENLABS_API_KEY')

function localEngineStub(
  id: string,
  label: string,
  capabilities: HvsCapability[],
): HvsProviderAdapter {
  return {
    id,
    label,
    capabilities,
    local: true,
    canHandle: request => (
      capabilities.includes(request.capability)
        ? { ok: true }
        : { ok: false, reason: `${id} does not handle ${request.capability}.` }
    ),
    estimate: request => ({
      cost: 'none',
      estimatedCost: 'local — $0 after install (engine is NOT_INSTALLED)',
      requiresSpendApproval: false,
      requiresExternalUpload: false,
      uploadSummary: {
        provider: id,
        mediaAssetIds: [],
        capability: request.capability,
        reason: 'Local engine. No upload. Not installed this wave.',
        privacy: 'local',
      },
    }),
    submit: () => ({
      status: 'NOT_AVAILABLE',
      reason: `LOCAL ENGINE NOT INSTALLED. ${label} submit is disabled. Generate does not install models. No HTTP. No download.`,
    }),
    status: job => job.status,
    cancel: job => requestCancel(job),
    normalize: result => {
      if (typeof result.artifactPath !== 'string') {
        return { ok: false, reason: 'No local artifact. Class existence is not generation. Engine is not installed.' }
      }
      return normalizeProviderArtifact({
        artifactPath: result.artifactPath,
        mimeType: String(result.mimeType ?? 'application/octet-stream'),
        kind: (result.kind as 'video' | 'image' | 'audio') ?? 'image',
        provider: id,
        model: null,
        prompt: typeof result.prompt === 'string' ? result.prompt : null,
        promptHash: null,
        seed: null,
        parameters: {},
        providerJobId: String(result.providerJobId ?? 'none'),
        referenceAssetIds: [],
        parentAssetIds: [],
        license: null,
        externalTransfer: { provider: id, transferred: false, reason: 'Local. No HTTP this wave.' },
        fixture: false,
      })
    },
    health: () => 'UNAVAILABLE',
  }
}

/** HVS-native Piper adapter. Does not exec Piper. Does not download voices. */
export const piperAdapter = localEngineStub('piper', 'PiperAdapter', ['VOICE_SYNTHESIS'])
/** HVS-native ComfyUI+FLUX adapter. Workflow JSON is never project truth. Does not install. */
export const comfyUiFluxAdapter = localEngineStub('comfyui-flux', 'ComfyUiFluxAdapter', ['IMAGE_GENERATION'])

export const REMOTE_GENERATION_ADAPTERS: HvsProviderAdapter[] = [
  openaiImageAdapter,
  geminiImageAdapter,
  geminiVideoAdapter,
  replicateAdapter,
  elevenLabsAdapter,
]

export const LOCAL_GENERATION_ADAPTERS: HvsProviderAdapter[] = [
  piperAdapter,
  comfyUiFluxAdapter,
]

export const ALL_GENERATION_ADAPTERS: HvsProviderAdapter[] = [
  ...LOCAL_GENERATION_ADAPTERS,
  ...REMOTE_GENERATION_ADAPTERS,
]

