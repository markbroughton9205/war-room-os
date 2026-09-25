/**
 * Authority rules. Capability does not equal authority.
 * Higher Vision may analyze, edit, generate, and render drafts.
 * It may NOT publish, spend, buy credits, upload to business accounts,
 * approve final client content, or delete source media without explicit authorized flows.
 */
import type { EditCommand } from './edit-commands'
import type { HvsProject } from './types'

export type PolicyResult =
  | { ok: true }
  | { ok: false; error: string; code: string }

const FORBIDDEN_ACTIONS = new Set([
  'publish',
  'spend',
  'buy_credits',
  'upload_business',
  'approve_final',
  'delete_original',
])

export function policyCheck(project: HvsProject, command: EditCommand): PolicyResult {
  void project
  const rec = command as EditCommand & { action?: string }
  if (rec.action && FORBIDDEN_ACTIONS.has(rec.action)) {
    return { ok: false, error: 'This action requires an explicit authorized Commander flow.', code: 'AUTHORITY' }
  }
  if (command.kind === 'generateVideo' || command.kind === 'generateImage') {
    // Generation is allowed as a ProviderJob. Spending money is not.
    return { ok: true }
  }
  return { ok: true }
}

export const HVS_WAVE1_PROVIDER_SPEND_AUTHORIZED = false
export const HVS_WAVE1_EXTERNAL_UPLOAD_AUTHORIZED = false
export const HVS_WAVE1_PROVIDER_SUBMIT_AUTHORIZED = false

/** Wave 2: paid/metered generation remains unauthorized. */
export const HVS_WAVE2_PROVIDER_SPEND_AUTHORIZED = false
export const HVS_WAVE2_EXTERNAL_UPLOAD_AUTHORIZED = false
export const HVS_WAVE2_PROVIDER_SUBMIT_AUTHORIZED = false
/** Local FFmpeg analysis / VFX / color / audio execution is authorized. */
export const HVS_WAVE2_LOCAL_ENGINE_EXECUTION_AUTHORIZED = true

/** Wave 4: plans only. Generate never installs. */
export const HVS_WAVE4_MODEL_INSTALL_AUTHORIZED = false
export const HVS_WAVE4_PIPER_INSTALL_AUTHORIZED = false
export const HVS_WAVE4_COMFYUI_INSTALL_AUTHORIZED = false
export const HVS_WAVE4_FLUX_DOWNLOAD_AUTHORIZED = false
export const HVS_WAVE4_PAID_HTTP_GENERATION_AUTHORIZED = false

/** Wave 5: install command preparation only. This wave is NOT installation approval. */
export const HVS_MODEL_INSTALL_AUTHORIZATION = false
export const HVS_PIPER_INSTALL_AUTHORIZED = false
export const HVS_COMFYUI_FLUX_INSTALL_AUTHORIZED = false
export const HVS_WAVE5_PAID_HTTP_GENERATION_AUTHORIZED = false

export function mayDeleteOriginal(): false {
  return false
}

export function mayPublishAutomatically(): false {
  return false
}

export function maySpendMoney(): false {
  return false
}

/** Wave 9: local FFmpeg post is authorized. Large model download is not. */
export const HVS_WAVE9_ASR_MODEL_DOWNLOAD_AUTHORIZED = false
export const HVS_WAVE9_OBJECT_MODEL_DOWNLOAD_AUTHORIZED = false
export const HVS_WAVE9_EMBEDDING_MODEL_DOWNLOAD_AUTHORIZED = false
/** Slice 4: Commander authorized local whisper.cpp + ggml-tiny.en.bin only. */
export const HVS_SLICE4_ASR_TINY_EN_AUTHORIZED = true
export const HVS_WAVE9_BIOMETRIC_DEFAULT = 'OFF' as const
export const HVS_WAVE9_PAID_HTTP_AUTHORIZED = false
export const HVS_WAVE9_EXTERNAL_UPLOAD_AUTHORIZED = false

export function providerSpendAuthorized(): boolean {
  return HVS_WAVE1_PROVIDER_SPEND_AUTHORIZED
}

export function externalUploadAuthorized(): boolean {
  return HVS_WAVE1_EXTERNAL_UPLOAD_AUTHORIZED
}
