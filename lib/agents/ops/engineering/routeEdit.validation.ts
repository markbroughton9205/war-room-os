/** Structural route edits: move/replace/insert/delete over parsed route blocks, fail-closed behaviour, status-contract diagnosis. Run: pnpm run validate:agent-eng-routeedit */
import { harness } from './engtestkit'
import { applyRouteOp, repairRouteOrder, statusDiagnosis } from './routeEdit'
import { routeFindings, routeTable, syntaxProblems } from './staticGates'

const { check, finish } = harness('AGENT_ENG_ROUTEEDIT_VALIDATION')
process.env.ENGINE_NODE_PARSE = '1'
const wrap = (body: string, pre = '', post = '') => `import { createServer } from 'node:http'\n${pre}const server = createServer((req, res) => {\n  const url = new URL(req.url, 'http://x')\n${body}\n${post}})\n`
const find = (t: string) => routeFindings('server.mjs', t)

// ---- 1. exact route moved ahead of a prefix route (two unrelated domains), unrelated bytes preserved
{
  const A = wrap(`  if (url.pathname === '/') return res.end('home')\n  if (url.pathname.startsWith('/api/orders/') && req.method === 'POST') {\n    const id = url.pathname.split('/')[3]\n    return res.end('order ' + id)\n  }\n  if (url.pathname === '/api/orders/export' && req.method === 'POST') return res.end('export')\n  res.statusCode = 404\n  res.end('nf')`)
  const r = repairRouteOrder('server.mjs', A)
  check('E01_prefix_first_layout_is_repaired_by_moving_only_the_specific_route', !!r && find(r.text).length === 0 && r.ops.length === 1 && r.ops[0].op === 'MOVE_ROUTE_BEFORE' && r.mode === 'ENGINE_DETERMINISTIC_REPAIR')
  const sortLines = (t: string) => t.split('\n').sort().join('\n')
  check('E02_the_move_preserves_every_other_byte_the_result_is_a_pure_permutation_of_lines', !!r && sortLines(r.text) === sortLines(A))
  check('E03_syntax_is_preserved_by_the_move', !!r && syntaxProblems('server.mjs', r.text).length === 0)
  check('E04_the_moved_route_and_the_prefix_handler_bodies_are_unchanged', !!r && r.text.includes("const id = url.pathname.split('/')[3]\n    return res.end('order ' + id)\n  }") && r.text.includes("return res.end('export')"))
  const B = wrap(`  if (url.pathname.startsWith('/v1/files/')) return res.end('f')\n  if (url.pathname === '/v1/files/purge') return res.end('p')\n  if (url.pathname === '/v1/files/stats') return res.end('s')`)
  const rb = repairRouteOrder('server.mjs', B)
  check('E05_several_hidden_routes_in_another_domain_are_all_repaired', !!rb && find(rb.text).length === 0 && rb.ops.length === 2)
}
// ---- 2. parameter and regex routes
{
  const P = wrap(`  if (/^\\/api\\/books\\/([^/]+)$/.test(url.pathname)) return res.end('one')\n  if (url.pathname === '/api/books/count') return res.end('count')`)
  const r = repairRouteOrder('server.mjs', P)
  check('E06_a_fixed_route_hidden_by_a_parameter_route_is_moved_ahead_of_it', !!r && find(r.text).length === 0 && r.text.indexOf("'/api/books/count'") < r.text.indexOf('books'))
  const Rg = wrap(`  if (url.pathname.match(/^\\/api\\/jobs\\/([^/]+)$/)) return res.end('job')\n  if (/^\\/api\\/jobs\\/summary$/.exec(url.pathname)) return res.end('sum')`)
  const rr = repairRouteOrder('server.mjs', Rg)
  check('E07_regex_routes_written_with_match_and_exec_are_ordered', !!rr && find(rr.text).length === 0 && rr.text.indexOf('summary') < rr.text.indexOf('([^/]+)'))
}
// ---- 3. catch-all ordering
{
  const C = wrap(`  if (url.pathname.startsWith('/')) return res.end('all')\n  if (url.pathname === '/health') return res.end('ok')`)
  const r = repairRouteOrder('server.mjs', C)
  check('E08_a_catch_all_prefix_registered_first_is_moved_after_the_specific_route', !!r && find(r.text).length === 0 && r.text.indexOf('/health') < r.text.indexOf("startsWith('/')"))
}
// ---- 4. idempotent, already-ordered, no-op
{
  const A = wrap(`  if (url.pathname.startsWith('/api/x/')) return res.end('p')\n  if (url.pathname === '/api/x/special') return res.end('s')`)
  const once = repairRouteOrder('server.mjs', A)!
  check('E09_a_correct_layout_needs_no_repair_and_repair_is_idempotent', repairRouteOrder('server.mjs', once.text) === null && applyRouteOp(once.text, { op: 'MOVE_ROUTE_BEFORE', route: { pattern: '/api/x/special' }, anchor: { pattern: '/api/x/' } }).ok === true)
  const again = applyRouteOp(once.text, { op: 'MOVE_ROUTE_BEFORE', route: { pattern: '/api/x/special' }, anchor: { pattern: '/api/x/' } })
  check('E10_applying_the_same_move_twice_changes_nothing_the_second_time', again.ok && !again.changed && again.text === once.text)
}
// ---- 5. fail closed
{
  const A = wrap(`  if (url.pathname.startsWith('/api/x/')) return res.end('p')\n  if (url.pathname === '/api/x/a' && req.method === 'GET') return res.end('1')\n  if (url.pathname === '/api/x/a' && req.method === 'POST') return res.end('2')`)
  const miss = applyRouteOp(A, { op: 'MOVE_ROUTE_BEFORE', route: { pattern: '/api/x/nope' }, anchor: { pattern: '/api/x/' } })
  check('E11_a_missing_target_route_fails_closed_with_the_reason', !miss.ok && /not found/.test((miss as { reason: string }).reason))
  const amb = applyRouteOp(A, { op: 'MOVE_ROUTE_BEFORE', route: { pattern: '/api/x/a' }, anchor: { pattern: '/api/x/' } })
  check('E12_an_ambiguous_route_match_fails_closed_and_asks_for_the_line_or_method', !amb.ok && /ambiguous/.test((amb as { reason: string }).reason))
  const ok = applyRouteOp(A, { op: 'MOVE_ROUTE_BEFORE', route: { pattern: '/api/x/a', method: 'POST' }, anchor: { pattern: '/api/x/' } })
  check('E13_naming_the_method_disambiguates_and_only_that_route_moves', ok.ok && ok.changed && ok.text.split('\n').findIndex((l) => /POST/.test(l)) < ok.text.split('\n').findIndex((l) => /startsWith/.test(l)) && ok.text.split('\n').findIndex((l) => /GET/.test(l)) > ok.text.split('\n').findIndex((l) => /startsWith/.test(l)))
  const nested = wrap(`  if (url.pathname.startsWith('/api/x/')) {\n    if (url.pathname === '/api/x/inner') return res.end('i')\n    return res.end('p')\n  }`)
  check('E14_a_route_nested_inside_another_block_is_not_treated_as_a_moveable_route', routeTable(nested).length === 1 && !applyRouteOp(nested, { op: 'MOVE_ROUTE_BEFORE', route: { pattern: '/api/x/inner' }, anchor: { pattern: '/api/x/' } }).ok)
  const unconv = wrap(`  if (url.pathname.startsWith('/q/')) return res.end('1')\n  if (url.pathname === '/q/a') return res.end('2')\n  if (url.pathname === '/q/a') return res.end('3')`)
  const rc = repairRouteOrder('server.mjs', unconv)
  check('E15_a_non_identical_duplicate_is_not_auto_deleted', rc === null || !rc.ops.some((o) => o.op === 'DELETE_DUPLICATE_ROUTE'))
}
// ---- 6. other operations
{
  const A = wrap(`  if (url.pathname === '/api/t' && req.method === 'GET') return res.end('1')\n  if (url.pathname === '/api/t' && req.method === 'GET') return res.end('1')`)
  const rd = repairRouteOrder('server.mjs', A)
  check('E16_a_byte_identical_duplicate_registration_is_removed', !!rd && find(rd.text).length === 0 && rd.ops[0].op === 'DELETE_DUPLICATE_ROUTE' && (rd.text.match(/\/api\/t/g) ?? []).length === 1)
  const rep = applyRouteOp(A.replace("return res.end('1')\n  if", "return res.end('first')\n  if"), { op: 'REPLACE_ROUTE_HANDLER', route: { pattern: '/api/t', method: 'GET', line: 5 }, block: "  if (url.pathname === '/api/t' && req.method === 'GET') return res.end('second')" })
  check('E17_replace_handler_changes_only_the_selected_block', rep.ok && rep.changed && rep.text.includes("'second'") && rep.text.includes("'first'"))
  const ins = applyRouteOp(A, { op: 'INSERT_ROUTE', anchor: { pattern: '/api/t', line: 4 }, where: 'before', block: "  if (url.pathname === '/health') return res.end('ok')" })
  check('E18_insert_route_places_the_new_block_before_the_anchor_and_keeps_syntax', ins.ok && ins.changed && ins.text.indexOf('/health') < ins.text.indexOf("'/api/t'") && syntaxProblems('server.mjs', ins.text).length === 0)
  const after = applyRouteOp(wrap(`  if (url.pathname === '/a') return res.end('a')\n  if (url.pathname === '/b') return res.end('b')\n  if (url.pathname === '/c') return res.end('c')`), { op: 'MOVE_ROUTE_AFTER', route: { pattern: '/a' }, anchor: { pattern: '/c' } })
  check('E19_move_route_after_places_it_below_the_anchor', after.ok && after.changed && after.text.indexOf("'/c'") < after.text.indexOf("'/a'") && after.text.indexOf("'/b'") < after.text.indexOf("'/c'"))
}
// ---- 7. handler / status preserved and the status diagnosis separates routing from handler semantics
{
  const files = { 'src/svc.mjs': `export function archive(id) { const e = new Error('archived'); e.status = 409; throw e }\nexport function mark(id) { return { id } }\n` }
  const acc = ['POST /api/things/:id/archive on an archived thing answers 409', 'GET /api/things/count answers 200']
  const shadowed = wrap(`  if (url.pathname.startsWith('/api/things/')) return res.end('x')\n  if (url.pathname === '/api/things/count' && req.method === 'GET') return res.end('0')`, "import { archive, mark } from './src/svc.mjs'\n", '')
  const d1 = statusDiagnosis(shadowed, files, ['GET /api/things/count answers 404 when empty'])
  check('E20_a_shadowed_route_is_diagnosed_as_ROUTE_ORDER_not_as_a_handler_fault', d1.some((d) => d.target === 'ROUTE_ORDER' && d.route === '/api/things/count'))
  const handlerBad = wrap(`  if (url.pathname.startsWith('/api/things/') && req.method === 'POST') return res.end(JSON.stringify(mark(1)))\n  if (url.pathname === '/api/things/count' && req.method === 'GET') return res.end('0')`, "import { archive, mark } from './src/svc.mjs'\n", '')
  const d2 = statusDiagnosis(handlerBad, { 'src/svc.mjs': `export function mark(id) { return { id } }\n` }, acc)
  check('E21_a_reachable_route_whose_code_cannot_produce_the_status_is_diagnosed_as_HANDLER', d2.some((d) => d.status === '409' && d.target === 'HANDLER'))
  const handlerOk = wrap(`  if (url.pathname.startsWith('/api/things/') && req.method === 'POST') { try { return res.end(JSON.stringify(archive(1))) } catch (e) { res.statusCode = e.status; return res.end('x') } }`, "import { archive } from './src/svc.mjs'\n", '')
  const d3 = statusDiagnosis(handlerOk, files, ['POST /api/things/:id/archive on an archived thing answers 409'])
  check('E22_a_status_that_the_handler_can_produce_is_OK', d3.some((d) => d.status === '409' && d.target === 'OK'))
  const missing = statusDiagnosis(wrap(`  if (url.pathname === '/') return res.end('h')\n  if (url.pathname === '/x') return res.end('x')\n  if (url.pathname === '/y') return res.end('y')`), {}, ['DELETE /api/things/:id answers 404'])
  check('E23_a_route_that_does_not_exist_is_diagnosed_as_ROUTE_MISSING', missing.some((d) => d.target === 'ROUTE_MISSING'))
}
// ---- 8. alias-declared routes move together with their declaration; shared declarations fail closed
{
  const T = wrap(`  if (url.pathname.startsWith('/api/s/')) return res.end('p')\n  const m = /^\\/api\\/s\\/(\\d+)$/.exec(url.pathname)\n  if (m) return res.end('one')\n  if (url.pathname === '/api/s/all') return res.end('all')`)
  const r = repairRouteOrder('server.mjs', T)
  check('E24_a_route_declared_through_a_const_alias_moves_together_with_its_declaration_no_use_before_declaration', !!r && find(r.text).length === 0 && syntaxProblems('server.mjs', r.text).length === 0 && r.text.indexOf('const m =') < r.text.indexOf('if (m)') && r.text.indexOf("'/api/s/all'") < r.text.indexOf("startsWith('/api/s/')"))
  const shared = wrap(`  if (url.pathname.startsWith('/api/s/')) return res.end('p')\n  const m = /^\\/api\\/s\\/(\\d+)$/.exec(url.pathname)\n  if (m) return res.end('one')\n  if (m && req.method === 'POST') return res.end('two')`)
  const mv = applyRouteOp(shared, { op: 'MOVE_ROUTE_BEFORE', route: { pattern: '^\\/api\\/s\\/(\\d+)$', method: null, line: 5 }, anchor: { pattern: '/api/s/' } })
  check('E25_a_declaration_shared_with_other_routes_fails_closed_instead_of_being_split', !mv.ok || !mv.changed)
}
finish()
