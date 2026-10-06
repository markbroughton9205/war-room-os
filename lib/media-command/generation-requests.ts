/**
 * Vendor-neutral generation request / result contracts.
 * A fixture may prove ingest+provenance. Fixture output is NOT generation working.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { AssetProvenance } from './types'
import { stripSecrets } from './secrets'

export type GenerationAuthority = {
  spendApproved: boolean
  externalUploadApproved: boolean
}

export type GenerateVideoRequest = {
  projectId: string
  versionId?: string | null
  prompt: string
  negativePrompt?: string
  referenceAssetIds?: string[]
  aspect?: '16:9' | '9:16' | '1:1'
  durationSec?: number
  resolution?: string
  seed?: string | number
  qualityTier?: 'draft' | 'standard' | 'high'
  privacy?: 'local' | 'remote' | 'any'
  providerPreference?: string
  authority: GenerationAuthority
}

export type GenerateImageRequest = Omit<GenerateVideoRequest, 'durationSec'> & {
  edit?: boolean
  maskAssetId?: string
}

export type GenerateVoiceRequest = {
  projectId: string
  versionId?: string | null
  script: string
  voice?: string
  language?: string
  pace?: number
  authority: GenerationAuthority
}

export type GenerateMusicRequest = {
  projectId: string
  versionId?: string | null
  prompt: string
  durationSec?: number
  authority: GenerationAuthority
}

export type GenerateSfxRequest = {
  projectId: string
  versionId?: string | null
  prompt: string
  durationSec?: number
  authority: GenerationAuthority
}

export type NormalizedProviderArtifact = {
  artifactPath: string
  mimeType: string
  kind: 'video' | 'image' | 'audio'
  provider: string
  model: string | null
  prompt: string | null
  promptHash: string | null
  seed: string | number | null
  parameters: Record<string, unknown>
  providerJobId: string
  referenceAssetIds: string[]
  parentAssetIds: string[]
  license: string | null
  externalTransfer: { provider: string; transferred: boolean; reason: string } | null
  fixture: boolean
}

export function normalizeGenerateRequest<T extends { prompt?: string; script?: string; authority: GenerationAuthority }>(request: T): T {
  return stripSecrets({
    ...request,
    prompt: typeof request.prompt === 'string' ? request.prompt.trim() : request.prompt,
    script: typeof request.script === 'string' ? request.script.trim() : request.script,
    authority: {
      spendApproved: Boolean(request.authority?.spendApproved),
      externalUploadApproved: Boolean(request.authority?.externalUploadApproved),
    },
  })
}

export function promptHash(prompt: string | null | undefined): string | null {
  if (!prompt) return null
  return createHash('sha256').update(prompt).digest('hex')
}

export function normalizeProviderArtifact(input: NormalizedProviderArtifact): NormalizedProviderArtifact {
  if (!input.artifactPath || !existsSync(input.artifactPath)) {
    throw new Error('Normalized artifact path missing. Class existence is not an artifact.')
  }
  return stripSecrets({
    ...input,
    promptHash: input.promptHash ?? promptHash(input.prompt),
    parameters: input.parameters ?? {},
  })
}

export function provenanceFromNormalized(
  projectId: string,
  artifact: NormalizedProviderArtifact,
  existing?: AssetProvenance | null,
): AssetProvenance {
  const base: AssetProvenance = existing ?? {
    provider: null,
    model: null,
    prompt: null,
    parameters: {},
    seed: null,
    referenceAssetIds: [],
    sourceAssetIds: [],
    createdAt: new Date().toISOString(),
    commercialUse: 'unknown',
    parentAssetId: null,
    projectId,
  }
  return {
    ...base,
    origin: 'generated',
    provider: artifact.provider,
    model: artifact.model,
    prompt: artifact.prompt,
    promptHash: artifact.promptHash,
    parameters: artifact.parameters,
    seed: artifact.seed,
    referenceAssetIds: artifact.referenceAssetIds,
    sourceAssetIds: artifact.parentAssetIds,
    parentAssetId: artifact.parentAssetIds[0] ?? base.parentAssetId,
    parentAssetIds: artifact.parentAssetIds,
    providerJobId: artifact.providerJobId,
    license: artifact.license,
    externalTransfer: artifact.externalTransfer,
    createdAt: base.createdAt,
    commercialUse: base.commercialUse,
    projectId,
  }
}

export const GENERATION_CONTRACT_NOTE = 'Fixture ingest proves the AssetRecord path. It does not mean generation is WORKING.'
