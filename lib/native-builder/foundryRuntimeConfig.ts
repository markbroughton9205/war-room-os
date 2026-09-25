/**
 * Persist Foundry model routing without secrets. Values live in the Foundry-owned
 * runtime-config.json and, when present, as named keys in repo `.env.local`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'
import { foundryDataHierarchy } from './foundryPaths'
import { FOUNDRY_DEFAULT_FALLBACK_MODEL, FOUNDRY_DEFAULT_LOCAL_ENDPOINT, FOUNDRY_DEFAULT_PRIMARY_MODEL, FOUNDRY_DEFAULT_PROVIDER_POLICY } from './foundryOperationsTypes'

const ALLOWED_KEYS = ['FOUNDRY_PRIMARY_MODEL', 'FOUNDRY_FALLBACK_MODEL', 'FOUNDRY_PROVIDER_POLICY'] as const
type AllowedKey = (typeof ALLOWED_KEYS)[number]

export type FoundryProviderPolicy = 'AUTO' | 'REMOTE' | 'LOCAL'

export type FoundryRuntimeConfig = {
  primaryModel: string
  fallbackModel: string | null
  providerPolicy: FoundryProviderPolicy
  localProviderType: 'ollama'
  localModelId: string
  localEndpoint: string
  localMissionReliability?: 'VALIDATED' | 'UNPROVEN'
  updatedAt: string
}

function parseLine(line: string): { name: string; value: string } | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  const eq = trimmed.indexOf('=')
  if (eq <= 0) return null
  let value = trimmed.slice(eq + 1).trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  return { name: trimmed.slice(0, eq).trim(), value }
}

function envLocalPath(): string {
  return path.join(resolveBaseRepoRoot(), '.env.local')
}

function readNamedEnvLocal(): Partial<Record<AllowedKey, string>> {
  const file = envLocalPath()
  if (!existsSync(file)) return {}
  const out: Partial<Record<AllowedKey, string>> = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const parsed = parseLine(line)
    if (!parsed || !(ALLOWED_KEYS as readonly string[]).includes(parsed.name)) continue
    if (parsed.value) out[parsed.name as AllowedKey] = parsed.value
  }
  return out
}

function upsertNamedEnvLocal(updates: Partial<Record<AllowedKey, string>>): void {
  const file = envLocalPath()
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const lines = existing ? existing.split(/\r?\n/) : []
  const seen = new Set<string>()
  const next = lines.map(line => {
    const parsed = parseLine(line)
    if (!parsed || !(ALLOWED_KEYS as readonly string[]).includes(parsed.name)) return line
    const replacement = updates[parsed.name as AllowedKey]
    if (replacement === undefined) return line
    seen.add(parsed.name)
    return `${parsed.name}=${replacement}`
  })
  for (const key of ALLOWED_KEYS) {
    const value = updates[key]
    if (!value || seen.has(key)) continue
    if (next.length && next[next.length - 1] !== '') next.push('')
    next.push(`${key}=${value}`)
  }
  writeFileSync(file, next.join('\n').replace(/\n*$/, '\n'), 'utf8')
}

function parsePolicy(value: unknown): FoundryProviderPolicy {
  const raw = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (raw === 'REMOTE' || raw === 'LOCAL' || raw === 'AUTO') return raw
  return FOUNDRY_DEFAULT_PROVIDER_POLICY
}

function localIdFromSpec(spec: string | null | undefined): string {
  const raw = spec?.trim() || FOUNDRY_DEFAULT_FALLBACK_MODEL
  return raw.replace(/^ollama:/i, '') || 'qwen2.5-coder:14b'
}

function readStoredConfig(): FoundryRuntimeConfig | null {
  const file = foundryDataHierarchy().runtimeConfig
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<FoundryRuntimeConfig> & { providerPolicy?: string }
    if (typeof parsed.primaryModel !== 'string' || !parsed.primaryModel.trim()) return null
    const fallback = typeof parsed.fallbackModel === 'string' && parsed.fallbackModel.trim() ? parsed.fallbackModel.trim() : null
    return {
      primaryModel: parsed.primaryModel.trim(),
      fallbackModel: fallback,
      providerPolicy: parsePolicy(parsed.providerPolicy),
      localProviderType: 'ollama',
      localModelId: typeof parsed.localModelId === 'string' && parsed.localModelId.trim()
        ? parsed.localModelId.trim()
        : localIdFromSpec(fallback),
      localEndpoint: typeof parsed.localEndpoint === 'string' && parsed.localEndpoint.trim()
        ? parsed.localEndpoint.trim().replace(/\/+$/, '')
        : FOUNDRY_DEFAULT_LOCAL_ENDPOINT,
      localMissionReliability: parsed.localMissionReliability === 'VALIDATED' ? 'VALIDATED' : 'UNPROVEN',
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    }
  } catch {
    return null
  }
}

export function readFoundryRuntimeConfig(): FoundryRuntimeConfig {
  const stored = readStoredConfig()
  const envLocal = readNamedEnvLocal()
  const primary =
    process.env.FOUNDRY_PRIMARY_MODEL?.trim()
    || envLocal.FOUNDRY_PRIMARY_MODEL?.trim()
    || stored?.primaryModel
    || FOUNDRY_DEFAULT_PRIMARY_MODEL
  const fallback =
    process.env.FOUNDRY_FALLBACK_MODEL?.trim()
    || envLocal.FOUNDRY_FALLBACK_MODEL?.trim()
    || stored?.fallbackModel
    || FOUNDRY_DEFAULT_FALLBACK_MODEL
  const policy = parsePolicy(
    process.env.FOUNDRY_PROVIDER_POLICY?.trim()
    || envLocal.FOUNDRY_PROVIDER_POLICY?.trim()
    || stored?.providerPolicy,
  )
  return {
    primaryModel: primary,
    fallbackModel: fallback,
    providerPolicy: policy,
    localProviderType: 'ollama',
    localModelId: stored?.localModelId || localIdFromSpec(fallback),
    localEndpoint: process.env.OLLAMA_BASE_URL?.trim().replace(/\/+$/, '') || stored?.localEndpoint || FOUNDRY_DEFAULT_LOCAL_ENDPOINT,
    localMissionReliability: stored?.localMissionReliability === 'VALIDATED' ? 'VALIDATED' : 'UNPROVEN',
    updatedAt: stored?.updatedAt ?? new Date().toISOString(),
  }
}

export function persistFoundryRuntimeConfig(input?: {
  primaryModel?: string
  fallbackModel?: string | null
  providerPolicy?: FoundryProviderPolicy
  localModelId?: string
  localEndpoint?: string
  localMissionReliability?: 'VALIDATED' | 'UNPROVEN'
}): FoundryRuntimeConfig {
  const current = readFoundryRuntimeConfig()
  const next: FoundryRuntimeConfig = {
    primaryModel: (input?.primaryModel ?? current.primaryModel).trim() || FOUNDRY_DEFAULT_PRIMARY_MODEL,
    fallbackModel: input && 'fallbackModel' in input
      ? (input.fallbackModel?.trim() || null)
      : current.fallbackModel,
    providerPolicy: input?.providerPolicy ?? current.providerPolicy,
    localProviderType: 'ollama',
    localModelId: (input?.localModelId ?? current.localModelId).trim() || localIdFromSpec(current.fallbackModel),
    localEndpoint: (input?.localEndpoint ?? current.localEndpoint).trim().replace(/\/+$/, '') || FOUNDRY_DEFAULT_LOCAL_ENDPOINT,
    localMissionReliability: input?.localMissionReliability ?? current.localMissionReliability ?? 'UNPROVEN',
    updatedAt: new Date().toISOString(),
  }
  writeFileSync(foundryDataHierarchy().runtimeConfig, JSON.stringify(next, null, 2), 'utf8')
  upsertNamedEnvLocal({
    FOUNDRY_PRIMARY_MODEL: next.primaryModel,
    ...(next.fallbackModel ? { FOUNDRY_FALLBACK_MODEL: next.fallbackModel } : {}),
    FOUNDRY_PROVIDER_POLICY: next.providerPolicy,
  })
  if (!process.env.FOUNDRY_PRIMARY_MODEL?.trim()) process.env.FOUNDRY_PRIMARY_MODEL = next.primaryModel
  if (next.fallbackModel && !process.env.FOUNDRY_FALLBACK_MODEL?.trim()) {
    process.env.FOUNDRY_FALLBACK_MODEL = next.fallbackModel
  }
  if (!process.env.FOUNDRY_PROVIDER_POLICY?.trim()) process.env.FOUNDRY_PROVIDER_POLICY = next.providerPolicy
  return next
}

/** Apply persisted routing into process.env without overwriting an explicit shell value. */
export function applyFoundryRuntimeConfig(): FoundryRuntimeConfig {
  const config = readFoundryRuntimeConfig()
  if (!process.env.FOUNDRY_PRIMARY_MODEL?.trim()) process.env.FOUNDRY_PRIMARY_MODEL = config.primaryModel
  if (config.fallbackModel && !process.env.FOUNDRY_FALLBACK_MODEL?.trim()) {
    process.env.FOUNDRY_FALLBACK_MODEL = config.fallbackModel
  }
  if (!process.env.FOUNDRY_PROVIDER_POLICY?.trim()) process.env.FOUNDRY_PROVIDER_POLICY = config.providerPolicy
  if (!process.env.OLLAMA_BASE_URL?.trim()) process.env.OLLAMA_BASE_URL = config.localEndpoint
  return config
}
