/** Static cross-reference gates: they catch the real defects, and never flag the independent reference implementations. Run: pnpm run validate:agent-eng-gates */
import { harness } from './engtestkit'
import { undefinedNames, routeShadowing, domIds, missingDomIds } from './staticGates'
import { CHAT_REFERENCE } from './chatFixture'
import { TASK_REFERENCE } from './taskFixture'
import { ALERT_REFERENCE } from './alertFixture'
import { TICKET_REFERENCE } from './ticketFixture'

const { check, finish } = harness('AGENT_ENG_GATES_VALIDATION')
check('V01_a_call_to_a_function_that_is_never_imported_or_declared_is_found', undefinedNames('server.mjs', "import { a } from './x.mjs'\nexport const r = () => countEvents() + a()\n").join() === 'countEvents')
check('V02_declared_imported_and_global_names_are_not_flagged', undefinedNames('s.mjs', "import { readFileSync } from 'node:fs'\nimport path from 'node:path'\nconst p = process.env.PORT\nconst u = new URL('http://x')\nexport async function f(req) { for await (const c of req) console.log(c, path.sep, readFileSync, p, u, fetch, setTimeout, AbortSignal, Buffer) }\n").length === 0)
check('V03_a_client_script_using_the_dom_is_not_flagged', undefinedNames('public/client.js', "async function load() { const el = document.getElementById('x'); el.textContent = String((await (await fetch('/api')).json()).n); window.addEventListener('load', load) }\nload()\n").length === 0)
check('V04_ESM_misuse_dirname_is_reported_as_undefined', undefinedNames('a.mjs', "export const d = __dirname\n").join() === '__dirname')
check('V05_a_prefix_route_before_a_literal_route_shadows_it', (() => { const s = routeShadowing('server.mjs', "    if (url.pathname.startsWith('/api/alerts/') && req.method === 'POST') {\n    }\n    if (url.pathname === '/api/alerts/read-all' && req.method === 'POST') return 1\n"); return s.length === 1 && s[0].literal === '/api/alerts/read-all' })())
check('V06_literal_first_or_different_method_is_not_shadowing', routeShadowing('server.mjs', "    if (url.pathname === '/api/alerts/read-all' && req.method === 'POST') return 1\n    if (url.pathname.startsWith('/api/alerts/') && req.method === 'POST') {}\n").length === 0 && routeShadowing('server.mjs', "    if (url.pathname.startsWith('/api/alerts/') && req.method === 'PATCH') {}\n    if (url.pathname === '/api/alerts/summary' && req.method === 'GET') return 1\n").length === 0)
check('V07_dom_ids_a_script_reads_must_exist_in_the_page', (() => { const ids = domIds("document.getElementById('a'); document.getElementById(\"b\")"); return ids.join() === 'a,b' && missingDomIds('<ul id="a"></ul>', ids).join() === 'b' })())
let flagged: string[] = []
for (const [name, ref] of Object.entries({ chat: CHAT_REFERENCE, task: TASK_REFERENCE, alert: ALERT_REFERENCE, ticket: TICKET_REFERENCE })) for (const [rel, text] of Object.entries(ref)) {
  const u = undefinedNames(rel, text), s = routeShadowing(rel, text)
  if (u.length || s.length) flagged.push(`${name}:${rel} undefined=${u.join('|')} shadow=${s.map((x) => x.literal).join('|')}`)
  if (/\.js$/.test(rel) && /public\//.test(rel)) { const html = Object.entries(ref).filter(([k]) => /\.html$/.test(k)).map(([, v]) => v).join('\n'); const miss = missingDomIds(html, domIds(text)); if (miss.length) flagged.push(`${name}:${rel} missing-ids=${miss.join('|')}`) }
}
check('V08_no_gate_flags_any_independent_reference_implementation_of_the_four_fixtures', flagged.length === 0, flagged.join('; '))
finish()
