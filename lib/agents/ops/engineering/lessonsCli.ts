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
import { allLessons, captureLessons } from './lessons'

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
} else if (cmd === 'show' && storeDir) {
  for (const l of allLessons(new AgentOpsLog(storeDir, { readOnly: true }))) console.log(JSON.stringify(l, null, 1))
} else console.log('usage: lessonsCli.ts <harvest <storeDir> <runLogDir>...|show <storeDir>>')
