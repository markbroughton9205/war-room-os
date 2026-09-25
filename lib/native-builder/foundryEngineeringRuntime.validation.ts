/**
 * Foundry Engineering Runtime v1 checks.
 * Includes a real isolated Python repair of the unexpected-keyword class.
 */
import { mkdtempSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { runWithWorkspaceRoot } from '@/lib/repo/workspaceContext'
import { issueFromCommanderReport } from './issueIngest'
import { reportIssue } from './runtime'
import { getRepair, saveRepair } from './storage'
import { applyProposal } from './patchApplier'
import { createHash } from 'node:crypto'
import {
  FOUNDRY_ENGINEERING_EVENT_TYPES,
  classifyWorkspacePath,
  engineeringEvent,
  outsideSpanUnchanged,
  reduceEngineeringEvents,
  spanChanged,
} from './foundryEngineeringEvents'
import {
  ALL_REPAIR_STRATEGIES,
  buildFailureSignature,
  decideFailureContinuation,
  parseUnexpectedKeyword,
  planUnexpectedKeywordRepair,
  trainerScriptNames,
} from './foundryEngineeringFailure'
import {
  FOUNDRY_ENGINEERING_CAPABILITIES,
  classifyEngineeringCommand,
  decideTrainerOwnership,
  engineeringRuntimeShouldOwn,
  rollbackOwnedMission,
  runEngineeringCommand,
  stopEngineeringProcess,
} from './foundryEngineeringRuntime'
import { runCodingMission } from './engineerLoop'

type CaseResult = { name: string; pass: boolean; detail: string }
const results: CaseResult[] = []
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`)
}

const NESTED = `import json

def emit(payload):
    print(json.dumps(payload, flush=True))

if __name__ == "__main__":
    emit({"ok": True})
`

const ASSIGNED = `import json
blob = json.dumps({"n": 1}, flush=True)
print(blob)
`

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

async function codingMission(workspace: string, request: string, title: string) {
  return runWithWorkspaceRoot(workspace, async () => {
    const opened = await reportIssue(issueFromCommanderReport({
      title,
      description: request,
      subsystem: 'project',
    }))
    if (!opened.repair) throw new Error('repair was not opened')
    await saveRepair({
      ...opened.repair,
      codingMission: {
        mode: 'bounded_coding',
        commanderRequest: request,
        objective: title,
        acceptanceCriteria: [request],
        plan: [],
        currentStep: 'PLANNING',
        attempt: 0,
        maxAttempts: 4,
        filesRead: [],
        filesChanged: [],
        commandsExecuted: [],
        testsExecuted: [],
        progressEvents: [],
        visualVerification: 'VISUAL_VERIFICATION_NOT_AVAILABLE',
        sessionId: 'engineering-runtime-validation',
      },
    })
    return runCodingMission(opened.repair.id)
  })
}

async function main() {
  const required = ['MISSION_STARTED', 'FILE_EDITED', 'FAILURE_DETECTED', 'STRATEGY_CHANGED', 'BLOCKED', 'MISSION_COMPLETE', 'COMMAND_OUTPUT', 'ROLLBACK_COMPLETE']
  check('event_types', required.every(type => (FOUNDRY_ENGINEERING_EVENT_TYPES as readonly string[]).includes(type)), String(FOUNDRY_ENGINEERING_EVENT_TYPES.length))
  check('strategies', ALL_REPAIR_STRATEGIES.includes('DIRECT_FIX') && ALL_REPAIR_STRATEGIES.includes('SPECIALIST_REVIEW'), String(ALL_REPAIR_STRATEGIES.length))
  check('capabilities', FOUNDRY_ENGINEERING_CAPABILITIES.some(item => item.id === 'trainer.lock' && item.owner.includes('wrim_single_trainer_lock.py')), String(FOUNDRY_ENGINEERING_CAPABILITIES.length))

  let stream = [] as ReturnType<typeof engineeringEvent>[]
  for (let i = 0; i < 3000; i++) {
    stream = reduceEngineeringEvents(stream, engineeringEvent('COMMAND_OUTPUT', {
      missionId: 'm',
      command: 'npm install',
      summary: 'progress',
      detail: `line ${i}\n`,
      status: 'running',
    }))
  }
  check('coalesce_output', stream.length === 1 && (stream[0].coalescedCount ?? 0) >= 3000 && (stream[0].detail?.length ?? 0) <= 1200, `events=${stream.length} tail=${stream[0]?.detail?.length}`)

  const same = { signature: 'sig', strategy: 'DIRECT_FIX', sourceFingerprint: 'src', summary: 'TypeError' }
  const changed = decideFailureContinuation({ history: [same], nextSignature: 'sig', nextStrategy: 'DIRECT_FIX', sourceFingerprint: 'src' })
  const freshSource = decideFailureContinuation({ history: [same], nextSignature: 'sig', nextStrategy: 'DIRECT_FIX', sourceFingerprint: 'src-2' })
  check('retry_changes_strategy', changed.action === 'change_strategy' && changed.strategy === 'ROOT_CAUSE_TRACE', changed.action)
  check('new_source_allowed', freshSource.action === 'allow', freshSource.action)
  let history = [same]
  let strategy = 'DIRECT_FIX'
  let guard = 0
  while (guard < 20) {
    guard += 1
    const decision = decideFailureContinuation({ history, nextSignature: 'sig', nextStrategy: strategy, sourceFingerprint: 'src' })
    if (decision.action === 'block') break
    if (decision.action === 'change_strategy') strategy = decision.strategy
    history = [...history, { signature: 'sig', strategy, sourceFingerprint: 'src', summary: strategy }]
  }
  check('bounded_block', guard < 20 && history.length <= 16, `steps=${guard} history=${history.length}`)

  const parsed = parseUnexpectedKeyword('TypeError: json.dumps() got an unexpected keyword argument \'flush\'\nFile "serialize.py", line 4')
  check('parse_unexpected_kw', parsed?.callable === 'json.dumps' && parsed.keyword === 'flush' && parsed.line === 4, parsed?.callable ?? 'none')
  const nestedPlan = planUnexpectedKeywordRepair(NESTED, { callable: 'JSONEncoder.__init__', keyword: 'flush', line: 4, traceback: 'TypeError: JSONEncoder.__init__() got an unexpected keyword argument \'flush\'' })
  check('nested_repair_plan', Boolean(nestedPlan && nestedPlan.nextSource.includes('print(json.dumps(payload), flush=True)') && !nestedPlan.nextSource.includes('print(print(') && !nestedPlan.nextSource.includes('json.dumps(payload, flush=True)')), nestedPlan?.nextSource.split('\n').find(line => line.includes('dumps')) ?? 'no plan')
  check('nested_span_stable', Boolean(nestedPlan && outsideSpanUnchanged(NESTED, nestedPlan.nextSource, nestedPlan.start, nestedPlan.end) && spanChanged(NESTED, nestedPlan.nextSource, nestedPlan.start, nestedPlan.end)), 'span')
  const assignedPlan = planUnexpectedKeywordRepair(ASSIGNED, { callable: 'json.dumps', keyword: 'flush', traceback: '' })
  check('assigned_repair_plan', Boolean(assignedPlan && assignedPlan.nextSource.includes('json.dumps({"n": 1})') && assignedPlan.nextSource.includes('print(blob, flush=True)')), assignedPlan ? assignedPlan.nextSource.replace(/\n/g, ' | ') : 'no plan')

  const push = classifyEngineeringCommand('git', ['push', 'origin', 'main'], false)
  const status = classifyEngineeringCommand('git', ['status'], false)
  const wipe = classifyEngineeringCommand('rm', ['-rf', 'tmp'], false)
  const paid = classifyEngineeringCommand('stripe', ['checkout'], false)
  check('governance_push', push.commandClass === 'GIT_PERSISTENT' && push.allowed === false, push.reason ?? '')
  check('governance_status', status.commandClass === 'READ_ONLY' && status.allowed === true, status.commandClass)
  check('governance_delete', wipe.allowed === false && wipe.commandClass === 'DESTRUCTIVE', wipe.reason ?? '')
  check('governance_paid', paid.commandClass === 'FINANCIAL' && paid.allowed === false, paid.commandClass)
  check('dirty_isolation', classifyWorkspacePath({ path: 'keep.txt', preexisting: ['keep.txt', 'serialize.py'], modified: ['serialize.py'], created: [], deleted: [] }) === 'PREEXISTING' && classifyWorkspacePath({ path: 'serialize.py', preexisting: ['keep.txt', 'serialize.py'], modified: ['serialize.py'], created: [], deleted: [] }) === 'MISSION_MODIFIED', 'classes')
  check('own_small_fix', engineeringRuntimeShouldOwn({ fileCount: 2, request: 'Fix the failing serialization script' }) && !engineeringRuntimeShouldOwn({ fileCount: 4000, request: 'Fix the repo' }), 'scope')

  const trainerSource = readFileSync(path.join(process.cwd(), 'scripts/wrim-environment/wrim_single_trainer_lock.py'), 'utf8')
  const names = trainerScriptNames(trainerSource)
  check('trainer_names_from_lock_module', names.includes('wrim_ra1_train.py') && names.includes('wrim_ea1_program.py'), String(names.length))
  const refused = decideTrainerOwnership({ script: 'wrim_ra1_train.py', trainerScripts: names, activeTrainers: ['99 python wrim_ra1_train.py'], lockAlive: true })
  const allowed = decideTrainerOwnership({ script: 'serialize.py', trainerScripts: names, activeTrainers: ['99 python wrim_ra1_train.py'], lockAlive: true })
  check('trainer_ownership', refused.allowed === false && allowed.allowed === true && refused.reason.includes('WRIM_SINGLE_TRAINER_LOCK'), refused.reason)

  const shell = readFileSync(path.join(process.cwd(), 'components/war-room/foundry/FoundryShell.tsx'), 'utf8')
  check('terminal_not_auto_open', shell.includes('data-terminal-collapsed') && !shell.includes("setDrawer(d => (d === 'hidden' ? 'terminal' : d))") && shell.includes('FoundryQuietThread'), 'shell')
  check('signature_stable', buildFailureSignature({ message: 'TypeError: json.dumps() unexpected', file: '/tmp/serialize.py', exitCode: 1 }).id === buildFailureSignature({ message: 'TypeError: json.dumps() unexpected', file: '/var/serialize.py', exitCode: 1 }).id, 'hash')

  const workspace = realpathSync(mkdtempSync(path.join(tmpdir(), 'foundry-eng-')))
  writeFileSync(path.join(workspace, 'serialize.py'), NESTED)
  writeFileSync(path.join(workspace, 'keep.txt'), 'preexisting-dirty\n')
  try {
    const finished = await codingMission(workspace, 'Fix the failing serialization script', 'Fix serialization')
    const events = finished.codingMission?.engineeringRuntime?.events ?? []
    const types = new Set(events.map(event => event.type))
    const script = readFileSync(path.join(workspace, 'serialize.py'), 'utf8')
    const kept = readFileSync(path.join(workspace, 'keep.txt'), 'utf8')
    check('json_flush_repaired', script.includes('print(json.dumps(payload), flush=True)') && !script.includes('print(print(') && !script.includes('json.dumps(payload, flush=True)'), script.split('\n').find(line => line.includes('dumps')) ?? '')
    check('preexisting_untouched', kept === 'preexisting-dirty\n', kept)
    check('chat_events', ['REPOSITORY_MAP_CREATED', 'FILE_READ', 'FAILURE_DETECTED', 'FILE_EDITED', 'MISSION_COMPLETE'].every(type => types.has(type as never)), [...types].join(','))
    check('completion_truth', finished.codingMission?.engineeringRuntime?.completion?.canComplete === true && finished.codingMission.engineeringRuntime.completion.commitOccurred === false && finished.codingMission.engineeringRuntime.completion.pushOccurred === false && finished.codingMission.engineeringRuntime.completion.deployOccurred === false, finished.codingMission?.engineeringRuntime?.completion?.limitations[0] ?? '')
    const receipt = finished.codingMission?.engineeringRuntime?.receipts[0]
    check('edit_receipt', Boolean(receipt && receipt.validation === 'PASS' && receipt.beforeFingerprint !== receipt.afterFingerprint), receipt?.file ?? 'none')
    const resumed = await runWithWorkspaceRoot(workspace, () => runCodingMission(finished.id))
    check('resume_keeps_completion', resumed.codingMission?.engineeringRuntime?.completion?.canComplete === true && resumed.codingMission.engineeringRuntime.events.length === events.length, String(resumed.codingMission?.engineeringRuntime?.events.length))
    const disk = JSON.parse(readFileSync(path.join(workspace, '.war-room/native-builder/repairs', `${finished.id}.json`), 'utf8')) as { codingMission?: { engineeringRuntime?: { events?: unknown[] } } }
    check('event_persistence', (disk.codingMission?.engineeringRuntime?.events?.length ?? 0) === events.length, String(disk.codingMission?.engineeringRuntime?.events?.length))

    const blocked = await codingMission(workspace, 'Governance block: do not run git push origin main', 'Governance block')
    check('blocked_detail', Boolean(blocked.codingMission?.engineeringRuntime?.blockedDetail?.unblockAction && blocked.state === 'blocked' && blocked.codingMission.engineeringRuntime.blockedDetail.failure.includes('git push')), blocked.codingMission?.engineeringRuntime?.blockedDetail?.unblockAction ?? blocked.state)

    const rolled = await runWithWorkspaceRoot(workspace, async () => {
      const current = readFileSync(path.join(workspace, 'serialize.py'), 'utf8')
      const proposal = {
        issueId: finished.issueId,
        sourceKind: 'deterministic' as const,
        proposerId: 'rollback-check',
        diagnosis: 'Temporary worse edit',
        confidence: 'high' as const,
        relevantFiles: ['serialize.py'],
        plannedChanges: [{
          file: 'serialize.py',
          reason: 'worse',
          operation: 'replace_range' as const,
          patch: {
            operation: 'replace_range' as const,
            file: 'serialize.py',
            expectedOriginalHash: sha256(current),
            matchText: 'flush=True',
            replacementText: 'flush=False',
          },
        }],
        validations: [],
        risks: [],
        rollbackPlan: 'snapshot',
        generatedAt: new Date().toISOString(),
      }
      const applied = await applyProposal(finished.id, proposal)
      const worse = readFileSync(path.join(workspace, 'serialize.py'), 'utf8')
      const back = await rollbackOwnedMission(finished.id)
      const restored = readFileSync(path.join(workspace, 'serialize.py'), 'utf8')
      const stillKept = readFileSync(path.join(workspace, 'keep.txt'), 'utf8')
      return { applied: applied.ok, worse: worse.includes('flush=False'), restored: restored === NESTED, kept: stillKept === 'preexisting-dirty\n', back: back.ok }
    })
    check('rollback_mission_only', rolled.applied && rolled.worse && rolled.restored && rolled.kept && rolled.back, JSON.stringify(rolled))
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }

  const cancelDir = realpathSync(mkdtempSync(path.join(tmpdir(), 'foundry-cancel-')))
  try {
    const pending = runEngineeringCommand({
      missionId: 'cancel-check',
      cmd: 'python3',
      args: ['-c', 'import time; time.sleep(30)'],
      cwd: cancelDir,
      timeoutMs: 8000,
    })
    await new Promise(resolve => setTimeout(resolve, 200))
    const stopped = stopEngineeringProcess('cancel-check')
    const ended = await pending
    check('process_cancel', stopped && (ended.cancelled || ended.code === null || ended.durationMs < 7000), `stopped=${stopped} code=${ended.code} ms=${ended.durationMs}`)
  } finally {
    rmSync(cancelDir, { recursive: true, force: true })
  }

  const failed = results.filter(item => !item.pass)
  console.log(`ENGINEERING_RUNTIME ${results.length - failed.length}/${results.length}`)
  if (failed.length) process.exit(1)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => {
    console.error(error)
    process.exit(1)
  })
}
