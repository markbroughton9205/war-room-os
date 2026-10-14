import { judgeSpecialist, specialistUses, welch, type MissionRow } from './abAnalysis'
let fails = 0
const check = (n: string, ok: boolean, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : ' ' + d}`); if (!ok) fails++ }
const row = (config: string, wallS: number, o: Partial<MissionRow> = {}): MissionRow => ({ run: `${config}-chat-1`, config, fixture: 'chat-sessions', padded: true, ok: true, completionClass: 'CLEAN', verifier: '# tests 12 | # pass 12 | # fail 0', wallS, builderCalls: 9, repairs: 0, tokens: 1000, promptCalls: 8, contextChars: 5000, filesProvided: [], retrievedProvided: [], irrelevantProvided: [], relevantProvidedHelpers: [], wrongFileEdits: [], evictions: 1, govAdmits: 6, embedMs: 0, phaseMs: 0, researchMs: 0, researchUsed: false, fastRepair: '-', peakGpuMiB: 15000, peakRamMiB: 12000, swapUsedMiB: 8100, specialistInferenceMs: 0, ...o })
const rep = (c: string, times: number[], o: Partial<MissionRow> = {}) => times.map((t, i) => row(c, t, { run: `${c}-chat-${i + 1}`, ...o }))
const B = rep('BASELINE', [400, 420, 410, 430, 405, 415])
check('A01_welch_reports_diff_standard_error_and_t', (() => { const w = welch([10, 11, 9, 10], [8, 7, 9, 8]); return w.diff === -2 && w.se > 0 && w.t < -2 })())
check('A02_welch_needs_two_samples_per_side', Number.isNaN(welch([1], [2, 3]).t))
check('A03_fewer_than_six_missions_is_insufficient_evidence', judgeSpecialist(B, rep('RETRIEVAL', [300, 310, 305])).verdict === 'INSUFFICIENT_EVIDENCE')
check('A04_a_clear_time_saving_beyond_noise_keeps_the_specialist_active', judgeSpecialist(B, rep('RETRIEVAL', [330, 340, 335, 345, 332, 338])).verdict === 'ACTIVE')
check('A05_a_saving_inside_the_noise_is_not_enough', judgeSpecialist(B, rep('RETRIEVAL', [380, 440, 400, 420, 395, 430])).verdict === 'INACTIVE')
check('A06_a_time_saving_with_lower_success_is_rejected', (() => { const v = judgeSpecialist(B, [...rep('RETRIEVAL', [330, 340, 335, 345, 332]), row('RETRIEVAL', 330, { ok: false, completionClass: 'FAILED' })]); return v.verdict === 'INACTIVE' && v.reasons.some((r) => /success fell/.test(r)) })())
check('A07_more_repairs_is_rejected_even_when_faster', (() => { const v = judgeSpecialist(B, rep('RETRIEVAL', [330, 340, 335, 345, 332, 338], { repairs: 2 })); return v.verdict === 'INACTIVE' && v.reasons.some((r) => /repairs rose/.test(r)) })())
check('A08_saving_builder_calls_without_losing_time_counts', judgeSpecialist(B, rep('RETRIEVAL', [405, 410, 400, 415, 408, 412], { builderCalls: 7 })).verdict === 'ACTIVE')
check('A09_slower_is_inactive_with_the_reason', (() => { const v = judgeSpecialist(B, rep('RETRIEVAL', [500, 520, 510, 505, 515, 512])); return v.verdict === 'INACTIVE' && /no proven saving/.test(v.reasons[0]) && v.time.pct > 0 })())
check('A10_specialist_use_records_carry_deltas_against_the_baseline_mean', (() => { const u = specialistUses(row('RETRIEVAL', 300, { builderCalls: 7, repairs: 0, retrievedProvided: ['src/lib/ids.mjs'], phaseMs: 9000, embedMs: 8000, specialistInferenceMs: 8000 }), B, 'CODE_RETRIEVAL', 'qwen3-embedding:0.6b', 'why')[0]; return u.specialistUsed && u.builderCallsSaved === 2 && u.missionTimeDeltaMs === Math.round(300000 - 413333.33333333331) && u.contextProvided.items === 1 && u.inferenceMs === 8000 })())
check('A11_without_baseline_rows_the_deltas_are_unknown_never_zero', (() => { const u = specialistUses(row('RETRIEVAL', 300), [], 'CODE_RETRIEVAL', 'm', 'w')[0]; return u.builderCallsSaved === 'UNKNOWN' && u.missionTimeDeltaMs === 'UNKNOWN' && u.repairDelta === 'UNKNOWN' })())
console.log(`FORGE_ABANALYSIS_VALIDATION ${fails ? 'FAIL (' + fails + ')' : 'PASS'}`)
process.exit(fails ? 1 : 0)
