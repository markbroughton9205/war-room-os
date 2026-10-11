/**
 * FOUNDRY FIRST-PASS CORRECTNESS LAW (part 4): metrics and failure left-shift classification.
 *
 * Every defect that is found is classified by WHERE it was found and whether Foundry could have found it earlier. A PLAN_MISS / RECIPE_MISS / STATIC_MISS names the
 * earlier stage that must be improved; the long-term goal is that failures move left: found by the plan, the recipe, the edit gate or the preflight, not by the tests.
 */
import { type ImplementationContract, type BehaviorCategory } from './implContract'
import { type Recipe } from './recipes'
import { type PreflightFinding, type PreflightReport } from './preflight'

export type FirstPassOptions = {
  /** run the runtime half of the preflight (boot the server on a private copy and exercise the contract); default true */
  runtime?: boolean
  /** ask once more when the worker returns no manifest; default true */
  requireManifest?: boolean
}
export type LeftShiftCategory = 'PLAN_MISS' | 'RECIPE_MISS' | 'STATIC_MISS' | 'MODEL_GENERATION_ERROR' | 'RUNTIME_ONLY_FAILURE' | 'TEST_DEFECT' | 'ENVIRONMENT_FAILURE'
export type LeftShiftEntry = { found_at: 'EDIT_GATE' | 'PREFLIGHT' | 'VERIFIER' | 'CONTRACT_TEST'; what: string; criterion: number | null; category: LeftShiftCategory; caught_before_execution: boolean; improve: string | null }

export type FirstPassState = {
  whole_file_rewrites: number
  new_files: number
  structural_edits: number
  range_edits: number
  deterministic_structural_edits: number
  reply_rejections: { file: string; problem: string }[]
  preflight_runs: { findings: number; advisories: number; ms: number }[]
  first_preflight: PreflightFinding[] | null
  final_preflight: PreflightReport | null
  preflight_repairs: number
  repairs_by_step: Record<string, number>
  first_verifier: { pass: number; fail: number } | null
  verifier_failure_names: string[]
  manifests: { present: number; missing: number; false_claims: number; retries: number }
  recipe_gate_rejections: number
}
export const newFirstPassState = (): FirstPassState => ({ whole_file_rewrites: 0, new_files: 0, structural_edits: 0, range_edits: 0, deterministic_structural_edits: 0, reply_rejections: [], preflight_runs: [], first_preflight: null, final_preflight: null, preflight_repairs: 0, repairs_by_step: {}, first_verifier: null, verifier_failure_names: [], manifests: { present: 0, missing: 0, false_claims: 0, retries: 0 }, recipe_gate_rejections: 0 })

const CATEGORY_RECIPE: Partial<Record<BehaviorCategory, string>> = { ROUTE: 'ROUTE_ORDER', STATUS: 'REST_STATUS', STATE: 'STATE_ACTIONS', FILTER: 'LIST_FILTER', COUNTER: 'COUNTERS_AND_SHAPES', PERSISTENCE: 'JSON_FILE_STORE', UI: 'API_UI_WIRING', COMPAT: 'LEGACY_COMPAT' }
const words = (t: string) => new Set((t.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []))
/** Which criterion a failing check name is about (word overlap with the criterion text; at least three shared words). */
export function criterionOfCheck(name: string, acceptance: string[]): number | null {
  const w = words(name); let best = -1, bestHit = 2
  acceptance.forEach((a, i) => { const aw = words(a); let hit = 0; for (const x of w) if (aw.has(x)) hit++; if (hit > bestHit) { best = i; bestHit = hit } })
  return best < 0 ? null : best + 1
}

