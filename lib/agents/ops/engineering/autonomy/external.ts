import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * External coding models are a LAST resort and only when the Commander has ALREADY configured them: an entry in <autonomy>/external-providers.json that names the provider, the model,
 * the call and token limits and who approved it, AND the credential already present in the environment under the stated variable name. Nothing is ever asked for, discovered or paid for
 * here. With no such configuration the answer is "unavailable" with the reason, and nothing is contacted.
 */
export type ExternalProvider = { provider: string; model: string; maxCalls: number; maxTokensPerCall: number; approvedBy: string; credentialEnv: string }
export type ExternalDecision = { available: true; provider: ExternalProvider } | { available: false; reason: string }

export function externalEscalation(adir: string, env: Record<string, string | undefined> = process.env): ExternalDecision {
  const f = path.join(adir, 'external-providers.json')
  if (!existsSync(f)) return { available: false, reason: 'no approved external coding provider is configured (it needs an entry with limits and approver in external-providers.json and an existing credential); none was contacted' }
  try {
    const list = JSON.parse(readFileSync(f, 'utf8')) as ExternalProvider[]
    const p = list.find((x) => x && typeof x.provider === 'string' && typeof x.model === 'string' && x.maxCalls > 0 && x.maxTokensPerCall > 0 && typeof x.approvedBy === 'string' && x.approvedBy && typeof x.credentialEnv === 'string')
    if (!p) return { available: false, reason: 'external-providers.json has no complete entry (provider, model, limits, approvedBy, credentialEnv); none was contacted' }
    if (!env[p.credentialEnv]) return { available: false, reason: `the approved provider ${p.provider} has no credential in ${p.credentialEnv}; none was contacted` }
    return { available: true, provider: p }
  } catch { return { available: false, reason: 'external-providers.json is unreadable; none was contacted' } }
}
