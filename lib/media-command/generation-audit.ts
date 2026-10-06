/**
 * Safe Wave-2 generation backend audit.
 * Never prints secret values. Never hits a paid endpoint. Never treats
 * FFmpeg colorbars / PIL / blank WAV as generative AI.
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { envConfigured } from './secrets'
import { listCapabilityBackends, type HvsCapability } from './provider-registry'
import { HVS_WAVE2_PROVIDER_SPEND_AUTHORIZED, HVS_WAVE2_PROVIDER_SUBMIT_AUTHORIZED } from './policy'
import { bundledToolPath } from './ffmpeg'

export type GenerationAuditRow = {
  backend: string
  capability: HvsCapability | 'TEXT_CHAT'
  local: boolean
  remote: boolean
  configured: boolean
  metered: boolean
  free: boolean
  requiresExternalUpload: boolean
  requiresInstall: boolean
  usableThisWave: 'YES' | 'NO'
  reason: string
}

export type Phase2ExecutionBlocker = {
  requiredCapability: HvsCapability
  candidateBackend: string
  localInstallOption: string
  remoteProviderOption: string
  estimatedCostIfKnown: string
  externalUploadRequired: boolean
  operatorDecisionRequired: string
}

const GEN_CAPS: HvsCapability[] = [
  'VIDEO_GENERATION',
  'IMAGE_GENERATION',
  'IMAGE_EDIT',
  'VOICE_SYNTHESIS',
  'MUSIC_GENERATION',
  'SFX_GENERATION',
]

function which(bin: string): boolean {
  const r = spawnSync('bash', ['-lc', `command -v ${bin}`], { encoding: 'utf8', timeout: 3000 })
  return r.status === 0 && Boolean(r.stdout?.trim())
}

function ollamaStatus(): { installed: boolean; server: boolean } {
  const installed = which('ollama') || existsSync('/home/chosenone/.local/bin/ollama')
  if (!installed) return { installed: false, server: false }
  const r = spawnSync('ollama', ['list'], { encoding: 'utf8', timeout: 4000 })
  return { installed: true, server: r.status === 0 }
}

export function auditGenerationBackends(): GenerationAuditRow[] {
  const rows: GenerationAuditRow[] = []
  for (const backend of listCapabilityBackends()) {
    if (!GEN_CAPS.includes(backend.capability)) continue
    const usable = false
    rows.push({
      backend: backend.id,
      capability: backend.capability,
      local: backend.local,
      remote: !backend.local,
      configured: backend.configured,
      metered: backend.cost.spend,
      free: !backend.cost.spend,
      requiresExternalUpload: backend.authority.externalUpload,
      requiresInstall: !backend.configured,
      usableThisWave: usable ? 'YES' : 'NO',
      reason: backend.cost.spend
        ? 'Metered remote. Wave 2 spend is not authorized. Key presence is not authorization.'
        : 'Not a routeable local generative engine.',
    })
  }

  const ollama = ollamaStatus()
  rows.push({
    backend: 'ollama',
    capability: 'TEXT_CHAT',
    local: true,
    remote: false,
    configured: ollama.installed,
    metered: false,
    free: true,
    requiresExternalUpload: false,
    requiresInstall: !ollama.installed || !ollama.server,
    usableThisWave: 'NO',
    reason: ollama.server
      ? 'Ollama is a text chat runtime, not image/audio/video generation.'
      : ollama.installed
        ? 'Ollama binary present but server is not running. Even if started, it is not a generative media engine.'
        : 'Ollama is not installed.',
  })

  for (const bin of ['piper', 'espeak', 'espeak-ng', 'festival'] as const) {
    const installed = which(bin)
    rows.push({
      backend: bin,
      capability: 'VOICE_SYNTHESIS',
      local: true,
      remote: false,
      configured: installed,
      metered: false,
      free: true,
      requiresExternalUpload: false,
      requiresInstall: !installed,
      usableThisWave: 'NO',
      reason: installed ? `${bin} present but not wired as an HVS adapter this wave.` : `${bin} is not installed. Auto-install is not authorized.`,
    })
  }

  rows.push({
    backend: 'ffmpeg-lavfi-placeholder',
    capability: 'IMAGE_GENERATION',
    local: true,
    remote: false,
    configured: existsSync(bundledToolPath('ffmpeg')),
    metered: false,
    free: true,
    requiresExternalUpload: false,
    requiresInstall: false,
    usableThisWave: 'NO',
    reason: 'FFmpeg colorbars / lavfi / blank WAV / PIL drawings are not generative AI.',
  })

  return rows
}

export function anyUsableGenerationBackend(rows = auditGenerationBackends()): boolean {
  return rows.some(row => row.usableThisWave === 'YES' && GEN_CAPS.includes(row.capability as HvsCapability))
}

export function phase2ExecutionBlocker(capability: HvsCapability = 'IMAGE_GENERATION'): Phase2ExecutionBlocker {
  const remotes = listCapabilityBackends().filter(b => b.capability === capability)
  const configured = remotes.find(b => b.configured)
  const candidate = configured ?? remotes[0]
  return {
    requiredCapability: capability,
    candidateBackend: candidate?.id ?? 'none',
    localInstallOption: 'Install an authorized local image/TTS engine (not Ollama text). Do not auto-download. Commander must name the engine.',
    remoteProviderOption: candidate
      ? `${candidate.label} via env ${candidate.authority.envNames.join(', ') || '(none)'}. Spend still requires a separate Commander authorization.`
      : 'No remote adapter registered.',
    estimatedCostIfKnown: candidate?.cost.spend ? 'metered-unknown' : '0',
    externalUploadRequired: Boolean(candidate?.authority.externalUpload),
    operatorDecisionRequired: 'Authorize spend for one metered backend, or authorize installing one local generative engine. Wave 2 did not submit any paid request.',
  }
}

export function configuredEnvNamesOnly(): Record<string, boolean> {
  const names = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'REPLICATE_API_TOKEN', 'ELEVENLABS_API_KEY']
  const out: Record<string, boolean> = {}
  for (const name of names) out[name] = envConfigured(name)
  return out
}

export function wave2GenerationAuthority() {
  return {
    spendAuthorized: HVS_WAVE2_PROVIDER_SPEND_AUTHORIZED,
    submitAuthorized: HVS_WAVE2_PROVIDER_SUBMIT_AUTHORIZED,
    keyIsNotSpendAuthorization: true,
  }
}