export function classifyLeftShift(input: {
  contract: ImplementationContract
  recipes: Recipe[]
  acceptance: string[]
  rejections: { file: string; problem: string }[]
  firstPreflight: PreflightFinding[] | null
  preflightChecked: string[]
  verifierFailures: string[]
  testDefects: { kind: string; test: string; basis?: string }[]
}): LeftShiftEntry[] {
  const out: LeftShiftEntry[] = []
  for (const r of input.rejections) out.push({ found_at: 'EDIT_GATE', what: `${r.file}: ${r.problem.slice(0, 180)}`, criterion: null, category: 'MODEL_GENERATION_ERROR', caught_before_execution: true, improve: null })
  for (const f of input.firstPreflight ?? []) out.push({ found_at: 'PREFLIGHT', what: `${f.check}: ${f.fact.slice(0, 180)}`, criterion: f.criterion, category: 'MODEL_GENERATION_ERROR', caught_before_execution: true, improve: null })
  const haveRecipe = new Set(input.recipes.map((r) => r.id))
  for (const name of input.verifierFailures) {
    const n = criterionOfCheck(name, input.acceptance)
    const b = n ? input.contract.behaviors.find((x) => x.criterion === n) : undefined
    const cats = b?.categories.filter((c) => c !== 'TEST' && c !== 'OTHER') ?? []
    if (!n || !b || !cats.length) { out.push({ found_at: 'VERIFIER', what: name.slice(0, 180), criterion: n, category: 'PLAN_MISS', caught_before_execution: false, improve: `implContract: C${n ?? '?'} yields no structured fact (route / status / state / persistence / UI); extend deriveImplementationContract so the plan carries it` }); continue }
    const want = cats.map((c) => CATEGORY_RECIPE[c]).filter((x): x is string => !!x)
    const missing = want.filter((r) => !haveRecipe.has(r))
    if (!want.length || missing.length === want.length) { out.push({ found_at: 'VERIFIER', what: name.slice(0, 180), criterion: n, category: 'RECIPE_MISS', caught_before_execution: false, improve: `recipes: no recipe covers ${cats.join('+')} (C${n}); add one with structure, invariants and checks` }); continue }
    const covering = input.recipes.filter((r) => want.includes(r.id))
    const exercised = input.preflightChecked.some((c) => cats.some((k) => ({ ROUTE: /runtime\.(GET|POST|PATCH)/, STATUS: /validation|runtime\.(GET|POST)/, STATE: /runtime\.POST/, FILTER: /filter/, COUNTER: /runtime\.GET/, PERSISTENCE: /restart|default storage/, UI: /^$/, COMPAT: /compat/ } as Record<string, RegExp>)[k]?.test(c)))
    const hasStatic = covering.some((r) => r.staticChecks.length > 0)
    if (!hasStatic || !exercised) out.push({ found_at: 'VERIFIER', what: name.slice(0, 180), criterion: n, category: 'STATIC_MISS', caught_before_execution: false, improve: `preflight: ${covering.map((r) => r.id).join('/')} has ${hasStatic ? 'no runtime probe' : 'no static check'} for ${cats.join('+')} (C${n}); add a check that would have flagged this` })
    else if (cats.some((c) => c === 'FILTER' || c === 'STATE' || c === 'COUNTER')) out.push({ found_at: 'VERIFIER', what: name.slice(0, 180), criterion: n, category: 'RUNTIME_ONLY_FAILURE', caught_before_execution: false, improve: `preflight reached the route and passed; the defect is in the VALUES (${cats.join('+')}, C${n}). Derive a value-level probe from the clause to move it left` })
    else out.push({ found_at: 'VERIFIER', what: name.slice(0, 180), criterion: n, category: 'STATIC_MISS', caught_before_execution: false, improve: `preflight: ${covering.map((r) => r.id).join('/')} passed but C${n} still failed; tighten its check` })
  }
  for (const d of input.testDefects) {
    const env = /^ENVIRONMENT/.test(d.kind)
    const impl = d.kind === 'IMPLEMENTATION_DEFECT'
    out.push({ found_at: 'CONTRACT_TEST', what: `${d.kind}: ${d.test.slice(0, 120)}`, criterion: null, category: env ? 'ENVIRONMENT_FAILURE' : impl ? 'STATIC_MISS' : 'TEST_DEFECT', caught_before_execution: false, improve: impl ? 'preflight: an implementation defect reached the contract tests; add the missing preflight probe' : null })
  }
  return out
}

