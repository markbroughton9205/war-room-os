import { architectFixtures } from './architect'
import { debuggerFixtures } from './debugger'
import { changedRatio, extractCode, extractJson, runModule } from './exec'
import { fastRepairFixtures } from './fastRepair'
import { researchFixtures } from './research'
import { runFixtures } from './run'
import { securityFixtures } from './security'
import { QUERIES, SEMANTIC_QUERIES, buildCorpus, cosine, embeddingRank, keywordRank, metrics, embed } from './retrieval'
import type { Fixture } from './types'
import type { ModelClient } from '@/lib/agents/ops/engineering/runtime/ports'

let fails = 0
const check = (n: string, ok: boolean, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : ' ' + d}`); if (!ok) fails++ }

// ---- helpers
check('B01_runModule_runs_code_and_reports_failures', (await runModule('console.log(1+1)')).stdout.trim() === '2' && !(await runModule('throw new Error("x")')).ok)
check('B02_runModule_has_no_filesystem_write_child_process_or_network', await (async () => {
  const w = await runModule("import fs from 'node:fs'; fs.writeFileSync('x.txt','1')")
  const c = await runModule("import { execSync } from 'node:child_process'; execSync('echo hi')")
  return !w.ok && !c.ok && /ERR_ACCESS_DENIED|Access to this API has been restricted/.test(w.stderr + c.stderr)
})())
check('B03_runModule_kills_an_infinite_loop', (await runModule('while (true) {}', 800)).timedOut)
check('B04_extractCode_and_extractJson_are_lenient_but_exact', extractCode('hi\n```js\nlet a=1\n```\nbye') === 'let a=1' && extractJson('```json\n{"a":1}\n```')?.valueOf() !== null && (extractJson<{ a: number }>('text {"a": 2} tail')?.a === 2) && extractJson('nope') === null)
check('B05_changedRatio_is_zero_for_identical_and_high_for_a_rewrite', changedRatio('a\nb\nc', 'a\nb\nc') === 0 && changedRatio('a\nb\nc', 'x\ny\nz') === 1 && Math.abs(changedRatio('a\nb\nc\nd', 'a\nb\nc\nX') - 0.25) < 1e-9)

// ---- every fixture validates itself: the reference passes, the broken answer fails, ids are unique
const suites: [string, Fixture[], number][] = [
  ['fast_repair', fastRepairFixtures(), 10], ['debugger', await debuggerFixtures(), 10], ['architect', architectFixtures(), 10], ['research', researchFixtures(), 10], ['security', securityFixtures(), 17],
]
for (const [name, fx, n] of suites) {
  check(`B10_${name}_has_${n}_fixtures_with_unique_ids`, fx.length === n && new Set(fx.map((f) => f.id)).size === n)
  const bad: string[] = []
  for (const f of fx) {
    const ref = await f.check(f.reference ?? ''), brk = await f.check(f.broken ?? '')
    if (!ref.pass) bad.push(`${f.id} reference rejected: ${ref.detail}`)
    if (brk.pass) bad.push(`${f.id} broken accepted`)
  }
  check(`B11_${name}_checkers_accept_the_reference_and_reject_the_broken_answer`, bad.length === 0, bad.join(' ; '))
}
{
  const sec = await Promise.all(securityFixtures().map((f) => f.check(f.reference ?? '')))
  check('B12_security_covers_ten_classes_and_seven_safe_look_alikes', sec.filter((r) => r.klass === 'vulnerable').length === 10 && sec.filter((r) => r.klass === 'safe').length === 7)
  const arc = await Promise.all(architectFixtures().map((f) => f.check(f.reference ?? '')))
  check('B13_architect_has_seven_flawed_and_three_correct_variants', arc.filter((r) => r.klass === 'flawed').length === 7 && arc.filter((r) => r.klass === 'clean').length === 3)
  const res = await Promise.all(researchFixtures().map((f) => f.check(f.reference ?? '')))
  check('B14_research_has_six_answerable_and_four_unanswerable_questions', res.filter((r) => r.klass === 'answerable').length === 6 && res.filter((r) => r.klass === 'unanswerable').length === 4)
}
check('B15_the_debugger_prompts_carry_a_real_failure_report', (await debuggerFixtures()).every((f) => /Error|assert|expected|actual|AssertionError|Cannot|undefined/i.test(f.prompt.split('Failing test report:')[1] ?? '')))
check('B16_a_rewrite_that_passes_is_rejected_as_not_bounded', await (async () => {
  const f = fastRepairFixtures()[0]
  const rewritten = "```js\nimport { join } from 'node:path'\nexport const configPath = (dir, name) => [dir, name + '.json'].join('/')\nexport function other() { return 1 }\n```"
  const r = await f.check(rewritten)
  return !r.pass && /rewrote|bounded/.test(r.detail)
})())

// ---- the runner
const scripted = (replies: string[]): ModelClient => { let i = 0; return { async generate() { const t = replies[i++ % replies.length]; return t === '__FAIL__' ? { ok: false, detail: 'HTTP 500', executor: { provider: 'ollama', model: 'm' } } : { ok: true, text: t, executor: { provider: 'ollama', model: 'm' }, promptTokens: 1, outputTokens: 5, latencyMs: 1 } } } }
{
  const fx = fastRepairFixtures().slice(0, 3)
  const good = await runFixtures(scripted(fx.map((f) => f.reference as string)), fx, { repeats: 2 })
  check('B20_runner_runs_every_fixture_per_repeat_and_scores_with_the_checker', good.length === 6 && good.every((o) => o.pass && o.modelOk && o.outputTokens === 5))
  const failing = await runFixtures(scripted(['__FAIL__']), fx)
  check('B21_a_model_call_failure_is_a_failed_run_with_the_reason_not_a_skip', failing.length === 3 && failing.every((o) => !o.pass && !o.modelOk && /HTTP 500/.test(o.detail)))
  const ctl = new AbortController(); ctl.abort()
  check('B22_an_aborted_signal_stops_before_calling_the_model', (await runFixtures(scripted(['x']), fx, { signal: ctl.signal })).length === 0)
  const crashing: Fixture = { ...fx[0], check: () => { throw new Error('boom') } }
  const o = await runFixtures(scripted([fx[0].reference as string]), [crashing])
  check('B23_a_throwing_checker_is_a_failed_run', !o[0].pass && /checker error/.test(o[0].detail))
}

// ---- retrieval
{
  const root = process.cwd()
  const { chunks, files, digest } = buildCorpus(root)
  check('B30_corpus_covers_the_forge_and_engineering_directories', files.length >= 60 && chunks.length > files.length && files.includes('lib/agents/forge/scheduler.ts') && files.includes('lib/agents/ops/engineering/runtime/ollamaModel.ts') && digest.length === 16)
  check('B31_every_query_names_files_that_exist_in_the_corpus', QUERIES.length === 24 && QUERIES.every((q) => q.files.every((f) => files.includes(f))), QUERIES.filter((q) => !q.files.every((f) => files.includes(f))).map((q) => q.id).join())
  check('B31b_the_semantic_queries_exist_in_the_corpus_and_avoid_the_identifier_words', SEMANTIC_QUERIES.length === 18 && SEMANTIC_QUERIES.every((q) => q.files.every((f) => files.includes(f))) && SEMANTIC_QUERIES.every((q) => !/keep_alive|nodeProtocol|enrollment|governor|scheduler|localNode/i.test(q.q)))
  const kw = metrics(QUERIES.map((q) => keywordRank(chunks, q.q)), QUERIES.map((q) => q.files))
  check('B32_the_keyword_baseline_is_a_real_baseline_not_trivially_perfect_or_empty', kw.recall10 > 0.3 && kw.recall1 < 1, JSON.stringify(kw))
  check('B33_metrics_handle_hits_misses_and_ties', (() => { const m = metrics([['a', 'b'], ['x', 'a'], ['q']], [['a'], ['a'], ['a']]); return m.recall1 === 1 / 3 && m.recall3 === 2 / 3 && Math.abs(m.mrr - (1 + 0.5) / 3) < 1e-9 })())
  check('B34_cosine_and_embedding_rank_prefer_the_aligned_chunk', cosine([1, 0], [1, 0]) === 1 && Math.abs(cosine([1, 0], [0, 1])) < 1e-9 && embeddingRank([{ file: 'a', text: '' }, { file: 'b', text: '' }], [[0, 1], [1, 0]], [1, 0])[0] === 'b')
  check('B35_embed_rejects_a_wrong_vector_count_and_http_errors', await (async () => {
    const bad = (async () => new Response(JSON.stringify({ embeddings: [[1]] }))) as unknown as typeof fetch
    const err = (async () => new Response('', { status: 500 })) as unknown as typeof fetch
    const a = await embed('http://127.0.0.1:1', 'm', ['a', 'b'], 0, bad).then(() => false, () => true)
    const b = await embed('http://127.0.0.1:1', 'm', ['a'], 0, err).then(() => false, () => true)
    return a && b
  })())
}

console.log(`FORGE_ROLEBENCH_VALIDATION ${fails ? 'FAIL (' + fails + ')' : 'PASS'}`)
process.exit(fails ? 1 : 0)
