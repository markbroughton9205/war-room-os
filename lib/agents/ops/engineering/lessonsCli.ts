/**
 * Operator CLI for the durable lesson store used by real-model runs.
 *   harvest <storeDir> <runLogDir>...   capture lessons from finished runs' evidence and append them to the store (idempotent)
 *   show <storeDir>                     print the stored lessons
 * Usage: node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/agents/ops/engineering/lessonsCli.ts <cmd> ...
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AgentOpsLog } from '../log'
import { deriveAssignments } from './assignments'
import { allLessons, captureLessons, routeOrderGuidance } from './lessons'
const GUIDANCE_ROUTE = routeOrderGuidance

const [cmd, storeDir, ...runDirs] = process.argv.slice(2)
if (cmd === 'harvest' && storeDir) {
  const store = new AgentOpsLog(storeDir)
  const have = new Set(allLessons(store).map((l) => l.id))
  let added = 0
  for (const d of runDirs) {
    const log = new AgentOpsLog(d, { readOnly: true })
    for (const [id, v] of deriveAssignments(log).assignments) {
      const ex = v.outcome?.executor
      const executor = ex && ex !== 'UNKNOWN' ? `${ex.provider}:${ex.model}` : 'UNKNOWN'
      // capture into a scratch log so the source evidence log is never written
      const scratch = new AgentOpsLog(mkdtempSync(path.join(tmpdir(), 'lesson-scratch-')))
      for (const r of log.view().records) { try { scratch.append(r as never) } catch { /* duplicate or refused */ } }
      for (const l of captureLessons(scratch, id, { taskClass: v.assignment.taskClass, executor })) { if (!have.has(l.id) && (!process.env.LESSON_CLASS || l.cls === process.env.LESSON_CLASS)) { have.add(l.id); store.append({ t: 'lesson', lesson: l }); added += 1 } }
    }
  }
  console.log(JSON.stringify({ added, total: allLessons(store).length }))
} else if (cmd === 'author-route' && storeDir) {
  // A lesson from a recurring UNRESOLVED failure: authored only when the runs' own verifier evidence shows a literal route answered 404/400 (route shadowing).
  // It is recorded as NOT validated; the before/after experiment is what validates (or refutes) it.
  const { readdirSync, readFileSync } = await import('node:fs')
  const { createHash } = await import('node:crypto')
  const store = new AgentOpsLog(storeDir)
  const hits: { assignmentId: string; model: string }[] = []
  for (const d of runDirs) for (const f of readdirSync(d).filter((x) => x.startsWith('report-'))) {
    const r = JSON.parse(readFileSync(path.join(d, f), 'utf8')) as { assignmentId: string; model: string; debug?: { signature?: string }[] }
    if ((r.debug ?? []).some((x) => /(read-all|unread-count|summary)[^;]*status=(404|400)/.test(x.signature ?? ''))) hits.push({ assignmentId: r.assignmentId, model: r.model })
  }
  if (hits.length) {
    const id = `lesson-${createHash('sha256').update(`ROUTE_ORDER|${hits.map((h) => h.assignmentId).sort().join()}`).digest('hex').slice(0, 12)}`
    if (!allLessons(store).some((l) => l.id === id)) store.append({ t: 'lesson', lesson: { id, cls: 'ROUTE_ORDER', taskClass: 'feature_implementation', observation: `a literal sub-route (read-all / unread-count) answered 404 or 400 in ${hits.length} run(s): a prefix/id route registered earlier swallowed it`, correction: GUIDANCE_ROUTE(), evidence: { assignmentId: hits[0].assignmentId, kind: 'UNRESOLVED_FAILURE' }, at: new Date().toISOString(), executor: hits[0].model, trigger: 'feature_implementation: adding literal sub-routes next to id or prefix routes in a hand-written node:http router', applicability: ['task class feature_implementation', 'server.mjs routes by url.pathname'], validation: `NOT confirmed: the failure persisted through 3 repair attempts in ${hits.length} run(s) (${hits.map((h) => h.assignmentId).join(', ')}); effect is tested by a before/after run on a similar task` } } as never)
  }
  console.log(JSON.stringify({ evidenceRuns: hits.length, total: allLessons(store).length }))
} else if (cmd === 'show' && storeDir) {
  for (const l of allLessons(new AgentOpsLog(storeDir, { readOnly: true }))) console.log(JSON.stringify(l, null, 1))
} else console.log('usage: lessonsCli.ts <harvest <storeDir> <runLogDir>...|show <storeDir>>')