export type FirstPassReport = {
  enabled: true
  contract: { routes: number; behaviors: number; fields: number; flags: number; filters: number; persistence: boolean; ambiguities: { kind: string; criterion: number; assumption: string | null }[] }
  recipes: string[]
  plan_steps: { target_file: string; recipes: string[]; behaviors: string[] }[]
  progression: { PLAN_VALID: boolean; IMPLEMENTATION_PREFLIGHT_PASS: boolean | null; IMPLEMENTATION_RUNTIME_PASS: boolean | null; CONTRACT_TEST_PASS: boolean | null; INDEPENDENT_VERIFIER_PASS: boolean | null }
  metrics: {
    FIRST_PASS_IMPLEMENTATION_VALID: boolean | null
    FIRST_PASS_VERIFIER_PASS: boolean | null
    FIRST_VERIFIER_SCORE: string | null
    REPAIRS_REQUIRED: number
    REPAIRS_BY_STEP: Record<string, number>
    WHOLE_FILE_REWRITES: number
    NEW_FILES: number
    STRUCTURAL_EDITS: number
    RANGE_EDITS: number
    REPLY_REJECTIONS: number
    PREFLIGHT_CAUGHT_ERRORS: number
    PREFLIGHT_UNRESOLVED: number
    TEST_DISCOVERED_ERRORS: number
    QUARANTINED_TESTS: number
  }
  preflight: { runs: FirstPassState['preflight_runs']; first_findings: { check: string; fact: string; criterion: number | null }[]; final_findings: { check: string; fact: string }[]; advisories: string[]; skipped: string[]; checked: number }
  manifests: FirstPassState['manifests']
  left_shift: LeftShiftEntry[]
  left_shift_summary: Record<string, number>
}
export function buildFirstPassReport(a: {
  contract: ImplementationContract; recipes: Recipe[]; steps: { target_file: string; recipes: string[]; behaviors: string[] }[]; st: FirstPassState; repairs: number; quarantined: number
  testDefects: { kind: string; test: string }[]; acceptance: string[]; testsPassed: boolean | null; verifierPassed: boolean | null
}): FirstPassReport {
  const { st, contract } = a
  const final = st.final_preflight
  const runtimeFinal = final ? !final.findings.some((f) => f.stage === 'RUNTIME') && !final.skipped.some((s) => /boot|did not exist|aborted/.test(s)) : null
  const first = st.first_preflight
  const firstValid = first === null ? null : first.length === 0 && st.reply_rejections.filter((r) => !/^test\//.test(r.file)).length === 0
  const left = classifyLeftShift({ contract, recipes: a.recipes, acceptance: a.acceptance, rejections: st.reply_rejections.filter((r) => !/^test\//.test(r.file)), firstPreflight: first, preflightChecked: final?.checked ?? [], verifierFailures: st.verifier_failure_names, testDefects: a.testDefects })
  const summary: Record<string, number> = {}
  for (const l of left) summary[l.category] = (summary[l.category] ?? 0) + 1
  const testDiscovered = (st.first_verifier?.fail ?? 0) + a.testDefects.filter((d) => d.kind === 'IMPLEMENTATION_DEFECT').length
  return {
    enabled: true,
    contract: { routes: contract.routes.length, behaviors: contract.behaviors.length, fields: contract.fields.length, flags: contract.flags.length, filters: contract.filters.length, persistence: contract.persistence.required, ambiguities: contract.ambiguities.map((x) => ({ kind: x.kind, criterion: x.criterion, assumption: x.assumption })) },
    recipes: a.recipes.map((r) => r.id),
    plan_steps: a.steps,
    progression: { PLAN_VALID: contract.ambiguities.every((x) => x.resolution !== null), IMPLEMENTATION_PREFLIGHT_PASS: final ? final.passed : null, IMPLEMENTATION_RUNTIME_PASS: runtimeFinal, CONTRACT_TEST_PASS: a.testsPassed, INDEPENDENT_VERIFIER_PASS: a.verifierPassed },
    metrics: {
      FIRST_PASS_IMPLEMENTATION_VALID: firstValid,
      FIRST_PASS_VERIFIER_PASS: st.first_verifier ? st.first_verifier.fail === 0 && st.first_verifier.pass > 0 : null,
      FIRST_VERIFIER_SCORE: st.first_verifier ? `${st.first_verifier.pass}/${st.first_verifier.pass + st.first_verifier.fail}` : null,
      REPAIRS_REQUIRED: a.repairs,
      REPAIRS_BY_STEP: st.repairs_by_step,
      WHOLE_FILE_REWRITES: st.whole_file_rewrites,
      NEW_FILES: st.new_files,
      STRUCTURAL_EDITS: st.structural_edits + st.deterministic_structural_edits,
      RANGE_EDITS: st.range_edits,
      REPLY_REJECTIONS: st.reply_rejections.length,
      PREFLIGHT_CAUGHT_ERRORS: first?.length ?? 0,
      PREFLIGHT_UNRESOLVED: final ? final.findings.length : 0,
      TEST_DISCOVERED_ERRORS: testDiscovered,
      QUARANTINED_TESTS: a.quarantined,
    },
    preflight: { runs: st.preflight_runs, first_findings: (first ?? []).map((f) => ({ check: f.check, fact: f.fact.slice(0, 240), criterion: f.criterion })), final_findings: (final?.findings ?? []).map((f) => ({ check: f.check, fact: f.fact.slice(0, 240) })), advisories: (final?.advisories ?? []).map((f) => f.fact.slice(0, 200)), skipped: final?.skipped ?? [], checked: final?.checked.length ?? 0 },
    manifests: st.manifests,
    left_shift: left,
    left_shift_summary: summary,
  }
}
