import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { CHAT_REFERENCE } from '@/lib/agents/ops/engineering/chatFixture'
import { TASK_REFERENCE } from '@/lib/agents/ops/engineering/taskFixture'
import { ALERT_REFERENCE } from '@/lib/agents/ops/engineering/alertFixture'
import { PAD_RELEVANT } from '@/lib/agents/ops/engineering/paddedWorkspace'
import type { SpecialistUse } from './types'
import type { ModelRole } from './roles'

/**
 * Baseline vs integrated-specialist comparison of real missions (reports written by e2eRealModel.ts). A specialist is judged on the WHOLE mission, with its own
 * switch cost inside it, and against run-to-run variance (Welch t over repeated missions), not on a single pair.
 * Pre-registered verdict (written before the repeated runs): a specialist stays ACTIVE only if, over >= 6 specialist missions,
 *   (a) success is not worse than baseline, (b) mean mission time is >= 5% lower AND the difference is >= 2 standard errors, or builder calls fall by >= 1 on average
 *       with time not worse, and (c) repairs do not increase. Fewer than 6 missions: INSUFFICIENT_EVIDENCE. Otherwise INACTIVE.
 */
export type MissionRow = {
  run: string; config: string; fixture: string; padded: boolean; ok: boolean; completionClass: string; verifier: string; wallS: number
  builderCalls: number; repairs: number; tokens: number | null; promptCalls: number; contextChars: number
  filesProvided: string[]; retrievedProvided: string[]; irrelevantProvided: string[]; relevantProvidedHelpers: string[]; wrongFileEdits: string[]
  evictions: number; govAdmits: number; embedMs: number; phaseMs: number; researchMs: number; researchUsed: boolean; fastRepair: string
  peakGpuMiB: number | null; peakRamMiB: number | null; swapUsedMiB: number | null; specialistInferenceMs: number
}
const REF: Record<string, Record<string, string>> = { 'chat-sessions': CHAT_REFERENCE, 'task-board': TASK_REFERENCE, 'alert-center': ALERT_REFERENCE }

