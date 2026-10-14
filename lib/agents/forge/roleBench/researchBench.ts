/**
 * RESEARCH_GENERALIST integration benchmark: which research model gives the builder the most useful brief for the least disruption?
 * Eight coding tasks whose required facts exist ONLY in a supplied document. For each research model: write a brief per task (batched, model unloaded
 * afterwards), then the builder implements each task under three conditions: NONE (no document), BRIEF (the research model's brief, after Foundry's own
 * assessBrief gate) and RAW (the whole document, the upper bound). Reported: brief fact coverage and unsupported claims (accuracy), latency, builder
 * reload cost after the research phase (VRAM disruption), and builder success per condition (usefulness).
 *   WAR_ROOM_AGENT_FOUNDRY_DIR=<dir> node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/agents/forge/roleBench/researchBench.ts \
 *        --builder <ref> --models <ref,ref> --out <dir> [--repeats 1]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { OllamaModelClient, loopbackBaseUrl } from '@/lib/agents/ops/engineering/runtime/ollamaModel'
import { assessBrief, makeResearcher } from '../researchBrief'
import { MemSampler, readMem } from './sampler'
import { extractCode, runModule } from './exec'

type Task = { id: string; doc: string; ask: string; facts: RegExp[]; test: string }
const H = "import assert from 'node:assert/strict'\n"
export const TASKS: Task[] = [
  { id: 'region', doc: 'Regional configuration. The service reads the environment variable WR_REGION. Valid values are eu-west and us-east; anything else, including an empty value, falls back to the default eu-west. Values are case-insensitive and surrounding spaces are ignored. The configuration file format is YAML but is not used here.', ask: 'Export function regionFromEnv(env) that returns the configured region string for an environment object.', facts: [/WR_REGION/, /eu-west/, /us-east/, /case-insensitive|lower/i], test: "assert.equal(regionFromEnv({}), 'eu-west'); assert.equal(regionFromEnv({ WR_REGION: ' US-East ' }), 'us-east'); assert.equal(regionFromEnv({ WR_REGION: 'mars' }), 'eu-west'); assert.equal(regionFromEnv({ WR_REGION: '' }), 'eu-west')" },
  { id: 'rate', doc: 'Rate limiting. Each API key may make 30 requests per fixed 60-second window. The window starts at the first request of that key. The 31st request inside the window is rejected with HTTP status 429 and a body { error: "rate limited", retryAfter: <whole seconds until the window ends, rounded up> }. Counters of different keys are independent. Metrics are exported separately.', ask: 'Export function checkRate(state, key, nowMs) where state is a plain object kept by the caller. It returns { allowed: true } or { allowed: false, status: 429, body: { error, retryAfter } }.', facts: [/30/, /60/, /429/, /rate limited/, /rounded up|ceil/i], test: "const st = {}; for (let i = 0; i < 30; i++) assert.equal(checkRate(st, 'k', 1000 + i).allowed, true); const r = checkRate(st, 'k', 11000); assert.equal(r.allowed, false); assert.equal(r.status, 429); assert.deepEqual(r.body, { error: 'rate limited', retryAfter: 50 }); assert.equal(checkRate(st, 'other', 11000).allowed, true); assert.equal(checkRate(st, 'k', 61001).allowed, true)" },
  { id: 'retention', doc: 'Log retention policy. Log entries older than 14 days are deleted. Entries of type "audit" are never deleted, whatever their age. Ages are measured in milliseconds from the entry timestamp ts (epoch milliseconds). An entry exactly 14 days old is kept. Compression of old logs is out of scope.', ask: 'Export function shouldDelete(entry, nowMs) for an entry { type, ts }.', facts: [/14 days/, /audit/, /exactly 14 days|kept/i], test: "const D = 86400000; assert.equal(shouldDelete({ type: 'app', ts: 0 }, 14 * D + 1), true); assert.equal(shouldDelete({ type: 'app', ts: 0 }, 14 * D), false); assert.equal(shouldDelete({ type: 'audit', ts: 0 }, 400 * D), false)" },
  { id: 'invoice', doc: 'Invoice numbering. Invoice numbers have the form INV-<year>-<counter>, where the counter has exactly 5 digits with leading zeros. The counter starts at 00001 at the first invoice of every calendar year and increases by one for each following invoice of the same year. The year is the UTC year of the invoice date. Tax rules are documented elsewhere.', ask: 'Export function nextInvoiceNumber(last, date) where last is the previous invoice number string or null, and date is a JavaScript Date.', facts: [/INV-/, /5 digits|five/i, /00001/, /every calendar year|each year|starts/i], test: "assert.equal(nextInvoiceNumber(null, new Date('2026-03-01T00:00:00Z')), 'INV-2026-00001'); assert.equal(nextInvoiceNumber('INV-2026-00041', new Date('2026-09-01T00:00:00Z')), 'INV-2026-00042'); assert.equal(nextInvoiceNumber('INV-2026-00042', new Date('2027-01-02T00:00:00Z')), 'INV-2027-00001')" },
  { id: 'roles', doc: 'Access control. There are three roles ordered viewer < editor < admin; a higher role may do everything a lower role may. The action "read" needs viewer, the actions "create" and "update" need editor, and the action "delete" needs admin. Any other action name is denied for every role. Role names are lowercase.', ask: 'Export function can(role, action) returning a boolean.', facts: [/viewer/, /editor/, /admin/, /denied/i], test: "assert.equal(can('viewer', 'read'), true); assert.equal(can('viewer', 'update'), false); assert.equal(can('editor', 'create'), true); assert.equal(can('editor', 'delete'), false); assert.equal(can('admin', 'delete'), true); assert.equal(can('admin', 'export'), false)" },
  { id: 'token', doc: 'Token format. A token is the base64url encoding of the JSON text of the payload, followed by a dot, followed by an 8-character checksum. The checksum is the first 8 lowercase hexadecimal characters of the SHA-256 digest of the string payloadJson + "WR-SALT", where payloadJson is the same JSON text that was encoded. Tokens expire after one hour, which is handled by the caller.', ask: 'Export function makeToken(payload) using node:crypto, returning the token string.', facts: [/base64url/, /8/, /sha-?256/i, /WR-SALT/], test: "import { createHash } from 'node:crypto'; const p = { u: 1 }; const j = JSON.stringify(p); const want = Buffer.from(j).toString('base64url') + '.' + createHash('sha256').update(j + 'WR-SALT').digest('hex').slice(0, 8); assert.equal(makeToken(p), want)" },
  { id: 'sla', doc: 'Service level dates. A ticket is due 3 business days after the day it was opened. Business days are Monday to Friday. The only holidays are 2026-01-01 and 2026-12-25, which do not count as business days. The opening day itself is not counted. Dates are ISO strings YYYY-MM-DD in UTC.', ask: 'Export function dueDate(startIso) returning the due date as a YYYY-MM-DD string.', facts: [/3 business days/, /Monday to Friday|weekdays/i, /2026-12-25/, /2026-01-01/], test: "assert.equal(dueDate('2026-03-02'), '2026-03-05'); assert.equal(dueDate('2026-03-05'), '2026-03-10'); assert.equal(dueDate('2026-12-23'), '2026-12-30'); assert.equal(dueDate('2025-12-30'), '2026-01-05')" },
  { id: 'paging', doc: 'List endpoints. The page size defaults to 25 and may not exceed 100: larger requests are clamped to 100. Page numbers start at 1; a missing or invalid page is page 1. The response is an object { items, page, pageSize, total, hasNext } where hasNext is true when more items exist after this page. Sorting is done by the caller.', ask: 'Export function paginate(items, query) where query may contain page and pageSize.', facts: [/25/, /100/, /start at 1|starts at 1/i, /hasNext/], test: "const xs = Array.from({ length: 130 }, (_, i) => i); const a = paginate(xs, {}); assert.equal(a.items.length, 25); assert.equal(a.page, 1); assert.equal(a.hasNext, true); assert.equal(a.total, 130); const b = paginate(xs, { page: 2, pageSize: 500 }); assert.equal(b.pageSize, 100); assert.equal(b.items[0], 100); assert.equal(b.hasNext, false); assert.equal(paginate(xs, { page: 0 }).page, 1)" },
]

// The documents the service really has are long: the needed paragraph sits among unrelated policy text, which is what a brief has to cut through (short documents are handed over whole, never briefed).
const FILLER_A = 'Office and facilities. The office is open from 08:00 to 18:00 on working days. Visitors register at the front desk and wear a badge. Meeting rooms are booked through the shared calendar and released when unused for fifteen minutes. Parking spaces are assigned by seniority. The kitchen is cleaned every evening and shared food is thrown away on Fridays.\n\nBranch naming. Feature branches start with feature/, fixes with fix/, and releases with release/. Commit messages are written in the imperative mood and stay under seventy-two characters on the first line. Pull requests need one approval. Squash merging is preferred for small changes and merge commits for long-running branches.\n\nBackups. Database backups run nightly at 02:30 and are kept for thirty days; weekly backups are kept for a year. Restores are rehearsed once per quarter by the operations team. Backup encryption keys are rotated every twelve months and stored in the hardware vault.\n\n'
const FILLER_B = '\n\nIncident communication. During an incident the on-call engineer opens a channel, posts a summary every thirty minutes, and writes a short review within five working days. Customers are informed through the status page. Severity levels are numbered one to four. The review template lists timeline, impact, causes and follow-up tasks.\n\nTraining. New staff complete security awareness training in their first two weeks and refresh it every year. Optional workshops on testing, accessibility and documentation run monthly. Certificates are paid by the company when the topic is relevant to the role.\n\nProcurement. Software purchases above a fixed amount need a second signature. Open-source dependencies are reviewed for licence terms before adoption. Vendor contracts are renewed in January and the list of vendors is kept by the finance team.\n'
const docOf = (t: { doc: string }) => FILLER_A + t.doc + FILLER_B
const BUILDER_SYSTEM = 'You implement one JavaScript function in an ES module. Reply with the complete module in exactly one ```js code block and nothing else.'
const args = process.argv.slice(2); const arg = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const builder = arg('builder'), models = (arg('models') ?? '').split(',').filter(Boolean), out = arg('out')
if (!builder || !models.length || !out) { console.error('usage: --builder <ref> --models <a,b> --out <dir>'); process.exit(2) }
mkdirSync(out, { recursive: true })
const base = loopbackBaseUrl()
const unload = async (m: string) => { await fetch(`${base}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: m, keep_alive: 0 }) }).catch(() => undefined); await new Promise((r) => setTimeout(r, 3500)) }
const ps = async () => ((await (await fetch(`${base}/api/ps`)).json()) as { models?: { name: string }[] }).models?.map((m) => m.name) ?? []
for (const m of await ps()) await unload(m)

const buildPrompt = (t: Task, extra: string) => `${t.ask}\n${extra}`
async function buildWith(client: OllamaModelClient, t: Task, extra: string) {
  const t0 = Date.now(); const r = await client.generate({ system: BUILDER_SYSTEM, prompt: buildPrompt(t, extra), maxTokens: 900, timeoutMs: 180_000, temperature: 0.1, seed: 5 })
  if (!r.ok) return { pass: false, ms: Date.now() - t0, detail: r.detail }
  const e = await runModule(`${extractCode(r.text)}\n${H}${t.test}\n`)
  return { pass: e.ok, ms: Date.now() - t0, detail: e.ok ? 'ok' : (e.stderr.split('\n').find((l) => /Error/.test(l)) ?? `exit ${e.exitCode}`).slice(0, 100) }
}
const report: Record<string, unknown> = { at: new Date().toISOString(), builder, tasks: TASKS.length, models: {} as Record<string, unknown> }
const results = (report.models as Record<string, unknown>)
const bclient = new OllamaModelClient(builder, base, '10m')
// the NONE and RAW conditions do not depend on the research model: run them once
const baseConds: Record<string, { none: boolean; raw: boolean }> = {}
const sampler = new MemSampler().start()
const tb0 = Date.now()
for (const t of TASKS) {
  const none = await buildWith(bclient, t, ''); const raw = await buildWith(bclient, t, `\nDOCUMENT:\n${docOf(t)}`)
  baseConds[t.id] = { none: none.pass, raw: raw.pass }; console.log(`  ${t.id}: builder none=${none.pass} raw=${raw.pass}`)
}
const builderWarmMs = Math.round((Date.now() - tb0) / (TASKS.length * 2))
await unload(builder)
for (const model of models) {
  console.log(`[research] ${model}`)
  const researcher = makeResearcher(new OllamaModelClient(model, base, '0'), model)
  const idle = readMem(); const t0 = Date.now(); const briefs: { id: string; text: string; ms: number; relevant: boolean; reason: string; coverage: number; unsupported: number; invented: number }[] = []
  const gpuBefore = readMem().gpuMiB; let peak = 0; const peakTimer = setInterval(() => { const g = readMem().gpuMiB; if (typeof g === 'number') peak = Math.max(peak, g) }, 800)
  for (const t of TASKS) {
    const b = await researcher({ request: t.ask, acceptance: [], trigger: { fire: true, reasons: ['bench'], topic: t.id, sources: ['doc.md'] }, material: [{ path: 'doc.md', text: docOf(t) }] })
    const a = assessBrief({ text: b.text, sources: ['doc.md'] }, t.ask, [], [{ path: 'doc.md', text: docOf(t) }])
    briefs.push({ id: t.id, text: b.text, ms: b.ms, relevant: b.relevance.relevant, reason: b.relevance.reason, coverage: t.facts.filter((f) => f.test(b.text)).length / t.facts.length, unsupported: a.unsupported.length, invented: b.inventedCitations ?? 0 })
    console.log(`  brief ${t.id}: ${b.ms}ms coverage ${(briefs.at(-1)!.coverage * 100) | 0}% relevant=${b.relevance.relevant}`)
  }
  clearInterval(peakTimer)
  const researchMs = Date.now() - t0
  await unload(model)
  // builder phase: the first call pays the reload that the research phase caused
  const first = await buildWith(bclient, TASKS[0], '\nDOCUMENT:\n' + docOf(TASKS[0])); const reloadPenaltyMs = Math.max(0, first.ms - builderWarmMs)
  const conds: Record<string, boolean> = {}
  for (const t of TASKS) {
    const b = briefs.find((x) => x.id === t.id)!
    const withBrief = b.relevant ? await buildWith(bclient, t, `\nRESEARCH BRIEF (advisory):\n${b.text.slice(0, 1200)}`) : { pass: false, ms: 0, detail: 'brief withheld by Foundry' }
    conds[t.id] = withBrief.pass; console.log(`  ${t.id}: builder with brief=${withBrief.pass}${b.relevant ? '' : ' (withheld)'}`)
  }
  await unload(builder)
  const n = TASKS.length
  results[model] = {
    briefMeanMs: Math.round(briefs.reduce((a, b) => a + b.ms, 0) / n), researchPhaseMs: researchMs, factCoverageMean: Math.round(briefs.reduce((a, b) => a + b.coverage, 0) / n * 1000) / 1000, unsupportedClaimsTotal: briefs.reduce((a, b) => a + b.unsupported, 0), inventedCitationsTotal: briefs.reduce((a, b) => a + b.invented, 0),
    briefsWithheldByFoundry: briefs.filter((b) => !b.relevant).length, builderReloadPenaltyMs: reloadPenaltyMs, gpuIdleMiB: idle.gpuMiB, gpuBeforeMiB: gpuBefore, gpuPeakMiB: peak,
    builderSuccess: { none: TASKS.filter((t) => baseConds[t.id].none).length, raw: TASKS.filter((t) => baseConds[t.id].raw).length, brief: Object.values(conds).filter(Boolean).length, of: n },
    perTask: TASKS.map((t) => ({ id: t.id, none: baseConds[t.id].none, raw: baseConds[t.id].raw, brief: conds[t.id], coverage: briefs.find((b) => b.id === t.id)!.coverage, relevant: briefs.find((b) => b.id === t.id)!.relevant, briefMs: briefs.find((b) => b.id === t.id)!.ms })),
    briefs,
  }
}
sampler.stop(); (report as Record<string, unknown>).builderWarmMsPerCall = builderWarmMs; (report as Record<string, unknown>).swapDeltaPeakMiB = sampler.peakSwap - sampler.baseline.swapUsedMiB
writeFileSync(path.join(out, 'research-bench.json'), JSON.stringify(report, null, 1))
console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => { const x = v as Record<string, any>; return [k, { briefMeanMs: x.briefMeanMs, coverage: x.factCoverageMean, unsupported: x.unsupportedClaimsTotal, inventedCitations: x.inventedCitationsTotal, withheld: x.briefsWithheldByFoundry, reloadPenaltyMs: x.builderReloadPenaltyMs, builder: x.builderSuccess }] })), null, 1)) // eslint-disable-line @typescript-eslint/no-explicit-any
