/** Fixture D (similar-but-not-identical variant of C): verifier separates baseline / partial / complete, and the vocabulary really differs. Run: pnpm run validate:agent-eng-fixture-d */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { harness, tmp } from './engtestkit'
import { TICKET_FEATURE, TICKET_REFERENCE, TICKET_VERIFY_SCRIPT, makeTicketApp } from './ticketFixture'
import { ALERT_FEATURE } from './alertFixture'
import { makeIndependentVerification } from './runtime/verifier'

const { check, finish } = harness('AGENT_ENG_FIXTURE_D_VALIDATION')
const app = (mut: (root: string) => void = () => {}) => { const root = makeTicketApp(path.join(tmp(), 'desk')); mut(root); return root }
const score = async (root: string) => { const r = await makeIndependentVerification('ticket verifier', tmp(), 'verify.mjs', TICKET_VERIFY_SCRIPT, root).run(); const m = (re: RegExp) => Number(re.exec(r.stdout)?.[1]); return { exit: r.exitCode, pass: m(/# pass (\d+)/), total: m(/# tests (\d+)/), out: r.stdout } }
const writeRef = (root: string, patch: Record<string, (t: string) => string> = {}) => { for (const [rel, body] of Object.entries(TICKET_REFERENCE)) { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), patch[rel] ? patch[rel](body) : body) } }

const base = await score(app())
check('D01_untouched_baseline_fails_with_at_most_2_of_12', base.exit !== 0 && base.total === 12 && base.pass <= 2, `${base.pass}/${base.total}`)
const ref = await score(app((r) => writeRef(r)))
check('D02_the_independent_reference_passes_12_of_12', ref.exit === 0 && ref.pass === 12 && ref.total === 12, `${ref.pass}/${ref.total} ${ref.out.slice(-300)}`)
const mem = await score(app((r) => writeRef(r, { 'src/ticketStore.mjs': () => `let state = { lastId: 0, tickets: [] }\nexport function ticketsFile() { return 'memory' }\nexport function readTickets() { return state }\nexport function writeTickets(s) { state = s }\n` })))
check('D03_memory_only_storage_is_partial_11_of_12', mem.exit !== 0 && mem.pass === 11 && /not ok 12/.test(mem.out), `${mem.pass}/${mem.total}`)
const noRoute = await score(app((r) => writeRef(r, { 'server.mjs': (t) => t.replace("    if (url.pathname === '/api/tickets/read-all' && req.method === 'POST') return reply(res, 200, readAll())\n", '') })))
check('D04_a_missing_bulk_endpoint_is_caught', noRoute.exit !== 0 && /not ok 9/.test(noRoute.out), `${noRoute.pass}/${noRoute.total}`)
const text = JSON.stringify([TICKET_FEATURE, TICKET_REFERENCE, TICKET_VERIFY_SCRIPT, readFileSync(path.join(app(), 'server.mjs'), 'utf8')])
check('D05_the_variant_shares_no_nouns_or_value_sets_with_fixture_C_but_keeps_its_engineering_shape', !/alert|archive|severity|critical|warning/i.test(text) && /read-all/.test(text) && /unread-count/.test(text) && TICKET_FEATURE.acceptance.length === ALERT_FEATURE.acceptance.length && TICKET_FEATURE.request !== ALERT_FEATURE.request)
finish()
