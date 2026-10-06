/**
 * Typed HVS capability registry. Presence of an API key is not spend authorization.
 */
import { envConfigured } from './secrets'
import { bundledToolPath } from './ffmpeg'
import { existsSync } from 'node:fs'

export const HVS_CAPABILITIES = [
  'VIDEO_GENERATION',
  'IMAGE_GENERATION',
  'IMAGE_EDIT',
  'VOICE_SYNTHESIS',
  'MUSIC_GENERATION',
  'SFX_GENERATION',
  'TRANSCRIPTION',
  'EMBEDDINGS',
  'VISION_ANALYSIS',
  'UPSCALE',
  'DENOISE',
  'BACKGROUND_REMOVAL',
] as const

export type HvsCapability = (typeof HVS_CAPABILITIES)[number]

export type RegistryPrivacy = 'local' | 'remote' | 'unknown'

export type RegistryCost = {
  class: 'none' | 'metered' | 'unknown'
  spend: boolean
  note: string
}

export type CapabilityBackend = {
  id: string
  label: string
  capability: HvsCapability
  local: boolean
  configured: boolean
  available: boolean
  health: 'CONFIGURED' | 'UNCONFIGURED' | 'UNAVAILABLE' | 'HEALTHY' | 'DEGRADED'
  supportedInputs: string[]
  supportedOutputs: string[]
  limits: Record<string, string | number | boolean>
  privacy: RegistryPrivacy
  cost: RegistryCost
  authority: {
    spend: boolean
    externalUpload: boolean
    envNames: string[]
  }
  routeable: boolean
}

function remoteMetered(id: string, label: string, capability: HvsCapability, envNames: string[], outputs: string[]): CapabilityBackend {
  const configured = envNames.some(name => envConfigured(name))
  return {
    id,
    label,
    capability,
    local: false,
    configured,
    available: false,
    health: configured ? 'CONFIGURED' : 'UNCONFIGURED',
    supportedInputs: ['prompt'],
    supportedOutputs: outputs,
    limits: { wave1Submit: false },
    privacy: 'remote',
    cost: { class: 'metered', spend: true, note: 'Metered remote provider. Wave 1 spend is not authorized.' },
    authority: { spend: true, externalUpload: true, envNames },
    routeable: false,
  }
}

function localFfmpegVision(): CapabilityBackend {
  const ffmpeg = existsSync(bundledToolPath('ffmpeg'))
  return {
    id: 'local-ffmpeg-vision',
    label: 'Local FFmpeg vision (Wave 2 execution)',
    capability: 'VISION_ANALYSIS',
    local: true,
    configured: ffmpeg,
    available: ffmpeg,
    health: ffmpeg ? 'HEALTHY' : 'UNAVAILABLE',
    supportedInputs: ['assetId'],
    supportedOutputs: ['observations.json'],
    limits: { wave1Execute: false },
    privacy: 'local',
    cost: { class: 'none', spend: false, note: 'Local CPU. Wave 1 queues only; does not run analysis.' },
    authority: { spend: false, externalUpload: false, envNames: [] },
    routeable: ffmpeg,
  }
}

export function listCapabilityBackends(): CapabilityBackend[] {
  return [
    remoteMetered('openai-image', 'OpenAI Images (disabled)', 'IMAGE_GENERATION', ['OPENAI_API_KEY'], ['image']),
    remoteMetered('openai-image-edit', 'OpenAI Image Edit (disabled)', 'IMAGE_EDIT', ['OPENAI_API_KEY'], ['image']),
    remoteMetered('gemini-imagen', 'Gemini Imagen (disabled)', 'IMAGE_GENERATION', ['GEMINI_API_KEY'], ['image']),
    remoteMetered('gemini-veo', 'Gemini Veo (disabled)', 'VIDEO_GENERATION', ['GEMINI_API_KEY'], ['video']),
    remoteMetered('replicate-video', 'Replicate video (disabled)', 'VIDEO_GENERATION', ['REPLICATE_API_TOKEN'], ['video']),
    remoteMetered('elevenlabs-tts', 'ElevenLabs TTS (disabled)', 'VOICE_SYNTHESIS', ['ELEVENLABS_API_KEY'], ['audio']),
    remoteMetered('elevenlabs-music', 'ElevenLabs Music (disabled)', 'MUSIC_GENERATION', ['ELEVENLABS_API_KEY'], ['audio']),
    remoteMetered('elevenlabs-sfx', 'ElevenLabs SFX (disabled)', 'SFX_GENERATION', ['ELEVENLABS_API_KEY'], ['audio']),
    remoteMetered('openai-transcribe', 'OpenAI transcription (disabled)', 'TRANSCRIPTION', ['OPENAI_API_KEY'], ['transcript']),
    remoteMetered('remote-embeddings', 'Remote embeddings (disabled)', 'EMBEDDINGS', ['OPENAI_API_KEY', 'GEMINI_API_KEY'], ['vectors']),
    remoteMetered('remote-upscale', 'Remote upscale (disabled)', 'UPSCALE', ['REPLICATE_API_TOKEN'], ['image', 'video']),
    remoteMetered('remote-denoise', 'Remote denoise (disabled)', 'DENOISE', ['REPLICATE_API_TOKEN'], ['audio', 'video']),
    remoteMetered('remote-bg-remove', 'Remote background removal (disabled)', 'BACKGROUND_REMOVAL', ['REPLICATE_API_TOKEN'], ['image', 'video']),
    localFfmpegVision(),
  ]
}

export function backendsFor(capability: HvsCapability): CapabilityBackend[] {
  return listCapabilityBackends().filter(row => row.capability === capability)
}

export function probeProviderHealth(backendId: string): CapabilityBackend | null {
  return listCapabilityBackends().find(row => row.id === backendId) ?? null
}