export function missionRow(dir: string, name: string): MissionRow | null {
  const rep = existsSync(dir) ? readdirSync(dir).filter((f) => /^report-.*\.json$/.test(f)).sort().at(-1) : undefined
  if (!rep) return null
  const r = JSON.parse(readFileSync(path.join(dir, rep), 'utf8')) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  const fixture = String(r.fixture)
  const reference = new Set(Object.keys(REF[fixture] ?? {}))
  const relevantAll = new Set<string>([...reference, ...(r.padded ? r.padded.relevant : [])])
  const cs = r.result?.contextStats ?? { filesProvided: {}, retrievedProvided: {}, builderPromptCalls: 0, contextChars: 0 }
  const provided = [...Object.keys(cs.filesProvided), ...Object.keys(cs.retrievedProvided)]
  const dec = r.specialistPool?.decisions ?? []
  const written: string[] = r.result?.filesChanged ?? []
  const cp = r.result?.contextPhase ?? {}
  return {
    run: name, config: name.split('-')[0], fixture, padded: !!r.padded, ok: r.completionClass === 'CLEAN' && String(r.independentVerificationNow?.summary ?? '').includes('# fail 0'), completionClass: r.completionClass,
    verifier: String(r.independentVerificationNow?.summary ?? ''), wallS: Math.round(r.wallMs / 1000), builderCalls: r.result?.modelCalls ?? 0, repairs: r.result?.repairs ?? 0, tokens: typeof r.result?.tokens === 'number' ? r.result.tokens : null,
    promptCalls: cs.builderPromptCalls, contextChars: cs.contextChars, filesProvided: Object.keys(cs.filesProvided), retrievedProvided: Object.keys(cs.retrievedProvided),
    irrelevantProvided: provided.filter((p) => !relevantAll.has(p) && !/^(public|server|package|src\/(chat|message|todo|task|event|alert)|test\/)/.test(p) && !/^data\//.test(p)),
    relevantProvidedHelpers: Object.keys(cs.retrievedProvided).filter((p) => (PAD_RELEVANT as readonly string[]).includes(p)),
    wrongFileEdits: written.filter((p) => !reference.has(p) && !/^test\//.test(p)),
    evictions: dec.filter((d: { action: string }) => d.action === 'EVICT_THEN_ADMIT').length, govAdmits: dec.filter((d: { action: string }) => d.action === 'ADMIT').length,
    embedMs: Number(cp.embedMs ?? 0), phaseMs: Number(cp.phaseMs ?? 0), researchMs: Number(cp.research?.ms ?? 0), researchUsed: !!cp.research?.relevant,
    fastRepair: r.result?.fastRepair ? `${r.result.fastRepair.calls}/${r.result.fastRepair.accepted}/${r.result.fastRepair.escalated}` : '-',
    peakGpuMiB: typeof r.resources?.peakGpuMiB === 'number' ? r.resources.peakGpuMiB : null, peakRamMiB: typeof r.resources?.peakRamMiB === 'number' ? r.resources.peakRamMiB : null, swapUsedMiB: typeof r.resources?.swapUsedMiB === 'number' ? r.resources.swapUsedMiB : null,
    specialistInferenceMs: Number(cp.embedMs ?? 0) + Number(cp.research?.ms ?? 0),
  }
}
export function loadMissions(root: string): MissionRow[] {
  return readdirSync(root).filter((d) => /^[A-Z]+-[a-z]+(-\d+)?$/.test(d)).sort().flatMap((d) => { const m = missionRow(path.join(root, d), d); return m ? [m] : [] })
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const sd = (xs: number[]) => { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)) }
/** Welch t of (b - a); NaN when either side has < 2 samples. */
export function welch(a: number[], b: number[]): { diff: number; se: number; t: number } {
  const diff = mean(b) - mean(a); const se = Math.sqrt(sd(a) ** 2 / Math.max(1, a.length) + sd(b) ** 2 / Math.max(1, b.length))
  return { diff, se, t: a.length < 2 || b.length < 2 ? Number.NaN : se === 0 ? (diff === 0 ? 0 : Math.sign(diff) * Infinity) : diff / se }
}
export type Verdict = { verdict: 'ACTIVE' | 'INACTIVE' | 'INSUFFICIENT_EVIDENCE'; reasons: string[]; n: { baseline: number; specialist: number }; time: { baselineMeanS: number; specialistMeanS: number; diffS: number; pct: number; t: number }; calls: { baselineMean: number; specialistMean: number }; repairs: { baselineMean: number; specialistMean: number }; success: { baseline: string; specialist: string } }
export function judgeSpecialist(baseline: MissionRow[], specialist: MissionRow[], minMissions = 6): Verdict {
  const bt = baseline.map((m) => m.wallS), st = specialist.map((m) => m.wallS)
  const w = welch(bt, st)
  const bc = mean(baseline.map((m) => m.builderCalls)), sc = mean(specialist.map((m) => m.builderCalls))
  const br = mean(baseline.map((m) => m.repairs)), sr = mean(specialist.map((m) => m.repairs))
  const bOk = baseline.filter((m) => m.ok).length / Math.max(1, baseline.length), sOk = specialist.filter((m) => m.ok).length / Math.max(1, specialist.length)
  const pct = mean(bt) ? w.diff / mean(bt) : 0
  const base: Omit<Verdict, 'verdict' | 'reasons'> = { n: { baseline: baseline.length, specialist: specialist.length }, time: { baselineMeanS: Math.round(mean(bt)), specialistMeanS: Math.round(mean(st)), diffS: Math.round(w.diff), pct: Math.round(pct * 1000) / 10, t: Math.round(w.t * 100) / 100 }, calls: { baselineMean: Math.round(bc * 100) / 100, specialistMean: Math.round(sc * 100) / 100 }, repairs: { baselineMean: Math.round(br * 100) / 100, specialistMean: Math.round(sr * 100) / 100 }, success: { baseline: `${baseline.filter((m) => m.ok).length}/${baseline.length}`, specialist: `${specialist.filter((m) => m.ok).length}/${specialist.length}` } }
  if (specialist.length < minMissions || baseline.length < minMissions) return { ...base, verdict: 'INSUFFICIENT_EVIDENCE', reasons: [`needs >= ${minMissions} missions per side (have ${baseline.length} baseline, ${specialist.length} specialist)`] }
  const reasons: string[] = []
  const successOk = sOk >= bOk
  const timeWin = pct <= -0.05 && Number.isFinite(w.t) && w.t <= -2
  const callsWin = bc - sc >= 1 && pct <= 0
  const repairsOk = sr <= br
  if (!successOk) reasons.push(`success fell (${base.success.baseline} -> ${base.success.specialist})`)
  if (!(timeWin || callsWin)) reasons.push(`no proven saving: time ${base.time.pct}% (t=${base.time.t}), builder calls ${base.calls.baselineMean} -> ${base.calls.specialistMean}`)
  if (!repairsOk) reasons.push(`repairs rose (${base.repairs.baselineMean} -> ${base.repairs.specialistMean})`)
  return reasons.length ? { ...base, verdict: 'INACTIVE', reasons } : { ...base, verdict: 'ACTIVE', reasons: [timeWin ? `time ${base.time.pct}% (t=${base.time.t})` : `builder calls ${base.calls.baselineMean} -> ${base.calls.specialistMean}`] }
}

/** SpecialistUse records for Forge from one specialist mission, with deltas against the baseline means of the same fixture. */
export function specialistUses(m: MissionRow, baselineSameFixture: MissionRow[], role: ModelRole, model: string, whyRouted: string, engineSha?: string): SpecialistUse[] {
  const bt = mean(baselineSameFixture.map((b) => b.wallS)) * 1000, bc = mean(baselineSameFixture.map((b) => b.builderCalls)), br = mean(baselineSameFixture.map((b) => b.repairs))
  const have = baselineSameFixture.length > 0
  return [{ at: new Date().toISOString(), mission: m.run, fixture: m.fixture, engineSha, specialistUsed: m.retrievedProvided.length > 0 || m.researchUsed || m.phaseMs > 0, role, model, whyRouted,
    loadMs: 'UNKNOWN', inferenceMs: m.specialistInferenceMs || 'UNKNOWN', contextProvided: { items: m.retrievedProvided.length, chars: m.contextChars, paths: m.retrievedProvided },
    builderCallsSaved: have ? Math.round((bc - m.builderCalls) * 100) / 100 : 'UNKNOWN', repairDelta: have ? Math.round((m.repairs - br) * 100) / 100 : 'UNKNOWN', missionTimeDeltaMs: have ? Math.round(m.wallS * 1000 - bt) : 'UNKNOWN', success: m.ok, verifierResult: m.verifier }]
}
