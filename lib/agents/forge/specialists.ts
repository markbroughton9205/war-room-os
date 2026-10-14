import { MODEL_ROLES, ROLE_GATES, type ModelRole } from './roles'
import { qualification } from './rank'
import type { BenchmarkRecord, ModelEntry } from './types'

/**
 * Local specialist candidates for Nebula (free weights, Ollama library tags). They are registered as CANDIDATE and NOT eligible; a candidate becomes
 * ACTIVE/eligible only through promoteFromEvidence, i.e. only when it has cleared at least one role gate on recorded benchmark runs. Eligibility is not a role:
 * rankForRole still decides per role, and a role with no evidence stays NO_EVIDENCE for that model.
 */
const cand = (id: string, ref: string, family: string, generation: string, license: ModelEntry['license'], note: string): ModelEntry => ({ id, ref, family, generation, roles: [], status: 'CANDIDATE', license, lineage: { note }, routing: { eligible: false, reason: 'candidate: no role qualified yet' } })

export const SPECIALIST_CANDIDATES: ModelEntry[] = [
  cand('qwen3-embedding-0.6b', 'qwen3-embedding:0.6b', 'qwen3-embedding', 'Qwen3-Embedding 0.6B', { statement: 'Apache-2.0 per the Qwen model card (declared; verify the LICENSE text shown by `ollama show --license`)', permissive: 'YES' }, 'embedding model for CODE_RETRIEVAL; Ollama library tag, Q8_0'),
  cand('qwen2.5-coder-7b', 'qwen2.5-coder:7b', 'qwen2.5-coder', 'Qwen2.5-Coder 7B Instruct', { statement: 'Apache-2.0 (Qwen2.5-Coder 7B; declared)', permissive: 'YES' }, 'small coder for FAST_REPAIR_WORKER; Ollama library tag, Q4_K_M'),
  cand('gemma3-12b', 'gemma3:12b', 'gemma3', 'Gemma 3 12B', { statement: 'Gemma Terms of Use (custom licence with use restrictions; not an OSI licence)', permissive: 'UNKNOWN' }, 'general model for RESEARCH_GENERALIST; Ollama library tag, Q4_K_M'),
  cand('deepseek-coder-v2-lite-16b', 'deepseek-coder-v2:16b-lite-instruct-q4_K_M', 'deepseek-coder-v2', 'DeepSeek-Coder-V2-Lite-Instruct 16B (MoE)', { statement: 'DeepSeek Model License (custom; permits commercial use with use-based restrictions)', permissive: 'UNKNOWN' }, 'MoE coder for DEBUGGER_TEST_SPECIALIST; Ollama library tag, Q4_K_M, 4K context on this tag'),
  cand('qwen3-coder-30b-a3b', 'qwen3-coder:30b', 'qwen3-coder', 'Qwen3-Coder 30B-A3B', { statement: 'Apache-2.0 per the Qwen model card (declared)', permissive: 'YES' }, 'MoE coder (3B active) for ARCHITECT_REVIEWER / alternate builder; Ollama library tag, Q4_K_M'),
]

export type Promotion = { entry: ModelEntry; earned: ModelRole[]; evidence: Partial<Record<ModelRole, string>> }

/** Roles whose gate (runs and success rate) the recorded benchmarks clear for this model. */
export function earnedRoles(ref: string, benchmarks: BenchmarkRecord[]): { earned: ModelRole[]; evidence: Partial<Record<ModelRole, string>> } {
  const earned: ModelRole[] = []; const evidence: Partial<Record<ModelRole, string>> = {}
  for (const role of MODEL_ROLES) {
    const q = qualification(ref, role, benchmarks); if (!q.evidence.n) continue
    const g = ROLE_GATES[role]
    evidence[role] = `${q.evidence.ok}/${q.evidence.n} (${Math.round(q.evidence.rate * 100)}%; gate ${Math.round(g.minRate * 100)}% over >= ${g.minRuns} runs)${q.qualified ? ' QUALIFIED' : ' not qualified: ' + q.problems.join('; ')}`
    if (q.qualified) earned.push(role)
  }
  return { earned, evidence }
}

/** Promote on evidence only. Never promotes by name, size or reputation; with nothing earned the model stays CANDIDATE and ineligible. */
export function promoteFromEvidence(entry: ModelEntry, benchmarks: BenchmarkRecord[], digest?: string, artifactBytes?: number): Promotion {
  const { earned, evidence } = earnedRoles(entry.ref, benchmarks)
  const base = { ...entry, ...(digest ? { digest } : {}), ...(artifactBytes ? { artifactBytes } : {}) }
  if (!earned.length) return { entry: { ...base, status: 'CANDIDATE', roles: [], routing: { eligible: false, reason: 'candidate: no role qualified yet' } }, earned, evidence }
  return { entry: { ...base, status: 'ACTIVE', roles: earned.map((r) => r.toLowerCase()), routing: { eligible: true, reason: `qualified by recorded benchmark runs for: ${earned.join(', ')}` } }, earned, evidence }
}
