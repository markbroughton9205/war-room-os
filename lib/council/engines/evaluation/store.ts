/**
 * ENGINE-05 persistence. Sibling of engine-04 / adaptive stores.
 * Not a second analytics database. Versioned JSON, atomic tmp+rename.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile, readdir, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { resolveLocalAppDataPaths } from '@/lib/sovereign-runtime/local-ownership/paths'
import type {
  CapabilityBenchmarkResult,
  CounterfactualResult,
  EmpiricalPolicyCandidate,
  EvaluationProgram,
  ModelRoutingDecision,
  PolicyEvaluationResult,
  PromotionReceipt,
} from './types'

export function engine05StoreRoot(): string {
  const override = process.env.WAR_ROOM_ENGINE05_STORE
  return override || path.join(resolveLocalAppDataPaths().data, 'council', 'engine-05')
}

async function atomicWrite(file: string, body: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, body)
  await rename(tmp, file)
  try { await unlink(`${file}.partial`) } catch { /* none */ }
}

async function readJson<T>(file: string): Promise<T | null> {
  if (!existsSync(file)) return null
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

export function hashCanonical(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function dir(kind: string): string {
  return path.join(engine05StoreRoot(), kind)
}

export async function savePolicy(candidate: EmpiricalPolicyCandidate): Promise<string> {
  const file = path.join(dir('policies'), `${candidate.policy_id}@${candidate.version}.json`)
  await atomicWrite(file, JSON.stringify(candidate, null, 2) + '\n')
  return file
}

export async function loadPolicy(policyId: string, version?: string): Promise<EmpiricalPolicyCandidate | null> {
  const folder = dir('policies')
  if (!existsSync(folder)) return null
  if (version) return readJson<EmpiricalPolicyCandidate>(path.join(folder, `${policyId}@${version}.json`))
  const names = (await readdir(folder)).filter(n => n.startsWith(`${policyId}@`) && n.endsWith('.json')).sort()
  const last = names.at(-1)
  return last ? readJson<EmpiricalPolicyCandidate>(path.join(folder, last)) : null
}

export async function listPolicies(): Promise<EmpiricalPolicyCandidate[]> {
  const folder = dir('policies')
  if (!existsSync(folder)) return []
  const out: EmpiricalPolicyCandidate[] = []
  for (const name of (await readdir(folder)).filter(n => n.endsWith('.json'))) {
    const row = await readJson<EmpiricalPolicyCandidate>(path.join(folder, name))
    if (row) out.push(row)
  }
  return out
}

export async function saveBenchmarkRun(run: CapabilityBenchmarkResult): Promise<string> {
  const file = path.join(dir('runs'), `${run.run_id}.json`)
  await atomicWrite(file, JSON.stringify(run, null, 2) + '\n')
  return file
}

export async function loadBenchmarkRun(runId: string): Promise<CapabilityBenchmarkResult | null> {
  return readJson<CapabilityBenchmarkResult>(path.join(dir('runs'), `${runId}.json`))
}

export async function savePolicyEval(result: PolicyEvaluationResult): Promise<string> {
  const file = path.join(dir('policy-evals'), `${result.evaluation_id}.json`)
  await atomicWrite(file, JSON.stringify(result, null, 2) + '\n')
  return file
}

export async function saveRouting(decision: ModelRoutingDecision): Promise<string> {
  const file = path.join(dir('routing'), `${decision.mission_id}-${decision.task_id}.json`)
  await atomicWrite(file, JSON.stringify(decision, null, 2) + '\n')
  return file
}

export async function listRouting(): Promise<ModelRoutingDecision[]> {
  const folder = dir('routing')
  if (!existsSync(folder)) return []
  const out: ModelRoutingDecision[] = []
  for (const name of (await readdir(folder)).filter(n => n.endsWith('.json'))) {
    const row = await readJson<ModelRoutingDecision>(path.join(folder, name))
    if (row) out.push(row)
  }
  return out
}

export async function saveCounterfactual(row: CounterfactualResult): Promise<string> {
  const file = path.join(dir('counterfactuals'), `${row.evaluation_id}.json`)
  await atomicWrite(file, JSON.stringify(row, null, 2) + '\n')
  return file
}

export async function savePromotion(row: PromotionReceipt): Promise<string> {
  const file = path.join(dir('promotions'), `${row.promotion_id}.json`)
  await atomicWrite(file, JSON.stringify(row, null, 2) + '\n')
  return file
}

export async function loadPromotion(id: string): Promise<PromotionReceipt | null> {
  return readJson<PromotionReceipt>(path.join(dir('promotions'), `${id}.json`))
}

export async function saveProgram(program: EvaluationProgram): Promise<string> {
  const file = path.join(dir('programs'), `${program.program_id}.json`)
  await atomicWrite(file, JSON.stringify(program, null, 2) + '\n')
  return file
}

export async function loadProgram(id: string): Promise<EvaluationProgram | null> {
  return readJson<EvaluationProgram>(path.join(dir('programs'), `${id}.json`))
}

export async function listPrograms(): Promise<EvaluationProgram[]> {
  const folder = dir('programs')
  if (!existsSync(folder)) return []
  const out: EvaluationProgram[] = []
  for (const name of (await readdir(folder)).filter(n => n.endsWith('.json'))) {
    const row = await readJson<EvaluationProgram>(path.join(folder, name))
    if (row) out.push(row)
  }
  return out
}
